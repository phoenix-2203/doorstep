import { createWalletClient, custom, parseUnits, isAddress, getAddress } from 'viem';
import qrcode from 'qrcode-generator';
import {
  createDoorstep, depositIntent, describe, explain, parseLink, toLink, formatUsdc6, formatUsdc18,
  DoorstepError, DOORSTEP_ABI, LANDER_CODE_HASH, paymentState, toUnits6, intentHash as intentHashOf,
} from '../sdk/src/index.js';
import { CONFIG, SITE, TESTNET } from './config.js';

// ---------------------------------------------------------------- config

const params = new URLSearchParams(location.search);
const chainId = Number(params.get('chain') ?? CONFIG.chainId);
const base = chainId === TESTNET.chainId ? { ...CONFIG, ...TESTNET } : { ...CONFIG };
const net = { ...base, rpcUrl: params.get('rpc') ?? base.rpcUrl, chainId };
const ESCROW = getAddress(params.get('escrow') ?? CONFIG.escrow);
const legacy = (CONFIG.legacy ?? []).map((l) => ({ ...l, doorstep: getAddress(l.doorstep) }));
const CURRENT_FROM = BigInt(params.get('from') ?? CONFIG.deployBlock);

// Which Doorstep a link belongs to: explicit ?doorstep=, else v1 for links made before the current
// deployment, else the current one.
function doorstepFor(fromBlock) {
  if (params.get('doorstep')) return getAddress(params.get('doorstep'));
  const current = getAddress(CONFIG.doorstep);
  if (fromBlock !== undefined && fromBlock < BigInt(CONFIG.deployBlock)) {
    const old = legacy.filter((l) => BigInt(l.deployBlock) <= fromBlock).sort((a, b) => b.deployBlock - a.deployBlock)[0];
    if (old) return old.doorstep;
  }
  return current;
}
const isLegacy = (addr) => legacy.some((l) => l.doorstep === addr);

// Arc's public RPC allows about one request per second per visitor, so the page paces its log
// searches (pauseMs), retries once, and polls gently.
const POLL_MS = 8000;
const clientFor = (doorstep, fromBlock) => createDoorstep({
  chainId, rpcUrl: net.rpcUrl, explorer: net.explorer, doorstep, fromBlock: fromBlock ?? CURRENT_FROM,
  pauseMs: 1100, retryCount: 1,
});
const isBusy = (e) => e?.status === 429 || /rate.?limit|too many requests|429/i.test(`${e?.shortMessage ?? ''} ${e?.details ?? ''} ${e?.message ?? ''}`);
const BUSY_TEXT = "Arc's public network connection is busy. Retrying in a few seconds…";
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode: fine */ } },
};

const ESCROW_ABI = [
  { type: 'function', name: 'balanceOf6', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'withdraw', stateMutability: 'nonpayable', inputs: [{ type: 'uint256', name: 'amount6' }, { type: 'address', name: 'to' }], outputs: [] },
];
const $ = (id) => document.getElementById(id);
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const chainName = chainId === 5042 ? 'Arc' : chainId === 5042002 ? 'Arc Testnet' : 'Local Arc node';
$('net').innerHTML = `<b>${chainName}</b>`;
for (const el of document.querySelectorAll('.api-link')) el.href = `${SITE.api}/docs`;
const link = (path, text) => `<a href="${net.explorer}/${path}" target="_blank" rel="noopener">${text}</a>`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const usd = (s) => Number(s).toLocaleString(undefined, { maximumFractionDigits: 6 });
const errText = (e) => e?.shortMessage ?? e?.message ?? String(e);
const say = (id, html, err) => { const el = $(id); el.className = err ? 'msg err' : 'msg'; el.innerHTML = html; };

// ---------------------------------------------------------------- wallet

let wallet;
async function connect(ds, { silent = false } = {}) {
  if (!window.ethereum) {
    if (silent) return null;
    throw new Error('No browser wallet found. Install one (e.g. Rabby or MetaMask), or send to the address from any wallet or exchange.');
  }
  if (silent) {
    // Reuse an earlier approval without any wallet prompt; switch networks only when sending.
    const accts = await window.ethereum.request({ method: 'eth_accounts' });
    if (!accts?.length) return null;
    wallet = createWalletClient({ chain: ds.chain, transport: custom(window.ethereum), account: getAddress(accts[0]) });
    return wallet;
  }
  const hexId = '0x' + chainId.toString(16);
  try {
    await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexId }] });
  } catch (e) {
    // 4902: unknown chain. Some wallets wrap it.
    const code = e?.code ?? e?.data?.originalError?.code;
    if (code !== 4902 && !/Unrecognized|not added|unknown chain/i.test(e?.message ?? '')) throw e;
    await window.ethereum.request({
      method: 'wallet_addEthereumChain',
      params: [{ chainId: hexId, chainName, nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: [net.rpcUrl], blockExplorerUrls: [net.explorer] }],
    });
  }
  const [account] = await window.ethereum.request({ method: 'eth_requestAccounts' });
  wallet = createWalletClient({ chain: ds.chain, transport: custom(window.ethereum), account: getAddress(account) });
  return wallet;
}

function renderQr(el, text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  el.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  el.querySelector('svg')?.setAttribute('aria-label', `QR code for ${text}`);
}

function namesFor(intent, { you } = {}) {
  const n = {};
  if (getAddress(intent.target) === ESCROW) n[ESCROW] = 'the demo savings vault';
  if (you) n[getAddress(you)] = 'you';
  return n;
}

async function withdrawAll(ds, owner, msgId, after) {
  const w = await connect(ds);
  if (w.account.address !== owner) {
    throw new Error(`This balance belongs to ${short(owner)}, but your wallet is connected as ${short(w.account.address)}. Switch to that account in your wallet and try again.`);
  }
  const amount = await ds.publicClient.readContract({ address: ESCROW, abi: ESCROW_ABI, functionName: 'balanceOf6', args: [owner] });
  if (amount === 0n) throw new Error('Nothing to withdraw yet.');
  say(msgId, `Withdrawing ${formatUsdc6(amount)} USDC. Confirm in your wallet…`);
  const hash = await w.writeContract({ address: ESCROW, abi: ESCROW_ABI, functionName: 'withdraw', args: [amount, owner] });
  say(msgId, `Sent, confirming… ${link('tx/' + hash, 'View transaction')}`);
  const r = await ds.publicClient.waitForTransactionReceipt({ hash });
  if (r.status !== 'success') throw new Error('The withdrawal failed.');
  say(msgId, `Done: ${formatUsdc6(amount)} USDC is now in your wallet. ${link('tx/' + hash, 'View transaction')}`);
  after?.();
}

// If the delivery bot hasn't picked a payment up after this long, offer to deliver it by hand.
const SLOW_MS = 15_000;
const SLOW_TEXT = 'Taking longer than usual: the delivery bot may be offline. You can deliver it yourself; your wallet pays the network fee (under $0.01) and gets it straight back from the payment.';

// ---------------------------------------------------------------- home: try it

// Each visitor's savings address is fixed: same wallet, same instructions, same address, every visit.
const SAVINGS_EXPIRY = new Date('2027-12-31T23:59:59Z');
const savingsIntent = (owner) => depositIntent({
  into: ESCROW, beneficiary: owner, refundTo: owner,
  minimum: '0.01', keeperFeeCap: '0.01', expires: SAVINGS_EXPIRY, reference: 'doorstep-savings',
});

async function initHome() {
  $('home-view').hidden = false;
  $('nav-home').setAttribute('aria-current', 'page');
  const ds = clientFor(getAddress(params.get('doorstep') ?? CONFIG.doorstep));
  let intent;
  let dep;
  let registered = false;
  let regKey = '';
  let events = [];
  let cursor = CURRENT_FROM;
  let tickNo = 0;
  let lastWaiting = 0n;

  const mark = (n, state) => { $(`s${n}`).classList.remove('done', 'now'); if (state) $(`s${n}`).classList.add(state); };

  async function onConnected(w) {
    intent = savingsIntent(w.account.address);
    dep = ds.depositAddress(intent);
    mark(1, 'done');
    say('s1-msg', `Connected as <span class="mono">${short(w.account.address)}</span>.`);
    $('btn-connect').textContent = 'Connected';
    $('btn-connect').disabled = true;
    regKey = `doorstep:registered:${ds.doorstep}:${w.account.address}`;
    try { cursor = (await ds.publicClient.getBlockNumber({ cacheTime: 0 })) - 2000n; } catch { /* keep default */ }
    if (store.get(regKey)) { registered = true; showAddress(); } else await checkRegistered();
    loop();
  }

  // Is this wallet's savings address already registered? Remembered after the first answer, so
  // later visits don't search the chain again. Retries calmly if the network is busy.
  let checkTries = 0;
  async function checkRegistered() {
    $('home-light').textContent = 'Checking your address…';
    say('s2-msg', 'Checking whether your address is already set up…');
    try {
      registered = await ds.isAnnounced(intent);
      if (registered) { store.set(regKey, '1'); showAddress(); return; }
      mark(2, 'now');
      $('btn-create').disabled = false;
      say('s2-msg', '');
      $('home-light').textContent = 'One step to get your address';
    } catch (e) {
      checkTries += 1;
      if (checkTries >= 2) {
        // Don't leave the visitor stuck: registering twice is harmless (it costs under $0.01).
        mark(2, 'now');
        $('btn-create').disabled = false;
        say('s2-msg', `${isBusy(e) ? BUSY_TEXT : esc(errText(e))} If you already did this step, there's no need to repeat it; still checking in the background.`);
      } else say('s2-msg', isBusy(e) ? BUSY_TEXT : esc(errText(e)));
      setTimeout(() => { if (!registered) checkRegistered(); }, 10_000);
    }
  }

  function showAddress() {
    mark(2, 'done');
    mark(3, 'now');
    $('btn-create').disabled = true;
    $('btn-create').textContent = 'Done';
    say('s2-msg', `Registered. Your address is ready.`);
    renderQr($('home-qr'), dep);
    $('home-addr').textContent = dep;
    $('home-slot').hidden = false;
    $('btn-home-pay').disabled = false;
    $('btn-home-copy').disabled = false;
    $('home-light').textContent = 'Ready for payments';
  }

  $('btn-connect').onclick = async () => {
    try { const w = await connect(ds); await onConnected(w); } catch (e) { say('s1-msg', esc(errText(e)), true); }
  };
  $('btn-create').onclick = async () => {
    try {
      const w = await connect(ds);
      say('s2-msg', 'Confirm in your wallet…');
      const { hash } = await ds.announce(intent, { walletClient: w });
      registered = true;
      store.set(regKey, '1');
      showAddress();
      say('s2-msg', `Registered. ${link('tx/' + hash, 'View transaction')}`);
    } catch (e) {
      say('s2-msg', `${esc(errText(e))}${/insufficient|funds/i.test(errText(e)) ? ' This wallet needs a little USDC on Arc for the fee.' : ''}`, true);
    }
  };
  $('btn-home-pay').onclick = async () => {
    try {
      const amount = prompt('How much USDC to send to your savings address?', '0.05');
      if (!amount) return;
      const w = await connect(ds);
      const tx = await w.sendTransaction({ to: dep, value: parseUnits(amount, 18) });
      say('s3-msg', `Sent. ${link('tx/' + tx, 'View transaction')}`);
    } catch (e) { say('s3-msg', esc(errText(e)), true); }
  };
  $('btn-home-copy').onclick = async () => {
    try { await navigator.clipboard.writeText(dep); say('s3-msg', 'Address copied. Paste it into any wallet or exchange withdrawal, on the Arc network.'); } catch (e) { say('s3-msg', esc(errText(e)), true); }
  };
  let arrivedAt = 0;
  $('btn-home-deliver').onclick = async () => {
    try {
      const w = await connect(ds);
      say('s4-msg', 'Delivering… confirm in your wallet.');
      const { hash } = await ds.land(intent, { walletClient: w });
      say('s4-msg', `Delivered. ${link('tx/' + hash, 'View transaction')}`);
      $('btn-home-deliver').hidden = true;
      refresh();
    } catch (e) { say('s4-msg', esc(errText(e)), true); }
  };
  $('btn-home-withdraw').onclick = async () => {
    try { await withdrawAll(ds, intent.refundTo, 's4-msg', refresh); } catch (e) { say('s4-msg', esc(errText(e)), true); }
  };

  // Two cheap reads per round: what's waiting at the address, and the savings balance. A delivery
  // shows up as the balance going up, so no log search is needed to notice it; log searches only
  // add the transaction link (every few rounds) and catch returned payments.
  let prevBal = null;
  let lastDelivered = 0n;
  async function refresh() {
    if (!intent || !registered) return;
    tickNo += 1;
    const [waiting, bal] = await Promise.all([
      ds.publicClient.getBalance({ address: dep }),
      ds.publicClient.readContract({ address: ESCROW, abi: ESCROW_ABI, functionName: 'balanceOf6', args: [intent.refundTo] }),
    ]);
    if (prevBal !== null && bal > prevBal) lastDelivered = bal - prevBal;
    const balanceRose = prevBal !== null && bal > prevBal;
    prevBal = bal;
    const justDelivered = (lastWaiting > 0n && waiting === 0n) || balanceRose;
    lastWaiting = waiting;
    if (justDelivered || tickNo % 4 === 1) {
      try {
        const head = await ds.publicClient.getBlockNumber({ cacheTime: 0 });
        if (cursor <= head) {
          events = events.concat(await ds.history(intent, { fromBlock: cursor, toBlock: head }));
          cursor = head + 1n;
        }
      } catch (e) { if (!isBusy(e)) throw e; /* links can wait for the next round */ }
    }
    $('home-balance').textContent = `${usd(formatUsdc6(bal))} USDC`;
    $('btn-home-withdraw').disabled = bal === 0n;
    const door = $('door-home');
    const last = events[events.length - 1];
    const belowMinimum = waiting / 10n ** 12n < intent.minAmount6;
    if (waiting > 0n) {
      const amt = usd(formatUsdc18(waiting));
      door.dataset.state = 'arrived';
      $('home-light').textContent = 'Payment arrived';
      $('s4-status').innerHTML = belowMinimum
        ? `${amt} USDC arrived. That's under the 0.01 USDC minimum, so it waits for more.`
        : `${amt} USDC arrived. Delivering it into your savings…`;
      mark(3, 'done'); mark(4, 'now');
      arrivedAt ||= Date.now();
      const slow = !belowMinimum && Date.now() - arrivedAt > SLOW_MS;
      $('btn-home-deliver').hidden = !slow;
      if (slow) $('s4-status').innerHTML = `${amt} USDC arrived. ${SLOW_TEXT}`;
    } else if (lastDelivered > 0n || last) {
      arrivedAt = 0;
      $('btn-home-deliver').hidden = true;
      const landed = last && last.event === 'Landed';
      const returned = last && last.event === 'Bounced' && !lastDelivered;
      door.dataset.state = returned ? 'bounced' : 'landed';
      $('home-light').textContent = returned ? 'Returned' : 'Delivered';
      if (returned) {
        $('s4-status').innerHTML = `Last payment was returned to your wallet (${last.reasonText}). ${link('tx/' + last.transactionHash, 'View transaction')}`;
      } else {
        const amount = landed ? formatUsdc6(last.amountPulled6) : formatUsdc6(lastDelivered);
        const fee = landed ? ` Network fee ${usd(formatUsdc18(last.keeperFee))} USDC${last.refunded > 0n ? `; the unused ${usd(formatUsdc18(last.refunded))} USDC of the fee allowance went back to your wallet` : ''}. ${link('tx/' + last.transactionHash, 'View transaction')}` : '';
        $('s4-status').innerHTML = `Last payment: ${amount} USDC delivered into your savings.${fee}`;
      }
      mark(3, 'done'); mark(4, 'done');
    } else {
      door.dataset.state = 'idle';
      $('home-light').textContent = 'Ready for payments';
    }
  }

  let looping = false;
  function loop() {
    if (looping) return;
    looping = true;
    const tick = async () => {
      try { await refresh(); say('s4-msg', ''); } catch (e) { say('s4-msg', isBusy(e) ? BUSY_TEXT : `Couldn't reach Arc: ${esc(errText(e))}`, !isBusy(e)); }
      setTimeout(tick, POLL_MS);
    };
    tick();
  }

  // Already connected on a previous visit? Pick up silently (no wallet prompt).
  try { const w = await connect(ds, { silent: true }); if (w) await onConnected(w); } catch { /* user can press Connect */ }
}

// ---------------------------------------------------------------- developers

async function initDev() {
  $('dev-view').hidden = false;
  $('nav-dev').setAttribute('aria-current', 'page');
  const ds = clientFor(doorstepFor());
  $('dev-facts').innerHTML = [
    ['Doorstep', `${link('address/' + ds.doorstep, ds.doorstep)}${isLegacy(ds.doorstep) ? ' (v1)' : ''}`],
    ['Demo savings vault', link('address/' + ESCROW, ESCROW)],
    ['Lander code hash', `<span class="mono">${LANDER_CODE_HASH}</span>`],
    ['Network', `${chainName}, chain id ${chainId}`],
  ].map(([k, v]) => `<div><dt>${k}</dt><dd class="mono">${v}</dd></div>`).join('');

  const f = $('intent-form');
  f.target.value = ESCROW;
  const read = () => {
    for (const k of ['target', 'beneficiary', 'refundTo']) {
      if (!isAddress(f[k].value.trim())) throw new DoorstepError(`missing:${k}`);
    }
    const exact = f.amount.value.trim();
    return depositIntent({
      into: f.target.value.trim(),
      beneficiary: f.beneficiary.value.trim(),
      refundTo: f.refundTo.value.trim(),
      // An invoice amount is also the minimum: nothing is delivered until all of it has arrived.
      minimum: exact || f.min.value || '0',
      keeperFeeCap: f.fee.value || '0',
      expires: `${Number(f.expiry.value)}s`,
      reference: f.ref.value || '',
    });
  };
  f.amount.addEventListener('input', () => { f.min.disabled = !!f.amount.value.trim(); if (f.amount.value.trim()) f.min.value = f.amount.value.trim(); });
  const preview = () => {
    const box = $('plain');
    try {
      const i = read();
      box.innerHTML = `<b>In plain words:</b> ${esc(describe(i, { names: namesFor(i, { you: wallet?.account.address }) }))}`;
      box.classList.remove('dim');
    } catch (e) {
      const which = { target: 'the contract', beneficiary: 'who gets credited', refundTo: 'the refund wallet' }[String(e.message).split(':')[1]];
      box.innerHTML = which ? `<b>In plain words:</b> fill in ${which} to see what this address will do.` : `<b>Check this:</b> ${esc(e.message)}`;
      box.classList.add('dim');
    }
  };
  f.addEventListener('input', preview);
  preview();

  $('btn-mine').onclick = async () => {
    try {
      const w = await connect(ds);
      f.beneficiary.value ||= w.account.address;
      f.refundTo.value = w.account.address;
      preview();
    } catch (e) { say('create-msg', esc(errText(e)), true); }
  };

  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      say('create-msg', 'Working out the address…');
      const block = await ds.publicClient.getBlock();
      // Expiry counts from the chain's clock, not this computer's.
      const intent = { ...read(), expiry: block.timestamp + BigInt(f.expiry.value) };
      // Cross-check the browser's maths against the contract before handing out an address.
      const onchain = await ds.publicClient.readContract({ address: ds.doorstep, abi: DOORSTEP_ABI, functionName: 'addressOf', args: [intent] });
      if (ds.depositAddress(intent) !== onchain) throw new Error('Address mismatch between page and contract. Not safe to use.');
      if (f.announce.checked) {
        const w = await connect(ds);
        say('create-msg', 'Confirm the registration in your wallet…');
        await ds.announce(intent, { walletClient: w });
      }
      const exact = f.amount.value.trim();
      location.hash = toLink(intent, { baseUrl: '', fromBlock: block.number, ...(exact ? { amount: exact } : {}) }).split('#')[1];
    } catch (e) {
      say('create-msg', String(e.message).startsWith('missing:') ? 'Fill in all three addresses first.' : esc(errText(e)), true);
    }
  });
}

// ---------------------------------------------------------------- pay page

async function initPay(fragment) {
  $('pay-view').hidden = false;
  const { intent, fromBlock, amount6 } = parseLink('#' + fragment);
  const doorAddr = doorstepFor(fromBlock);
  const ds = clientFor(doorAddr, fromBlock);
  const cancellable = !isLegacy(doorAddr);
  const dep = ds.depositAddress(intent);
  const ex = explain(intent);
  const isEscrow = intent.target === ESCROW;
  const targetName = isEscrow ? 'the demo savings vault' : short(intent.target);

  $('addr').textContent = dep;
  renderQr($('qr'), dep);
  const forRef = ex.reference && ex.reference !== 'doorstep-savings' ? ex.reference : '';
  $('pay-lede').textContent = amount6 !== undefined
    ? `Pay ${formatUsdc6(amount6)} USDC${forRef ? ` for ${forRef}` : ''}`
    : forRef ? `Pay ${forRef}` : `Deposit to ${targetName}`;
  $('limits').innerHTML = [
    amount6 !== undefined ? `Amount ${formatUsdc6(amount6)} USDC (more is delivered too)` : ex.minimum !== '0' ? `Minimum ${ex.minimum} USDC` : null,
    `Accepted until ${ex.expiresAt.toLocaleString()}`,
    'Arc network, USDC only',
  ].filter(Boolean).join(' · ');
  $('plain-pay').innerHTML = esc(describe(intent, { names: namesFor(intent), cancellable }));
  $('facts').innerHTML = [
    ['Pays into', `${link('address/' + intent.target, short(intent.target))}${isEscrow ? ' (demo savings vault)' : ''}`],
    ex.beneficiary ? ['Credited to', `<span class="mono">${ex.beneficiary}</span>`] : ['Call', `<span class="mono">${esc(ex.call.text)}</span>`],
    ['Returned to', `<span class="mono">${intent.refundTo}</span>`],
    ['Minimum', `${ex.minimum} USDC`],
    ['Delivery fee limit', `${ex.keeperFeeCap} USDC, taken from the payment`],
    ['Accepted until', ex.expiresAt.toLocaleString()],
    ex.reference ? ['Reference', esc(ex.reference)] : null,
    ['Doorstep contract', `${link('address/' + doorAddr, short(doorAddr))}${cancellable ? '' : ' (v1, no cancel)'}`],
  ].filter(Boolean).map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  $('btn-cancel').hidden = !cancellable;

  let registered = false;
  const regKeyPay = `doorstep:registered:${ds.doorstep}:${intentHashOf(intent)}`;
  const showRegistered = async () => {
    registered = !!store.get(regKeyPay) || await ds.isAnnounced(intent, { fromBlock });
    if (registered) store.set(regKeyPay, '1');
    $('btn-announce').hidden = registered;
    $('bots').innerHTML = registered
      ? 'This address is registered for automatic delivery.'
      : 'This address isn\'t registered for automatic delivery. Register it once (under $0.01), or press Deliver now after each payment.';
  };
  const retryRegistered = () => showRegistered().catch(() => setTimeout(retryRegistered, 10_000));
  retryRegistered();

  if (isEscrow && ex.beneficiary) {
    $('escrow-box').hidden = false;
    $('escrow-owner').textContent = ex.beneficiary;
    $('btn-withdraw').onclick = async () => {
      try { await withdrawAll(ds, ex.beneficiary, 'withdraw-msg', refresh); } catch (e) { say('withdraw-msg', esc(errText(e)), true); }
    };
  }

  const door = $('door');
  let events = [];
  let cursor = fromBlock;
  let arrivedAt = 0;
  let tickNo = 0;
  let lastWaiting = 0n;
  async function refresh() {
    tickNo += 1;
    const st = await ds.status(intent);
    const changed = lastWaiting > 0n && st.waitingRaw === 0n;
    lastWaiting = st.waitingRaw;
    if (changed || tickNo % 3 === 1) {
      const head = await ds.publicClient.getBlockNumber({ cacheTime: 0 });
      if (cursor <= head) {
        events = events.concat(await ds.history(intent, { fromBlock: cursor, toBlock: head }));
        cursor = head + 1n;
      }
    }
    const last = events[events.length - 1];
    $('amount').innerHTML = `${usd(st.waiting)}<small>USDC waiting</small>`;

    // Timeline: Waiting for payment -> Payment received -> Delivered | Returned
    const steps = [];
    if (st.waitingRaw > 0n) arrivedAt ||= Date.now(); else arrivedAt = 0;
    const slow = st.waitingRaw > 0n && !st.belowMinimum && Date.now() - arrivedAt > (registered ? SLOW_MS : 0);
    $('btn-deliver-main').hidden = !slow;
    if (st.waitingRaw > 0n) {
      door.dataset.state = 'arrived';
      $('light-text').textContent = 'Payment received';
      steps.push(['done', 'Waiting for payment']);
      const inv = amount6 !== undefined ? paymentState(amount6, { received: st.waitingRaw }) : null;
      const note = st.expired ? 'Past its deadline, so it will be returned.'
        : inv?.state === 'underpaid' ? `${inv.received} of ${inv.expected} USDC received. Send ${inv.remaining} USDC more to complete the payment.`
        : st.belowMinimum ? `Under the ${ex.minimum} USDC minimum, so it waits for more.`
          : slow ? (registered ? SLOW_TEXT : 'This address isn\'t registered with the delivery bot. Press Deliver it now; your wallet pays the network fee (under $0.01) and gets it straight back from the payment.')
            : 'Delivering automatically, usually within seconds.';
      steps.push(['now', amount6 !== undefined && st.belowMinimum ? `Part paid: ${usd(st.waiting)} of ${formatUsdc6(amount6)} USDC` : `Payment received: ${usd(st.waiting)} USDC`, note]);
      steps.push(['', st.expired ? `Returned to ${short(intent.refundTo)}` : `Delivered into ${targetName}`]);
    } else if (last) {
      const ok = last.event === 'Landed';
      door.dataset.state = ok ? 'landed' : 'bounced';
      $('light-text').textContent = ok ? 'Delivered' : 'Returned';
      steps.push(['done', 'Waiting for payment']);
      steps.push(['done', 'Payment received']);
      const paidIn = ok ? last.amountPulled6 * 10n ** 12n + last.keeperFee + last.refunded : 0n;
      const inv = ok && amount6 !== undefined ? paymentState(amount6, { received: paidIn }) : null;
      steps.push(ok
        ? ['done', `${inv ? (inv.state === 'overpaid' ? `Paid ${inv.received} USDC (${inv.extra} more than asked). ` : 'Paid in full. ') : ''}Delivered ${formatUsdc6(last.amountPulled6)} USDC into ${targetName}`, `Network fee ${formatUsdc18(last.keeperFee)} USDC${last.refunded > 0n ? `; unused fee allowance ${formatUsdc18(last.refunded)} USDC returned to ${short(intent.refundTo)}` : ''}. ${link('tx/' + last.transactionHash, 'View transaction')}`]
        : ['bad', `${last.reasonText === 'cancelled' ? 'Cancelled: ' : ''}${formatUsdc18(last.refunded)} USDC returned to ${short(last.refundTo)}`, `${last.reasonText === 'cancelled' ? 'The refund wallet took it back.' : last.reasonText === 'expired' ? 'It arrived after the deadline.' : 'The contract didn\'t accept it.'} ${link('tx/' + last.transactionHash, 'View transaction')}`]);
      if (!st.expired) steps.push(['', 'Ready for another payment to the same address']);
    } else {
      door.dataset.state = 'idle';
      $('light-text').textContent = st.expired ? 'No longer accepting payments' : 'Waiting for payment';
      steps.push([st.expired ? 'bad' : 'now', st.expired ? 'Expired: payments are no longer accepted' : 'Waiting for payment', st.expired ? '' : 'Send USDC on Arc to the address.']);
      steps.push(['', 'Payment received']);
      steps.push(['', `Delivered into ${targetName}`]);
    }
    $('timeline').innerHTML = steps.map(([c, t, small]) => `<li class="${c}">${t}${small ? `<small>${small}</small>` : ''}</li>`).join('');

    $('log').innerHTML = events.length
      ? [...events].reverse().map((e) => (e.event === 'Landed'
        ? `<li><span class="ok">Delivered</span> ${formatUsdc6(e.amountPulled6)} USDC into ${short(e.target)}. Network fee ${formatUsdc18(e.keeperFee)} USDC${e.refunded > 0n ? `, ${formatUsdc18(e.refunded)} returned` : ''}. ${link('tx/' + e.transactionHash, 'View transaction')}</li>`
        : `<li><span class="no">${e.reasonText === 'cancelled' ? 'Cancelled' : 'Returned'}</span> ${formatUsdc18(e.refunded)} USDC to ${short(e.refundTo)}${e.reasonText === 'cancelled' ? '' : ` (${e.reasonText})`}. ${link('tx/' + e.transactionHash, 'View transaction')}</li>`)).join('')
      : '<li>Nothing yet.</li>';

    if (isEscrow && ex.beneficiary) {
      const held = await ds.publicClient.readContract({ address: ESCROW, abi: ESCROW_ABI, functionName: 'balanceOf6', args: [ex.beneficiary] });
      $('credited').textContent = `${formatUsdc6(held)} USDC`;
      $('btn-withdraw').disabled = held === 0n;
    }
  }

  const run = (fn) => async () => { try { await fn(); } catch (e) { say('pay-msg', esc(errText(e)), true); } };
  $('btn-pay').onclick = run(async () => {
    const st = await ds.status(intent);
    const suggested = amount6 !== undefined ? paymentState(amount6, { received: st.waitingRaw }).remaining : ex.minimum !== '0' ? ex.minimum : '0.1';
    const amount = prompt('How much USDC to send?', suggested !== '0' ? suggested : '0.1');
    if (!amount) return;
    const w = await connect(ds);
    // A plain native transfer: exactly what a wallet's Send button does.
    const tx = await w.sendTransaction({ to: dep, value: parseUnits(amount, 18) });
    say('pay-msg', `Sent. ${link('tx/' + tx, 'View transaction')}`);
  });
  $('btn-copy').onclick = run(async () => { await navigator.clipboard.writeText(location.href); say('pay-msg', 'Link copied.'); });
  $('btn-deliver-main').onclick = () => $('btn-land').click();
  $('btn-land').onclick = run(async () => {
    const w = await connect(ds);
    say('pay-msg', 'Delivering…');
    const { hash, event } = await ds.land(intent, { walletClient: w });
    say('pay-msg', `${event?.event === 'Landed' ? 'Delivered.' : 'Returned.'} ${link('tx/' + hash, 'View transaction')}`);
    refresh();
  });
  $('btn-cancel').onclick = run(async () => {
    const w = await connect(ds);
    if (w.account.address !== intent.refundTo) throw new Error(`Only the refund wallet (${short(intent.refundTo)}) can cancel. Switch to it in your wallet.`);
    say('pay-msg', 'Cancelling…');
    const { hash, event } = await ds.cancel(intent, { walletClient: w });
    say('pay-msg', `Cancelled. ${formatUsdc18(event.refunded)} USDC sent back. ${link('tx/' + hash, 'View transaction')}`);
    refresh();
  });
  $('btn-announce').onclick = run(async () => {
    const w = await connect(ds);
    const { hash } = await ds.announce(intent, { walletClient: w });
    say('pay-msg', `Registered for automatic delivery. ${link('tx/' + hash, 'View transaction')}`);
    store.set(regKeyPay, '1');
    showRegistered().catch(() => {});
  });

  const loop = async () => {
    try { await refresh(); } catch (e) { say('pay-msg', isBusy(e) ? BUSY_TEXT : `Couldn't reach Arc: ${esc(errText(e))}`, !isBusy(e)); }
    setTimeout(loop, POLL_MS);
  };
  loop();
}

// ---------------------------------------------------------------- boot

const route = () => {
  const m = location.hash.match(/^#(i=.+)$/);
  if (m) initPay(m[1]).catch((e) => say('pay-msg', esc(errText(e)), true));
  else if (location.hash === '#developers') initDev();
  else initHome();
};
window.addEventListener('hashchange', () => location.reload());
route();

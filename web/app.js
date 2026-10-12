import { createWalletClient, custom, parseUnits, isAddress, getAddress } from 'viem';
import qrcode from 'qrcode-generator';
import {
  createDoorstep, depositIntent, describe, explain, parseLink, toLink, formatUsdc6, formatUsdc18,
  DoorstepError, DOORSTEP_ABI,
} from '../sdk/src/index.js';
import { CONFIG, TESTNET } from './config.js';

// ---------------------------------------------------------------- config

const params = new URLSearchParams(location.search);
const chainId = Number(params.get('chain') ?? CONFIG.chainId);
const base = chainId === TESTNET.chainId ? { ...CONFIG, ...TESTNET } : { ...CONFIG };
const net = { ...base, rpcUrl: params.get('rpc') ?? base.rpcUrl, chainId };
const ESCROW = getAddress(params.get('escrow') ?? CONFIG.escrow);
const legacy = (CONFIG.legacy ?? []).map((l) => ({ ...l, doorstep: getAddress(l.doorstep) }));

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

const clientFor = (doorstep, fromBlock) => createDoorstep({
  chainId, rpcUrl: net.rpcUrl, explorer: net.explorer, doorstep, fromBlock: fromBlock ?? BigInt(CONFIG.deployBlock),
});

const $ = (id) => document.getElementById(id);
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const chainName = chainId === 5042 ? 'Arc' : chainId === 5042002 ? 'Arc Testnet' : 'Local Arc node';
$('net').innerHTML = `<b>${chainName}</b> · chain ${chainId}`;
const link = (path, text) => `<a href="${net.explorer}/${path}" target="_blank" rel="noopener">${text}</a>`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------------------------------------------------------------- wallet

let wallet;
async function connect(ds) {
  if (!window.ethereum) throw new Error('No browser wallet found. Install one, or send from any wallet to the address shown.');
  const hexId = '0x' + chainId.toString(16);
  try {
    await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexId }] });
  } catch (e) {
    if (e.code !== 4902) throw e;
    await window.ethereum.request({
      method: 'wallet_addEthereumChain',
      params: [{ chainId: hexId, chainName, nativeCurrency: ds.chain.nativeCurrency, rpcUrls: [net.rpcUrl], blockExplorerUrls: [net.explorer] }],
    });
  }
  const [account] = await window.ethereum.request({ method: 'eth_requestAccounts' });
  wallet = createWalletClient({ chain: ds.chain, transport: custom(window.ethereum), account: getAddress(account) });
  return wallet;
}

// ---------------------------------------------------------------- QR

function renderQr(el, text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  el.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  el.querySelector('svg')?.setAttribute('aria-label', `QR code for ${text}`);
}

// ---------------------------------------------------------------- create view

function namesFor(intent, { you } = {}) {
  const n = {};
  if (getAddress(intent.target) === ESCROW) n[ESCROW] = 'the demo escrow';
  if (you) n[getAddress(you)] = 'you';
  return n;
}

async function initCreate() {
  const ds = clientFor(doorstepFor());
  const f = $('intent-form');
  f.target.value = ESCROW;

  const read = () => {
    for (const k of ['target', 'beneficiary', 'refundTo']) {
      if (!isAddress(f[k].value.trim())) throw new DoorstepError(`missing:${k}`);
    }
    return depositIntent({
      into: f.target.value.trim(),
      beneficiary: f.beneficiary.value.trim(),
      refundTo: f.refundTo.value.trim(),
      minimum: f.min.value || '0',
      keeperFeeCap: f.fee.value || '0',
      expires: `${Number(f.expiry.value)}s`,
      reference: f.ref.value || '',
    });
  };

  // Live plain-language preview of the instruction as it's being filled in.
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
    } catch (e) {
      $('create-msg').className = 'msg err';
      $('create-msg').textContent = e.shortMessage ?? e.message;
    }
  };

  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const msg = $('create-msg');
    msg.className = 'msg';
    msg.textContent = 'Working out the address…';
    try {
      const block = await ds.publicClient.getBlock();
      // Expiry counts from the chain's clock, not this computer's.
      const intent = { ...read(), expiry: block.timestamp + BigInt(f.expiry.value) };
      // Cross-check the browser's maths against the contract before handing out an address.
      const onchain = await ds.publicClient.readContract({ address: ds.doorstep, abi: DOORSTEP_ABI, functionName: 'addressOf', args: [intent] });
      if (ds.depositAddress(intent) !== onchain) throw new Error('Address mismatch between page and contract. Not safe to use.');
      location.hash = toLink(intent, { baseUrl: '', fromBlock: block.number }).split('#')[1];
    } catch (e) {
      msg.className = 'msg err';
      msg.textContent = String(e.message).startsWith('missing:') ? 'Fill in all three addresses first.' : (e.shortMessage ?? e.message);
    }
  });
}

// ---------------------------------------------------------------- pay / status view

async function initPay(fragment) {
  $('create-view').hidden = true;
  $('pay-view').hidden = false;
  const { intent, fromBlock } = parseLink('#' + fragment);
  const doorAddr = doorstepFor(fromBlock);
  const ds = clientFor(doorAddr, fromBlock);
  const cancellable = !isLegacy(doorAddr);
  const dep = ds.depositAddress(intent);
  const ex = explain(intent);
  const isEscrow = intent.target === ESCROW;

  $('addr').textContent = dep;
  renderQr($('qr'), dep);
  if (ex.reference) $('pay-lede').textContent = `Pay ${ex.reference} with USDC on Arc.`;
  $('plain-pay').innerHTML = `<b>In plain words:</b> ${esc(describe(intent, { names: namesFor(intent), cancellable }))}`;

  $('facts').innerHTML = [
    ['Pays into', `${link('address/' + intent.target, short(intent.target))}${isEscrow ? ' (demo escrow)' : ''}`],
    ex.beneficiary ? ['Credits', `<span class="mono">${ex.beneficiary}</span>`] : ['Call', `<span class="mono">${esc(ex.call.text)}</span>`],
    ['Money goes back to', `<span class="mono">${intent.refundTo}</span>`],
    ['Waits for at least', `${ex.minimum} USDC`],
    ['Delivery fee limit', `${ex.keeperFeeCap} USDC, taken from the deposit`],
    ['Stops accepting', `${ex.expiresAt.toLocaleString()}`],
    ex.reference ? ['Reference', esc(ex.reference)] : null,
    ['Doorstep contract', `${link('address/' + doorAddr, short(doorAddr))}${cancellable ? '' : ' (v1, no cancel)'}`],
  ].filter(Boolean).map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  if (isEscrow) $('escrow-box').hidden = false;
  $('btn-cancel').hidden = !cancellable;

  const door = $('door');
  let events = [];
  let cursor = fromBlock;
  async function refresh() {
    const [st, head] = await Promise.all([ds.status(intent), ds.publicClient.getBlockNumber({ cacheTime: 0 })]);
    if (cursor <= head) {
      events = events.concat(await ds.history(intent, { fromBlock: cursor, toBlock: head }));
      cursor = head + 1n;
    }
    const newest = [...events].reverse();
    $('amount').innerHTML = `${Number(st.waiting).toLocaleString(undefined, { maximumFractionDigits: 6 })}<small>USDC waiting</small>`;
    const last = newest[0];
    if (st.waitingRaw > 0n) {
      door.dataset.state = 'arrived';
      $('light-text').textContent = st.belowMinimum ? 'Waiting for the minimum' : st.expired ? 'Arrived, will be refunded' : 'Arrived, ready to deliver';
    } else if (last) {
      door.dataset.state = last.event === 'Landed' ? 'landed' : 'bounced';
      $('light-text').textContent = last.event === 'Landed' ? 'Delivered' : last.reasonText === 'cancelled' ? 'Cancelled and refunded' : 'Refunded';
    } else {
      door.dataset.state = 'idle';
      $('light-text').textContent = st.expired ? 'Expired' : 'Waiting for a payment';
    }
    $('log').innerHTML = newest.length
      ? newest.map((e) => (e.event === 'Landed'
        ? `<li><span class="ok">Delivered</span> ${formatUsdc6(e.amountPulled6)} USDC into ${short(e.target)}. Delivery fee ${formatUsdc18(e.keeperFee)} USDC${e.refunded > 0n ? `, ${formatUsdc18(e.refunded)} returned` : ''}. ${link('tx/' + e.transactionHash, 'View transaction')}</li>`
        : `<li><span class="no">${e.reasonText === 'cancelled' ? 'Cancelled' : 'Refunded'}</span> ${formatUsdc18(e.refunded)} USDC back to ${short(e.refundTo)}${e.reasonText === 'cancelled' ? '' : ` (${e.reasonText})`}${e.keeperFee > 0n ? `. Delivery fee ${formatUsdc18(e.keeperFee)} USDC` : ''}. ${link('tx/' + e.transactionHash, 'View transaction')}</li>`)).join('')
      : '<li>Nothing delivered or refunded yet.</li>';
    if (isEscrow && ex.beneficiary) {
      const c = await ds.publicClient.readContract({ address: ESCROW, abi: [{ type: 'function', name: 'balanceOf6', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] }], functionName: 'balanceOf6', args: [ex.beneficiary] });
      $('credited').textContent = `${formatUsdc6(c)} USDC`;
    }
  }

  const say = (t, err) => { $('pay-msg').className = err ? 'msg err' : 'msg'; $('pay-msg').textContent = t; };
  const run = (fn) => async () => {
    try { await fn(); } catch (e) { say(e.shortMessage ?? e.message, true); }
  };

  $('btn-pay').onclick = run(async () => {
    const amount = prompt('How much USDC to send?', ex.minimum !== '0' ? ex.minimum : '0.1');
    if (!amount) return;
    const w = await connect(ds);
    // A plain native transfer: exactly what a wallet's Send button does.
    const tx = await w.sendTransaction({ to: dep, value: parseUnits(amount, 18) });
    $('pay-msg').innerHTML = `Sent. ${link('tx/' + tx, 'View transaction')}`;
  });
  $('btn-land').onclick = run(async () => {
    const w = await connect(ds);
    say('Delivering…');
    const { hash, event } = await ds.land(intent, { walletClient: w });
    $('pay-msg').innerHTML = `${event?.event === 'Landed' ? 'Delivered.' : 'Refunded.'} ${link('tx/' + hash, 'View transaction')}`;
    refresh();
  });
  $('btn-cancel').onclick = run(async () => {
    const w = await connect(ds);
    if (w.account.address !== intent.refundTo) throw new Error(`Only the refund wallet (${short(intent.refundTo)}) can cancel. Connect that wallet.`);
    say('Cancelling…');
    const { hash, event } = await ds.cancel(intent, { walletClient: w });
    $('pay-msg').innerHTML = `Cancelled. ${formatUsdc18(event.refunded)} USDC sent back. ${link('tx/' + hash, 'View transaction')}`;
    refresh();
  });
  $('btn-announce').onclick = run(async () => {
    const w = await connect(ds);
    const { hash } = await ds.announce(intent, { walletClient: w });
    $('pay-msg').innerHTML = `Announced. Delivery bots can now find this address. ${link('tx/' + hash, 'View transaction')}`;
    showAnnounced().catch(() => {});
  });
  $('btn-copy').onclick = run(async () => {
    await navigator.clipboard.writeText(location.href);
    say('Link copied.');
  });

  const showAnnounced = async () => {
    const yes = await ds.isAnnounced(intent, { fromBlock });
    $('bots').innerHTML = yes
      ? '<span class="ok">Delivery bots know about this address.</span> Payments are delivered automatically while a bot is running.'
      : 'Delivery bots don\'t know about this address yet. Press <b>Tell delivery bots</b> once (costs a fraction of a cent) so payments are delivered automatically, or press <b>Deliver now</b> after each payment.';
  };
  showAnnounced().catch(() => {});

  const loop = async () => {
    try { await refresh(); } catch (e) { say(`Couldn't reach Arc: ${e.shortMessage ?? e.message}`, true); }
    setTimeout(loop, 3000);
  };
  loop();
}

// ---------------------------------------------------------------- boot

const route = () => {
  const m = location.hash.match(/^#(i=.+)$/);
  if (m) initPay(m[1]).catch((e) => { $('pay-msg').className = 'msg err'; $('pay-msg').textContent = e.message; });
  else initCreate();
};
window.addEventListener('hashchange', () => location.reload());
route();

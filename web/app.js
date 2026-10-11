import {
  createPublicClient, createWalletClient, custom, http, defineChain,
  encodeAbiParameters, keccak256, getContractAddress, encodeFunctionData,
  parseUnits, formatUnits, stringToHex, hexToString, isAddress, getAddress,
} from 'viem';
import qrcode from 'qrcode-generator';
import { CONFIG, TESTNET } from './config.js';

// ---------------------------------------------------------------- config

const params = new URLSearchParams(location.search);
const chainId = Number(params.get('chain') ?? CONFIG.chainId);
const base = chainId === TESTNET.chainId ? { ...CONFIG, ...TESTNET } : { ...CONFIG };
const net = { ...base, rpcUrl: params.get('rpc') ?? base.rpcUrl, chainId };
const DOORSTEP = getAddress(params.get('doorstep') ?? CONFIG.doorstep);
const ESCROW = getAddress(params.get('escrow') ?? CONFIG.escrow);
const LOG_SPAN = 9000n; // public RPC rejects eth_getLogs over 10,000 blocks

const chain = defineChain({
  id: chainId,
  name: chainId === 5042 ? 'Arc' : chainId === 5042002 ? 'Arc Testnet' : 'Local Arc node',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [net.rpcUrl] } },
  blockExplorers: { default: { name: 'Arcscan', url: net.explorer } },
});
const pub = createPublicClient({ chain, transport: http(net.rpcUrl) });
const { Doorstep: DOOR_ABI, DemoEscrow: ESCROW_ABI } = await (await fetch('./abi.json')).json();

const INTENT_COMPONENTS = [
  { name: 'target', type: 'address' },
  { name: 'callData', type: 'bytes' },
  { name: 'amountOffset', type: 'uint32' },
  { name: 'refundTo', type: 'address' },
  { name: 'minAmount6', type: 'uint256' },
  { name: 'maxKeeperFee6', type: 'uint256' },
  { name: 'expiry', type: 'uint64' },
  { name: 'ref', type: 'bytes32' },
];

const $ = (id) => document.getElementById(id);
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const usdc6 = (v) => formatUnits(BigInt(v), 6);
const usdc18 = (v) => formatUnits(BigInt(v), 18);
$('net').innerHTML = `<b>${chain.name}</b> · chain ${chainId}`;
const link = (path, text) => `<a href="${net.explorer}/${path}" target="_blank" rel="noopener">${text}</a>`;

// ---------------------------------------------------------------- intent maths (mirrors the contract)

function intentHash(i) {
  return keccak256(encodeAbiParameters([{ type: 'tuple', components: INTENT_COMPONENTS }], [i]));
}

let landerCodeHash;
async function depositAddressOf(i) {
  landerCodeHash ??= await pub.readContract({ address: DOORSTEP, abi: DOOR_ABI, functionName: 'LANDER_CODE_HASH' });
  return getContractAddress({ opcode: 'CREATE2', from: DOORSTEP, salt: intentHash(i), bytecodeHash: landerCodeHash });
}

// Intents travel in the URL fragment, so the link alone is enough to verify and pay.
const toB64 = (s) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64 = (s) => atob(s.replace(/-/g, '+').replace(/_/g, '/'));
function encodeIntent(i, fromBlock) {
  return toB64(JSON.stringify({ ...i, minAmount6: i.minAmount6.toString(), maxKeeperFee6: i.maxKeeperFee6.toString(), expiry: i.expiry.toString(), b: fromBlock.toString() }));
}
function decodeIntent(s) {
  const o = JSON.parse(fromB64(s));
  return {
    intent: {
      target: getAddress(o.target), callData: o.callData, amountOffset: Number(o.amountOffset),
      refundTo: getAddress(o.refundTo), minAmount6: BigInt(o.minAmount6), maxKeeperFee6: BigInt(o.maxKeeperFee6),
      expiry: BigInt(o.expiry), ref: o.ref,
    },
    fromBlock: BigInt(o.b ?? CONFIG.deployBlock),
  };
}

// ---------------------------------------------------------------- wallet

let wallet;
async function connect() {
  if (!window.ethereum) throw new Error('No browser wallet found. Install one, or send from any wallet to the address shown.');
  const hexId = '0x' + chainId.toString(16);
  try {
    await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexId }] });
  } catch (e) {
    if (e.code !== 4902) throw e;
    await window.ethereum.request({
      method: 'wallet_addEthereumChain',
      params: [{ chainId: hexId, chainName: chain.name, nativeCurrency: chain.nativeCurrency, rpcUrls: [net.rpcUrl], blockExplorerUrls: [net.explorer] }],
    });
  }
  const [account] = await window.ethereum.request({ method: 'eth_requestAccounts' });
  wallet = createWalletClient({ chain, transport: custom(window.ethereum), account: getAddress(account) });
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

async function initCreate() {
  const f = $('intent-form');
  f.target.value = ESCROW;
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const msg = $('create-msg');
    msg.className = 'msg';
    msg.textContent = 'Working out the address…';
    try {
      for (const k of ['target', 'beneficiary', 'refundTo']) if (!isAddress(f[k].value)) throw new Error(`${k} is not an address`);
      const block = await pub.getBlock();
      const intent = {
        target: getAddress(f.target.value),
        callData: encodeFunctionData({ abi: ESCROW_ABI, functionName: 'deposit', args: [0n, getAddress(f.beneficiary.value)] }),
        amountOffset: 4, // first argument of deposit(uint256,address)
        refundTo: getAddress(f.refundTo.value),
        minAmount6: parseUnits(f.min.value || '0', 6),
        maxKeeperFee6: parseUnits(f.fee.value || '0', 6),
        expiry: block.timestamp + BigInt(f.expiry.value),
        ref: stringToHex(f.ref.value || '', { size: 32 }),
      };
      // Cross-check the browser's maths against the contract before handing out an address.
      const [local, onchain] = await Promise.all([
        depositAddressOf(intent),
        pub.readContract({ address: DOORSTEP, abi: DOOR_ABI, functionName: 'addressOf', args: [intent] }),
      ]);
      if (local !== onchain) throw new Error('Address mismatch between page and contract. Not safe to use.');
      location.hash = 'i=' + encodeIntent(intent, block.number);
    } catch (e) {
      msg.className = 'msg err';
      msg.textContent = e.shortMessage ?? e.message;
    }
  });
}

// ---------------------------------------------------------------- pay / status view

async function initPay(encoded) {
  $('create-view').hidden = true;
  $('pay-view').hidden = false;
  const { intent, fromBlock } = decodeIntent(encoded);
  const hash = intentHash(intent);
  const dep = await depositAddressOf(intent);
  const isEscrow = intent.target === ESCROW;
  let beneficiary;
  if (isEscrow) beneficiary = getAddress('0x' + intent.callData.slice(2 + 8 + 64 + 24, 2 + 8 + 128));

  $('addr').textContent = dep;
  renderQr($('qr'), dep);
  const refText = hexToString(intent.ref, { size: 32 }).replace(/\0+$/, '');
  if (refText) $('pay-lede').textContent = `Pay ${refText} with USDC on Arc.`;

  const expiryDate = new Date(Number(intent.expiry) * 1000);
  $('facts').innerHTML = [
    ['Deposits into', `${link('address/' + intent.target, short(intent.target))}${isEscrow ? ' (demo escrow)' : ''}`],
    beneficiary ? ['Credits', `<span class="mono">${beneficiary}</span>`] : null,
    ['Refunds to', `<span class="mono">${intent.refundTo}</span>`],
    ['Minimum', `${usdc6(intent.minAmount6)} USDC`],
    ['Keeper fee', `at most ${usdc6(intent.maxKeeperFee6)} USDC, repaid from the deposit`],
    ['Expires', `${expiryDate.toLocaleString()} (after that, deposits are refunded)`],
    refText ? ['Reference', refText] : null,
    ['Intent hash', `<span class="mono">${hash}</span>`],
  ].filter(Boolean).map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  if (isEscrow) $('escrow-box').hidden = false;

  const door = $('door');
  const events = [];
  let cursor = fromBlock;
  async function refresh() {
    const [bal, head] = await Promise.all([pub.getBalance({ address: dep }), pub.getBlockNumber()]);
    while (cursor <= head) {
      const to = cursor + LOG_SPAN - 1n < head ? cursor + LOG_SPAN - 1n : head;
      for (const eventName of ['Landed', 'Bounced']) {
        const logs = await pub.getContractEvents({ address: DOORSTEP, abi: DOOR_ABI, eventName, args: { intentHash: hash }, fromBlock: cursor, toBlock: to });
        events.push(...logs);
      }
      cursor = to + 1n;
    }
    events.sort((a, b) => Number(b.blockNumber - a.blockNumber));
    $('amount').innerHTML = `${Number(usdc18(bal)).toLocaleString(undefined, { maximumFractionDigits: 6 })}<small>USDC waiting</small>`;
    const last = events[0];
    if (bal > 0n) {
      door.dataset.state = 'arrived';
      $('light-text').textContent = 'Deposit arrived, landing…';
    } else if (last) {
      door.dataset.state = last.eventName === 'Landed' ? 'landed' : 'bounced';
      $('light-text').textContent = last.eventName === 'Landed' ? 'Landed' : 'Refunded';
    } else {
      door.dataset.state = 'idle';
      $('light-text').textContent = 'Waiting for a deposit';
    }
    $('log').innerHTML = events.length
      ? events.map((e) => {
          const a = e.args;
          return e.eventName === 'Landed'
            ? `<li><span class="ok">Landed</span> ${usdc6(a.amountPulled6)} USDC into ${short(a.target)}; keeper repaid ${usdc18(a.keeperFee)} USDC${a.refunded > 0n ? `, ${usdc18(a.refunded)} returned` : ''}. ${link('tx/' + e.transactionHash, 'View transaction')}</li>`
            : `<li><span class="no">Refunded</span> ${usdc18(a.refunded)} USDC to ${short(a.refundTo)} (${a.reason === 0 ? 'expired' : 'target call failed'}); keeper repaid ${usdc18(a.keeperFee)} USDC. ${link('tx/' + e.transactionHash, 'View transaction')}</li>`;
        }).join('')
      : '<li>No landings yet.</li>';
    if (isEscrow) {
      const c = await pub.readContract({ address: ESCROW, abi: ESCROW_ABI, functionName: 'balanceOf6', args: [beneficiary] });
      $('credited').textContent = `${usdc6(c)} USDC`;
    }
  }

  const say = (t, err) => { $('pay-msg').className = err ? 'msg err' : 'msg'; $('pay-msg').textContent = t; };
  const run = (fn) => async () => {
    try { await fn(); } catch (e) { say(e.shortMessage ?? e.message, true); }
  };

  $('btn-pay').onclick = run(async () => {
    const amount = prompt('How much USDC to send?', usdc6(intent.minAmount6 > 0n ? intent.minAmount6 : 100000n));
    if (!amount) return;
    const w = await connect();
    // A plain native transfer: exactly what a wallet's Send button does.
    const tx = await w.sendTransaction({ to: dep, value: parseUnits(amount, 18) });
    $('pay-msg').innerHTML = `Sent. ${link('tx/' + tx, 'View transaction')}`;
  });
  $('btn-land').onclick = run(async () => {
    const w = await connect();
    // Estimate with a real gas price (at price 0 the fee transfer is skipped and the estimate is short).
    const block = await pub.getBlock();
    const maxFeePerGas = block.baseFeePerGas * 2n;
    const est = await pub.estimateContractGas({ address: DOORSTEP, abi: DOOR_ABI, functionName: 'land', args: [intent], account: w.account, maxFeePerGas, maxPriorityFeePerGas: 0n });
    const tx = await w.writeContract({ address: DOORSTEP, abi: DOOR_ABI, functionName: 'land', args: [intent], gas: (est * 13n) / 10n + 30_000n, maxFeePerGas, maxPriorityFeePerGas: 0n });
    $('pay-msg').innerHTML = `Landing submitted. ${link('tx/' + tx, 'View transaction')}`;
  });
  $('btn-announce').onclick = run(async () => {
    const w = await connect();
    const tx = await w.writeContract({ address: DOORSTEP, abi: DOOR_ABI, functionName: 'announce', args: [intent] });
    $('pay-msg').innerHTML = `Announced. Keepers can now find this address. ${link('tx/' + tx, 'View transaction')}`;
  });
  $('btn-copy').onclick = run(async () => {
    await navigator.clipboard.writeText(location.href);
    say('Link copied.');
  });

  const loop = async () => {
    try { await refresh(); } catch (e) { say(`Couldn't reach Arc: ${e.shortMessage ?? e.message}`, true); }
    setTimeout(loop, 3000);
  };
  loop();
}

// ---------------------------------------------------------------- boot

const route = () => {
  const m = location.hash.match(/^#i=(.+)$/);
  if (m) initPay(m[1]).catch((e) => { $('pay-msg').className = 'msg err'; $('pay-msg').textContent = e.message; });
  else initCreate();
};
window.addEventListener('hashchange', () => location.reload());
route();

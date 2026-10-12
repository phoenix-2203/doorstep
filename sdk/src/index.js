// Doorstep SDK: create, explain, watch, land and cancel Doorstep deposit addresses on Arc.
//
// A Doorstep "intent" is a payment instruction: "deposit whatever USDC arrives at this address
// into contract X, credited to Y; if that isn't possible, give it back to Z". Its deposit address
// is a pure function of the instruction, so this SDK computes it offline, with no RPC call.

import {
  createPublicClient, http, defineChain, encodeAbiParameters, encodeFunctionData, decodeFunctionData,
  keccak256, getContractAddress, parseUnits, formatUnits, stringToHex, hexToString, getAddress,
  isAddress, isHex, parseAbi, toFunctionSelector, BaseError, ContractFunctionRevertedError, decodeEventLog,
} from 'viem';
import { DOORSTEP_ABI } from './abi.js';

export { DOORSTEP_ABI };

// ---------------------------------------------------------------- constants

/** Arc's USDC system contract: one balance, native (18 decimals) and ERC-20 (6 decimals). */
export const USDC = '0x3600000000000000000000000000000000000000';
/** keccak256 of the 8-byte DoorstepLander initcode (0x608060405233fffe). */
export const LANDER_CODE_HASH = '0xb91c48347624e04b62d62f2117740998be8c3f9205503cdc14c1c16e48eae951';
/** `amountOffset` meaning "don't write the amount into the call". */
export const NO_AMOUNT = 0xffffffff;
/** Placeholder for "the amount that arrived" in `makeIntent` args. Any unique value works; this one is. */
export const AMOUNT = 0xd00257e9d00257e9d00257e9d00257e9d00257e9d00257e9d00257e9d00257e9n;

const SCALE = 10n ** 12n; // native units per 6-decimal unit
const LOG_SPAN = 9000n; // Arc RPCs cap eth_getLogs at 10,000 blocks

export const NETWORKS = {
  arc: { id: 5042, name: 'Arc', rpcUrl: 'https://rpc.mainnet.arc.io', explorer: 'https://explorer.arc.io' },
  arcTestnet: { id: 5042002, name: 'Arc Testnet', rpcUrl: 'https://rpc.testnet.arc.io', explorer: 'https://explorer.testnet.arc.io' },
};

/**
 * Official Doorstep deployments. `doorstep` is the current version; `legacy` lists older ones that
 * keep working for addresses created with them (v1 has no `cancel`).
 */
export const DEPLOYMENTS = {
  5042: {
    doorstep: null, // v2 (with cancel): filled in after deployment
    fromBlock: null,
    legacy: [{ version: 1, doorstep: '0xd614A7B602E1417F258A834465AE01F47891e080', fromBlock: 25488972n }],
    demoEscrow: '0x3da5F9d36d1AE8769A9460a7788a21c8041C7bB3',
  },
};

export const INTENT_COMPONENTS = [
  { name: 'target', type: 'address' },
  { name: 'callData', type: 'bytes' },
  { name: 'amountOffset', type: 'uint32' },
  { name: 'refundTo', type: 'address' },
  { name: 'minAmount6', type: 'uint256' },
  { name: 'maxKeeperFee6', type: 'uint256' },
  { name: 'expiry', type: 'uint64' },
  { name: 'ref', type: 'bytes32' },
];

const DEPOSIT_ABI = parseAbi(['function deposit(uint256 amount, address beneficiary)']);
/** Well-known calls `describe` can name. Pass your own ABI to `describe` for anything else. */
const KNOWN_ABI = parseAbi([
  'function deposit(uint256 assets, address receiver)',
  'function mint(uint256 shares, address receiver)',
  'function fund(uint256 amount, address beneficiary)',
  'function contribute(uint256 amount, address contributor)',
  'function topUp(uint256 amount, address account)',
  'function pay(uint256 amount, bytes32 invoice)',
]);

// ---------------------------------------------------------------- small helpers

const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** USDC amount → 6-decimal units. Strings and numbers are USDC ("12.5"); bigints are already 6-decimal units. */
export function toUnits6(v, field = 'amount') {
  if (typeof v === 'bigint') {
    if (v < 0n) throw new DoorstepError(`${field} cannot be negative`);
    return v;
  }
  if (typeof v === 'number') v = String(v);
  if (typeof v !== 'string' || !/^\d+(\.\d{1,6})?$/.test(v.trim())) {
    throw new DoorstepError(`${field} must be a USDC amount like "12.5" (at most 6 decimals), got ${JSON.stringify(v)}`);
  }
  return parseUnits(v.trim(), 6);
}

/** 6-decimal units → "12.5" */
export const formatUsdc6 = (v) => formatUnits(BigInt(v), 6);
/** native 18-decimal units → "12.5" */
export const formatUsdc18 = (v) => formatUnits(BigInt(v), 18);

const DURATION = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };

/**
 * When the intent stops accepting deliveries. Accepts a Date, a unix timestamp in seconds
 * (number or bigint), or a duration from now: "45s", "90m", "12h", "30d", "2w".
 */
export function toExpiry(expires, now = Math.floor(Date.now() / 1000)) {
  if (expires instanceof Date) return BigInt(Math.floor(expires.getTime() / 1000));
  if (typeof expires === 'bigint') return expires;
  if (typeof expires === 'number') {
    if (!Number.isInteger(expires) || expires < 1e9) throw new DoorstepError('expires as a number must be a unix timestamp in seconds');
    return BigInt(expires);
  }
  const m = typeof expires === 'string' && expires.trim().match(/^(\d+)\s*([smhdw])$/);
  if (!m) throw new DoorstepError(`expires must be a Date, a unix timestamp, or a duration like "30d", got ${JSON.stringify(expires)}`);
  return BigInt(now) + BigInt(Number(m[1]) * DURATION[m[2]]);
}

/** Text reference (up to 31 bytes) or a 0x bytes32 → bytes32. */
export function toRef(reference = '') {
  if (isHex(reference) && reference.length === 66) return reference;
  if (new TextEncoder().encode(reference).length > 31) throw new DoorstepError('reference must be at most 31 bytes of text');
  return stringToHex(reference, { size: 32 });
}

/** bytes32 → text, or the hex if it isn't text. */
export function fromRef(ref) {
  try {
    const t = hexToString(ref, { size: 32 }).replace(/\0+$/, '');
    return /^[\x20-\x7e]*$/.test(t) ? t : ref;
  } catch {
    return ref;
  }
}

export class DoorstepError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'DoorstepError';
    if (details) this.details = details;
  }
}

// ---------------------------------------------------------------- building intents

/**
 * General-purpose intent builder: "call `functionName(args)` on `target`, writing the amount that
 * arrived wherever `AMOUNT` appears in `args`".
 *
 *   makeIntent({
 *     target: vault, abi, functionName: 'deposit', args: [AMOUNT, alice],
 *     refundTo: alice, minimum: '10', keeperFeeCap: '0.01', expires: '30d', reference: 'invoice-42',
 *   })
 */
export function makeIntent({
  target, abi, functionName, args = [], callData, amountOffset,
  refundTo, minimum = '0', keeperFeeCap = '0.01', expires = '30d', reference = '', now,
}) {
  if (!isAddress(target)) throw new DoorstepError('target must be a contract address');
  if (!isAddress(refundTo)) throw new DoorstepError('refundTo must be an address');
  target = getAddress(target);
  refundTo = getAddress(refundTo);

  let offset;
  if (callData) {
    if (!isHex(callData)) throw new DoorstepError('callData must be hex');
    offset = amountOffset ?? NO_AMOUNT;
  } else {
    if (!abi || !functionName) throw new DoorstepError('pass abi + functionName + args, or a ready callData');
    const uses = args.filter((a) => a === AMOUNT).length;
    if (uses > 1) throw new DoorstepError('AMOUNT may appear only once in args');
    callData = encodeFunctionData({ abi, functionName, args });
    if (uses === 1) {
      const needle = AMOUNT.toString(16).padStart(64, '0');
      const at = callData.slice(2).indexOf(needle);
      if (at < 0 || at % 2 !== 0) throw new DoorstepError('AMOUNT must be a uint256 argument at the top level of the call');
      offset = at / 2;
      callData = (callData.slice(0, 2 + at) + '0'.repeat(64) + callData.slice(2 + at + 64));
    } else {
      offset = NO_AMOUNT;
    }
  }

  const intent = {
    target,
    callData,
    amountOffset: offset,
    refundTo,
    minAmount6: toUnits6(minimum, 'minimum'),
    maxKeeperFee6: toUnits6(keeperFeeCap, 'keeperFeeCap'),
    expiry: toExpiry(expires, now),
    ref: toRef(reference),
  };
  validateIntent(intent);
  return intent;
}

/**
 * The common case: pay into a contract with `deposit(uint256 amount, address beneficiary)`. That
 * is ERC-4626 `deposit(assets, receiver)` and the DemoEscrow's `deposit`, same selector.
 *
 *   depositIntent({ into: vault, beneficiary: alice, refundTo: alice, minimum: '500', expires: '30d' })
 */
export function depositIntent({ into, beneficiary, ...rest }) {
  if (!isAddress(beneficiary)) throw new DoorstepError('beneficiary must be an address');
  return makeIntent({ target: into, abi: DEPOSIT_ABI, functionName: 'deposit', args: [AMOUNT, getAddress(beneficiary)], ...rest });
}

/** The same checks the contract makes, so a bad intent fails here rather than on-chain. */
export function validateIntent(intent, doorstep) {
  const z = '0x0000000000000000000000000000000000000000';
  if (getAddress(intent.target) === z || getAddress(intent.refundTo) === z) throw new DoorstepError('target and refundTo cannot be the zero address');
  if (getAddress(intent.target) === getAddress(USDC)) throw new DoorstepError('target cannot be the USDC contract itself');
  if (doorstep && getAddress(intent.target) === getAddress(doorstep)) throw new DoorstepError('target cannot be Doorstep itself');
  const off = Number(intent.amountOffset);
  const len = (intent.callData.length - 2) / 2;
  if (off !== NO_AMOUNT && off + 32 > len) throw new DoorstepError('amountOffset points past the end of callData');
  if (intent.expiry < 0n || intent.expiry >= 2n ** 64n) throw new DoorstepError('expiry out of range');
  if (doorstep) {
    const dep = depositAddress(intent, doorstep);
    if (getAddress(intent.refundTo) === dep || getAddress(intent.target) === dep) {
      throw new DoorstepError('refundTo and target cannot be the deposit address itself');
    }
  }
  return true;
}

// ---------------------------------------------------------------- address maths (mirrors the contract)

export function intentHash(intent) {
  return keccak256(encodeAbiParameters([{ type: 'tuple', components: INTENT_COMPONENTS }], [intent]));
}

/** The deposit address for an intent under a given Doorstep deployment. Offline. */
export function depositAddress(intent, doorstep) {
  if (!isAddress(doorstep)) throw new DoorstepError('doorstep (the Doorstep contract address) is required');
  return getContractAddress({ opcode: 'CREATE2', from: getAddress(doorstep), salt: intentHash(intent), bytecodeHash: LANDER_CODE_HASH });
}

// ---------------------------------------------------------------- plain-language explanation

/** Structured, human-readable view of an intent. */
export function explain(intent, { abi, now = Math.floor(Date.now() / 1000) } = {}) {
  let call = { selector: intent.callData.slice(0, 10), name: null, args: null, text: `function ${intent.callData.slice(0, 10)}` };
  for (const a of [abi, KNOWN_ABI].filter(Boolean)) {
    try {
      const d = decodeFunctionData({ abi: a, data: intent.callData });
      const item = a.find((x) => x.type === 'function' && x.name === d.functionName && toFunctionSelector(x) === call.selector);
      const off = Number(intent.amountOffset);
      const shown = (d.args ?? []).map((v, k) => {
        const isAmountSlot = off !== NO_AMOUNT && off === 4 + 32 * k;
        if (isAmountSlot) return 'the amount';
        return typeof v === 'string' && isAddress(v) ? v : String(v);
      });
      call = { selector: call.selector, name: d.functionName, args: d.args, inputs: item?.inputs, text: `${d.functionName}(${shown.join(', ')})` };
      break;
    } catch { /* try the next ABI */ }
  }
  const beneficiary = call.name && call.inputs?.[1]?.type === 'address' ? call.args[1] : null;
  const expiresAt = new Date(Number(intent.expiry) * 1000);
  return {
    target: intent.target,
    call,
    beneficiary,
    refundTo: intent.refundTo,
    minimum: formatUsdc6(intent.minAmount6),
    keeperFeeCap: formatUsdc6(intent.maxKeeperFee6),
    expiresAt,
    expired: BigInt(now) > intent.expiry,
    reference: fromRef(intent.ref),
    writesAmount: Number(intent.amountOffset) !== NO_AMOUNT,
  };
}

/** One paragraph a payer can read before paying. */
export function describe(intent, opts = {}) {
  const e = explain(intent, opts);
  const name = (a) => (opts.names?.[getAddress(a)] ?? short(a));
  const when = e.expiresAt.toISOString().replace('T', ' ').replace(/:\d\d\.\d+Z$/, ' UTC');
  const parts = [];
  parts.push(e.beneficiary
    ? `USDC sent to this address is deposited into ${name(e.target)} for ${name(e.beneficiary)}.`
    : `USDC sent to this address is paid into ${name(e.target)} by calling ${e.call.text}.`);
  if (e.minimum !== '0') parts.push(`It waits until at least ${e.minimum} USDC has arrived.`);
  parts.push(`If it can't be delivered, or hasn't been delivered by ${when}, it goes back to ${name(e.refundTo)}.`);
  if (opts.cancellable !== false) parts.push(`${name(e.refundTo)} can also take it back at any time before it is delivered.`);
  parts.push(`Whoever delivers it is repaid their network fee from the deposit, at most ${e.keeperFeeCap} USDC.`);
  if (e.reference && e.reference !== intent.ref) parts.push(`Reference: ${e.reference}.`);
  return parts.join(' ');
}

// ---------------------------------------------------------------- share links (same format as the web app)

const toB64 = (s) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64 = (s) => atob(s.replace(/-/g, '+').replace(/_/g, '/'));

/** Link to the Doorstep app's pay page for this intent: "<baseUrl>?doorstep=…#i=…". */
export function toLink(intent, { baseUrl = 'https://phoenix-2203.github.io/doorstep/', fromBlock = 0n, doorstep, chainId } = {}) {
  const payload = toB64(JSON.stringify({
    ...intent,
    amountOffset: Number(intent.amountOffset),
    minAmount6: intent.minAmount6.toString(),
    maxKeeperFee6: intent.maxKeeperFee6.toString(),
    expiry: intent.expiry.toString(),
    b: BigInt(fromBlock).toString(),
  }));
  const q = new URLSearchParams();
  if (doorstep) q.set('doorstep', getAddress(doorstep));
  if (chainId) q.set('chain', String(chainId));
  const qs = q.toString();
  return `${baseUrl}${qs ? '?' + qs : ''}#i=${payload}`;
}

/** Parse a pay link (or just its "#i=…" fragment, or the bare payload) back into an intent. */
export function parseLink(link) {
  const m = String(link).match(/#i=([A-Za-z0-9_-]+)/) ?? String(link).match(/^([A-Za-z0-9_-]+)$/);
  if (!m) throw new DoorstepError('not a Doorstep link');
  const o = JSON.parse(fromB64(m[1]));
  const intent = {
    target: getAddress(o.target),
    callData: o.callData,
    amountOffset: Number(o.amountOffset),
    refundTo: getAddress(o.refundTo),
    minAmount6: BigInt(o.minAmount6),
    maxKeeperFee6: BigInt(o.maxKeeperFee6),
    expiry: BigInt(o.expiry),
    ref: o.ref,
  };
  let doorstep;
  let chainId;
  const q = String(link).match(/\?([^#]*)/);
  if (q) {
    const p = new URLSearchParams(q[1]);
    if (p.get('doorstep')) doorstep = getAddress(p.get('doorstep'));
    if (p.get('chain')) chainId = Number(p.get('chain'));
  }
  return { intent, fromBlock: BigInt(o.b ?? 0), doorstep, chainId };
}

// ---------------------------------------------------------------- on-chain client

/**
 * Connect to a Doorstep deployment.
 *
 *   const ds = createDoorstep();                         // Arc mainnet, current deployment
 *   const ds = createDoorstep({ walletClient });         // to land, cancel or announce
 *   const ds = createDoorstep({ rpcUrl, doorstep, chainId: 31337 }); // local node
 */
export function createDoorstep(opts = {}) {
  const net = typeof opts.network === 'object' ? opts.network : NETWORKS[opts.network ?? 'arc'];
  const chainId = opts.chainId ?? net?.id ?? 5042;
  const rpcUrl = opts.rpcUrl ?? net?.rpcUrl;
  const deployment = DEPLOYMENTS[chainId] ?? {};
  const doorstepAddr = opts.doorstep ?? deployment.doorstep;
  if (!doorstepAddr) throw new DoorstepError(`no Doorstep deployment known for chain ${chainId}; pass { doorstep }`);
  const DOOR = getAddress(doorstepAddr);
  const fromBlockDefault = BigInt(opts.fromBlock ?? (opts.doorstep ? 0n : deployment.fromBlock ?? 0n));
  const explorer = opts.explorer ?? net?.explorer;

  const chain = opts.chain ?? defineChain({
    id: chainId,
    name: chainId === 5042 ? 'Arc' : chainId === 5042002 ? 'Arc Testnet' : `Arc (${chainId})`,
    nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
    blockExplorers: explorer ? { default: { name: 'Arcscan', url: explorer } } : undefined,
  });
  const pub = opts.publicClient ?? createPublicClient({ chain, transport: http(rpcUrl) });

  const walletFor = (o) => {
    const w = o?.walletClient ?? opts.walletClient;
    if (!w?.account) throw new DoorstepError('a walletClient with an account is required for this action');
    return w;
  };

  const decodeEvent = (log) => {
    const e = { event: log.eventName, transactionHash: log.transactionHash, blockNumber: log.blockNumber, ...log.args };
    if (log.eventName === 'Bounced') e.reasonText = ['expired', 'target call failed', 'cancelled'][Number(log.args.reason)] ?? 'unknown';
    return e;
  };

  /** Past Landed/Bounced events for an intent, oldest first. */
  async function history(intent, { fromBlock = fromBlockDefault, toBlock } = {}) {
    const h = intentHash(intent);
    const head = toBlock ?? await pub.getBlockNumber({ cacheTime: 0 });
    const out = [];
    for (let from = BigInt(fromBlock); from <= head; from += LOG_SPAN) {
      const to = from + LOG_SPAN - 1n < head ? from + LOG_SPAN - 1n : head;
      for (const eventName of ['Landed', 'Bounced']) {
        const logs = await pub.getContractEvents({ address: DOOR, abi: DOORSTEP_ABI, eventName, args: { intentHash: h }, fromBlock: from, toBlock: to });
        out.push(...logs.map(decodeEvent));
      }
    }
    return out.sort((a, b) => (a.blockNumber < b.blockNumber ? -1 : a.blockNumber > b.blockNumber ? 1 : 0));
  }

  /** Has this intent been announced on-chain (so delivery bots can find it)? */
  async function isAnnounced(intent, { fromBlock = fromBlockDefault } = {}) {
    const h = intentHash(intent);
    const head = await pub.getBlockNumber({ cacheTime: 0 });
    for (let from = BigInt(fromBlock); from <= head; from += LOG_SPAN) {
      const to = from + LOG_SPAN - 1n < head ? from + LOG_SPAN - 1n : head;
      const logs = await pub.getContractEvents({ address: DOOR, abi: DOORSTEP_ABI, eventName: 'Announced', args: { intentHash: h }, fromBlock: from, toBlock: to });
      if (logs.length) return true;
    }
    return false;
  }

  /** What is waiting at the address right now, and what can be done with it. */
  async function status(intent) {
    const address = depositAddress(intent, DOOR);
    const [waiting, block] = await Promise.all([pub.getBalance({ address }), pub.getBlock()]);
    const expired = block.timestamp > intent.expiry;
    const waiting6 = waiting / SCALE;
    const belowMinimum = !expired && waiting6 < intent.minAmount6;
    return {
      address,
      waiting: formatUsdc18(waiting),
      waitingRaw: waiting,
      expired,
      expiresAt: new Date(Number(intent.expiry) * 1000),
      belowMinimum,
      canLand: waiting > 0n && !belowMinimum,
      canCancel: waiting > 0n,
      wouldBounce: waiting > 0n && expired,
    };
  }

  async function fees() {
    const block = await pub.getBlock();
    return { maxFeePerGas: block.baseFeePerGas * 2n, maxPriorityFeePerGas: 0n };
  }

  async function send(functionName, intent, o) {
    const w = walletFor(o);
    validateIntent(intent, DOOR);
    try {
      await pub.simulateContract({ address: DOOR, abi: DOORSTEP_ABI, functionName, args: [intent], account: w.account });
    } catch (e) {
      throw explainRevert(e);
    }
    // Estimate at a real gas price: at price 0 the keeper-fee transfer is skipped and the estimate is short.
    const f = await fees();
    const est = await pub.estimateContractGas({ address: DOOR, abi: DOORSTEP_ABI, functionName, args: [intent], account: w.account, ...f });
    const hash = await w.writeContract({ address: DOOR, abi: DOORSTEP_ABI, functionName, args: [intent], gas: (est * 13n) / 10n + 30_000n, ...f, chain });
    const receipt = await pub.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') throw new DoorstepError(`${functionName} transaction failed`, { hash });
    const h = intentHash(intent);
    const events = parseEvents(receipt.logs).filter((e) => e.intentHash === h);
    return { hash, receipt, event: events.find((e) => e.event === 'Landed' || e.event === 'Bounced') ?? events[0] ?? null };
  }

  function parseEvents(logs) {
    const out = [];
    for (const l of logs) {
      if (getAddress(l.address) !== DOOR) continue;
      try {
        const d = decodeEventLogSafe(l);
        if (d) out.push(decodeEvent({ ...l, ...d }));
      } catch { /* not a Doorstep event */ }
    }
    return out;
  }

  /** Deliver what's waiting (or refund it, if the intent has expired). Anyone may call this. */
  const land = (intent, o) => send('land', intent, o);
  /** Take back what's waiting, right now. Only `refundTo` may call this (Doorstep v2+). */
  async function cancel(intent, o) {
    const w = walletFor(o);
    if (getAddress(w.account.address) !== getAddress(intent.refundTo)) {
      throw new DoorstepError(`only refundTo (${intent.refundTo}) can cancel; connected account is ${w.account.address}`);
    }
    return send('cancel', intent, o);
  }
  /** Publish the intent on-chain so keepers can find its address from logs. Optional. */
  async function announce(intent, o) {
    const w = walletFor(o);
    validateIntent(intent, DOOR);
    const hash = await w.writeContract({ address: DOOR, abi: DOORSTEP_ABI, functionName: 'announce', args: [intent], chain });
    const receipt = await pub.waitForTransactionReceipt({ hash });
    return { hash, receipt, address: depositAddress(intent, DOOR) };
  }

  /**
   * Poll an intent and report changes: { type: 'waiting' | 'landed' | 'bounced', ... }.
   * Returns a function that stops watching.
   */
  function watch(intent, onChange, { pollMs = 3000, fromBlock } = {}) {
    let stopped = false;
    let lastWaiting = -1n;
    let cursor;
    const h = intentHash(intent);
    const address = depositAddress(intent, DOOR);
    const tick = async () => {
      if (stopped) return;
      try {
        const head = await pub.getBlockNumber({ cacheTime: 0 });
        cursor ??= fromBlock !== undefined ? BigInt(fromBlock) : head;
        if (cursor <= head) {
          const evs = await history(intent, { fromBlock: cursor, toBlock: head });
          cursor = head + 1n;
          for (const e of evs) onChange({ type: e.event === 'Landed' ? 'landed' : 'bounced', ...e });
        }
        const bal = await pub.getBalance({ address });
        if (bal !== lastWaiting) {
          lastWaiting = bal;
          onChange({ type: 'waiting', address, intentHash: h, waiting: formatUsdc18(bal), waitingRaw: bal });
        }
      } catch (err) {
        onChange({ type: 'error', error: err });
      }
      if (!stopped) setTimeout(tick, pollMs);
    };
    tick();
    return () => { stopped = true; };
  }

  /** Resolve with the next Landed or Bounced event for this intent (from now on). */
  function waitForOutcome(intent, { timeoutMs = 10 * 60_000, pollMs = 2000 } = {}) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { stop(); reject(new DoorstepError('timed out waiting for the deposit to land')); }, timeoutMs);
      const stop = watch(intent, (ev) => {
        if (ev.type === 'landed' || ev.type === 'bounced') {
          clearTimeout(timer);
          stop();
          resolve(ev);
        }
      }, { pollMs });
    });
  }

  return {
    doorstep: DOOR,
    chain,
    publicClient: pub,
    explorer,
    makeIntent: (o) => { const i = makeIntent(o); validateIntent(i, DOOR); return i; },
    depositIntent: (o) => { const i = depositIntent(o); validateIntent(i, DOOR); return i; },
    depositAddress: (intent) => depositAddress(intent, DOOR),
    describe,
    explain,
    toLink: (intent, o = {}) => toLink(intent, { fromBlock: fromBlockDefault, doorstep: opts.doorstep ? DOOR : undefined, chainId: chainId !== 5042 ? chainId : undefined, ...o }),
    parseLink,
    status,
    history,
    isAnnounced,
    watch,
    waitForOutcome,
    land,
    cancel,
    announce,
    txUrl: (hash) => (explorer ? `${explorer}/tx/${hash}` : null),
  };
}

// ---------------------------------------------------------------- errors

function decodeEventLogSafe(l) {
  try {
    return decodeEventLog({ abi: DOORSTEP_ABI, data: l.data, topics: l.topics });
  } catch {
    return null;
  }
}

const REVERT_TEXT = {
  NothingToLand: 'Nothing is waiting at this address.',
  BelowMinimum: 'Less than the minimum has arrived. It waits for more, or refundTo can cancel.',
  NotRefundTo: 'Only the refund address can cancel.',
  InvalidIntent: 'This instruction is invalid (target, refund address or amount position).',
  InsufficientGas: 'Not enough gas for the target call. Retry with a higher gas limit.',
  NativeTransferFailed: 'A payout failed (the refund address or keeper may be blocklisted or reject USDC).',
  Reentrancy: 'Re-entered Doorstep during a landing.',
};

/** Turn a contract revert into a readable DoorstepError. */
export function explainRevert(err) {
  if (err instanceof BaseError) {
    const r = err.walk((e) => e instanceof ContractFunctionRevertedError);
    const name = r?.data?.errorName;
    if (name) {
      let msg = REVERT_TEXT[name] ?? name;
      if (name === 'BelowMinimum') {
        const [arrived6, min6] = r.data.args;
        msg = `Only ${formatUsdc6(arrived6)} of the ${formatUsdc6(min6)} USDC minimum has arrived. It waits for more, or refundTo can cancel.`;
      }
      return new DoorstepError(msg, { error: name, args: r.data.args });
    }
    return new DoorstepError(err.shortMessage ?? err.message);
  }
  return err;
}

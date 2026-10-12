// Doorstep hosted API: create payment addresses and invoices over HTTPS, check their status, and
// receive signed webhooks when payments are delivered or returned.
//
//   cd api && cp .env.example .env && node admin.mjs new-wallet && node admin.mjs new-key my-app
//   node server.mjs
//
// The API never holds anyone's money. It calculates Doorstep addresses (anyone can recompute them),
// registers them on-chain so delivery bots find them, and reports what the chain says.

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { createPublicClient, createWalletClient, http as httpTransport, fallback, defineChain, getAddress, isAddress, formatUnits, parseAbiItem } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  depositIntent, makeIntent, depositAddress, intentHash, toLink, describe, explain, paymentState,
  DOORSTEP_ABI, DoorstepError, AMOUNT, formatUsdc6, formatUsdc18, toUnits6,
} from '../sdk/src/index.js';
import { decryptKeystore } from '../keeper/keystore.mjs';

// ---------------------------------------------------------------- config

try { const saved = { ...process.env }; process.loadEnvFile(new URL('./.env', import.meta.url)); Object.assign(process.env, saved); } catch { /* no .env */ }
const env = (k, d) => process.env[k] ?? d;
const home = (p) => p?.replace(/^~(?=\/)/, os.homedir());

const PORT = Number(env('PORT', 8787));
const HOST = env('HOST', '127.0.0.1'); // behind Caddy; don't expose directly
const CHAIN_ID = Number(env('CHAIN_ID', 5042));
const RPC_URL = env('RPC_URL', 'https://rpc.mainnet.arc.io');
const READ_RPC_URL = env('READ_RPC_URL', CHAIN_ID === 5042 ? 'https://rpc.mainnet.arc.io' : RPC_URL);
const DOORSTEP = getAddress(env('DOORSTEP', '0x56BD0FEfdaAF9d053a74107E6dDb9de19D306229'));
const FROM_BLOCK = BigInt(env('FROM_BLOCK', '25509432'));
const PAY_BASE = env('PAY_BASE', 'https://phoenix-2203.github.io/doorstep/app/');
const EXPLORER = env('EXPLORER', 'https://explorer.arc.io');
const DATA_DIR = home(env('DATA_DIR', new URL('./data', import.meta.url).pathname));
const POLL_MS = Number(env('POLL_MS', 10_000));
const CREATES_PER_HOUR = Number(env('CREATES_PER_HOUR', 100));
const PUBLIC_URL = env('PUBLIC_URL', `http://${HOST}:${PORT}`);

fs.mkdirSync(DATA_DIR, { recursive: true });
const STORE_FILE = `${DATA_DIR}/store.json`;
const KEYS_FILE = `${DATA_DIR}/keys.json`;

const chain = defineChain({
  id: CHAIN_ID, name: CHAIN_ID === 5042 ? 'Arc' : `Arc (${CHAIN_ID})`,
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});
// Reads: public RPC first (free), your own as backup. Writes: your own.
const read = createPublicClient({ chain, transport: READ_RPC_URL === RPC_URL ? httpTransport(RPC_URL) : fallback([httpTransport(READ_RPC_URL, { retryCount: 0 }), httpTransport(RPC_URL)]) });
const writePub = createPublicClient({ chain, transport: httpTransport(RPC_URL) });

let account = null;
let wallet = null;
if (env('REGISTER_KEYSTORE')) {
  const ks = fs.readFileSync(home(env('REGISTER_KEYSTORE')), 'utf8');
  const pw = fs.readFileSync(home(env('REGISTER_PASSWORD_FILE')), 'utf8').replace(/\r?\n$/, '');
  account = privateKeyToAccount(decryptKeystore(ks, pw));
  wallet = createWalletClient({ chain, transport: httpTransport(RPC_URL), account });
}

// ---------------------------------------------------------------- storage (one JSON file; fine for thousands of addresses)

const big = (_, v) => (typeof v === 'bigint' ? `${v}n` : v);
const unbig = (_, v) => (typeof v === 'string' && /^-?\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v);
const load = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8'), unbig); } catch { return d; } };
const store = load(STORE_FILE, { cursor: FROM_BLOCK, records: {}, webhooks: [] });
const keys = () => load(KEYS_FILE, []);
let saveTimer = null;
const save = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = `${STORE_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(store, big));
    fs.renameSync(tmp, STORE_FILE);
  }, 200);
};
const byHash = new Map(Object.values(store.records).map((r) => [r.intentHash, r.address]));

// ---------------------------------------------------------------- helpers

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const json = (res, status, body) => {
  const text = JSON.stringify(body, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(text);
};
const fail = (res, status, code, message) => json(res, status, { error: { code, message } });
const readBody = (req) => new Promise((resolve, reject) => {
  let b = '';
  req.on('data', (c) => { b += c; if (b.length > 64 * 1024) { reject(new Error('body too large')); req.destroy(); } });
  req.on('end', () => resolve(b));
  req.on('error', reject);
});
function auth(req) {
  const m = (req.headers.authorization ?? '').match(/^Bearer\s+(dk_[A-Za-z0-9_-]+)$/);
  if (!m) return null;
  const h = sha256(m[1]);
  return keys().find((k) => k.keyHash === h && !k.revoked) ?? null;
}
const recent = new Map(); // key name -> creation timestamps (last hour)
function allowCreate(name) {
  const now = Date.now();
  const list = (recent.get(name) ?? []).filter((t) => now - t < 3_600_000);
  if (list.length >= CREATES_PER_HOUR) return false;
  list.push(now);
  recent.set(name, list);
  return true;
}
const txUrl = (h) => `${EXPLORER}/tx/${h}`;

// Serialize registrations so two requests never race for the same nonce.
let chainQueue = Promise.resolve();
const serial = (fn) => { const p = chainQueue.then(fn, fn); chainQueue = p.catch(() => {}); return p; };

async function register(intent) {
  if (!wallet) return null;
  return serial(async () => {
    const block = await writePub.getBlock();
    const maxFeePerGas = block.baseFeePerGas * 2n > 20_000_000_000n ? block.baseFeePerGas * 2n : 20_000_000_000n;
    const hash = await wallet.writeContract({ address: DOORSTEP, abi: DOORSTEP_ABI, functionName: 'announce', args: [intent], maxFeePerGas, maxPriorityFeePerGas: 0n, chain });
    const r = await writePub.waitForTransactionReceipt({ hash });
    if (r.status !== 'success') throw new Error(`registration transaction failed: ${hash}`);
    return hash;
  });
}

// ---------------------------------------------------------------- status

function statusOf(rec, waiting, now) {
  const last = rec.events[rec.events.length - 1];
  const expired = BigInt(now) > rec.intent.expiry;
  const belowMin = waiting / 10n ** 12n < rec.intent.minAmount6;
  let state;
  if (waiting > 0n) state = expired ? 'returning' : belowMin ? (rec.amount6 !== undefined ? 'part_paid' : 'below_minimum') : 'delivering';
  else if (last?.type === 'delivered') state = 'delivered';
  else if (last?.type === 'returned') state = last.reason === 'cancelled' ? 'cancelled' : 'returned';
  else state = expired ? 'expired' : 'waiting';
  const out = {
    address: rec.address,
    state,
    waiting: formatUsdc18(waiting),
    reference: rec.reference,
    expiresAt: new Date(Number(rec.intent.expiry) * 1000).toISOString(),
    payLink: rec.payLink,
    events: rec.events,
  };
  if (rec.amount6 !== undefined) {
    const paidIn = rec.events.filter((e) => e.type === 'delivered').reduce((s, e) => s + BigInt(e.paidIn18), 0n) + waiting;
    out.invoice = paymentState(rec.amount6, { received: paidIn });
  }
  return out;
}

// ---------------------------------------------------------------- webhooks

const LANDED = parseAbiItem('event Landed(bytes32 indexed intentHash, bytes32 indexed ref, address indexed target, address depositAddress, uint256 amountPulled6, uint256 refunded, uint256 keeperFee)');
const BOUNCED = parseAbiItem('event Bounced(bytes32 indexed intentHash, bytes32 indexed ref, address indexed refundTo, address depositAddress, uint8 reason, uint256 refunded, uint256 keeperFee, bytes revertData)');
const REASONS = ['expired', 'target_call_failed', 'cancelled'];

function enqueueWebhook(rec, event) {
  const owner = keys().find((k) => k.name === rec.keyName);
  if (!rec.webhookUrl || !owner) return;
  const payload = { id: `evt_${crypto.randomBytes(9).toString('hex')}`, type: event.type === 'delivered' ? 'payment.delivered' : 'payment.returned', createdAt: new Date().toISOString(), data: { address: rec.address, reference: rec.reference, ...event } };
  store.webhooks.push({ url: rec.webhookUrl, keyName: rec.keyName, body: JSON.stringify(payload), attempts: 0, nextAt: Date.now() });
  save();
}

const BACKOFF = [0, 30_000, 120_000, 600_000, 1_800_000, 7_200_000];
async function sendWebhooks() {
  const now = Date.now();
  for (const w of store.webhooks.filter((x) => !x.done && x.nextAt <= now)) {
    const secret = keys().find((k) => k.name === w.keyName)?.webhookSecret;
    if (!secret) { w.done = 'no-key'; continue; }
    const ts = Math.floor(now / 1000).toString();
    const sig = crypto.createHmac('sha256', secret).update(`${ts}.${w.body}`).digest('hex');
    try {
      const r = await fetch(w.url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-doorstep-timestamp': ts, 'x-doorstep-signature': `v1=${sig}` }, body: w.body, signal: AbortSignal.timeout(10_000) });
      if (r.ok) { w.done = 'delivered'; continue; }
      throw new Error(`HTTP ${r.status}`);
    } catch (e) {
      w.attempts += 1;
      w.lastError = String(e.message ?? e);
      if (w.attempts >= BACKOFF.length) w.done = 'failed';
      else w.nextAt = now + BACKOFF[w.attempts];
    }
  }
  // Keep the last 1,000 finished deliveries for inspection.
  const finished = store.webhooks.filter((x) => x.done);
  if (finished.length > 1000) store.webhooks = store.webhooks.filter((x) => !x.done).concat(finished.slice(-1000));
  save();
}

// ---------------------------------------------------------------- watcher: Landed/Bounced for our addresses

let span = 9000n;
let pausedUntil = 0;
async function poll() {
  if (Date.now() < pausedUntil || byHash.size === 0) return;
  let head;
  try { head = await read.getBlockNumber({ cacheTime: 0 }); } catch { pausedUntil = Date.now() + 20_000; return; }
  while (store.cursor <= head) {
    const to = store.cursor + span - 1n < head ? store.cursor + span - 1n : head;
    let logs;
    try {
      logs = await read.getLogs({ address: DOORSTEP, events: [LANDED, BOUNCED], fromBlock: store.cursor, toBlock: to });
    } catch (e) {
      const m = `${e.shortMessage ?? ''} ${e.details ?? ''}`;
      if (/rate|429|too many/i.test(m)) { pausedUntil = Date.now() + 30_000; return; }
      const stated = m.match(/limited to a (\d+)|max(?:imum)? (?:block )?range (?:of |is )?(\d+)/i);
      span = stated ? BigInt(stated[1] ?? stated[2]) : span > 10n ? span / 2n : 10n;
      continue;
    }
    for (const l of logs) {
      const addr = byHash.get(l.args.intentHash);
      if (!addr) continue;
      const rec = store.records[addr];
      if (rec.events.some((e) => e.tx === l.transactionHash)) continue;
      const ev = l.eventName === 'Landed'
        ? { type: 'delivered', amount: formatUsdc6(l.args.amountPulled6), networkFee: formatUsdc18(l.args.keeperFee), returnedUnusedFee: formatUsdc18(l.args.refunded), paidIn18: (l.args.amountPulled6 * 10n ** 12n + l.args.keeperFee + l.args.refunded).toString(), tx: l.transactionHash, txUrl: txUrl(l.transactionHash), block: l.blockNumber.toString() }
        : { type: 'returned', reason: REASONS[Number(l.args.reason)] ?? 'unknown', amount: formatUsdc18(l.args.refunded), networkFee: formatUsdc18(l.args.keeperFee), to: l.args.refundTo, tx: l.transactionHash, txUrl: txUrl(l.transactionHash), block: l.blockNumber.toString() };
      rec.events.push(ev);
      enqueueWebhook(rec, ev);
    }
    store.cursor = to + 1n;
    save();
  }
}

// ---------------------------------------------------------------- HTTP

const DOCS = fs.readFileSync(new URL('./docs.html', import.meta.url), 'utf8');

async function createAddress(req, res, key) {
  if (!allowCreate(key.name)) return fail(res, 429, 'rate_limited', `At most ${CREATES_PER_HOUR} new addresses per hour per key.`);
  let b;
  try { b = JSON.parse(await readBody(req) || '{}'); } catch { return fail(res, 400, 'bad_json', 'Body must be JSON.'); }
  const { into, beneficiary, refundTo, amount, minimum, keeperFeeCap = '0.01', expires = '30d', reference = '', webhookUrl, register: doRegister = true, call } = b;
  if (webhookUrl !== undefined && !/^https?:\/\/.+/.test(String(webhookUrl))) return fail(res, 400, 'bad_webhook', 'webhookUrl must be an http(s) URL.');
  const head = await read.getBlockNumber({ cacheTime: 0 }).catch(() => writePub.getBlockNumber());
  let intent;
  try {
    const common = { refundTo, minimum: amount ?? minimum ?? '0', keeperFeeCap, expires, reference };
    if (call) {
      // Advanced: any function, with "AMOUNT" where the arrived amount goes. call = { abi, functionName, args }
      const args = (call.args ?? []).map((a) => (a === 'AMOUNT' ? AMOUNT : a));
      intent = makeIntent({ target: into, abi: call.abi, functionName: call.functionName, args, ...common });
    } else {
      intent = depositIntent({ into, beneficiary, ...common });
    }
  } catch (e) {
    return fail(res, 400, 'invalid', e instanceof DoorstepError ? e.message : String(e.message ?? e));
  }
  const address = depositAddress(intent, DOORSTEP);
  // Same instructions, same address: return the existing record instead of creating a second one.
  if (store.records[address]) {
    const rec = store.records[address];
    if (rec.keyName !== key.name) return fail(res, 409, 'exists', 'This address was created with another API key.');
    const waiting = await read.getBalance({ address }).catch(() => 0n);
    return json(res, 200, { ...statusOf(rec, waiting, Math.floor(Date.now() / 1000)), existing: true });
  }
  const amount6 = amount !== undefined ? toUnits6(String(amount), 'amount') : undefined;
  const payLink = toLink(intent, { baseUrl: PAY_BASE, fromBlock: head, ...(amount !== undefined ? { amount: String(amount) } : {}) });
  const rec = {
    address, intentHash: intentHash(intent), intent, keyName: key.name, reference: explain(intent).reference,
    amount6, webhookUrl, payLink, description: describe(intent, { cancellable: true }), createdAt: new Date().toISOString(),
    fromBlock: head, registerTx: null, events: [],
  };
  if (doRegister) {
    try { rec.registerTx = await register(intent); } catch (e) { return fail(res, 502, 'register_failed', `Couldn't register the address on-chain: ${e.shortMessage ?? e.message}`); }
  }
  // Nothing to watch before the first address: start watching from where it was created.
  if (byHash.size === 0 && store.cursor < head) store.cursor = head;
  store.records[address] = rec;
  byHash.set(rec.intentHash, address);
  save();
  return json(res, 201, {
    address, payLink, description: rec.description, reference: rec.reference,
    expiresAt: new Date(Number(intent.expiry) * 1000).toISOString(),
    registered: !!rec.registerTx, registerTx: rec.registerTx, ...(rec.registerTx ? { registerTxUrl: txUrl(rec.registerTx) } : {}),
    invoice: amount6 !== undefined ? paymentState(amount6, { received: 0n }) : undefined,
    intent,
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, PUBLIC_URL);
  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/docs')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(DOCS.replaceAll('{{BASE}}', PUBLIC_URL).replaceAll('{{DOORSTEP}}', DOORSTEP));
    }
    if (req.method === 'GET' && url.pathname === '/v1/health') {
      return json(res, 200, { ok: true, chainId: CHAIN_ID, doorstep: DOORSTEP, registering: !!wallet, registerWallet: account?.address ?? null, watchingFrom: store.cursor.toString(), addresses: Object.keys(store.records).length });
    }
    const key = auth(req);
    if (url.pathname.startsWith('/v1/') && !key) return fail(res, 401, 'unauthorized', 'Send your API key as: Authorization: Bearer dk_…');
    if (req.method === 'POST' && url.pathname === '/v1/addresses') return await createAddress(req, res, key);
    const m = url.pathname.match(/^\/v1\/addresses\/(0x[0-9a-fA-F]{40})$/);
    if (req.method === 'GET' && m) {
      if (!isAddress(m[1])) return fail(res, 400, 'invalid', 'Not an address.');
      const rec = store.records[getAddress(m[1])];
      if (!rec || rec.keyName !== key.name) return fail(res, 404, 'not_found', 'No address with that id for this API key.');
      const [waiting, block] = await Promise.all([read.getBalance({ address: rec.address }), read.getBlock()]);
      return json(res, 200, statusOf(rec, waiting, Number(block.timestamp)));
    }
    if (req.method === 'GET' && url.pathname === '/v1/addresses') {
      const ref = url.searchParams.get('reference');
      const list = Object.values(store.records).filter((r) => r.keyName === key.name && (!ref || r.reference === ref))
        .slice(-100).map((r) => ({ address: r.address, reference: r.reference, createdAt: r.createdAt, events: r.events.length, payLink: r.payLink }));
      return json(res, 200, { addresses: list });
    }
    return fail(res, 404, 'not_found', 'No such endpoint. See /docs.');
  } catch (e) {
    console.error('[api error]', e);
    return fail(res, 500, 'internal', 'Something went wrong. Try again.');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Doorstep API on ${HOST}:${PORT} (public URL ${PUBLIC_URL}), chain ${CHAIN_ID}, Doorstep ${DOORSTEP}`);
  console.log(wallet ? `Registering addresses with ${account.address}` : 'No REGISTER_KEYSTORE: addresses are created but not registered for automatic delivery.');
});

const tick = async () => {
  try { await poll(); await sendWebhooks(); } catch (e) { console.error('[watch error]', e.shortMessage ?? e.message); }
  setTimeout(tick, POLL_MS);
};
tick();

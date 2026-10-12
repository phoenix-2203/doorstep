// Doorstep keeper: finds announced intents, watches their deposit addresses, lands deposits.
//
//   RPC_URL=https://rpc.mainnet.arc.io \
//   DOORSTEP=0x... FROM_BLOCK=<deploy block> \
//   KEEPER_KEYSTORE=~/.foundry/keystores/<name> node keeper.mjs      (asks for the password)
//
// Signing key, in order of preference:
//   KEEPER_KEYSTORE      a Foundry / Web3 Secret Storage keystore file; password from
//                        KEEPER_PASSWORD_FILE, or typed in at start-up
//   KEEPER_PRIVATE_KEY   a raw key (only for throwaway keeper wallets)
// With neither, it runs read-only and just reports what it would land.
//
// Anyone can run this. The keeper is repaid its gas (capped per intent) out of each deposit.
// Use a separate keeper wallet holding a little USDC for gas, not your main wallet.

import fs from 'node:fs';
import os from 'node:os';
import { createPublicClient, createWalletClient, http, defineChain, parseGwei, formatUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { decryptKeystore, askHidden } from './keystore.mjs';


async function loadAccount() {
  if (process.env.KEEPER_KEYSTORE) {
    const file = process.env.KEEPER_KEYSTORE.replace(/^~(?=\/)/, os.homedir());
    const password = process.env.KEEPER_PASSWORD_FILE
      ? fs.readFileSync(process.env.KEEPER_PASSWORD_FILE.replace(/^~(?=\/)/, os.homedir()), 'utf8').replace(/\r?\n$/, '')
      : await askHidden(`Keystore password for ${file}: `);
    return privateKeyToAccount(decryptKeystore(fs.readFileSync(file, 'utf8'), password));
  }
  if (process.env.KEEPER_PRIVATE_KEY) return privateKeyToAccount(process.env.KEEPER_PRIVATE_KEY);
  return null;
}

const abi = JSON.parse(fs.readFileSync(new URL('./abi.json', import.meta.url))).Doorstep;

const RPC_URL = process.env.RPC_URL ?? 'https://rpc.mainnet.arc.io';
const DOORSTEP = process.env.DOORSTEP;
const FROM_BLOCK = BigInt(process.env.FROM_BLOCK ?? '0');
const POLL_MS = Number(process.env.POLL_MS ?? 3000);
const LOG_SPAN = BigInt(process.env.LOG_SPAN ?? 9000); // blocks per eth_getLogs call; Arc's public RPC caps ranges at 10,000
// One state file per Doorstep contract, so switching DOORSTEP never mixes up registered addresses.
const STATE_FILE = process.env.STATE_FILE ?? new URL(`./keeper-state-${(process.env.DOORSTEP ?? '').slice(2, 10).toLowerCase()}.json`, import.meta.url).pathname;
const MIN_FEE = parseGwei('20'); // Arc mempool floor; lower maxFeePerGas is silently dropped

if (!DOORSTEP) throw new Error('Set DOORSTEP to the deployed Doorstep address');

const chainId = Number(process.env.CHAIN_ID ?? 5042);
const arc = defineChain({
  id: chainId,
  name: chainId === 5042 ? 'Arc' : 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});

// Two endpoints keep a free RPC plan from running out:
// - WATCH (READ_RPC_URL, default Arc's public RPC): log searches and balance checks. It allows
//   9,000-block log searches, so watching costs one small request every few seconds.
// - RPC_URL (your own endpoint): everything for an actual delivery, and the backup for balance
//   checks. A delivery costs a few hundred compute units on Alchemy's free plan.
const READ_RPC_URL = process.env.READ_RPC_URL || (chainId === 5042 ? 'https://rpc.mainnet.arc.io' : RPC_URL);
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11'; // listed on Arc mainnet in Arc's docs
const pub = createPublicClient({ chain: arc, transport: http(RPC_URL) });
const watch = READ_RPC_URL === RPC_URL ? pub : createPublicClient({ chain: arc, transport: http(READ_RPC_URL) });
const account = await loadAccount();
const wallet = account ? createWalletClient({ chain: arc, transport: http(RPC_URL), account }) : null;

const realChain = await pub.getChainId();
if (realChain !== chainId) throw new Error(`RPC is chain ${realChain}, expected ${chainId}`);
if (watch !== pub) {
  const watchChain = await watch.getChainId();
  if (watchChain !== chainId) throw new Error(`READ_RPC_URL is chain ${watchChain}, expected ${chainId}`);
}

const ETH_BALANCE_ABI = [{ type: 'function', name: 'getEthBalance', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] }];
// All deposit-address balances in one request (Multicall3), from the watch endpoint, falling back
// to your own endpoint, and to one-by-one reads if Multicall3 is unavailable.
async function balancesOf(addresses) {
  if (!addresses.length) return [];
  const contracts = addresses.map((a) => ({ address: MULTICALL3, abi: ETH_BALANCE_ABI, functionName: 'getEthBalance', args: [a] }));
  for (const client of watch === pub ? [pub] : [watch, pub]) {
    try {
      return await client.multicall({ contracts, allowFailure: false, multicallAddress: MULTICALL3, batchSize: 0 });
    } catch { /* try the next endpoint */ }
  }
  return Promise.all(addresses.map((a) => pub.getBalance({ address: a })));
}

// ---------------------------------------------------------------- state

let state = { cursor: FROM_BLOCK.toString(), intents: {} };
try {
  state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
} catch {}
const save = () => fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 1));

const json = (v) => JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x));
const revive = (i) => ({
  ...i,
  minAmount6: BigInt(i.minAmount6),
  maxKeeperFee6: BigInt(i.maxKeeperFee6),
  expiry: BigInt(i.expiry),
});

// ---------------------------------------------------------------- discovery

// Arc's public RPC refuses some eth_getLogs ranges ("Request exceeds defined limit"), so the span
// shrinks on refusal and grows back after successes.
// The same error (-32005, "Request exceeds defined limit") is also used for rate limiting, so on a
// refusal the bot both shrinks the range and waits, longer each time, and says exactly what the RPC
// replied.
let span = LOG_SPAN;
let maxSpan = LOG_SPAN; // lowered for good if the RPC states its own limit
const MIN_SPAN = 1n;
// e.g. QuickNode free plan: "eth_getLogs is limited to a 5 range"; others say "max block range 2000".
const statedLimit = (e) => { const m = rpcReason(e).match(/limited to a (\d+)|max(?:imum)? (?:block )?range (?:of |is )?(\d+)|(\d+) block range/i); return m ? BigInt(m[1] ?? m[2] ?? m[3]) : null; };
let backoffMs = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isLimit = (e) => e?.code === -32005 || /limit|range|too many|exceed|too large|response size|rate/i.test(`${e?.shortMessage ?? ''} ${e?.details ?? ''} ${e?.message ?? ''}`);
const rpcReason = (e) => (e?.details || e?.cause?.details || e?.shortMessage || e?.message || String(e)).toString().split('\n')[0];

let lastProgress = 0;
async function scan() {
  const head = await watch.getBlockNumber({ cacheTime: 0 });
  let from = BigInt(state.cursor);
  const behind = head - from;
  if (behind > 2000n) console.log(`[sync] catching up on ${behind} blocks (${from} -> ${head}), ${span} blocks per search…`);
  while (from <= head) {
    const to = from + span - 1n < head ? from + span - 1n : head;
    let logs;
    try {
      logs = await watch.getContractEvents({ address: DOORSTEP, abi, eventName: 'Announced', fromBlock: from, toBlock: to });
    } catch (e) {
      if (!isLimit(e)) throw e;
      const stated = statedLimit(e);
      if (stated && stated > 0n && stated < maxSpan) {
        // The RPC told us its range limit: use exactly that from now on, no waiting needed.
        maxSpan = stated;
        span = stated;
        console.log(`[rpc] this endpoint allows ${stated}-block log searches; using that size.`);
        continue;
      }
      backoffMs = Math.min(backoffMs ? backoffMs * 2 : 1000, 60_000);
      console.log(`[rpc refused] eth_getLogs blocks ${from}-${to} (${to - from + 1n} blocks): "${rpcReason(e)}". Retrying in ${backoffMs / 1000}s${span > MIN_SPAN ? ' with a smaller range' : ''}.`);
      if (span > MIN_SPAN) span = span / 2n < MIN_SPAN ? MIN_SPAN : span / 2n;
      await sleep(backoffMs);
      continue;
    }
    backoffMs = 0;
    for (const log of logs) {
      const { intentHash, depositAddress, intent } = log.args;
      if (!state.intents[intentHash]) {
        state.intents[intentHash] = { depositAddress, intent: JSON.parse(json(intent)) };
        console.log(`[discover] ${intentHash.slice(0, 10)} -> ${depositAddress} (block ${log.blockNumber})`);
      }
    }
    state.cursor = (to + 1n).toString();
    save();
    from = to + 1n;
    if (behind > 2000n && Date.now() - lastProgress > 15_000) {
      lastProgress = Date.now();
      const done = Number(((from - (head - behind)) * 1000n) / (behind || 1n)) / 10;
      console.log(`[sync] ${done.toFixed(1)}% (block ${from} of ${head})`);
    }
    if (span < maxSpan) span = span * 2n > maxSpan ? maxSpan : span * 2n;
  }
  if (behind > 2000n) console.log(`[sync] caught up at block ${head}. Watching for payments.`);
}

// ---------------------------------------------------------------- landing

async function tryLand(hash, { depositAddress, intent }, balance) {
  if (balance === 0n) return;
  const i = revive(intent);

  // Simulate first: BelowMinimum / NothingToLand / InvalidIntent revert here at no cost.
  try {
    await pub.simulateContract({ address: DOORSTEP, abi, functionName: 'land', args: [i], account: account?.address });
  } catch (e) {
    const reason = e.shortMessage ?? e.message;
    if (!/BelowMinimum/.test(reason)) console.log(`[skip] ${hash.slice(0, 10)} ${formatUnits(balance, 18)} USDC: ${reason.split('\n')[0]}`);
    return;
  }

  if (!wallet) {
    console.log(`[would land] ${hash.slice(0, 10)} ${formatUnits(balance, 18)} USDC at ${depositAddress}`);
    return;
  }

  // Price: Doorstep repays at min(tx.gasprice, 2 x basefee), so bid within that and above the floor.
  const block = await pub.getBlock();
  const base = block.baseFeePerGas ?? MIN_FEE;
  const maxFeePerGas = base * 2n > MIN_FEE ? base * 2n : MIN_FEE;
  // Estimate WITH a gas price: at price 0 the keeper fee is 0, the fee transfer is skipped, and
  // the estimate comes out ~7k gas short. Then add headroom; unused gas is not charged.
  const est = await pub.estimateContractGas({ address: DOORSTEP, abi, functionName: 'land', args: [i], account, maxFeePerGas, maxPriorityFeePerGas: 0n });
  const hashTx = await wallet.writeContract({
    address: DOORSTEP,
    abi,
    functionName: 'land',
    args: [i],
    gas: (est * 13n) / 10n + 30_000n,
    maxFeePerGas,
    maxPriorityFeePerGas: 0n,
  });
  const receipt = await pub.waitForTransactionReceipt({ hash: hashTx });
  // A blocklist revert can leave no receipt; waitForTransactionReceipt throws on timeout in that case.
  console.log(`[land] ${hash.slice(0, 10)} ${formatUnits(balance, 18)} USDC status=${receipt.status} tx=${hashTx}`);
}

const rpcShown = (() => { try { const u = new URL(RPC_URL); if (/^[\d.]+$|localhost/.test(u.hostname)) return `${u.protocol}//${u.host}`; const host = u.hostname.split('.').slice(-2).join('.'); return `${u.protocol}//${u.hostname.split('.').length > 2 ? '…' : ''}${host}${u.pathname.length > 1 || u.search ? '/…' : ''}`; } catch { return 'RPC'; } })();
const shown = (url) => { try { const u = new URL(url); if (/^[\d.]+$|localhost/.test(u.hostname)) return `${u.protocol}//${u.host}`; const host = u.hostname.split('.').slice(-2).join('.'); return `${u.protocol}//${u.hostname.split('.').length > 2 ? '…' : ''}${host}${u.pathname.length > 1 || u.search ? '/…' : ''}`; } catch { return 'RPC'; } };
if (watch !== pub) console.log(`Watching with ${shown(READ_RPC_URL)}; delivering with ${rpcShown}.`);
console.log(`Doorstep keeper on chain ${chainId} (${rpcShown}), contract ${DOORSTEP}, ${wallet ? 'signing as ' + account.address : 'read-only'}`);
if (account) {
  const bal = await pub.getBalance({ address: account.address });
  console.log(`Bot wallet balance: ${formatUnits(bal, 18)} USDC${bal < 10n ** 16n ? '  (low: send it ~0.1 USDC on Arc for gas; each delivery costs under 0.01 and is repaid)' : ''}`);
}
for (;;) {
  try {
    await scan();
    const entries = Object.entries(state.intents);
    const balances = await balancesOf(entries.map(([, e]) => e.depositAddress));
    for (let k = 0; k < entries.length; k++) await tryLand(entries[k][0], entries[k][1], balances[k]);
  } catch (e) {
    console.error(`[error] ${e.shortMessage ?? e.message}${e.details && e.details !== e.shortMessage ? ` (RPC said: "${rpcReason(e)}")` : ''}`);
    if (isLimit(e)) await sleep(10_000);
  }
  await new Promise((r) => setTimeout(r, POLL_MS));
}

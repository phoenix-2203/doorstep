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
const POLL_MS = Number(process.env.POLL_MS ?? 2000);
const LOG_SPAN = 9_000n; // Arc's public RPC rejects eth_getLogs ranges of 10,000+ blocks
const STATE_FILE = process.env.STATE_FILE ?? new URL('./keeper-state.json', import.meta.url).pathname;
const MIN_FEE = parseGwei('20'); // Arc mempool floor; lower maxFeePerGas is silently dropped

if (!DOORSTEP) throw new Error('Set DOORSTEP to the deployed Doorstep address');

const chainId = Number(process.env.CHAIN_ID ?? 5042);
const arc = defineChain({
  id: chainId,
  name: chainId === 5042 ? 'Arc' : 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});

const pub = createPublicClient({ chain: arc, transport: http(RPC_URL) });
const account = await loadAccount();
const wallet = account ? createWalletClient({ chain: arc, transport: http(RPC_URL), account }) : null;

const realChain = await pub.getChainId();
if (realChain !== chainId) throw new Error(`RPC is chain ${realChain}, expected ${chainId}`);

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

async function scan() {
  const head = await pub.getBlockNumber();
  let from = BigInt(state.cursor);
  while (from <= head) {
    const to = from + LOG_SPAN - 1n < head ? from + LOG_SPAN - 1n : head;
    const logs = await pub.getContractEvents({ address: DOORSTEP, abi, eventName: 'Announced', fromBlock: from, toBlock: to });
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
  }
}

// ---------------------------------------------------------------- landing

async function tryLand(hash, { depositAddress, intent }) {
  const balance = await pub.getBalance({ address: depositAddress });
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

console.log(`Doorstep keeper on chain ${chainId} (${RPC_URL}), contract ${DOORSTEP}, ${wallet ? 'signing as ' + account.address : 'read-only'}`);
for (;;) {
  try {
    await scan();
    for (const [h, entry] of Object.entries(state.intents)) await tryLand(h, entry);
  } catch (e) {
    console.error('[error]', e.shortMessage ?? e.message);
  }
  await new Promise((r) => setTimeout(r, POLL_MS));
}

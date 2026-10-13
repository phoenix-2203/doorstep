// A small in-memory stand-in for Arc mainnet and a browser wallet, for testing the web app in a
// headless browser without real money. It understands just enough JSON-RPC for the app: balances,
// Doorstep's announce / land / cancel, the demo vault's balanceOf6 / withdraw, logs and receipts.
// A pretend delivery bot delivers payments that reach the minimum after DELIVERY_MS.
//
// Everything it produces is simulated; never present it as mainnet activity.
import {
  decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionResult, getAddress, keccak256, toHex,
} from '../node_modules/viem/_esm/index.js';
import { DOORSTEP_ABI } from '../../sdk/src/abi.js';
import { CONFIG } from '../config.js';

const DOOR = getAddress(CONFIG.doorstep);
const ESCROW = getAddress(CONFIG.escrow);
const ESCROW_ABI = [
  { type: 'function', name: 'balanceOf6', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'withdraw', stateMutability: 'nonpayable', inputs: [{ type: 'uint256', name: 'amount6' }, { type: 'address', name: 'to' }], outputs: [] },
];
const SCALE = 10n ** 12n;
const hex = (n) => '0x' + BigInt(n).toString(16);

export function createSim({ owner, depositAddress, intentHash, minAmount6 = 10_000n, deliveryMs = 3500, keeperFee = 3_200_000_000_000_000n }) {
  owner = getAddress(owner);
  const dep = getAddress(depositAddress);
  const start = Date.now();
  const baseBlock = 25_531_000n;
  const state = {
    wallet: 5n * 10n ** 18n, // 5 USDC in the visitor's wallet
    waiting: 0n,
    vault: 0n, // 6 decimals
    logs: [],
    receipts: new Map(),
    announced: false,
    nonce: 0,
    connected: false,
  };
  const head = () => baseBlock + BigInt(Math.floor((Date.now() - start) / 500));
  let txn = 0;
  const newHash = () => keccak256(toHex(`sim-${start}-${++txn}`));

  function addLog(eventName, args, txHash) {
    const ev = DOORSTEP_ABI.find((x) => x.type === 'event' && x.name === eventName);
    const topics = encodeEventTopics({ abi: [ev], eventName, args });
    const nonIndexed = ev.inputs.filter((i) => !i.indexed);
    const data = encodeAbiParameters(nonIndexed, nonIndexed.map((i) => args[i.name]));
    const blockNumber = head();
    const log = { address: DOOR, topics, data, blockNumber: hex(blockNumber), transactionHash: txHash, transactionIndex: '0x0', blockHash: keccak256(toHex(`b${blockNumber}`)), logIndex: hex(state.logs.length), removed: false };
    state.logs.push(log);
    return log;
  }
  function receipt(hash, logs, to) {
    const r = { transactionHash: hash, status: '0x1', blockNumber: hex(head()), blockHash: keccak256(toHex(`b${head()}`)), transactionIndex: '0x0', from: owner, to, logs, gasUsed: '0x30000', cumulativeGasUsed: '0x30000', effectiveGasPrice: hex(20_000_000_000n), contractAddress: null, logsBloom: '0x' + '0'.repeat(512), type: '0x2' };
    state.receipts.set(hash, r);
  }
  function deliver(hash = newHash(), byKeeper = true) {
    if (state.waiting === 0n) return null;
    const fee = byKeeper ? keeperFee : keeperFee;
    const pulled6 = (state.waiting - fee) / SCALE;
    const refunded = state.waiting - pulled6 * SCALE - fee;
    state.vault += pulled6;
    state.wallet += refunded;
    state.waiting = 0n;
    const log = addLog('Landed', { intentHash, ref: '0x' + Buffer.from('doorstep-savings').toString('hex').padEnd(64, '0'), target: ESCROW, depositAddress: dep, amountPulled6: pulled6, refunded, keeperFee: fee }, hash);
    receipt(hash, [log], DOOR);
    return hash;
  }
  let timer = null;
  function maybeScheduleDelivery() {
    clearTimeout(timer);
    if (state.waiting / SCALE >= minAmount6) timer = setTimeout(() => deliver(), deliveryMs);
  }

  function send(tx) {
    const hash = newHash();
    const to = getAddress(tx.to);
    const value = BigInt(tx.value ?? 0);
    state.nonce += 1;
    if (to === dep) {
      state.wallet -= value;
      state.waiting += value;
      receipt(hash, [], dep);
      maybeScheduleDelivery();
      return hash;
    }
    if (to === DOOR) {
      const { functionName, args } = decodeFunctionData({ abi: DOORSTEP_ABI, data: tx.data });
      if (functionName === 'announce') {
        state.announced = true;
        const log = addLog('Announced', { intentHash, depositAddress: dep, intent: args[0] }, hash);
        receipt(hash, [log], DOOR);
      } else if (functionName === 'cancel') {
        clearTimeout(timer);
        const back = state.waiting;
        state.waiting = 0n;
        state.wallet += back;
        const log = addLog('Bounced', { intentHash, ref: '0x' + Buffer.from('doorstep-savings').toString('hex').padEnd(64, '0'), refundTo: owner, depositAddress: dep, reason: 2, refunded: back, keeperFee: 0n, revertData: '0x' }, hash);
        receipt(hash, [log], DOOR);
      } else if (functionName === 'land') {
        clearTimeout(timer);
        deliver(hash, false);
      }
      return hash;
    }
    if (to === ESCROW) {
      const { args } = decodeFunctionData({ abi: ESCROW_ABI, data: tx.data });
      state.vault -= args[0];
      state.wallet += args[0] * SCALE;
      receipt(hash, [], ESCROW);
      return hash;
    }
    receipt(hash, [], to);
    return hash;
  }

  function call({ to, data }) {
    to = getAddress(to);
    if (to === ESCROW) {
      const { functionName, args } = decodeFunctionData({ abi: ESCROW_ABI, data });
      if (functionName === 'balanceOf6') return encodeFunctionResult({ abi: ESCROW_ABI, functionName, result: getAddress(args[0]) === owner ? state.vault : 0n });
    }
    if (to === DOOR) {
      const { functionName } = decodeFunctionData({ abi: DOORSTEP_ABI, data });
      if (functionName === 'cancel' && state.waiting === 0n) throw Object.assign(new Error('execution reverted'), { code: 3, data: keccak256(toHex('NothingToLand()')).slice(0, 10) });
      if (functionName === 'addressOf') return encodeFunctionResult({ abi: DOORSTEP_ABI, functionName, result: dep });
    }
    return '0x' + '0'.repeat(63) + '1';
  }

  function getLogs(f) {
    const from = BigInt(f.fromBlock ?? 0), to = BigInt(f.toBlock === 'latest' || !f.toBlock ? head() : f.toBlock);
    const t0 = f.topics?.[0];
    const want0 = t0 == null ? null : Array.isArray(t0) ? t0 : [t0];
    const t1 = f.topics?.[1];
    return state.logs.filter((l) => {
      const b = BigInt(l.blockNumber);
      if (b < from || b > to) return false;
      if (f.address && getAddress(Array.isArray(f.address) ? f.address[0] : f.address) !== getAddress(l.address)) return false;
      if (want0 && !want0.includes(l.topics[0])) return false;
      if (t1 && l.topics[1] !== t1) return false;
      return true;
    });
  }

  function handle({ method, params = [] }) {
    switch (method) {
      case 'eth_chainId': return '0x13b2';
      case 'net_version': return '5042';
      case 'eth_blockNumber': return hex(head());
      case 'eth_accounts': return state.connected ? [owner] : [];
      case 'eth_requestAccounts': state.connected = true; return [owner];
      case 'wallet_switchEthereumChain': case 'wallet_addEthereumChain': return null;
      case 'eth_getBalance': {
        const a = getAddress(params[0]);
        return hex(a === dep ? state.waiting : a === owner ? state.wallet : 0n);
      }
      case 'eth_getCode': return '0x';
      case 'eth_getTransactionCount': return hex(state.nonce);
      case 'eth_gasPrice': return hex(20_000_000_000n);
      case 'eth_maxPriorityFeePerGas': return '0x0';
      case 'eth_estimateGas': return '0x40000';
      case 'eth_feeHistory': return { oldestBlock: hex(head()), baseFeePerGas: [hex(20_000_000_000n), hex(20_000_000_000n)], gasUsedRatio: [0.1], reward: [['0x0']] };
      case 'eth_getBlockByNumber': return { number: hex(head()), hash: keccak256(toHex(`b${head()}`)), timestamp: hex(Math.floor(Date.now() / 1000)), baseFeePerGas: hex(20_000_000_000n), gasLimit: '0x1c9c380', gasUsed: '0x0', transactions: [] };
      case 'eth_call': return call(params[0]);
      case 'eth_getLogs': return getLogs(params[0]);
      case 'eth_sendTransaction': return send(params[0]);
      case 'eth_getTransactionReceipt': return state.receipts.get(params[0]) ?? null;
      case 'eth_getTransactionByHash': {
        const r = state.receipts.get(params[0]);
        return r ? { hash: r.transactionHash, blockNumber: r.blockNumber, blockHash: r.blockHash, from: owner, to: r.to, input: '0x', value: '0x0', nonce: '0x0', gas: '0x40000', gasPrice: hex(20_000_000_000n), transactionIndex: '0x0', type: '0x0', v: '0x0', r: '0x0', s: '0x0', chainId: '0x13b2' } : null;
      }
      default: console.error('sim: unsupported', method, JSON.stringify(params).slice(0, 200)); throw Object.assign(new Error(`sim: ${method} not supported`), { code: -32601 });
    }
  }

  function rpc(body) {
    const one = (b) => {
      if (process.env.SIM_DEBUG) console.error('rpc', b.method);
      try { return { jsonrpc: '2.0', id: b.id, result: handle(b) }; } catch (e) { if (process.env.SIM_DEBUG) console.error('sim error', b.method, e.message); return { jsonrpc: '2.0', id: b.id, error: { code: e.code ?? -32000, message: e.message, data: e.data } }; }
    };
    return Array.isArray(body) ? body.map(one) : one(body);
  }

  /** Wire the simulator into a Playwright page: the Arc RPC and window.ethereum. */
  async function install(page) {
    await page.route('https://rpc.mainnet.arc.io/**', async (r) => {
      const res = rpc(JSON.parse(r.request().postData()));
      await r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(res, (k, v) => (typeof v === 'bigint' ? hex(v) : v)) });
    });
    await page.exposeFunction('__simRpc', (body) => JSON.parse(JSON.stringify(rpc(body), (k, v) => (typeof v === 'bigint' ? hex(v) : v))));
    await page.addInitScript(() => {
      window.ethereum = {
        isMetaMask: true,
        on() {}, removeListener() {},
        async request({ method, params }) {
          const res = await window.__simRpc({ jsonrpc: '2.0', id: 1, method, params });
          if (res.error) throw Object.assign(new Error(res.error.message), { code: res.error.code });
          return res.result;
        },
      };
    });
  }

  return { install, state, deliver, rpc };
}

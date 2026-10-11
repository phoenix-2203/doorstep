// End-to-end rehearsal against a real Arc node: every step is a separate signed transaction.
//
//   arc-anvil --network arc --hardfork arc:zero8          (local), or a testnet RPC
//   RPC_URL=... DOORSTEP=0x... ESCROW=0x... PAYER_KEY=0x... KEEPER_KEY=0x... node e2e.mjs
//
// Checks: plain wallet send to the escrow reverts; native send lands; the same address is
// reused in a later transaction; an ERC-20 transfer lands; an expired intent bounces home.

import fs from 'node:fs';
import assert from 'node:assert/strict';
import {
  createPublicClient, createWalletClient, http, defineChain, encodeFunctionData,
  parseUnits, formatUnits, stringToHex, keccak256, encodeAbiParameters, getContractAddress, parseAbi,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const { Doorstep: DOOR_ABI, DemoEscrow: ESCROW_ABI } = JSON.parse(fs.readFileSync(new URL('./abi.json', import.meta.url)));
const USDC = '0x3600000000000000000000000000000000000000';
const ERC20 = parseAbi(['function transfer(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)']);

const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:8545';
const DOORSTEP = process.env.DOORSTEP;
const ESCROW = process.env.ESCROW;
const pub0 = createPublicClient({ transport: http(RPC_URL) });
const chain = defineChain({ id: await pub0.getChainId(), name: 'Arc', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: [RPC_URL] } } });
const pub = createPublicClient({ chain, transport: http(RPC_URL) });
const payer = createWalletClient({ chain, transport: http(RPC_URL), account: privateKeyToAccount(process.env.PAYER_KEY) });
const keeper = createWalletClient({ chain, transport: http(RPC_URL), account: privateKeyToAccount(process.env.KEEPER_KEY) });
const beneficiary = process.env.BENEFICIARY ?? '0x000000000000000000000000000000000000beef';
const refundTo = process.env.REFUND_TO ?? '0x000000000000000000000000000000000000cafe';
const isLocal = chain.id === 31337;

const C = [{name:'target',type:'address'},{name:'callData',type:'bytes'},{name:'amountOffset',type:'uint32'},{name:'refundTo',type:'address'},{name:'minAmount6',type:'uint256'},{name:'maxKeeperFee6',type:'uint256'},{name:'expiry',type:'uint64'},{name:'ref',type:'bytes32'}];
const landerHash = await pub.readContract({ address: DOORSTEP, abi: DOOR_ABI, functionName: 'LANDER_CODE_HASH' });
const addrOf = (i) => getContractAddress({ opcode: 'CREATE2', from: DOORSTEP, salt: keccak256(encodeAbiParameters([{ type: 'tuple', components: C }], [i])), bytecodeHash: landerHash });
const fmt = (v) => formatUnits(v, 18);
const step = (s) => console.log(`\n== ${s}`);

async function send(wallet, req) {
  const hash = await wallet.sendTransaction(req);
  const r = await pub.waitForTransactionReceipt({ hash });
  return r;
}
async function land(i) {
  await pub.simulateContract({ address: DOORSTEP, abi: DOOR_ABI, functionName: 'land', args: [i], account: keeper.account });
  const fees = await pub.estimateFeesPerGas();
  const est = await pub.estimateContractGas({ address: DOORSTEP, abi: DOOR_ABI, functionName: 'land', args: [i], account: keeper.account, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: 0n });
  const hash = await keeper.writeContract({ address: DOORSTEP, abi: DOOR_ABI, functionName: 'land', args: [i], gas: (est * 13n) / 10n + 30_000n, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: 0n });
  const r = await pub.waitForTransactionReceipt({ hash });
  assert.equal(r.status, 'success', 'land tx succeeded');
  const ev = r.logs.map((l) => { try { return { ...l, ...decode(l) }; } catch { return null; } }).filter(Boolean);
  return { r, ev };
}
import { decodeEventLog } from 'viem';
const decode = (l) => decodeEventLog({ abi: DOOR_ABI, data: l.data, topics: l.topics });

const block = await pub.getBlock();
const intent = (expirySecs, ref) => ({
  target: ESCROW,
  callData: encodeFunctionData({ abi: ESCROW_ABI, functionName: 'deposit', args: [0n, beneficiary] }),
  amountOffset: 4, refundTo, minAmount6: parseUnits('0.05', 6), maxKeeperFee6: parseUnits('0.01', 6),
  expiry: block.timestamp + BigInt(expirySecs), ref: stringToHex(ref, { size: 32 }),
});
const credited = () => pub.readContract({ address: ESCROW, abi: ESCROW_ABI, functionName: 'balanceOf6', args: [beneficiary] });

console.log(`chain ${chain.id}, Doorstep ${DOORSTEP}, escrow ${ESCROW}`);

step('1. A plain wallet send straight to the escrow reverts (issue #48)');
try {
  await pub.estimateGas({ account: payer.account, to: ESCROW, value: parseUnits('0.1', 18) });
  assert.fail('expected a revert');
} catch (e) {
  console.log('   reverted as expected:', (e.shortMessage ?? e.message).split('\n')[0]);
}

const i1 = intent(86400, 'e2e-1');
const dep = addrOf(i1);
const onchain = await pub.readContract({ address: DOORSTEP, abi: DOOR_ABI, functionName: 'addressOf', args: [i1] });
assert.equal(dep, onchain, 'viem and contract agree on the address');
console.log('   deposit address', dep);

step('2. Native send (wallet "Send") to the deposit address, then land');
let r = await send(payer, { to: dep, value: parseUnits('0.25', 18) });
console.log('   send tx', r.transactionHash, r.status);
let before = await credited();
let out = await land(i1);
let landed = out.ev.find((e) => e.eventName === 'Landed');
assert.ok(landed, 'Landed emitted');
console.log(`   landed ${formatUnits(landed.args.amountPulled6, 6)} USDC, keeper fee ${fmt(landed.args.keeperFee)}, refunded ${fmt(landed.args.refunded)}, gas used ${out.r.gasUsed}`);
assert.equal(await credited() - before, landed.args.amountPulled6);
assert.equal(await pub.getBytecode({ address: dep }) ?? '0x', '0x', 'address codeless again');

step('3. Same address, later transaction: send again and land (reuse)');
r = await send(payer, { to: dep, value: parseUnits('0.4', 18) });
assert.equal(r.status, 'success', 'second native send accepted in a later transaction');
before = await credited();
out = await land(i1);
landed = out.ev.find((e) => e.eventName === 'Landed');
assert.ok(landed);
console.log(`   landed again: ${formatUnits(landed.args.amountPulled6, 6)} USDC`);

step('4. ERC-20 transfer to the same address, then land');
r = await send(payer, { to: USDC, data: encodeFunctionData({ abi: ERC20, functionName: 'transfer', args: [dep, parseUnits('0.3', 6)] }) });
assert.equal(r.status, 'success');
out = await land(i1);
landed = out.ev.find((e) => e.eventName === 'Landed');
assert.ok(landed);
console.log(`   landed ${formatUnits(landed.args.amountPulled6, 6)} USDC from an ERC-20 transfer`);

step('5. Expired intent bounces to refundTo');
const i2 = intent(isLocal ? 30 : 60, 'e2e-expired');
const dep2 = addrOf(i2);
const refundBefore = await pub.getBalance({ address: refundTo });
await send(payer, { to: dep2, value: parseUnits('0.2', 18) });
if (isLocal) {
  await pub.request({ method: 'evm_increaseTime', params: [120] });
  await pub.request({ method: 'evm_mine', params: [] });
} else {
  console.log('   waiting 75s for expiry…');
  await new Promise((res) => setTimeout(res, 75_000));
}
out = await land(i2);
const bounced = out.ev.find((e) => e.eventName === 'Bounced');
assert.ok(bounced, 'Bounced emitted');
assert.equal(bounced.args.reason, 0, 'reason: expired');
assert.equal(await pub.getBalance({ address: refundTo }) - refundBefore, bounced.args.refunded);
console.log(`   refunded ${fmt(bounced.args.refunded)} USDC, keeper fee ${fmt(bounced.args.keeperFee)}`);

step('6. Factory holds nothing');
assert.equal(await pub.getBalance({ address: DOORSTEP }), 0n);
console.log('   Doorstep balance: 0');
console.log(`\nAll checks passed. Beneficiary credited ${formatUnits(await credited(), 6)} USDC in the escrow.`);

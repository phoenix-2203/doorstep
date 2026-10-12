// Integration tests against a real Arc node (arc-anvil), with real separate transactions.
//
//   arc-anvil --network arc --hardfork arc:zero8
//   (deploy with script/Deploy.s.sol)
//   RPC_URL=http://127.0.0.1:8545 DOORSTEP=0x... ESCROW=0x... npm run test:local
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWalletClient, http, parseUnits, parseAbi, defineChain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createDoorstep, DoorstepError } from '../src/index.js';

const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:8545';
const ESCROW = process.env.ESCROW;
// Anvil's public development keys. Never use them on a real network.
const keys = {
  payer: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  keeper: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  owner: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
};
const chain = defineChain({ id: 31337, name: 'Local Arc', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: [RPC_URL] } } });
const wallet = (k) => createWalletClient({ chain, transport: http(RPC_URL), account: privateKeyToAccount(k) });
const payer = wallet(keys.payer);
const keeper = wallet(keys.keeper);
const owner = wallet(keys.owner); // beneficiary and refund address
const ESCROW_ABI = parseAbi(['function balanceOf6(address) view returns (uint256)']);

const ds = createDoorstep({ rpcUrl: RPC_URL, chainId: 31337, doorstep: process.env.DOORSTEP, chain, walletClient: keeper });
const pub = ds.publicClient;
const pay = async (to, usdc) => {
  const hash = await payer.sendTransaction({ to, value: parseUnits(usdc, 18) });
  const r = await pub.waitForTransactionReceipt({ hash });
  assert.equal(r.status, 'success');
};
const credit = () => pub.readContract({ address: ESCROW, abi: ESCROW_ABI, functionName: 'balanceOf6', args: [owner.account.address] });
const head = await pub.getBlockNumber();
const block = await pub.getBlock();
const mk = (reference, minimum = '0.05') => ds.depositIntent({
  into: ESCROW, beneficiary: owner.account.address, refundTo: owner.account.address,
  minimum, keeperFeeCap: '0.01', expires: '1d', reference, now: Number(block.timestamp),
});

test('address from the SDK equals the contract', async () => {
  const i = mk('sdk-addr');
  const onchain = await pub.readContract({ address: ds.doorstep, abi: (await import('../src/abi.js')).DOORSTEP_ABI, functionName: 'addressOf', args: [i] });
  assert.equal(ds.depositAddress(i), onchain);
});

test('pay, status, land, history', async () => {
  const i = mk('sdk-land');
  const s0 = await ds.status(i);
  assert.equal(s0.waitingRaw, 0n);
  assert.equal(s0.canLand, false);

  await pay(s0.address, '0.3');
  const s1 = await ds.status(i);
  assert.equal(s1.waiting, '0.3');
  assert.equal(s1.canLand, true);

  const before = await credit();
  const { event } = await ds.land(i);
  assert.equal(event.event, 'Landed');
  assert.equal((await credit()) - before, event.amountPulled6);
  assert.ok(event.amountPulled6 > 290_000n, 'most of it credited');

  const h = await ds.history(i, { fromBlock: head });
  assert.equal(h.length, 1);
  assert.equal(h[0].event, 'Landed');
});

test('below minimum: land explains, only refundTo can cancel, cancel refunds every wei', async () => {
  const i = mk('sdk-cancel', '1');
  const dep = ds.depositAddress(i);
  await pay(dep, '0.02');

  await assert.rejects(ds.land(i), (e) => e instanceof DoorstepError && /Only 0.02 of the 1 USDC minimum/.test(e.message));
  await assert.rejects(ds.cancel(i), /only refundTo/); // keeper is not refundTo

  const balBefore = await pub.getBalance({ address: owner.account.address });
  const { event, receipt } = await ds.cancel(i, { walletClient: owner });
  assert.equal(event.event, 'Bounced');
  assert.equal(event.reasonText, 'cancelled');
  assert.equal(event.refunded, parseUnits('0.02', 18));
  assert.equal(event.keeperFee, 0n);
  const gas = receipt.gasUsed * receipt.effectiveGasPrice;
  assert.equal(await pub.getBalance({ address: owner.account.address }), balBefore + parseUnits('0.02', 18) - gas);
  assert.equal((await ds.status(i)).waitingRaw, 0n);

  // The address keeps working after a cancel, in later transactions.
  await pay(dep, '1.5');
  const { event: e2 } = await ds.land(i);
  assert.equal(e2.event, 'Landed');
});

test('cancel with nothing waiting is explained', async () => {
  await assert.rejects(ds.cancel(mk('sdk-empty'), { walletClient: owner }), /Nothing is waiting/);
});

test('waitForOutcome and watch see a landing', async () => {
  const i = mk('sdk-watch');
  const seen = [];
  const stop = ds.watch(i, (ev) => seen.push(ev.type), { pollMs: 300 });
  const outcome = ds.waitForOutcome(i, { pollMs: 300, timeoutMs: 30_000 });
  await new Promise((r) => setTimeout(r, 700));
  await pay(ds.depositAddress(i), '0.2');
  await new Promise((r) => setTimeout(r, 700));
  await ds.land(i);
  const ev = await outcome;
  await new Promise((r) => setTimeout(r, 900));
  stop();
  assert.equal(ev.type, 'landed');
  assert.ok(seen.includes('waiting'));
  assert.ok(seen.includes('landed'));
});

test('a link made by the SDK opens the same intent', () => {
  const i = mk('sdk-link');
  const back = ds.parseLink(ds.toLink(i));
  assert.deepEqual(back.intent, i);
  assert.equal(back.doorstep, ds.doorstep);
  assert.equal(back.chainId, 31337);
});

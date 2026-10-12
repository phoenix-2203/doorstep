// Offline tests: no network, no node. Run with `npm test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAbi, encodeFunctionData, stringToHex } from 'viem';
import {
  makeIntent, depositIntent, depositAddress, intentHash, describe, explain, toLink, parseLink,
  toExpiry, toUnits6, toRef, fromRef, validateIntent, AMOUNT, NO_AMOUNT, USDC, LANDER_CODE_HASH,
} from '../src/index.js';

const A = '0x3333333333333333333333333333333333333333';
const R = '0x4444444444444444444444444444444444444444';
const T = '0x2222222222222222222222222222222222222222';
const FACTORY = '0x1111111111111111111111111111111111111111';

test('matches the vector pinned in the Solidity test (test_addressMatchesViemVector)', () => {
  const i = depositIntent({ into: T, beneficiary: A, refundTo: R, minimum: '0.05', keeperFeeCap: '0.01', expires: 1760140800, reference: 'order-1' });
  assert.equal(i.amountOffset, 4);
  assert.equal(i.callData, '0x6e553f6500000000000000000000000000000000000000000000000000000000000000000000000000000000000000003333333333333333333333333333333333333333');
  assert.equal(intentHash(i), '0x1f36ff0db753b4e9ec34591ef38a4a3ca34b5c91db1d46d892f0d59b5e2c4185');
  assert.equal(depositAddress(i, FACTORY), '0x028053E7CDdCB91618502Fd6a6E4Cb47cDBB17D7');
});

test('lander code hash is keccak256(0x608060405233fffe)', async () => {
  const { keccak256 } = await import('viem');
  assert.equal(keccak256('0x608060405233fffe'), LANDER_CODE_HASH);
});

test('AMOUNT placeholder: offset found and zeroed, in any argument position', () => {
  const abi = parseAbi(['function pay(bytes32 invoice, address from, uint256 amount)']);
  const i = makeIntent({ target: T, abi, functionName: 'pay', args: [stringToHex('inv', { size: 32 }), A, AMOUNT], refundTo: R, expires: 1900000000 });
  assert.equal(i.amountOffset, 4 + 64);
  assert.equal(i.callData, encodeFunctionData({ abi, functionName: 'pay', args: [stringToHex('inv', { size: 32 }), A, 0n] }));
});

test('no AMOUNT means the amount is not written', () => {
  const abi = parseAbi(['function poke()']);
  const i = makeIntent({ target: T, abi, functionName: 'poke', refundTo: R, expires: 1900000000 });
  assert.equal(i.amountOffset, NO_AMOUNT);
});

test('AMOUNT twice is rejected', () => {
  const abi = parseAbi(['function f(uint256,uint256)']);
  assert.throws(() => makeIntent({ target: T, abi, functionName: 'f', args: [AMOUNT, AMOUNT], refundTo: R }), /only once/);
});

test('amounts: strings are USDC, bigints are 6-decimal units, bad input rejected', () => {
  assert.equal(toUnits6('12.5'), 12_500_000n);
  assert.equal(toUnits6(0.05), 50_000n);
  assert.equal(toUnits6(7n), 7n);
  assert.throws(() => toUnits6('1.0000001'), /6 decimals/);
  assert.throws(() => toUnits6('-1'));
  assert.throws(() => toUnits6('abc'));
});

test('expiry: durations, dates and timestamps', () => {
  assert.equal(toExpiry('30d', 1000), 1000n + 30n * 86400n);
  assert.equal(toExpiry('45s', 1000), 1045n);
  assert.equal(toExpiry('2w', 0), 1209600n);
  assert.equal(toExpiry(new Date('2027-01-01T00:00:00Z')), 1798761600n);
  assert.equal(toExpiry(1798761600), 1798761600n);
  assert.throws(() => toExpiry('soon'));
  assert.throws(() => toExpiry(1798761600000 / 1000.5));
});

test('reference text round-trips and is length-checked', () => {
  assert.equal(fromRef(toRef('invoice-42')), 'invoice-42');
  assert.equal(fromRef(toRef('')), '');
  assert.throws(() => toRef('x'.repeat(32)), /31 bytes/);
});

test('validation mirrors the contract', () => {
  assert.throws(() => depositIntent({ into: USDC, beneficiary: A, refundTo: R }), /USDC/);
  assert.throws(() => depositIntent({ into: T, beneficiary: A, refundTo: '0x0000000000000000000000000000000000000000' }), /zero/);
  assert.throws(() => depositIntent({ into: 'nope', beneficiary: A, refundTo: R }), /target/);
  const i = depositIntent({ into: T, beneficiary: A, refundTo: R, expires: 1900000000 });
  assert.throws(() => validateIntent({ ...i, amountOffset: 60 }), /past the end/);
  assert.throws(() => validateIntent(i, T), /Doorstep itself/);
});

test('explain and describe speak plainly', () => {
  const i = depositIntent({ into: T, beneficiary: A, refundTo: R, minimum: '500', keeperFeeCap: '0.01', expires: new Date('2026-11-30T12:00:00Z'), reference: 'rent-nov' });
  const e = explain(i, { now: 1790000000 });
  assert.equal(e.call.name, 'deposit');
  assert.equal(e.call.text, `deposit(the amount, ${A})`);
  assert.equal(e.beneficiary, A);
  assert.equal(e.minimum, '500');
  assert.equal(e.reference, 'rent-nov');
  assert.equal(e.expired, false);
  const d = describe(i, { names: { [T]: 'the rent vault', [A]: 'Chidi', [R]: 'Chidi' } });
  assert.match(d, /deposited into the rent vault for Chidi/);
  assert.match(d, /at least 500 USDC/);
  assert.match(d, /2026-11-30 12:00 UTC, it goes back to Chidi/);
  assert.match(d, /Chidi can also take it back at any time/);
  assert.match(d, /at most 0.01 USDC/);
  assert.match(d, /Reference: rent-nov/);
  assert.doesNotMatch(describe(i, { cancellable: false }), /take it back/);
});

test('describe handles unknown functions', () => {
  const abi = parseAbi(['function settle(uint256 amount, uint8 mode)']);
  const i = makeIntent({ target: T, abi, functionName: 'settle', args: [AMOUNT, 1], refundTo: R, expires: 1900000000 });
  assert.match(describe(i), /calling function 0x/);
  assert.match(describe(i, { abi }), /calling settle\(the amount, 1\)/);
});

test('links round-trip, with and without overrides', () => {
  const i = depositIntent({ into: T, beneficiary: A, refundTo: R, minimum: '1', expires: 1900000000, reference: 'x' });
  const link = toLink(i, { fromBlock: 123n });
  assert.ok(link.startsWith('https://phoenix-2203.github.io/doorstep/#i='));
  const back = parseLink(link);
  assert.deepEqual(back.intent, i);
  assert.equal(back.fromBlock, 123n);
  const link2 = toLink(i, { baseUrl: 'http://localhost:8080/', doorstep: FACTORY, chainId: 31337 });
  const back2 = parseLink(link2);
  assert.equal(back2.doorstep, FACTORY);
  assert.equal(back2.chainId, 31337);
  assert.deepEqual(parseLink(link2.split('#i=')[1]).intent, i);
  assert.throws(() => parseLink('https://example.com'), /not a Doorstep link/);
});

test('scanLogs shrinks the range when the RPC refuses it, and covers every block once', async () => {
  const { scanLogs } = await import('../src/index.js');
  const seen = [];
  const fetchRange = async (from, to) => {
    if (to - from + 1n > 1200n) throw new Error('Request exceeds defined limit.');
    for (let b = from; b <= to; b++) seen.push(b);
    return [Number(from)];
  };
  const out = await scanLogs(fetchRange, 100n, 30_099n);
  assert.equal(seen.length, 30_000);
  assert.equal(new Set(seen.map(String)).size, 30_000, 'no block scanned twice');
  assert.ok(out.length > 0);
  await assert.rejects(scanLogs(async () => { throw new Error('boom'); }, 0n, 10n), /boom/);
});

test('fixed-amount links carry the amount without changing the address', async () => {
  const { paymentState } = await import('../src/index.js');
  const i = depositIntent({ into: T, beneficiary: A, refundTo: R, minimum: '25', expires: 1900000000, reference: 'inv-9' });
  const plain = parseLink(toLink(i));
  const fixed = parseLink(toLink(i, { amount: '25' }));
  assert.equal(plain.amount6, undefined);
  assert.equal(fixed.amount6, 25_000_000n);
  assert.deepEqual(fixed.intent, i);
  assert.equal(depositAddress(fixed.intent, FACTORY), depositAddress(i, FACTORY));
});

test('paymentState: unpaid, underpaid, paid, overpaid', async () => {
  const { paymentState } = await import('../src/index.js');
  const e = 25_000_000n;
  assert.equal(paymentState(e, { received: 0n }).state, 'unpaid');
  const u = paymentState(e, { received: 15n * 10n ** 18n });
  assert.deepEqual([u.state, u.received, u.remaining], ['underpaid', '15', '10']);
  assert.equal(paymentState(e, { received6: 25_000_000n }).state, 'paid');
  const o = paymentState(e, { received: 26n * 10n ** 18n + 5n });
  assert.deepEqual([o.state, o.extra], ['overpaid', '1']);
});

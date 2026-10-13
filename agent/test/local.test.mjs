// End-to-end test of the MCP server against a local Arc node (arc-anvil), through a real MCP client.
//
//   arc-anvil --network arc --hardfork arc:zero8 --port 8547
//   (deploy with script/Deploy.s.sol)
//   RPC_URL=http://127.0.0.1:8547 DOORSTEP=0x... ESCROW=0x... npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createWalletClient, createPublicClient, http, parseUnits, defineChain, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:8547';
const DOORSTEP = process.env.DOORSTEP ?? '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const ESCROW = process.env.ESCROW ?? '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';
// Anvil's public development keys. Never use them on a real network.
const PAYER = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const KEEPER = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';
const OWNER = privateKeyToAccount('0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6').address;

const chain = defineChain({ id: 31337, name: 'Local Arc', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: [RPC_URL] } } });
const pub = createPublicClient({ chain, transport: http(RPC_URL) });
const payer = createWalletClient({ chain, transport: http(RPC_URL), account: privateKeyToAccount(PAYER) });

async function connect(extraEnv = {}) {
  const client = new Client({ name: 'doorstep-test', version: '0' });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [new URL('../server.mjs', import.meta.url).pathname],
    env: { ...process.env, DOORSTEP_CHAIN_ID: '31337', DOORSTEP_RPC_URL: RPC_URL, DOORSTEP: DOORSTEP, DOORSTEP_FROM_BLOCK: '0', ...extraEnv },
    stderr: 'ignore',
  }));
  return client;
}
const call = async (client, name, args) => {
  const r = await client.callTool({ name, arguments: args });
  return { error: !!r.isError, text: r.content[0].text, json: r.isError ? null : JSON.parse(r.content[0].text) };
};

test('lists exactly the three tools, and none of them can send money elsewhere', async (t) => {
  const c = await connect();
  t.after(() => c.close());
  const { tools } = await c.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ['check_payment', 'create_payment_address', 'deliver_payment']);
});

test('create, pay, check, deliver, check: an invoice from start to finish', async (t) => {
  const c = await connect({ DOORSTEP_DEV_PRIVATE_KEY: KEEPER });
  t.after(() => c.close());
  const created = await call(c, 'create_payment_address', { into: ESCROW, beneficiary: OWNER, refundTo: OWNER, amount: '2', expires: '1d', reference: 'agent-inv-1' });
  assert.equal(created.error, false, created.text);
  assert.match(created.json.address, /^0x[0-9a-fA-F]{40}$/);
  assert.match(created.json.payLink, /#i=/);
  assert.match(created.json.description, /deposited into/);

  // Part payment: waits, and deliver refuses.
  await pub.waitForTransactionReceipt({ hash: await payer.sendTransaction({ to: created.json.address, value: parseUnits('0.5', 18) }) });
  let st = await call(c, 'check_payment', { payLink: created.json.payLink });
  assert.equal(st.json.state, 'waiting_below_minimum');
  assert.equal(st.json.invoice.state, 'underpaid');
  const early = await call(c, 'deliver_payment', { payLink: created.json.payLink });
  assert.equal(early.error, true);
  assert.match(early.text, /under the 2 USDC minimum/);

  // The rest arrives; the agent delivers it.
  await pub.waitForTransactionReceipt({ hash: await payer.sendTransaction({ to: created.json.address, value: parseUnits('1.5', 18) }) });
  const delivered = await call(c, 'deliver_payment', { payLink: created.json.payLink });
  assert.equal(delivered.error, false, delivered.text);
  assert.equal(delivered.json.result.type, 'delivered');

  st = await call(c, 'check_payment', { payLink: created.json.payLink, expectInto: ESCROW, expectBeneficiary: OWNER, expectRefundTo: OWNER });
  assert.equal(st.json.state, 'delivered');
  assert.equal(st.json.matchesExpectations, true);
  assert.equal(st.json.invoice.state, 'paid');
  const credit = await pub.readContract({ address: ESCROW, abi: parseAbi(['function balanceOf6(address) view returns (uint256)']), functionName: 'balanceOf6', args: [OWNER] });
  assert.ok(credit >= 1_990_000n, 'owner credited in the escrow');
});

test('verifying a link someone else made catches a swapped beneficiary', async (t) => {
  const c = await connect();
  t.after(() => c.close());
  const mallory = '0x000000000000000000000000000000000000dEaD';
  const created = await call(c, 'create_payment_address', { into: ESCROW, beneficiary: mallory, refundTo: mallory });
  const st = await call(c, 'check_payment', { payLink: created.json.payLink, expectBeneficiary: OWNER });
  assert.equal(st.json.matchesExpectations, false);
  assert.match(st.json.mismatches[0], /credits/);
});

test('refuses links for another Doorstep contract or chain', async (t) => {
  const c = await connect();
  t.after(() => c.close());
  const created = await call(c, 'create_payment_address', { into: ESCROW, beneficiary: OWNER, refundTo: OWNER });
  const forged = created.json.payLink.replace(/\?[^#]*/, '?doorstep=0x1111111111111111111111111111111111111111');
  const r = await call(c, 'check_payment', { payLink: forged });
  assert.equal(r.error, true);
  assert.match(r.text, /Refusing/);
  const other = created.json.payLink.replace(/\?[^#]*/, '?chain=5042');
  assert.match((await call(c, 'check_payment', { payLink: other })).text, /chain 5042/);
});

test('enforces the operator limits', async (t) => {
  const c = await connect({ DOORSTEP_ALLOWED_TARGETS: ESCROW, DOORSTEP_MAX_FEE: '0.02', DOORSTEP_MAX_DAYS: '7' });
  t.after(() => c.close());
  const other = await call(c, 'create_payment_address', { into: '0x000000000000000000000000000000000000bEEF', beneficiary: OWNER, refundTo: OWNER });
  assert.match(other.text, /only creates addresses for/);
  assert.match((await call(c, 'create_payment_address', { into: ESCROW, beneficiary: OWNER, refundTo: OWNER, deliveryFeeLimit: '1' })).text, /above this server's limit/);
  assert.match((await call(c, 'create_payment_address', { into: ESCROW, beneficiary: OWNER, refundTo: OWNER, expires: '30d' })).text, /longer than this server allows/);
});

test('without a delivery wallet, deliver_payment says how to deliver instead', async (t) => {
  const c = await connect();
  t.after(() => c.close());
  const created = await call(c, 'create_payment_address', { into: ESCROW, beneficiary: OWNER, refundTo: OWNER });
  const r = await call(c, 'deliver_payment', { payLink: created.json.payLink });
  assert.equal(r.error, true);
  assert.match(r.text, /No delivery wallet/);
});

#!/usr/bin/env node
// Doorstep MCP server: lets an AI agent create Doorstep payment addresses on Arc, check them
// (including whether a pay link really does what someone claims), and deliver payments.
//
// What the agent can NOT do, by construction:
//   - redirect money. Every address is computed from its instructions; delivery recomputes the
//     address from the pay link and the Doorstep contract only ever pays the contract in those
//     instructions or the refund wallet. There is no "send" or "transfer" tool.
//   - use another Doorstep contract or chain than the one this server is configured for.
//   - exceed the operator's limits: allowed target contracts, maximum delivery fee, maximum
//     lifetime of an address.
// The delivery wallet (optional) only ever pays network fees, and is repaid from each payment.
//
// Configuration (environment variables), all optional:
//   DOORSTEP_RPC_URL         Arc RPC (default: Arc's public mainnet RPC)
//   DOORSTEP_CHAIN_ID        5042 (mainnet) by default
//   DOORSTEP                 Doorstep contract (default: the v2 deployment for the chain)
//   DOORSTEP_FROM_BLOCK      first block to search for events (default: the deployment block)
//   DOORSTEP_PAY_BASE        base URL of pay links (default: the public app)
//   DOORSTEP_ALLOWED_TARGETS comma-separated contracts addresses may pay into; empty = any
//   DOORSTEP_MAX_FEE         highest delivery fee limit an address may have, USDC (default 0.02)
//   DOORSTEP_MAX_DAYS        longest an address may accept payments, days (default 90)
//   DOORSTEP_KEYSTORE + DOORSTEP_PASSWORD_FILE   wallet for deliver_payment (Foundry keystore)
//   DOORSTEP_DEV_PRIVATE_KEY development only (local node); never a real key
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'node:fs';
import { createWalletClient, http, getAddress, isAddress, defineChain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  createDoorstep, DEPLOYMENTS, depositAddress, intentHash, explain, describe, parseLink, toLink, toUnits6,
  paymentState, formatUsdc6, formatUsdc18, explainRevert,
} from '../sdk/src/index.js';
import { decryptKeystore } from '../keeper/keystore.mjs';

const env = (k, d) => (process.env[k] ?? '').trim() || d;
const chainId = Number(env('DOORSTEP_CHAIN_ID', '5042'));
const dep = DEPLOYMENTS[chainId];
const DOOR = getAddress(env('DOORSTEP', dep?.doorstep ?? ''));
const FROM_BLOCK = BigInt(env('DOORSTEP_FROM_BLOCK', String(dep?.fromBlock ?? 0n)));
const RPC_URL = env('DOORSTEP_RPC_URL', chainId === 5042 ? 'https://rpc.mainnet.arc.io' : 'http://127.0.0.1:8545');
const PAY_BASE = env('DOORSTEP_PAY_BASE', 'https://arcdoorstep.duckdns.org/app/');
const ALLOWED = env('DOORSTEP_ALLOWED_TARGETS', '').split(',').map((s) => s.trim()).filter(Boolean).map((a) => getAddress(a));
const MAX_FEE6 = toUnits6(env('DOORSTEP_MAX_FEE', '0.02'), 'DOORSTEP_MAX_FEE');
const MAX_DAYS = Number(env('DOORSTEP_MAX_DAYS', '90'));

const chain = defineChain({ id: chainId, name: chainId === 5042 ? 'Arc' : `Arc (${chainId})`, nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: [RPC_URL] } } });

function deliveryAccount() {
  if (process.env.DOORSTEP_KEYSTORE) {
    const pw = fs.readFileSync(env('DOORSTEP_PASSWORD_FILE', ''), 'utf8').replace(/\r?\n$/, '');
    return privateKeyToAccount(decryptKeystore(fs.readFileSync(process.env.DOORSTEP_KEYSTORE, 'utf8'), pw));
  }
  if (process.env.DOORSTEP_DEV_PRIVATE_KEY) {
    if (chainId === 5042) throw new Error('DOORSTEP_DEV_PRIVATE_KEY is for local development only; use DOORSTEP_KEYSTORE on mainnet');
    return privateKeyToAccount(process.env.DOORSTEP_DEV_PRIVATE_KEY);
  }
  return null;
}
const account = deliveryAccount();
const walletClient = account ? createWalletClient({ chain, transport: http(RPC_URL), account }) : undefined;
const ds = createDoorstep({ chainId, rpcUrl: RPC_URL, doorstep: DOOR, fromBlock: FROM_BLOCK, chain, walletClient, pauseMs: chainId === 5042 ? 1100 : 0 });
const explorer = chainId === 5042 || chainId === 5042002 ? ds.explorer : null; // no explorer for local nodes
const txUrl = (h) => (explorer ? `${explorer}/tx/${h}` : h);

// ---------------------------------------------------------------- helpers

const reply = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj, (k, v) => (typeof v === 'bigint' ? v.toString() : v), 2) }] });
const fail = (message) => ({ isError: true, content: [{ type: 'text', text: message }] });
const addr = z.string().describe('0x address');
const usdc = z.string().regex(/^\d+(\.\d{1,6})?$/, 'a USDC amount like "25" or "0.05"');

function durationSeconds(s) {
  const m = String(s).trim().match(/^(\d+)\s*([mhdw])$/);
  if (!m) throw new Error('expires must look like "45m", "12h", "30d" or "2w"');
  return Number(m[1]) * { m: 60, h: 3600, d: 86400, w: 604800 }[m[2]];
}

/** Decode a pay link and refuse anything that isn't for this server's Doorstep and chain. */
function loadLink(link) {
  const p = parseLink(link);
  if (p.doorstep && p.doorstep !== DOOR) throw new Error(`This link names Doorstep contract ${p.doorstep}, not ${DOOR}. Refusing: it may not be a genuine Doorstep address.`);
  if (p.chainId && p.chainId !== chainId) throw new Error(`This link is for chain ${p.chainId}; this server works on chain ${chainId}.`);
  return { ...p, address: depositAddress(p.intent, DOOR) };
}

function summary(intent) {
  const e = explain(intent);
  return {
    contract: e.target,
    call: e.call.text,
    beneficiary: e.beneficiary,
    refundTo: e.refundTo,
    minimum: `${e.minimum} USDC`,
    deliveryFeeLimit: `${e.keeperFeeCap} USDC`,
    acceptsUntil: e.expiresAt.toISOString(),
    expired: e.expired,
    reference: e.reference || null,
  };
}

function eventView(e) {
  return e.event === 'Landed'
    ? { type: 'delivered', amount: `${formatUsdc6(e.amountPulled6)} USDC`, networkFee: `${formatUsdc18(e.keeperFee)} USDC`, unusedFeeReturned: `${formatUsdc18(e.refunded)} USDC`, tx: txUrl(e.transactionHash), block: e.blockNumber }
    : { type: e.reasonText === 'cancelled' ? 'cancelled' : 'returned', reason: e.reasonText, amount: `${formatUsdc18(e.refunded)} USDC`, to: e.refundTo, tx: txUrl(e.transactionHash), block: e.blockNumber };
}

// ---------------------------------------------------------------- server

const server = new McpServer({ name: 'doorstep', version: '0.1.0' }, {
  instructions: 'Doorstep creates USDC payment addresses on Arc that deposit into a contract for a named beneficiary, or refund. '
    + 'Use create_payment_address to get an address and pay link, check_payment to see status or to verify a link before paying it, '
    + 'and deliver_payment to push a waiting payment into its contract. Always show the user the plain-language description before they pay.',
});

server.registerTool('create_payment_address', {
  title: 'Create a Doorstep payment address',
  description: 'Make an address on Arc that deposits any USDC sent to it into `into` (a contract with deposit(uint256 amount, address to) that pulls with transferFrom, e.g. an ERC-4626 vault), credited to `beneficiary`. '
    + 'If it cannot be delivered, or after `expires`, the money goes back to `refundTo`, which can also cancel at any time. Offline: no transaction, nothing deployed. '
    + 'Returns the address, a pay link with QR code and live status, and a description to show the payer.',
  inputSchema: {
    into: addr.describe('Contract to pay into'),
    beneficiary: addr.describe('Who the contract credits'),
    refundTo: addr.describe('Wallet that gets the money back if it cannot be delivered. Never an exchange deposit address.'),
    amount: usdc.optional().describe('Exact amount to ask for (an invoice). Nothing is delivered until all of it has arrived.'),
    minimum: usdc.optional().describe('Instead of amount: deliver once at least this much has arrived. Default 0.'),
    expires: z.string().optional().describe('How long it accepts payments: "45m", "12h", "30d", "2w". Default 30d.'),
    deliveryFeeLimit: usdc.optional().describe('Most the delivery may cost the payment, in USDC. Default 0.01.'),
    reference: z.string().max(31).optional().describe('Order or invoice id, up to 31 characters'),
  },
}, async (a) => {
  try {
    for (const k of ['into', 'beneficiary', 'refundTo']) if (!isAddress(a[k])) return fail(`${k} must be a 0x address (mixed-case addresses need a valid checksum)`);
    const into = getAddress(a.into);
    if (ALLOWED.length && !ALLOWED.includes(into)) return fail(`This server only creates addresses for these contracts: ${ALLOWED.join(', ')}.`);
    const fee = a.deliveryFeeLimit ?? '0.01';
    if (toUnits6(fee) > MAX_FEE6) return fail(`deliveryFeeLimit is above this server's limit of ${formatUsdc6(MAX_FEE6)} USDC.`);
    const seconds = durationSeconds(a.expires ?? '30d');
    if (seconds > MAX_DAYS * 86400) return fail(`expires is longer than this server allows (${MAX_DAYS} days).`);
    if (a.amount && a.minimum) return fail('Give amount or minimum, not both.');
    const head = await ds.publicClient.getBlock();
    const intent = ds.depositIntent({
      into, beneficiary: a.beneficiary, refundTo: a.refundTo,
      minimum: a.amount ?? a.minimum ?? '0', keeperFeeCap: fee,
      expires: Number(head.timestamp) + seconds, reference: a.reference ?? '',
    });
    const address = ds.depositAddress(intent);
    // Cross-check the offline maths with the contract before handing the address out.
    const onchain = await ds.publicClient.readContract({ address: DOOR, abi: (await import('../sdk/src/abi.js')).DOORSTEP_ABI, functionName: 'addressOf', args: [intent] });
    if (getAddress(onchain) !== address) return fail('The address computed here does not match the Doorstep contract. Not safe to use.');
    const payLink = toLink(intent, { baseUrl: PAY_BASE, fromBlock: head.number, ...(a.amount ? { amount: a.amount } : {}), ...(chainId !== 5042 ? { chainId, doorstep: DOOR } : {}) });
    return reply({
      address,
      payLink,
      description: describe(intent),
      instructions: summary(intent),
      instructionHash: intentHash(intent),
      network: `Arc, chain ${chainId}. USDC only.`,
      note: 'Delivery bots deliver automatically once the address is registered (open the pay link and press "Register for automatic delivery"), or call deliver_payment after money arrives.',
    });
  } catch (e) {
    return fail(e.shortMessage ?? e.message);
  }
});

server.registerTool('check_payment', {
  title: 'Check a Doorstep payment',
  description: 'Read a Doorstep pay link and report what it does and what has happened: money waiting, delivered, returned or cancelled, and invoice progress. '
    + 'Before paying a link someone else gave you, pass the expected contract / beneficiary / refund wallet: the result says whether the link really matches.',
  inputSchema: {
    payLink: z.string().describe('A Doorstep pay link (…#i=…)'),
    expectInto: addr.optional(),
    expectBeneficiary: addr.optional(),
    expectRefundTo: addr.optional(),
  },
}, async (a) => {
  try {
    const { intent, address, amount6, fromBlock } = loadLink(a.payLink);
    const info = summary(intent);
    const mismatches = [];
    if (a.expectInto && getAddress(a.expectInto) !== info.contract) mismatches.push(`pays into ${info.contract}, not ${getAddress(a.expectInto)}`);
    if (a.expectBeneficiary && (!info.beneficiary || getAddress(a.expectBeneficiary) !== getAddress(info.beneficiary))) mismatches.push(`credits ${info.beneficiary ?? 'an unknown account'}, not ${getAddress(a.expectBeneficiary)}`);
    if (a.expectRefundTo && getAddress(a.expectRefundTo) !== info.refundTo) mismatches.push(`refunds to ${info.refundTo}, not ${getAddress(a.expectRefundTo)}`);
    const st = await ds.status(intent);
    const events = await ds.history(intent, { fromBlock: fromBlock > FROM_BLOCK ? fromBlock : FROM_BLOCK });
    // What payers sent: everything delivered (including its network fee and the unused fee returned) plus what's waiting.
    const paidIn18 = events.filter((e) => e.event === 'Landed').reduce((s, e) => s + e.amountPulled6 * 10n ** 12n + e.keeperFee + e.refunded, 0n) + st.waitingRaw;
    const state = st.waitingRaw > 0n
      ? (st.expired ? 'expired_waiting_to_return' : st.belowMinimum ? 'waiting_below_minimum' : 'waiting_to_be_delivered')
      : events.length ? eventView(events[events.length - 1]).type : 'no_payment_yet';
    return reply({
      address,
      matchesExpectations: mismatches.length === 0,
      mismatches,
      state,
      waitingAtAddress: `${st.waiting} USDC`,
      canDeliverNow: st.canLand,
      invoice: amount6 !== undefined ? paymentState(amount6, { received: paidIn18 }) : null,
      description: describe(intent),
      instructions: info,
      events: events.map(eventView),
    });
  } catch (e) {
    return fail(e.shortMessage ?? e.message);
  }
});

server.registerTool('deliver_payment', {
  title: 'Deliver a waiting Doorstep payment',
  description: 'Push the USDC waiting at a Doorstep address into its contract (or back to its refund wallet if the address has expired). '
    + 'It can only do what the pay link\'s instructions say; the network fee is repaid from the payment, up to its fee limit. Needs a delivery wallet configured on the server.',
  inputSchema: { payLink: z.string().describe('The Doorstep pay link of the address to deliver') },
}, async (a) => {
  try {
    if (!walletClient) return fail('No delivery wallet is configured on this server (DOORSTEP_KEYSTORE). Anyone can deliver from the pay link page instead.');
    const { intent, address } = loadLink(a.payLink);
    const st = await ds.status(intent);
    if (st.waitingRaw === 0n) return fail('Nothing is waiting at this address.');
    if (!st.canLand && !st.wouldBounce) return fail(`Only ${st.waiting} USDC is waiting, under the ${summary(intent).minimum} minimum. It waits for more, or the refund wallet can cancel.`);
    const { hash, event } = await ds.land(intent, { walletClient });
    return reply({ address, result: event ? eventView({ ...event, transactionHash: hash }) : { type: 'unknown' }, tx: txUrl(hash) });
  } catch (e) {
    const x = explainRevert(e);
    return fail(x.message ?? String(e));
  }
});

await server.connect(new StdioServerTransport());
console.error(`doorstep-mcp: chain ${chainId}, Doorstep ${DOOR}, delivery wallet ${account ? account.address : 'none (read-only)'}`);

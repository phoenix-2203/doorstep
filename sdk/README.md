# doorstep-arc

JavaScript/TypeScript SDK for [Doorstep](https://github.com/phoenix-2203/doorstep): deposit addresses on Arc that put USDC into a contract you choose the moment someone pays them.

```shell
npm install doorstep-arc viem
```

## What's an intent?

An **intent** is the instruction attached to a Doorstep address. In plain words:

> "Whatever USDC arrives here, deposit it into **this contract** for **this person**. Don't deliver until at least **this much** has arrived. If it can't be delivered by **this date**, give it back to **this wallet**. The refund wallet can also take it back any time. Whoever delivers it may keep at most **this much** for gas."

The address is calculated from the instruction. Change any word and the address changes, so an address can't be quietly redirected. Anyone can recompute it to check.

## Get paid into a vault or escrow

```js
import { createDoorstep } from 'doorstep-arc';

const ds = createDoorstep(); // Arc mainnet

const intent = ds.depositIntent({
  into: '0xVault…',          // any contract with deposit(uint256 amount, address beneficiary), e.g. ERC-4626
  beneficiary: '0xChidi…',   // who gets credited
  refundTo: '0xChidi…',      // gets the money back if it can't be delivered, and can cancel
  minimum: '500',            // USDC; wait until at least this much has arrived
  expires: '30d',            // or a Date, or unix seconds
  reference: 'rent-nov',     // shows up in every event
});

ds.depositAddress(intent); // '0x…' — show it or put it in a QR code; works offline
ds.describe(intent);       // a paragraph the payer can read
ds.toLink(intent);         // a link to the Doorstep app's pay page for this intent
```

The payer then just sends USDC on Arc to that address, from any wallet or exchange.

## Ask for an exact amount (invoices)

```js
const invoice = ds.depositIntent({ into: vault, beneficiary: freelancer, refundTo: client, minimum: '25', reference: 'inv-9' });
ds.toLink(invoice, { amount: '25' });   // pay page says "Pay 25 USDC for inv-9" and tracks what's missing

const { waitingRaw } = await ds.status(invoice);
ds.paymentState(25_000_000n, { received: waitingRaw });
// { state: 'underpaid', received: '15', remaining: '10', ... }  ->  'paid' / 'overpaid'
```

Setting `minimum` to the invoice amount means nothing is delivered until all of it has arrived. Anything paid above it is delivered too.

## Watch it land

```js
const stop = ds.watch(intent, (e) => {
  if (e.type === 'waiting') console.log(`${e.waiting} USDC waiting`);
  if (e.type === 'landed') console.log(`delivered ${e.amountPulled6} (6-dec units)`);
  if (e.type === 'bounced') console.log(`refunded: ${e.reasonText}`);
});

const outcome = await ds.waitForOutcome(intent); // or just wait for the next landing
await ds.status(intent);  // { waiting, canLand, belowMinimum, expired, … }
await ds.history(intent); // every past landing and refund
```

## Deliver, refund, cancel

```js
const ds = createDoorstep({ walletClient }); // a viem WalletClient on Arc

await ds.land(intent);   // anyone: deliver what's waiting (refunds instead if expired); gas is repaid from the deposit
await ds.cancel(intent); // refundTo only: take it all back now, no fee
```

Errors come back in plain words, for example `Only 0.02 of the 1 USDC minimum has arrived. It waits for more, or refundTo can cancel.`

## Any other contract call

Put `AMOUNT` where the amount that arrived should go:

```js
import { AMOUNT } from 'doorstep-arc';

const intent = ds.makeIntent({
  target: game,
  abi: gameAbi,
  functionName: 'topUp',
  args: [AMOUNT, playerId],
  refundTo: player,
  expires: '7d',
});
```

The contract must pull the funds with `transferFrom` from the caller (Doorstep approves exactly the amount, then revokes).

## Offline helpers

`makeIntent`, `depositIntent`, `depositAddress(intent, doorstep)`, `intentHash`, `explain`, `describe`, `toLink`, `parseLink` and `validateIntent` need no network.

## Tests

```shell
npm test                      # offline, includes the address vector shared with the Solidity tests
npm run test:local            # against arc-anvil: pay, land, cancel, watch, links (see test/local.test.mjs)
```

## Notes

- Doorstep is unaudited. Use small amounts.
- `refundTo` must be a wallet you control, never an exchange deposit address.
- Amount strings and numbers are USDC (`"12.5"`); bigints are 6-decimal units.

# What the film may show

## Implemented and demonstrated in the film

- Address computed from instructions; a changed instruction gives a different address (shown with the real homepage inspector)
- Savings demo: own address with QR code and instructions, send, delivery progress, receipt with Doorstep's cut = 0 (real app interface; balances in those shots come from a test network and are labelled)
- Delivery or refund rules (motion graphics of the contract's actual logic)
- Real mainnet transactions shown as hashes: automatic delivery, ERC-20 to a reused address, expiry refund, early cancel
- SDK usage code (the real API of `doorstep-arc`), the API docs page, the MCP tool list

## Implemented but not demonstrated

- Exact-amount invoices with part payments, signed webhook delivery and retries, API keys and rate limits
- Running your own delivery bot, the keeper's fee guard and parking of undeliverable payments
- Theme switch, pay-page notifications

## Planned (must not be shown as working)

- Security audit
- More independent delivery bots
- Integrations with Arc vaults, onramps and wallets
- Merchant dashboard, shareable receipts
- Payments from other chains through a bridge

## Unsupported or unverified (must not be claimed)

- Tokens other than USDC, chains other than Arc
- Any users, volume, partners or customers
- Audited or guaranteed security
- Built-in yield (Doorstep deposits into whichever contract the app chooses)

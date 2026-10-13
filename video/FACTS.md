# Facts used in the film

Checked on 13 October 2026 against the repository (commit on `main`), test runs in this session, and the mainnet transactions recorded in the README. "Verified" means checked in code, by running it, or by a transaction on the Arc explorer that the project recorded. "Not verified here" means it's true according to the operator but I couldn't check it from the production environment.

## Verified

| Claim used in the film | How it was verified |
| --- | --- |
| Doorstep v2 is deployed on Arc mainnet at `0x56BD0FEfdaAF9d053a74107E6dDb9de19D306229` (chain 5042) | Deploy tx `0x32ad069f…4a27` in README; the live API's `/v1/health` reported this address and chain 5042 (operator's VPS output, 13 Oct) |
| An address is computed from its instructions (CREATE2); changing any instruction changes it | `addressOf` in `src/Doorstep.sol`; `test_addressIsDeterministicAndCodeless`; the homepage inspector recomputes it with the SDK |
| Nothing is deployed until money arrives | The lander contract is created and destroyed only inside `land`/`cancel` (`src/Doorstep.sol`) |
| A delivery calls the target's own deposit function for the beneficiary | `_deliver` approves exactly the amount, calls `intent.target` with the encoded call, then revokes |
| If delivery fails or the deadline passed, the money goes to the refund wallet | `land` → `Bounced`; tests `test_revertingTargetRefunds`, `test_expiredIntentRefunds`; mainnet tx `0x97ee485e…` (expired → refunded) |
| Refund wallet can cancel at any time, no fee | `cancel` in contract; mainnet tx `0x2466b10c…` |
| The bot is repaid in USDC from the payment, capped | `_keeperFee`: metered gas × min(gas price, 2×base fee), never above `maxKeeperFee6` |
| Apart from the capped fee, funds go only to the target or the refund wallet | `_settle` and `land` logic; `test_greedyTargetCannotTakeStrays` |
| No owner, upgrade or pause | No owner/admin functions in `src/Doorstep.sol` (searched); no proxy |
| 32 contract tests pass under Arc's rules | Ran `FOUNDRY_PROFILE=arc arc-forge test`: 32 passed (this session) |
| SDK published on npm as `doorstep-arc` | Installed from the npm registry into a fresh project and computed an address (this session) |
| Hosted API: addresses, invoices, status, API keys, rate limits, signed webhooks with retries | `api/server.mjs` (HMAC-SHA256 `x-doorstep-signature`, 429 `rate_limited`, retry schedule) |
| MCP server has exactly three tools: create, check (incl. link verification), deliver | `agent/server.mjs`; 6 tests through a real MCP client on a local Arc node |
| Live demo with QR code, progress tracker, receipts with Doorstep's cut = 0 | `web/app/index.html`, `web/app.js`; end-to-end browser test against a simulated chain |
| A wallet payment on the live site was delivered automatically by the bot on mainnet | tx `0x9213c520…` (README, Mainnet proof) |
| ERC-20 transfer to the same address delivered (address reuse) | tx `0xb7e0ac45…` |
| Open source, MIT | `LICENSE` |
| Not audited | `SECURITY.md` |

## Not verified here

| Claim | Status |
| --- | --- |
| The delivery bot is running right now | Runs as a systemd service with `Restart=always` on the operator's VPS; I can't reach the VPS or mainnet from the production environment. The film says "a bot that runs around the clock", which is the design and the operator's setup, not a live measurement. |
| Arc's sub-second finality | From Arc's own announcement; not measured. Not stated in the narration. |
| Exchange support for Arc (Kraken, KuCoin) | From the exchanges' announcements (16 Sep 2026); not tested with Doorstep. The film says "straight from an exchange" because an exchange withdrawal on Arc is a native transfer, which is verified. |

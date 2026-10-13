# Storyboard

A 2 minute 47 second product film for the Arc Microgrants submission. Audience: Arc judges and developers. One idea carries the film: an ordinary USDC transfer can land as a proper contract deposit.

Visual system: the Doorstep brand (forest green `#153E31`, lime `#B9F27C`, off-white `#F6F7F2`, rust `#B4553E` for refunds), Schibsted Grotesk for words and JetBrains Mono for addresses and code. Scenes alternate dark and light so each beat reads as a new chapter. Every motion is tied to a narration line; nothing moves for decoration.

Honesty rules on screen:
- Diagrams carry an **Illustration** or **Illustrative amounts** label.
- Product screens carry **Real interface · balances shown come from a test network**, because they were captured against a simulated chain, not a live wallet.
- Every address on screen is real: the mainnet contract, the demo vault, the mainnet delivery tx, and payment addresses computed with the SDK from the instructions shown.

| # | Scene | Purpose | What the viewer sees | Key on-screen text |
| --- | --- | --- | --- | --- |
| 1 | Hook | Make the problem felt in one picture | 25 USDC leaves an exchange account and reaches a savings app that only accepts `deposit(amount, you)`. The balance stays at 0.00. | YOUR MONEY CAN REACH AN ADDRESS. / BUT CAN THE APP ACTUALLY RECEIVE IT? · "Arrived as a plain transfer · nobody credited" |
| 2 | Friction | Show today's workaround | Seven steps appear one by one (withdraw, personal wallet, add the Arc network, open the app, connect, approve, deposit), then blur. | SENDING USDC IS EASY. / GETTING IT INTO THE RIGHT CONTRACT IS THE HARD PART. |
| 3 | Intro | Name the answer | The Doorstep mark draws on; a transfer runs wallet → Doorstep → contract. | doorstep · Payments that find their way in. · "Credited to the right person" |
| 4 | Mechanism | Explain it in four steps | (1) the instructions card fills in, row by row; (2) the payment address appears, then changes when the beneficiary changes, with "Nothing deployed yet"; (3) the exchange sends 25 USDC to that address, "No wallet connection · no approvals"; (4) the bot calls `deposit()` → "Credited ✓", with the refund wallet path. | How it works · Instructions / Address / Send / Deliver or return |
| 5 | Product | Prove it exists | "Live on Arc mainnet" with the contract address; then the real demo screens (address + QR, sending, delivered, receipt) in a browser frame; then the SDK, API and bot cards with the real mainnet delivery transaction. | LIVE ON ARC MAINNET. · arcdoorstep.duckdns.org/app/ |
| 6 | Why Arc | Show why this only works cleanly on Arc | A 25 USDC payment goes through `deposit()` and splits into 24.995 USDC for the payer and a capped ≈0.005 USDC to the bot, both in USDC. Three chips are struck through. | BUILT AROUND ARC. / SETTLED IN USDC. · No second gas token · No price oracle · No token swap |
| 7 | Security | Earn trust, honestly | Three cards: two destinations, bound to its instructions (two real addresses), no admin key. An amber disclosure bar. | Not yet independently audited. Use small amounts. · USDC on Arc only |
| 8 | Uses | Show how far it goes | Five tiles (savings, escrow, invoices, payroll, AI agents) and the MCP server's three tools. | ONE ADDRESS. ANY APP. · MCP server · no tool can send money anywhere else |
| 9 | Close | Land the line and the links | A lime trail runs into the door mark, then the lock-up and URLs. | PAYMENTS THAT FIND THEIR WAY IN. / Live on Arc mainnet. Open source. Built for developers. · arcdoorstep.duckdns.org · github.com/phoenix-2203/doorstep |

Music arc: a warm pad alone under the hook; a soft pulse enters with the friction; bass arrives with Doorstep's name; the pulse and light ticks build through the product and Arc scenes; everything resolves on the final chord under the end card.

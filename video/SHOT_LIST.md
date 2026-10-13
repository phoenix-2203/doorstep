# Shot list

Film length 2:46.68 at 1920×1080, 30 fps. All shots are rendered from `production/film.html`; times are the start of each narration line the shot is cued to.

| Scene | Time | Shot | Source |
| --- | --- | --- | --- |
| hook | 0:00.90 | Exchange card and savings-app card fade in | Motion graphics (film.html) |
| hook | 0:03.43 | 25 USDC token travels along the dashed line; exchange balance 250.00 → 225.00 | Motion graphics (film.html) |
| hook | 0:09.34 | Token stops at the app; app border pulses amber; "Arrived as a plain transfer · nobody credited" | Motion graphics (film.html) |
| hook | 0:09.34 | Headlines: YOUR MONEY CAN REACH AN ADDRESS. / BUT CAN THE APP ACTUALLY RECEIVE IT? | Motion graphics (film.html) |
| friction | 0:14.89 | SENDING USDC IS EASY. | Motion graphics (film.html) |
| friction | 0:18.80 | Seven workaround steps appear one by one, linked by arrows | Motion graphics (film.html) |
| friction | 0:28.20 | Steps dim and blur; GETTING IT INTO THE RIGHT CONTRACT IS THE HARD PART. | Motion graphics (film.html) |
| intro | 0:34.14 | Doorstep logo draws on: arch, arrow, dot; tagline | Motion graphics (film.html) |
| intro | 0:36.47 | Logo rises; wallet → Doorstep → smart contract; USDC token travels; "Credited to the right person" | Motion graphics (film.html) |
| mechanism | 0:44.35 | Step rail 1–4; instructions card fills row by row (demo vault 0x3da5…7bB3, deposit(amount, beneficiary), refund, minimum, fee limit, deadline, reference) | Motion graphics (film.html) |
| mechanism | 0:45.78 | Card shrinks; payment address 0xf962…5d54 appears (CREATE2 formula shown); "Nothing deployed yet" | Motion graphics (film.html) |
| mechanism | 0:52.70 | Beneficiary changes to 0xb0b0…0002; address scrambles to 0x50b9…95e9 | Motion graphics (film.html) |
| mechanism | 0:58.67 | Exchange withdraw card sends 25 USDC to that address; "No wallet connection · no approvals" | Motion graphics (film.html) |
| mechanism | 1:05.09 | Bot pill "Delivery bot calls deposit()"; token moves into savings vault; "Credited ✓"; refund-wallet branch appears (rust, dashed) | Motion graphics (film.html) |
| product | 1:14.56 | LIVE ON ARC MAINNET. + contract 0x56BD…6229, chain 5042 | Real UI captured by production/capture.mjs (test network), plus motion graphics |
| product | 1:17.11 | Browser frame: demo-address screen (address + QR), slow push-in | Real UI captured by production/capture.mjs (test network), plus motion graphics |
| product | 1:24.08 | demo-send → demo-delivered screens | Real UI captured by production/capture.mjs (test network), plus motion graphics |
| product | 1:28.33 | demo-receipt screen (Doorstep's cut 0) | Real UI captured by production/capture.mjs (test network), plus motion graphics |
| product | 1:32.86 | Three cards: SDK code, hosted API docs screenshot, delivery bot with mainnet tx 0x9213…d554 | Real UI captured by production/capture.mjs (test network), plus motion graphics |
| arc | 1:43.00 | BUILT AROUND ARC. / SETTLED IN USDC. | Motion graphics (film.html) |
| arc | 1:48.22 | 25.00 USDC → deposit() → 24.995 to the vault and ≈0.005 capped bot fee | Motion graphics (film.html) |
| arc | 1:55.35 | Chips struck through: no second gas token, no price oracle, no token swap | Motion graphics (film.html) |
| security | 2:00.23 | Card 01 Two destinations | Motion graphics (film.html) |
| security | 2:09.57 | Card 02 Bound to its instructions (two real address pairs) | Motion graphics (film.html) |
| security | 2:14.62 | Card 03 No admin key + contract address; amber disclosure bar | Motion graphics (film.html) |
| uses | 2:18.71 | ONE ADDRESS. ANY APP. | Motion graphics (film.html) |
| uses | 2:22.42 | Tiles appear on each word: savings, escrow, invoices, payroll | Motion graphics (film.html) |
| uses | 2:25.83 | AI agents tile highlighted; MCP tools panel; "no tool can send money anywhere else" | Motion graphics (film.html) |
| close | 2:35.97 | Lime trail runs into the door mark; dot lands | Motion graphics (film.html) |
| close | 2:39.01 | Lock-up: logo, PAYMENTS THAT FIND THEIR WAY IN., secondary line, URLs; held to the end | Motion graphics (film.html) |

## Sound effects

All synthesised in `production/audio.py`.

| Time | Effect |
| --- | --- |
| 0:04.93 | hook: transfer travels to the app (whoosh) |
| 0:09.74 | hook: arrives, nobody credited (dull thump) |
| 0:37.77 | intro: transfer through Doorstep (whoosh) |
| 0:40.77 | intro: credited (chime) |
| 0:53.00 | address calculated (rising blips) |
| 0:55.70 | instructions changed: new address (scramble) |
| 0:59.57 | payment sent (whoosh) |
| 1:01.32 | payment arrives at the address (soft thump) |
| 1:06.39 | delivery (whoosh) |
| 1:08.04 | deposit credited (chime) |
| 1:09.69 | return path shown (falling two notes) |
| 1:25.49 | real interface: delivered (chime) |
| 1:48.82 | payment into deposit() (whoosh) |
| 1:50.42 | split: vault credited (blip) |
| 1:51.82 | split: capped bot fee (blip) |
| 1:55.70 | strike-through 1 |
| 1:56.45 | strike-through 2 |
| 1:57.20 | strike-through 3 |
| 2:36.57 | trail into the door (whoosh) |
| 2:38.07 | arrives home (chime) |

## Screens used

| File | What it shows |
| --- | --- |
| assets/screens/demo-address.png | Live demo app: your savings address, QR code, instructions |
| assets/screens/demo-send.png | Sending a small amount |
| assets/screens/demo-delivered.png | Delivered: progress tracker and savings balance |
| assets/screens/demo-receipt.png | Receipt list ("Doorstep's cut 0") |
| assets/screens/api-docs.png | Hosted API documentation |

The screens are the real interface built from `web/`, captured against the in-browser chain simulator (`web/test/sim.mjs`), so their balances are test values. The film labels them as such.

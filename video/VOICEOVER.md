# Voiceover

Voice: Kokoro-82M (open-weight TTS, Apache-2.0), voice `am_michael` (adult American male), speed 0.94, generated locally by `narration/generate.py`. Each line was transcribed back with Whisper base.en to check the words; see "How it was checked" below.

`Said as` is the spelling sent to the voice so it pronounces acronyms correctly. Times are where each line starts in the finished film.

| Scene | Starts | Line | Length | Said as |
| --- | --- | --- | --- | --- |
| hook | 0:00.90 | Here's something that should be simple. | 2.0 s |  |
| hook | 0:03.43 | You've got USDC on an exchange. You want it in a savings app on Arc. | 5.0 s | You've got U-S-D-C on an exchange. You want it in a savings app on Arc. |
| hook | 0:09.34 | So you send it… and the app has no idea it's yours. | 3.5 s | So you send it... and the app has no idea it's yours. |
| friction | 0:14.09 | Exchanges and wallets can only send to an address. | 3.4 s |  |
| friction | 0:18.00 | But apps keep money in smart contracts, and those only accept it through their own deposit function. That's how they know who to credit. | 8.7 s |  |
| friction | 0:27.40 | Sending is easy. Getting it into the right contract is the hard part. | 4.6 s | Sending is easy. Getting it into the right contract, that's the hard part. |
| intro | 0:33.34 | Doorstep closes that gap. | 1.7 s |  |
| intro | 0:35.67 | It turns an ordinary USDC transfer into a proper deposit, credited to the right person. | 6.9 s | It turns an ordinary U-S-D-C transfer into a proper deposit, credited to the right person. |
| mechanism | 0:43.55 | Here's how. | 0.9 s |  |
| mechanism | 0:44.98 | First, the app sets the instructions: the contract, who gets credited, and where refunds go. | 6.0 s | First, the app sets the instructions. The contract, who gets credited, and where refunds go. |
| mechanism | 0:51.90 | Those instructions produce an address. Change anything, and you get a different one. | 5.1 s |  |
| mechanism | 0:57.87 | The payer just sends their USDC there, from a wallet or straight from an exchange. | 5.5 s | The payer just sends their U-S-D-C there, from a wallet, or straight from an exchange. |
| mechanism | 1:04.29 | Then a delivery bot calls the contract's deposit function for them. If it can't, the money goes back to the refund wallet. | 8.2 s |  |
| product | 1:13.76 | And it's live on Arc mainnet. | 2.0 s | And it's live, on Arc main-net. |
| product | 1:16.31 | In the demo, you get your own savings address, with a QR code and the instructions behind it. | 6.1 s | In the demo, you get your own savings address, with a QR code, and the instructions behind it. |
| product | 1:23.28 | Send a few cents, and watch it arrive in your savings. | 3.4 s |  |
| product | 1:27.53 | Every payment gets a receipt, and Doorstep's cut is zero. | 3.8 s | Every payment gets a receipt. And Doorstep's cut, is zero. |
| product | 1:32.06 | Behind it: an SDK on npm, a hosted API with signed webhooks, and a bot that runs around the clock. | 8.9 s | Behind it, there's an S-D-K on N-P-M, a hosted A-P-I with signed webhooks, and a bot that runs around the clock. |
| arc | 1:42.20 | Arc is what makes this practical, because gas is paid in USDC. | 4.6 s | Arc is what makes this practical, because gas is paid in U-S-D-C. |
| arc | 1:47.42 | The bot spends USDC to deliver, and it's repaid in USDC from the payment, with a cap. | 6.5 s | The bot spends U-S-D-C to deliver, and it's repaid in U-S-D-C from the payment, with a cap. |
| arc | 1:54.55 | No second token. No price oracle. No swaps. | 3.6 s |  |
| security | 1:59.43 | Apart from that capped fee, money only goes two places: into the contract in the instructions, or back to the refund wallet. | 8.6 s | Apart from that capped fee, money only goes two places. Into the contract in the instructions, or back to the refund wallet. |
| security | 2:08.77 | Nobody can redirect a payment, and there's no admin key at all. | 4.2 s |  |
| security | 2:13.81 | It isn't audited yet, so keep the amounts small. | 3.0 s |  |
| uses | 2:17.91 | And because it's just an address, any app can use it. | 3.2 s |  |
| uses | 2:21.62 | Savings. Escrow. Invoices. Payroll. | 2.8 s |  |
| uses | 2:25.03 | Even AI agents: our MCP server lets them create, check and deliver payments, but never send money anywhere else. | 8.6 s | Even A-I agents. Our M-C-P server lets them create, check, and deliver payments. But never send money anywhere else. |
| close | 2:35.17 | Your users' money is already out there. | 2.4 s |  |
| close | 2:38.21 | Doorstep gives it a way in. | 1.7 s |  |

## Visual and on-screen text per scene

| Scene | Starts | Length | Visual |
| --- | --- | --- | --- |
| hook | 0:00.00 | 14.2 s | Dark. YOUR MONEY CAN REACH AN ADDRESS. / BUT CAN THE APP ACTUALLY RECEIVE IT? 25 USDC travels from an exchange account to a savings app that only accepts deposit(amount, you); balance stays 0.00, "Arrived as a plain transfer · nobody credited". Labelled Illustration. |
| friction | 0:13.59 | 19.7 s | Light. SENDING USDC IS EASY. Today's seven-step workaround appears pill by pill (withdraw, personal wallet, add Arc network, open app, connect, approve, deposit), then blurs under GETTING IT INTO THE RIGHT CONTRACT IS THE HARD PART. |
| intro | 0:32.64 | 11.1 s | Dark. The doorstep logo draws on with "Payments that find their way in."; a USDC transfer runs wallet → Doorstep → savings vault, "Credited to the right person". |
| mechanism | 0:43.15 | 30.7 s | Light. Four-step rail. Instructions card → payment address (real CREATE2 output) → address recomputes when the beneficiary changes → exchange sends 25 USDC → bot calls deposit() → vault credited; refund path shown. |
| product | 1:13.26 | 29.0 s | Light. “Live on Arc mainnet.” with the contract address; real demo screens in a browser frame (address + QR, send, delivered, receipt), then SDK / API / bot cards with the real mainnet delivery tx. |
| arc | 1:41.70 | 17.8 s | Dark. BUILT AROUND ARC. / SETTLED IN USDC. A 25 USDC payment splits into the vault deposit and a capped bot fee, both USDC. Strike-through chips: no second gas token, no price oracle, no token swap. |
| security | 1:58.93 | 19.2 s | Light. Three cards: two destinations, bound to its instructions (two real addresses), no admin key. Amber disclosure bar. |
| uses | 2:17.51 | 17.5 s | Dark. One address. Any app. Five use-case tiles; the MCP server’s three tools. |
| close | 2:34.37 | 11.5 s | Dark. The trail runs into the door mark, then lock-up: PAYMENTS THAT FIND THEIR WAY IN. / Live on Arc mainnet. Open source. Built for developers. URLs. |

29 lines, 357 words, 135.1 s of speech in a 165.9 s film (159 words per minute while speaking).

## Pronunciation

| Written | Said as | Why |
| --- | --- | --- |
| USDC | U-S-D-C | read as a word ("usk") otherwise |
| mainnet | main-net | heard as "Maine" otherwise |
| SDK, npm, API, MCP, AI | S-D-K, N-P-M, A-P-I, M-C-P, A-I | spelled out letter by letter |
| Arc | Arc | the transcriber writes "Ark"; same sound |

## How it was checked

- Every line was transcribed with Whisper base.en and compared word for word with the script (`narration/lines.json` keeps the transcript). The only differences left are spellings of the same sound: Arc/Ark, U-S-D-C/USDC, main-net/mainnet.
- **Not auditioned by a human ear.** The production environment has no speakers; naturalness was judged only from the transcription, pacing and waveform. Kokoro is one of the most natural open voices, but it is still synthetic and can sound flat on long sentences. Listen before publishing.

## Replacing the voice

The film is timed from the narration, so a new voice drops in cleanly:

1. Record or generate each line as `narration/lines/SS_LL.wav` (scene and line number, same order as `narration/script.json`), or put the new voice into `narration/generate.py`.
2. Run `python3 narration/generate.py` (or only update the durations in `narration/lines.json`), then `python3 production/timeline.py`, `python3 production/audio.py`, `python3 production/captions.py`, and render (see README).

A human read of this script (yours, or a voice actor) would be the single biggest upgrade to the film.

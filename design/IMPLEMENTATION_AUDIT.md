# Implementation audit (before the redesign)

Date: 12 October 2026. Read from the repository at commit `9c343fb` on `gh-pages` / main HEAD.

## Routes

| Route | File | What it does |
| --- | --- | --- |
| `/` | `web/index.html` + `web/landing.js` | Landing page. Redirects old `#i=` and `#developers` links to `app/`. |
| `/app/` | `web/app/index.html` + `web/app.js` | Try it: connect a wallet, get a savings address (registered on-chain), pay it, watch it land in the demo vault, withdraw. |
| `/app/#i=…` (optionally `?doorstep=&chain=&rpc=`) | same | Pay page: QR code, waiting amount, timeline, invoice progress, Deliver, Cancel, Register, Withdraw, history. |
| `/app/#developers` | same | SDK and API snippets, a form that makes a payment link, contract addresses. |
| `api.…/docs` | `api/docs.html` (served by `api/server.mjs`) | API reference. |

## Build and deploy

`cd web && node build.mjs` bundles `landing.js` and `app.js` with esbuild into `web/dist/assets/<name>-<hash>.js` and rewrites the two HTML files. `web/dist` is copied onto the `gh-pages` branch (old hashed bundles are kept so cached pages keep working). No framework, two runtime dependencies (`viem`, `qrcode-generator`).

## Working journeys (verified on mainnet earlier, see README "Mainnet proof")

Wallet send, ERC-20 transfer, reused address, expiry refund, early cancel, automatic delivery by the public bot, website savings demo, API address creation.

## Design assets before

No logo file; a CSS door as the mark. Palette door blue / brass / fog. Fonts from Google Fonts (Bricolage Grotesque, Instrument Sans, JetBrains Mono). CSS is inline per page; the app and landing page each define their own tokens.

## Constraints

- Arc's public RPC allows about one request per second per visitor; the app and the landing feed must pace reads.
- The app's logic (`app.js`) finds elements by id and sets `data-state` on `.door` and classes `done/now/bad` on steps and timeline items. A restyle must keep every id and those hooks.
- No secrets in the frontend: none today (the API key is server-side only).

## Risks to existing functionality

Renaming ids, changing the `#i=` link format, or touching `app.js` state logic. The redesign keeps all three.

## Baseline results (run 12 Oct 2026)

- `FOUNDRY_PROFILE=arc arc-forge test`: 32 passed, 0 failed. (Without the `arc` profile 12 fail, as expected: they depend on Arc's native-USDC rules.)
- `cd sdk && npm test`: 15 passed, 0 failed.
- `cd web && node build.mjs`: builds both pages.

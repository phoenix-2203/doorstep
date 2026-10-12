# Redesign report

12 October 2026. Built against [the brief](REDESIGN_PLAN.md); nothing in the contract, SDK behaviour, API or payment flow changed.

## What changed

**Identity.** New logo from the supplied concept: an open arch (the receiving contract), a lime arrow (the payment) and a dot (arrival), on a forest tile, with a lowercase wordmark converted to outlines. Palette moved from blue/brass to forest, lime and warm off-white, with separate status colours (green delivered, amber waiting, rust returned). One self-hosted typeface, Schibsted Grotesk, plus JetBrains Mono for addresses and code; Google Fonts are no longer loaded.

**Landing page** (`web/index.html`, `web/landing.js`):
- Hero states the problem and the fix in two sentences, with an honest proof line (live, open source, not audited).
- A payment route on a forest track: wallet → Doorstep address → vault, with a refund branch. It plays once, can be replayed, switches to a refund, and every part explains itself when selected. The final state shows without motion under reduced motion. It is labelled as an example.
- The problem section cites the real mainnet issue.
- Four steps.
- **Instruction inspector:** edit the instructions and the page computes the real Doorstep v2 address and instruction hash with the SDK in the browser, plus the exact text a payer sees. It is labelled as sample wallets and says not to send.
- Live activity from mainnet with loading, empty, error and "checked at" states and a manual refresh.
- Code tabs.
- Built for Arc.
- Safety and limits: what happens on refusal, keeper downtime and a blocklisted refund wallet; only USDC; not audited.
- An 11-question FAQ.
- Footer.
- A mobile menu.

**App** (`web/app/index.html`): the same header, logo and tokens. The address panel is now an arch-topped "threshold" that matches the logo. Steps show a check mark when done. Timeline states use shape as well as colour. The pay page opens "What this address does" by default so payers see where money goes before sending. Every element id and `app.js` hook is unchanged; only one line was added to `app.js`, to set the API links from config.

**Build:** shared chunks between pages, brand files and fonts copied to `dist/brand/`, and `brand.css` cache-busted by content hash.

## Features

| Feature | Status |
| --- | --- |
| Instruction verification (inspector) | Built, using the real SDK |
| Payment-state observability | Existing pay-page timeline kept and restyled |
| Public receipt page | Deferred |
| Integration playground | Deferred (the inspector and code tabs cover the core) |
| Keeper status | Deferred: no trustworthy heartbeat signal exists yet |

## Tests run (12 Oct 2026)

- `FOUNDRY_PROFILE=arc arc-forge test`: 32 passed.
- `cd sdk && npm test`: 15 passed.
- `cd web && node build.mjs`: builds.
- Headless Chromium against the production build with a mocked Arc RPC:
  - Widths 1440, 1280, 768, 390 and 320: no horizontal overflow and no page errors.
  - The inspector changes the address when an instruction changes.
  - The feed renders delivered and returned rows, and shows an error state when the RPC returns 503.
  - Reduced motion shows the final state.
  - The mobile menu opens and closes.
  - Dark mode works on the landing page and the app.
  - The pay page renders a part-paid invoice.
- No real transactions were sent for these tests.

## Known limitations

- Feed timestamps cost one RPC call per row; on a busy public RPC they may not appear (the explorer links still do).
- The landing route uses example values, labelled as such.
- Cancel has no confirmation dialog; its explanation sits next to the button and only the refund wallet can use it.
- The domain is still the GitHub Pages address and the API is on an sslip.io name until a domain is set up.

## Preview and build

```shell
cd web && npm install && node build.mjs     # outputs web/dist
npx serve web/dist                          # or any static server
```

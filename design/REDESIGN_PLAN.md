# Redesign plan

Deadline: 14 October 2026. Scope is chosen so that nothing in the payment flow changes.

## Landing page (`/`)

1. Header: logo, How it works, Developers, Live activity, API docs, GitHub, "Try the live demo". Mobile: a menu button with a disclosure panel.
2. Hero: headline, one paragraph, two buttons, a proof line. Below it, the payment route on a forest track: wallet or exchange → Doorstep address → vault, with a refund branch to the refund wallet. Plays once; "Replay" and "Show a refund" controls; each stage has a one-line explanation.
3. The problem: direct send vs Doorstep address, citing the real mainnet issue.
4. How it works: four steps on a progress line.
5. Instruction inspector: edit beneficiary, refund wallet, minimum, fee cap, deadline and reference; the page computes the real Doorstep address with the SDK and shows the plain-words description. Changing any field visibly changes the address.
6. Live activity: last deliveries and returns from Doorstep v2 on mainnet, with loading, empty, error and "checked at" states.
7. Developers: code tabs (SDK, HTTP API, webhook) and what the SDK/API do.
8. Built for Arc.
9. Safety and limits, including not audited and what happens when delivery is impossible.
10. FAQ, closing call to action, footer.

## App (`/app/`)

Same tokens and logo. Header with logo and nav. The door panel becomes a forest "threshold" panel (arch top, lime arrival light). Steps, timeline, forms and facts restyled. Ids and `app.js` logic unchanged.

## Features evaluated (section 12 of the brief)

| Idea | Value | Effort | Risk | Decision |
| --- | --- | --- | --- | --- |
| B. Instruction verification panel | High: makes "the address is the instructions" tangible to judges | Low (SDK already computes it) | Low | Build, as the landing inspector |
| D. Payment-state observability | High | Already mostly there (pay-page timeline with explorer links) | Low | Keep; restyle |
| A. Public receipt page | Medium | Medium | Medium | Defer: the pay page already shows final status and links |
| C. Integration playground | Medium | High | Medium | Defer: covered by the inspector + code tabs |
| E. Keeper status | Medium | Needs a trustworthy heartbeat endpoint | Medium | Defer: a single RPC call can't prove the bot is healthy |

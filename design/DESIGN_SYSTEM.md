# Design system

All tokens live in `web/brand/brand.css`, shared by the landing page and the app.

## Colour

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--bg` | `#F6F7F2` | `#0F1613` | Page |
| `--surface` | `#FFFFFF` | `#16201B` | Panels, inputs |
| `--surface-2` | `#EAF1E8` | `#1C2822` | Quiet fills |
| `--line` | `#E1E6DE` | `#2A3832` | Borders, rules |
| `--ink` | `#171C19` | `#E9EFEA` | Text |
| `--muted` | `#5B6960` | `#A3B1A8` | Secondary text (AA on `--bg`) |
| `--forest` | `#153E31` | `#153E31` | Brand surfaces, primary buttons |
| `--lime` | `#B9F27C` | `#B9F27C` | Arrival, accents on forest only |
| `--ok` | `#1E7A4C` | `#5FCB8E` | Delivered |
| `--wait` | `#8A5D0B` | `#E2B44F` | Waiting, part paid |
| `--back` | `#A3412B` | `#E58A73` | Returned, cancelled, errors |

Status is never colour alone: every state has a word, and timeline dots have distinct shapes (filled, ring, cross).

## Type

Schibsted Grotesk (variable, self-hosted) for everything; JetBrains Mono for addresses, hashes, code and chain ids. Scale: 14 / 16 / 18 / 22 / 28 / 40 / 64. Body 17px/1.6 on the landing page, 16px/1.55 in the app. Sentence case everywhere; no all-caps labels.

## Space and shape

4-pt grid: 4, 8, 12, 16, 24, 32, 48, 72, 112. Radii: 6 (inputs, chips), 12 (panels), 20 (the hero track), 999 (status chips). Borders 1px `--line`; shadows only on the floating mobile menu.

## Components

Buttons (primary forest, secondary outline, quiet text), 44px min touch height. Inputs 44px, mono for addresses. Status chips. Address blocks with copy. Timeline. Code window with tabs. FAQ disclosure.

## Motion

160–240 ms for interface feedback; the hero route plays once (about 4 s) and can be replayed. Only opacity, transform and stroke. `prefers-reduced-motion` shows the final state without movement.

## Breakpoints

1440, 1280, 960 (two columns collapse), 768, 560 (mobile menu), 390, 320. No horizontal page scroll; code scrolls inside its window; addresses wrap with `overflow-wrap: anywhere`.

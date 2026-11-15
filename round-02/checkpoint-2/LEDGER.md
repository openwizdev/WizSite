# RD1 scene ledger: one spec becomes many (round 2)

Donors: scroll-craft's beat ledger and layer contract (one camera idea, named planes, shared anchors, a settled motion-off frame, mobile art-directed separately); Matt Pocock's prototype (structurally different variants on the real page via `?variant=`, picked by eye, losers kept on a throwaway branch).

## The missing beat (round 6)
v2 cut from "one bay, one spec" straight to "the whole citadel". Nothing showed *more specs starting*. Every variant below must show, in order and readably at 390 px:
1. **One finishes.** Our bay ships: the app glows, its spec reads "Dark mode toggle · shipped ✓".
2. **Neighbours start.** Next to it, other bays light up one at a time, each with **its own named spec**.
3. **More floors.** The lighting spreads beyond the first row: other floors and lines.
4. **The whole citadel**, busy, then rest.

## Beat ledger (time from the end of the build, seconds; the intro before it is unchanged)

| Beat | t | What the visitor must understand | Words on screen |
| --- | --- | --- | --- |
| B1 Ship | 0.0–1.0 | This one spec is done | "Dark mode toggle · shipped ✓" |
| B2 Pull back | 1.0–2.4 | It was one bay of many | none |
| B3 Neighbours | 2.0–4.0 | Others are being built at the same time, each its own spec | 3–4 spec names on desktop, 2–3 on phone |
| B4 Floors | 3.8–5.4 | It scales: whole floors and lines | none (names collapse to brass dots) |
| B5 Citadel | 5.2–6.6 | A factory building many ideas at once | none |
| B6 Rest | 6.6– | Ambient (RD2) | none |

## Layer contract (all variants)

| Layer | Source | Size | Alpha | Order | Anchor |
| --- | --- | --- | --- | --- | --- |
| Sky + stars | SVG | view | — | 0 | view |
| Moon | art/moon.webp | 400² | yes | 1 | world (parallax 0.4) |
| Citadel, dark | derived from citadel.webp (brass → dim navy) | 2400×1350 | yes | 2 | world |
| Lit windows | citadel-lights.webp clipped per window box (184 windows, 29 strips, found by connected components) | per box | yes | 3 | world, each box |
| Our bay | art/bay.webp + crew/items | 1600×1000 | no | 4 | world box centred on the lit bay window (1036, 953), 192×120 |
| Spec labels | HTML | constant screen size | — | 5 | world point above each bay |

Spec labels stay a constant screen size while the camera moves, so they remain readable on the phone. Motion-off frame: B5 with our spec label only.

## Variants (structurally different)
- **A · Window to window.** One continuous camera pull-back. Our bay becomes one lit window on its floor; the nearest neighbours light one by one, each raising a spec label; the camera keeps pulling back while other floors light in waves outward.
- **B · Cards multiply.** No camera move at first. The finished bay shrinks into a tile, the tile multiplies into a grid of bays (each a different spec), then every tile flies into its own window on the dark citadel and lights it.
- **C · Elevator cutaway.** A dollhouse section. Our bay sits in a row of bays on its floor, which light left to right; the camera rides up through floors stacked above, each row lighting, then pulls out as the stack resolves into the citadel.

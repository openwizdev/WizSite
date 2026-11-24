# Wiz Loader — Variant C (Hat wave)

## Byte counts (raw, un-gzipped)

| Asset | Bytes |
| --- | ---: |
| `wiz-loader/wiz-loader.css` | 4,470 B |
| `wiz-loader/wiz-loader.js` | 3,947 B |
| **CSS + JS total** | **8,417 B** |
| Single inline HTML markup snippet | 1,375 B |
| **CSS + JS + markup total** | **9,792 B** (under 10 KB hard cap) |

## The dance

- **0–4 s (CSS-only first paint):** One cream Wiz (`#cfc6b8`) sits dead-center, bobbing, hopping with soft squash-and-stretch, and wiggling/popping its hat. Works with JS disabled.
- **4–8 s (Joiners pop up):** Role-coloured Wizes pop up from below one by one every ~1.05 s (builder sea glass `#8ccbd9`, reviewer orchid `#bba8e8`, merged green `#a7d4a0`, and ready gold `#e9d38c` on widths >= 540 px; capped at 4 at 390 px, 5 at 1440 px, 3 in compact). As each joins, existing Wizes glide smoothly to re-center via CSS `translate` with zero vertical or page layout shift.
- **Stadium hat wave:** Once the second Wiz arrives, the row runs a gentle 2.2 s stadium wave (0.18 s stagger): each Wiz hops and tosses its hat high above its head, catching it neatly.

## What changes at ~15 s, ~20 s, ~30 s, ~60 s

- **~14.1 s (visible at t = 15 s) and every 30 s thereafter:** **Neighbour hat swap** — two adjacent Wizes toss their hats in high crossing arcs (`-265` and `-165` SVG units) onto each other's heads, wear the swapped hats for ~2.5 s with a little bob, then toss them back.
- **~19.4 s (~20 s):** Right after the first hat swap finishes, the stadium wave reverses direction (right-to-left) and alternates direction after each subsequent swap.
- **~29.1 s (~30 s):** **Tiny Wiz cartwheel** — a small amber-hatted Wiz (`#e8b46a`, 62% scale) cartwheels across the stage in front of the row (3 full rotations), fading cleanly in and out at the edges.
- **~59.1 s (~60 s):** **Grand unison hat toss** — the whole row tosses their hats together in unison for one beat, followed by a reverse tiny-Wiz cartwheel.

## Line list (rotates every 2.6 s; 5 s in reduced motion)

Initial HTML line (announced once in `role="status"`):
- `Opening OpenWiz`

Rotating lines (visual only; `aria-hidden="true"` once JS mounts, with a stable `.wl-sr` label):
1. `Wizes are brewing your specs`
2. `Herding agents`
3. `Checking every ticket`
4. `Reading your repo`
5. `Polishing the hats`
6. `Asking the reviewers nicely`
7. `Untangling the branches`
8. `Warming up the ember`
9. `Straightening the beards`

## Reduced motion & CSP

- Under `prefers-reduced-motion: reduce`, only the single cream Wiz renders, gently breathing opacity (`0.64`–`1`) with no hops, joiners, or surprises; lines rotate slower (5 s).
- Tested under `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'` with 0 console or CSP errors. Zero inline `<script>`, zero `style=""` attributes, zero `element.style` writes.

## Trade-offs

- **Exact `mark.svg` in JS for `WizLoader.markup()`:** Embedding the exact `mark.svg` paths in `wiz-loader.js` (~1.13 KB) allows `WizLoader.markup(compact)` to work standalone on any page without pre-existing DOM markup, which puts raw CSS + JS at 8.4 KB (above the 6 KB stretch target, though comfortably under the 10 KB hard cap including markup). If the shipping build only clones an existing inline `<svg>` or uses a shared `<symbol>`, JS drops by ~1.1 KB.
- **Pupil micro-glance omitted:** Dropped the 1 px eye-up keyframe during the wave to keep CSS compact and well within the 10 KB cap.

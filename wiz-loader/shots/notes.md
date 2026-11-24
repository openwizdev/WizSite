# Wiz Loader — Variant A: Conga

## Byte counts

| Asset | Raw | Gzip |
| --- | ---: | ---: |
| `wiz-loader/wiz-loader.css` | 4,284 B | 1,527 B |
| `wiz-loader/wiz-loader.js` | 3,756 B | 1,851 B |
| **CSS + JS combined** | **8,040 B** | **3,378 B** |
| Single-loader HTML markup snippet (compact whitespace) | 1,281 B | — |
| **Total (CSS + JS + markup snippet)** | **9,321 B** | — |

All under the 10 KB hard cap (9,321 B raw including the exact inline `app/mark.svg` paths). Note: 995 B of `wiz-loader.js` is the exact `mark.svg` SVG path string so `WizLoader.markup()` works standalone even on pages without server-rendered loader markup.

## The dance

- **0–4 s (solo):** The cream Wiz (`#cfc6b8`) stands center stage, doing a squash-and-stretch hop (`wl-hp`), a ground shadow pulse (`wl-sh`), a slight beard sway (`wl-bs`), and a hat-and-brim bob (`wl-hb`) delayed by `+0.12 s` so the hat lags a beat behind the body. Works from first paint with CSS alone (no JS required).
- **4 s onward (conga line):** Role-coloured Wizes hop in from the right (`wl-en`) every 1.6 s (`4.0 s`, `5.6 s`, `7.2 s`, `8.8 s`):
  1. Builder — sea glass `#8ccbd9`
  2. Reviewer — orchid `#bba8e8`
  3. Merged — green `#a7d4a0`
  4. Ready — gold `#e9d38c` (5th Wiz at `>= 640 px` viewports; capped at 4 Wizes total at `390 px`, and 3 Wizes in `compact` mode)
- Each follower holds the Wiz in front with a small cream mitten (`::before`) and bounces in a travelling wave (`+0.14 s` stagger per Wiz, with hats bobbing `+0.12 s` behind each body).
- **Every 12 s (conga turn):** The whole line hops (`wl-th`) and flips horizontally (`scaleX(-1)`) to march the other way, mittens and wave order intact.

## Long-wait variations (20 s / 40 s / 60 s)

- **20 s (and repeating every 20 s for 7 s):** Party groove (`.wl-p`) speeds the bounce cycle from `0.90 s` to `0.72 s` and twinkles four subtle role-coloured sparkles above the line.
- **40 s:** The leader Wiz puts on an amber (`#e8b46a`) party hat (`.wl-g`).
- **60 s:** Mega Conga Encore (`.wl-x`) — higher joyous leaps (`-18 px` vs `-12 px`) with persistent twinkling sparkles.

## Rotating lines

Initial HTML line (announced once via `aria-live="polite"`):
- `Opening OpenWiz` (or `Reading GitHub…` in the compact inline demo)

Rotating copy every `2.5 s` (`5.0 s` under `prefers-reduced-motion: reduce`), switched to `aria-hidden="true"` after the first line while `<span class="wl-sr">Loading</span>` remains in the `role="status"` container:
1. `Wizes are brewing your specs`
2. `Herding agents`
3. `Checking every ticket`
4. `Reading your repo`
5. `Polishing the hats`
6. `Asking the reviewers nicely`
7. `Untangling the branches`
8. `Warming up the Ember`
9. `Combing the beards`
10. `Lining up the conga`
11. `Double-checking the diffs`
12. `Still here, still dancing`

## Reduced motion

Under `@media (prefers-reduced-motion: reduce)`:
- Only the first Wiz renders (joiners, mittens, shadows, and sparkles are hidden in CSS and skipped in JS).
- All hopping, swaying, and turns are disabled; the single Wiz gently fades (`opacity: 0.62` ↔ `1`, `3.6 s`).
- Lines still rotate, at half speed (`5 s`).

## Trade-offs

- **Exact `mark.svg` paths without `<mask>` ID collisions:** Used the exact face, beard, eye-socket, mouth-cutout, pupil, tooth, hat, and brim paths from `app/mark.svg`, drawing the eye/mouth cutouts in `var(--bg)` (matching `app/wiz-reviewer.svg`'s technique) rather than `<mask id="face">`. This avoids duplicate SVG ID bugs when multiple Wizes or multiple loaders share a page.
- **Byte budget:** CSS + JS raw is 8,040 B (3,378 B gzipped), slightly above the 6 KB raw stretch target because the exact `mark.svg` paths take ~1 KB in JS and all nine keyframes + reduced-motion + demo layout live in one CSS file without a build step, while staying comfortably under the 10 KB hard cap (9,321 B including the HTML snippet).
- **Strict CSP:** Tested with `default-src 'self'; script-src 'self'; style-src 'self'` — zero inline scripts, zero `style=""` attributes, zero `element.style` writes, zero console/CSP errors.

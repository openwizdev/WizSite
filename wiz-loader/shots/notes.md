# Wiz loader, variant B: Wand twirl

## Bytes (raw, no gzip)
| file | bytes |
|---|---|
| wiz-loader.css | 4646 |
| wiz-loader.js (terser-minified; includes its own copy of the markup for `markup()`) | 3766 |
| markup snippet (stage + inline SVG + line) | 1443 |
| **total** | **9855** (under the 10 KB cap; css+js 8412 is over the 6 KB target) |

`demo.css` (169 B) styles only the demo's "Inline (compact)" card. It isn't part of the loader.

## The dance
- **0–4 s (CSS only, works without JS):** one cream Wiz on a 2 s beat. Two small bobs, a squash, a hop with stretch, a landing squash, and a hat wiggle (the hat and brim rock on the head). The wand does a baton twirl each beat: a small wind-up, a full 360° spin, then the star twinkles. A soft ground shadow sits under it.
- **From 4 s:** a new Wiz appears every 2 s (4, 6, 8, 10 s) in a soft amber glow with a ring of four sparkles. New Wizes alternate right and left of the leader, and the line slides over to stay centred (absolutely positioned, so no layout shift). Each joiner wears a role-colour hat: sea glass, orchid, green, gold. Line sizes: 4 Wizes at 390, 5 at ≥700 px, 3 in compact.
- **Line dance:** the twirls run left to right, 0.25 s apart, so a ripple of spinning stars moves down the line every beat. Joins land on the beat, so everyone stays in step.
- **Cast (14 s, then every 10 s: 24, 34, 44…):** everyone raises their wand, the stars flare and spin, and two layers of amber sparkles drift down. The Wizes then do one of three moves, in turn:
  - a: one big hop together (14 s, 44 s…)
  - b: a hop that ripples left to right (24 s, 54 s…)
  - c: a mid-air turn: they flip and spin back (34 s, 64 s…)
- **What keeps it fresh:** after each cast the hat colours shift one place down the line with a slow cross-fade. So at 20 s you've seen the first cast and the hats have changed. At 60 s you've seen all three moves, the hats have rotated five times, and the words have looped about twice with a new pairing.

## Lines (one every 2.5 s, fades out and up)
Opening OpenWiz (markup), Wizes are brewing your specs, Herding agents, Checking every ticket, Reading your repo, Polishing the hats, Asking the reviewers nicely, Twirling the wands, Waking the sleepy Wizes, Tidying the beards, Dusting off the stars, Sorting the spellbook, Finding a comfy hat.

## Accessibility
`role="status"` on the container. The stage is `aria-hidden`. `mount()` sets `aria-hidden` on the visible rotating line and adds a hidden `.wl-sr` label with the first line, so screen readers announce it once and never again. `mount(el,{lines})` uses `lines[0]` for both.
Reduced motion: no bob, hop, twirl, joins or casts. One Wiz slowly fades its opacity, and the words change every 4 s.

## API
`WizLoader.mount(el,{compact,lines}) -> {stop}`, `WizLoader.markup(compact) -> HTMLElement`, auto-mount on `[data-wiz-loader]`. Timers stop on `stop()`, or on the first tick after the element leaves the DOM (tested headless). Each SVG copy gets a unique mask id on mount.

## Trade-offs
- css+js is 8.4 KB, over the 6 KB target. That's mostly because the JS carries a second copy of the SVG for `markup()`.
- The wand floats beside the beard: the Wiz has no hands, and the mark's paths stay unchanged.
- The beats run on `setInterval(2s)` lined up with the CSS animations from mount. Over a long wait, drift is tens of ms at most, too small to see. Each cast restarts every Wiz's animation together, which re-syncs them.
- Minor: `transform-box: fill-box` is used for the hat and wand pivots (supported in all evergreen browsers).

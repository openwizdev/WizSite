# Round 2 — checkpoint 2 (2026-11-15)

- Candidate: WizSite branch `round2`, PR #3, head b3cbb0d. Builder: Claude Opus 5.5. Art: round 1's layers, plus a derived dark citadel (brass removed) and a window map of 213 rectangles in 83 groups and 14 lines, both found from the lights layer.
- Inputs: the round-2 brief (RD1–RD6, phone first) and the round-8 picks: the A + C transition and How it works wording 1, adjusted ("skills", "in Cloudroom", no approve claim, the banned word dropped).
- Method donors: scroll-craft's beat ledger and layer contract (`LEDGER.md`), Matt Pocock's prototype variants (checkpoint 1), Corey Haines' copywriting (How it works, kept to what the repos say), Impeccable's located critique (`CRITIQUE.md`).

## Evidence
- `hero-desktop.mp4`, `hero-phone.mp4` (+ GIFs): the real page, 0–24 s at 20 fps. The clock is driven deterministically for capture (performance.now and CSS animations seeked together). The intro runs about 12.7 s, then about 11 s of rest motion.
- `landing/` and `shiplog/`: real screenshots at 1440 × 900 and 390 × 844, full page, reduced motion (the still frame), with `capture.json`.
- `contact-sheet.png`: both still frames and nine moments of the intro at each width.

## Functional checks (browser, 1440 and 390)
Autoplays once when visible. Replay appears after the intro, is focusable and replays. Switching to reduced motion mid-play settles to the still frame (0 running animations, Replay hidden). No JS gives 0 animations and the final frame. No horizontal overflow, no JS errors on either page. Scrolling away during the intro doesn't break it. One real bug was found and fixed: Chromium didn't fire the reduced-motion change on the long-lived media query, so CSS now stops the intro under reduced motion on its own, and the conductor re-checks each frame.

## Not done / limits
- No council or pairwise judging this round; the checkpoint is Jake's look.
- No automated browser tests in CI (the standing named gap).
- The phone's first screen ends just above the two buttons (headline, animation and window come first, per AN2).

## Review round 1 (Codex Sol, high): 8 findings, all fixed
- The intro plays once per load and on Replay only (it no longer replays on a breakpoint change).
- A Pause control stops all CSS and JS motion.
- One reused bloom element (it used to leak a node per flip).
- Conveyor strips are recognised.
- Label sizes are cached.
- The copy gates read entity-decoded text.
- The teaser is checked as version–headline pairs.
- Two public 404 links are fixed (WizSkills shown unlinked; the testing note points to STATUS.md).
The clips and stills here are re-recorded at the fixed head.

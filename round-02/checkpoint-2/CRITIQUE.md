# RD3 · Located critique of every v2 element (round 2)

Method: Impeccable's located critique (each finding tied to a screenshot region, one proposed change) plus round 6's owner notes. Evidence: round 1's real screenshots of v2 (`climb/round-01/desktop.png` 1440 wide, `phone.png` 390 wide; y in CSS px of the full page). Verdict: **keep**, **cut** or **fix**.

| # | Element | Where (screenshot, region) | Evidence | Verdict | Change |
| --- | --- | --- | --- | --- | --- |
| 1 | Brand "✦ OpenWiz" | both, header left | Reads first, one mark, no noise | keep | — |
| 2 | Nav "Changelog · GitHub ↗" | both, header right | "Changelog" no longer names what the page is (RD5) | fix | "Ship log · GitHub ↗" |
| 3 | Headline | desktop y 170–400; phone y 100–240 | Clear; three lines on both widths | keep | phone 44 px so the art starts higher |
| 4 | Subline | desktop y 430–500; phone y 255–300 | Clear | keep | — |
| 5 | Install button + note + prompt box | desktop y 540–730 (four stacked parts, ~190 px); phone y 1060–1380 | Owner: "too crowded"; the prompt box repeats the button's job | fix | the button plus one short line; cut the note paragraph and the code box |
| 6 | Star on GitHub | desktop y 540–590; phone y 1120 | The only working action; brass reads first | keep | phone: side by side with Install |
| 7 | "● Building in public" | desktop y 760; phone y 1400 | Owner: obvious, cut | cut | the changelog's `/#next` link moves to `/#ship` |
| 8 | Product window | desktop y 500–880; phone y 640–1010 (370 px tall at 390) | Explains the story; on the phone it fills the first screen's bottom and pushes the art small | fix | phone: compact rows and type, ~300 px, overlapping the art less |
| 9 | Replay | figcaption (hidden after the cut) | Needed after the intro | fix | a small button on the window's title bar |
| 10 | "Illustration, not live data." | desktop y 890; phone y 1030 | Owner: obvious, cut | cut | — |
| 11 | Zoom-out to the citadel | frames 8.0–9.6 s | Owner: misses one spec becoming many | fix | RD1 mix: one pull-back, a named item per line, rows multiplying |
| 12 | Citadel at rest | desktop y 60–500 | Owner: should move more | fix | RD2: items on lines, a train on the ring, windows flipping to brass, smoke |
| 13 | Moon, stars | desktop y 100–160 | Quiet depth | keep | — |
| 14 | "Idea in. Shipped work out." + factory loop | desktop y 880–1350; phone y 1560–1960 | The loop is liked; phone crop is mostly balcony, the crew is tiny | fix | phone: crop to the line so the crew fills the frame |
| 15 | Caption "OpenWiz runs the line ↗ · …" | desktop y 1380; phone y 1990–2080 | Owner: repos and the org not explained in real text | fix | RD4 "How it works": three lines and one fit sentence, names linked |
| 16 | Changelog teaser | desktop y 1480–1780; phone y 2150–2600 | Owner: unclear with the new versioning | fix | RD5 ship log teaser: Shipped (latest releases) and a small Being built strip |
| 17 | Horizontal rules (header, changelog top, footer) | desktop y 75, 1480, 1900 | Three full-width rules plus section gaps read as filler | fix | keep the header and footer rules only |
| 18 | Footer | both, bottom | Repeats the nav, fine | keep | "Ship log" label |
| 19 | Live-dot glow, note tag square | desktop y 760, 890 | Decoration for cut items | cut | — |
| 20 | Phone first screen (390 × 844) | phone y 0–844 | Headline, then a small art band, then the window's top: no clear picture of the factory | fix | phone-first stage: taller art (about 420 px), compact window below, CTAs right after |

Copy rule (owner, round 8): the word "play" + "book" never appears on the site (page copy, alt text, captions, meta, README); the check script refuses it.

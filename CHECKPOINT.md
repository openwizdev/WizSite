# Checkpoint: landing variant B (stopped early, owner's order)

Done:
- scripts/landing-sync.mjs: `node scripts/landing-sync.mjs <OpenWiz checkout> <prs.json>` (PR file from
  `gh pr list -R openwizdev/OpenWiz --state open --limit 300 --json number,title,url,headRefName,files`). Writes landing/reach.json.
- scripts/reach.mjs: NAMES map, PLATFORM (#3053, #3113), parse/validate, render(reach, registry), withReach (slot `<template data-slot="reach"></template>`).
- landing/reach.json synced: 23 today (14 agents, 9 hosts), 14 coming, OpenWiz 7b04184.

Next (not done, untested):
- index.html: replace the inner of `section.agent-row` with the reach slot; keep the class `agent-row` (check.py regexes anchor on it).
- build.mjs: `if (page === 'index.html') html = withReach(html, render(reach, registry))`.
- site.css: replace `.agent-row*` rules with the typographic index (Geist Mono, numbered columns, double-rule count plate, quiet blue numerals). No images (keeps budget).
- tests/landing.test.mjs (names match snapshot; a main harness never shows as coming), add to `test:functions`; docs/maintaining.md section.
- Screenshots 390x844 / 1440x900, byte delta, Lighthouse; rebase after WizSite #237; open DRAFT PR "Landing (variant B): every agent and host you can bring".

Gotchas:
- check.py STORY_COPY needs the text "Bring any agent" (kept as the h2); landing refuses YYYY-MM-DD dates and x.y.z versions in text.
- market/registry.json has 0 listings (WizMarket main has ~54); render hides the WizMarket count when 0. Re-sync is another lead's call.
- Logos would blow the 25 KB budget (cloudroom.png alone is 21 KB), hence text-only for B.

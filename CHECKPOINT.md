# Checkpoint: landing reach section (no code yet)

Done: read the landing, build, checks and OpenWiz data. Nothing implemented.

Next: write scripts/landing-sync.mjs (OpenWiz checkout + `gh pr list -R openwizdev/OpenWiz --state open --limit 500 --json number,title,url,headRefName,files` file) -> landing/reach.json, a slot in section.agent-row filled from build.mjs, rules in site.css, a node test, and docs/maintaining.md.

Data at OpenWiz 7b04184: today agents = claude, codex + 12 rows (agy amp auggie copilot gemini goose junie kilo kimi oz pi qwen). Today hosts = local boat cloudroom devin factory hermes openclaw.
sprites and codespaces have only a README on main (no `driver` file), so list them as coming (#2720, #2559) and say so in the PR. Coming rows: opencode #2891, cursor #2778, crush #2649, vibe #2643, kiro #2631. Coming drivers: ona #2699, tembo #2662, capy #2652, openhands #2567, warp-oz #2555, pane #2029, cursor #2021, conductor #2020. Package move: #3053, #3113.

Gotchas:
- market/registry.json has 0 listings on main: handle K=0 ("Browse WizMarket").
- check.py: STORY_COPY needs 'Bring any agent', or update it; the hero regex looks ahead to `<section class="agent-row` (keep that class); no `x.y.z` versions or YYYY-MM-DD dates in the landing text (so don't write "0.2.0"); external links only to github.com/openwizdev/OpenWiz with no query; add data-count="github" (clickLinkAttribute).
- Logo rules (docs/drivers-logos.md): text only for Copilot, Codespaces, Junie, Sprites, Vibe. Never recolour or filter.
- Budget: Today's SVGs gzip to about 14.4 KB, plus goose.png 2.2 KB and hermes.png 4.1 KB. cloudroom.png is 21 KB, so show Cloudroom as a text chip. Keep the coming chips text only (logos inside the <details>). Keep the existing inline Claude and Codex SVGs (0 delta).
- #237 (images, lazy check) is still open: rebase after it merges.

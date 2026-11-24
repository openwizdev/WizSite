# Checkpoint: market static pages, kind pages and search (WIP, not buildable yet)

Done (scripts/market.mjs only, draft, untested): one stable order (verified, OpenWiz's own, then name/id), `kinds()` (top 24 tags, `public-source` excluded), `plan()` (48 per page: /market/, /market/page/<n>/, /market/kind/<tag>/ + its pages), compact cards (public-source label + licence, no Publisher row for imported, tags link to kind pages), windowed pager, count line, honesty note, no-JS search link (`.market-search-box` to `#kinds`), head region (title, canonical, prev/next between `<!-- market-head:start/end -->`), `searchIndex()` (rows `[id,name,summary<=64,tagIdx[],verified]` in page order; result page = 1 + i/48, link to the card, not the external URL), `marketFiles(index, template)`, `withMarket(page, section, head)`.

Next:
1. `market/index.html`: replace `<title>Market — OpenWiz</title>` with `<template data-slot="market-head"></template>`; add `<script src="/market/search.js" defer>`.
2. Write `market/search.js` (replace the link with an input, fetch `/market/search.json` on first focus, filter, max 50, DOM via textContent). Add it to build.mjs `hashed` and check.py `HASHED`.
3. build.mjs: for market/index.html, `put` every entry of `marketFiles(registry, html)`.
4. market.css: styles for .market-note, .market-search(-box), .market-range, .market-pages, .market-source, results.
5. scripts/check.py: discover `market/(page/N|kind/<tag>(/page/N)?)/index.html` + `market/search.json` in check_site (allowed files, market.css stylesheet, split both regions, validate head region hrefs start with https://openwiz.dev/market/ and exist, run market checks on each); add `ol` to MARKET_TAGS and `aria-current` to MARKET_ATTRS; in main() regenerate all market files with node `marketFiles` and compare byte for byte; privacy-scan generated files.
6. Update tests/market.test.mjs (cards now ordered verified-then-name; tag links go to /market/kind/<tag>/ only for kind tags; the old "By tag" section is gone) and add the synthetic 5,000-listing test (sizes: first page < 60 KB, search.json size, page counts, kind pages, labels).
7. Screenshots (390x844, 1440x900) and Lighthouse phone vs main (~98).

Gotchas: market/registry.json on main is empty (don't edit it). test_check.py checks the dist market pages against fixture registries, so they only pass while the real registry is empty. The search.json goal of ~400 KB at 5,000 rows is only reachable with cut-down rows (real averages: id 13, name 10, summary 66 chars), which is why rows have no URL and the summary is truncated. Measure this.

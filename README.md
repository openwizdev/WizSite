# WizSite

The standalone static site for [OpenWiz](https://github.com/openwizdev/openwiz), with a landing page and `/changelog`. It uses local fonts and has no npm dependencies or runtime server.

## Map

<picture>
  <source media="(max-width: 600px)" srcset="docs/map-phone.png">
  <img alt="WizSite's parts: the landing page, the ship log, the art, the brand and fonts, the build and checks, and the deploy" src="docs/map.png" width="560">
</picture>

WizSite is the factory's site, openwiz.dev. The [org map](https://github.com/openwizdev) shows how it fits with the other repos.

## Build and check

Use Node.js 24, Python 3.11+ and Git. No package installation is needed.

```sh
npm run build
npm run check
npm test
```

`npm run build` copies the public runtime files (pages, fingerprinted styles and scripts, fonts, every `art/*.webp` layer and the logo files) into `dist/`. The checks require that build first. `npm run check` checks JavaScript syntax, exact build contents, local links and fragments, HTML/CSS resources, font signatures and OFL licences, landing copy, the retained changelog content, and private markers. `npm test` exercises those gates with synthetic broken links, missing resources and private markers.

To preview locally:

```sh
python3 -m http.server 8800 --bind 127.0.0.1 --directory dist
```

## Cloudflare Pages

Cloudflare Pages deploys from **main**. Configure the repository root as the build root, `npm run build` as the build command, and `dist` as the output directory. Both `/changelog` and `/changelog/` must resolve to `changelog/index.html`.

Changes merge after green CI and one review from the other model family. No per-change maintainer approval is required. This repository contains no deployment credentials or separate deploy workflow; the Pages project owns the Git integration.

## Site assets

WizSite owns `tokens.css`; it is a copied foundation, maintained here independently. Both pages use `site.css`; the landing page also uses `site.js`. The build fingerprints `tokens.css`, `site.css` and `site.js` (`name.<hash>.ext` in `dist/`) and rewrites both pages to use those names, so a change always gets a new URL and new HTML never meets an old cached stylesheet or script; `_headers` also asks for revalidation, which applies only if the zone's Browser Cache TTL respects existing headers. The look is navy, black and brass, with layered engraved art in `art/` (generated pictures, sliced into separately animated WebP layers; the lit citadel is a dark base plus its lights layer, shown through a mask of window rectangles).

The hero's intro plays once: CSS runs the build beats (the idea, a 3-question grill, a spec of five tickets, Approve, builders, a reviewer, merged), then `site.js` pulls the camera back from that one bay to the whole citadel. Neighbouring lines light up one at a time, each carrying its own named spec, and then every line carries work. At rest the citadel keeps moving (items on its lines, a train on the ring, windows flipping to brass, smoke), paused off screen. Under reduced motion, or without JavaScript, the page shows one still frame. A Replay button follows the intro. Install reads **Install · coming soon** and stays disabled until a stranger can install.

`/changelog` is the **ship log**: *Being built* (named bundles, never version numbers) and *Shipped* (published releases, newest first, each with its main line and *Also changed*). The landing teaser shows only releases the ship log publishes.

The logo files are the favicons (`favicon.ico` with 16, 32 and 48 px images, `favicon.svg`, `apple-touch-icon.png`), the header lockup `brand/openwiz-lockup.svg` and the 1200×630 social card `brand/og.png` (the lockup on the site ground, rendered from the SVG). The lockup's wordmark is converted to outlines: the SVG has no text and no font reference, and the check refuses one that does, so the wordmark font never ships.

The README's map (`docs/map.png`, and `docs/map-phone.png` for narrow screens) is for GitHub only: the build never copies it, and the check pins both by hash in `DOC_HASHES` like the icons. Its source is `maps/draw.mjs` in `openwizdev/.github`.

The Geist and Geist Mono fonts ship unmodified with `fonts/OFL.txt`. Keep the licence in source and the static export. The build does not fetch fonts from an external service.

## Privacy and verification limits

CI uses only Node.js, Python's standard library, Git and the checkout/setup Actions; it installs no npm dependencies. `scripts/check.py` documents a small case-insensitive denylist of generic private-repository names, owner-home paths, private evidence/decision paths and thread identifiers. It scans tracked and non-ignored source paths and UTF-8 contents, plus the export. Only the denylist declaration itself is exempt from matching its own literals. Bundled font binaries and licences are pinned by hash; `art/*.webp` must be plain WebP with no EXIF or XMP chunks, within a 2 MB total; the PNG and ICO logo files are pinned by hash; other binary content and symlinks require review. Personal literal lists and private policy/history tooling are deliberately not copied into this public repository.

This denylist is a tripwire, not comprehensive detection of private names or secrets. Independent review must also assess privacy and unsettled claims. External link destinations are constrained to the three public repositories; CI does not make network availability checks or validate remote fragments.

**Named gap — automated browser tests:** layout/overflow, keyboard and touch navigation, accessibility/contrast and animation/reduced-motion behavior are not covered by CI. No Playwright, axe or other npm dependency is added. A browser smoke check is useful evidence but does not close this automated-test gap.

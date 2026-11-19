# WizSite

The standalone static site for [OpenWiz](https://github.com/openwizdev/openwiz), with a landing page and `/changelog`. It uses local fonts and a vendored GSAP build, with no runtime server.

## Map

<picture>
  <source media="(max-width: 600px)" srcset="docs/map-phone.png">
  <img alt="WizSite's parts: the landing page, the ship log, the art, the brand and fonts, the build and checks, and the deploy" src="docs/map.png" width="560">
</picture>

WizSite is the factory's site, openwiz.dev. The [org map](https://github.com/openwizdev) shows how it fits with the other repos.

## Build and check

Use Node.js 24, Python 3.11+ and Git. The static build uses the checked-in GSAP file. The npm lockfile pins its upstream version so maintainers can verify or refresh the bundle with `npm ci --ignore-scripts`.

```sh
npm run build
npm run check
npm test
```

`npm run build` copies the public runtime files (pages, fingerprinted styles and scripts, fonts, approved artwork, the sample spec video, vendor licences and the logo files) into `dist/`. The checks require that build first. `npm run check` checks JavaScript syntax, exact build contents, local links and fragments, HTML/CSS resources, font signatures and OFL licences, landing copy, the retained changelog content, and private markers. `npm test` exercises those gates with synthetic broken links, missing resources and private markers.

To preview locally:

```sh
python3 -m http.server 8800 --bind 127.0.0.1 --directory dist
```

## Cloudflare Pages

Cloudflare Pages deploys from **main**. Configure the repository root as the build root, `npm run build` as the build command, and `dist` as the output directory. Both `/changelog` and `/changelog/` must resolve to `changelog/index.html`.

Changes merge after green CI and one review from the other model family. No per-change maintainer approval is required. This repository contains no deployment credentials or separate deploy workflow; the Pages project owns the Git integration.

## Site assets

WizSite owns `tokens.css`. The landing page and ship log use it with `site.css`. The landing also loads the pinned GSAP 3.15.1 core and `site.js`. The build fingerprints these styles and scripts so new HTML gets the matching assets. The GreenSock Standard No Charge licence and the agent icon notices ship in `vendor/`.

The landing page opens on an Ember-style OpenWiz window that walks through one to-do build. Painted WebP costume and crew sprites sit alongside HTML ticket states and an SVG working pulse. Below it are the supported agent logos and three product moments. The spec card describes steering the build from a narrated video and includes a labeled silent sample that loads on request. The footer's twelve waving Wizes look toward the pointer. The demo pauses off screen, offers a Pause motion control and keeps a readable still when reduced motion is on or either script is unavailable. The OpenWiz install button stays disabled as **Install · coming soon**. Sign in and the phone home-screen instructions lead to the existing app.

`/changelog` is the **ship log**: *Shipped* (published releases, newest first) and *Being built* (named bundles, never version numbers). Each release uses the changelog's own text: a plain headline, *What's new for you*, one line on what was tested and what is still unverified, and a folded *Under the hood* list for contributors.

The logo files are the favicons (`favicon.ico` with 16, 32 and 48 px images, `favicon.svg`, `apple-touch-icon.png`), the header lockup `brand/openwiz-lockup.svg` and the 1200×630 social card `brand/og.png` (the lockup on the site ground, rendered from the SVG). The lockup's wordmark is converted to outlines: the SVG has no text and no font reference, and the check refuses one that does, so the wordmark font never ships.

The README's map (`docs/map.png`, and `docs/map-phone.png` for narrow screens) is for GitHub only: the build never copies it, and the check pins both by hash in `DOC_HASHES` like the icons. Its source is `maps/draw.mjs` in `openwizdev/.github`.

The Geist and Geist Mono fonts ship unmodified with `fonts/OFL.txt`. Keep the licence in source and the static export. The build does not fetch fonts from an external service.

## Privacy and verification limits

CI uses only Node.js, Python's standard library, Git and the checkout/setup Actions; it builds from the checked-in vendor files. `scripts/check.py` documents a small case-insensitive denylist of generic private-repository names, owner-home paths, private evidence/decision paths and thread identifiers. It scans tracked and non-ignored source paths and UTF-8 contents, plus the export. Only the denylist declaration itself is exempt from matching its own literals. Bundled font binaries and licences are pinned by hash; each `art/*.webp` must be plain WebP with no EXIF or XMP chunks, and the pinned artwork and spec video share a 2 MB budget; the PNG and ICO logo files are pinned by hash; other binary content and symlinks require review. Personal literal lists and private policy/history tooling are deliberately not copied into this public repository.

This denylist is a tripwire, not comprehensive detection of private names or secrets. Independent review must also assess privacy and unsettled claims. External link destinations are constrained to the three public repositories; CI does not make network availability checks or validate remote fragments.

**Named gap — automated browser tests:** layout/overflow, keyboard and touch navigation, accessibility/contrast and animation/reduced-motion behavior are not covered by CI. The browser smoke check requires no additional project dependency. A browser smoke check is useful evidence but does not close this automated-test gap.

## Sign-in

openwiz.dev/app signs in through the read-only [OpenWiz Viewer](https://github.com/apps/openwiz-viewer) GitHub App (issues, pull requests and metadata, read only). Its client ID and secret live only in the Cloudflare Pages project settings.

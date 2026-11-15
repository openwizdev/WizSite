# WizSite

The standalone static site for [OpenWiz](https://github.com/openwizdev/openwiz), with a landing page and `/changelog`. It uses local fonts and has no npm dependencies or runtime server.

## Build and check

Use Node.js 24, Python 3.11+ and Git. No package installation is needed.

```sh
npm run build
npm run check
npm test
```

`npm run build` copies the public runtime files (pages, styles, scripts, fonts and every `art/*.webp` layer) into `dist/`. The checks require that build first. `npm run check` checks JavaScript syntax, exact build contents, local links and fragments, HTML/CSS resources, font signatures and OFL licences, landing copy, the retained changelog content, and private markers. `npm test` exercises those gates with synthetic broken links, missing resources and private markers.

To preview locally:

```sh
python3 -m http.server 8800 --bind 127.0.0.1 --directory dist
```

## Cloudflare Pages

Cloudflare Pages deploys from **main**. Configure the repository root as the build root, `npm run build` as the build command, and `dist` as the output directory. Both `/changelog` and `/changelog/` must resolve to `changelog/index.html`.

Changes merge after green CI and one review from the other model family. No per-change maintainer approval is required. This repository contains no deployment credentials or separate deploy workflow; the Pages project owns the Git integration.

## Site assets

WizSite owns `tokens.css`; it is a copied foundation, maintained here independently. The landing page (v2) uses `landing.css` and `landing.js`: navy, black and brass, with layered engraved art in `art/` (generated pictures, sliced into separately animated WebP layers). Its ~10 s intro plays once, then rests with ambient motion and a Replay button; under reduced motion, or without JavaScript, every element shows the intro's final frame. The animation is labelled **Illustration, not live data.** Install reads **Install · coming soon**, stays disabled and shows the prompt it will copy, until a stranger can install. The changelog teaser shows only versions the changelog publishes. `/changelog` keeps `style.css`, `script.js` and its command palette; its notes are retained.

The Geist and Geist Mono fonts ship unmodified with `fonts/OFL.txt`. Virgil ships unmodified with `fonts/Virgil-OFL.txt` (SIL Open Font License 1.1; Reserved Font Name Virgil). Keep both licences in source and the static export. The build does not fetch fonts from an external service.

## Privacy and verification limits

CI uses only Node.js, Python's standard library, Git and the checkout/setup Actions; it installs no npm dependencies. `scripts/check.py` documents a small case-insensitive denylist of generic private-repository names, owner-home paths, private evidence/decision paths and thread identifiers. It scans tracked and non-ignored source paths and UTF-8 contents, plus the export. Only the denylist declaration itself is exempt from matching its own literals. Bundled font binaries and licences are pinned by hash; `art/*.webp` must be plain WebP with no EXIF or XMP chunks, within a 2 MB total; other binary content and symlinks require review. Personal literal lists and private policy/history tooling are deliberately not copied into this public repository.

This denylist is a tripwire, not comprehensive detection of private names or secrets. Independent review must also assess privacy and unsettled claims. External link destinations are constrained to the three public repositories; CI does not make network availability checks or validate remote fragments.

**Named gap — automated browser tests:** layout/overflow, keyboard and touch navigation, command-palette interaction, accessibility/contrast and animation/reduced-motion behavior are not covered by CI. No Playwright, axe or other npm dependency is added. A browser smoke check is useful evidence but does not close this automated-test gap.

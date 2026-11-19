# WizSite

The standalone static site for [OpenWiz](https://github.com/openwizdev/openwiz), with a landing page and `/changelog`. It uses local fonts and has no runtime server. Its one dependency is [GSAP](https://gsap.com) 3.15.1, which runs the landing film's timeline; it is vendored in `vendor/`, so CI and the build install nothing.

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

`npm run build` copies the public runtime files (pages, fingerprinted styles and scripts, the vendored GSAP file with its licence, fonts, every `art/*.webp` layer and the logo files) into `dist/`. The checks require that build first. `npm run check` checks JavaScript syntax, exact build contents, local links and fragments, HTML/CSS resources, font signatures and OFL licences, landing copy, the retained changelog content, and private markers. `npm test` exercises those gates with synthetic broken links, missing resources and private markers.

To preview locally:

```sh
python3 -m http.server 8800 --bind 127.0.0.1 --directory dist
```

## Cloudflare Pages

Cloudflare Pages deploys from **main**. Configure the repository root as the build root, `npm run build` as the build command, and `dist` as the output directory. Both `/changelog` and `/changelog/` must resolve to `changelog/index.html`.

Changes merge after green CI and one review from the other model family. No per-change maintainer approval is required. This repository contains no deployment credentials or separate deploy workflow; the Pages project owns the Git integration.

## Site assets

WizSite owns `tokens.css`; it is a copied foundation, maintained here independently. Both pages use `site.css`; the landing page also uses `site.js`. The build fingerprints `tokens.css`, `site.css` and `site.js` (`name.<hash>.ext` in `dist/`) and rewrites both pages to use those names, so a change always gets a new URL and new HTML never meets an old cached stylesheet or script; `_headers` also asks for revalidation, which applies only if the zone's Browser Cache TTL respects existing headers. The look is warm charcoal with the paintings' three pigments (Sea Glass, Orchid, Guava). The art in `art/` is the era paintings (generated pictures, web-sized WebP), plus three cut-out layers of those paintings for the small moves (the hammer, the stamp, the rocket).

The landing page is one film. The hero shows the headline and the two buttons above it. The film plays by itself for about 40 seconds and loops: the camera pans and pushes across the cave, grill, forge, mill and launch paintings, with brush-stroke wipes or cuts between them. It pulls back through the mill's three lines into the lattice of every era, then settles into a wordless app window and "This is your factory." Below it, each act has its own short loop: the five eras roll past ("One idea, through all of history."), the lines pull back into the lattice ("Your whole factory, across time."), and the app board moves tickets from build to review to merged ("This is your factory."). Only three scenes have a small move: the forge's hammer, the mill's stamp and the launch's rocket shake (the grill adds a lens glint). The cave, the lines and the lattice move only by camera. The film runs on one GSAP timeline in `site.js`; the act loops and small moves are CSS animations. `site.js` builds the timeline only under `prefers-reduced-motion: no-preference`, closes Act 1's strip into a loop and pauses each loop while it is off screen. It also runs the Pause button on every loop, which pauses all motion on the page at once. Every CSS animation sits inside the same query. Under reduced motion, without JavaScript, or if `site.js` or GSAP fails to load, every scene shows as a still painting. The only words are the headline, the two buttons and one caption of six words or fewer per act. Install reads **Install · coming soon** and stays disabled until a stranger can install.

GSAP 3.15.1 (`vendor/gsap-3.15.1.min.js`, about 28 KB gzipped) is pinned in `package.json` and `package-lock.json`, and the check pins the file by hash. It is copied byte for byte from the npm package, with its header notice, `vendor/GSAP-NOTICE.txt` and the licence text `vendor/GSAP-LICENSE.txt`. Its licence is GSAP's Standard "No Charge" licence: free for sites whose visitors pay nothing, but not OSI-approved. The owner allowed it for this public website, not for the OpenWiz kernel. It replaces a hand-written CSS keyframe clock, so retiming the film is one number per shot.

`/changelog` is the **ship log**: *Shipped* (published releases, newest first) and *Being built* (named bundles, never version numbers). Each release uses the changelog's own text: a plain headline, *What's new for you*, one line on what was tested and what is still unverified, and a folded *Under the hood* list for contributors. The landing teaser shows only releases the ship log publishes.

The logo files are the favicons (`favicon.ico` with 16, 32 and 48 px images, `favicon.svg`, `apple-touch-icon.png`), the header lockup `brand/openwiz-lockup.svg` and the 1200×630 social card `brand/og.png` (the lockup on the site ground, rendered from the SVG). The lockup's wordmark is converted to outlines: the SVG has no text and no font reference, and the check refuses one that does, so the wordmark font never ships.

The README's map (`docs/map.png`, and `docs/map-phone.png` for narrow screens) is for GitHub only: the build never copies it, and the check pins both by hash in `DOC_HASHES` like the icons. Its source is `maps/draw.mjs` in `openwizdev/.github`.

The Geist and Geist Mono fonts ship unmodified with `fonts/OFL.txt`. Keep the licence in source and the static export. The build does not fetch fonts from an external service.

## Privacy and verification limits

CI uses only Node.js, Python's standard library, Git and the checkout/setup Actions; it installs no npm dependencies. `scripts/check.py` documents a small case-insensitive denylist of generic private-repository names, owner-home paths, private evidence/decision paths and thread identifiers. It scans tracked and non-ignored source paths and UTF-8 contents, plus the export. Only the denylist declaration itself is exempt from matching its own literals. Bundled font binaries and licences are pinned by hash; `art/*.webp` must be plain WebP with no EXIF or XMP chunks, within a 2 MB total; the PNG and ICO logo files are pinned by hash; other binary content and symlinks require review. Personal literal lists and private policy/history tooling are deliberately not copied into this public repository.

This denylist is a tripwire, not comprehensive detection of private names or secrets. Independent review must also assess privacy and unsettled claims. External link destinations are constrained to the three public repositories; CI does not make network availability checks or validate remote fragments.

**Named gap — automated browser tests:** layout/overflow, keyboard and touch navigation, accessibility/contrast and animation/reduced-motion behavior are not covered by CI. No Playwright, axe or other npm dependency is added. A browser smoke check is useful evidence but does not close this automated-test gap.

## Sign-in

openwiz.dev/app signs in through the read-only [OpenWiz Viewer](https://github.com/apps/openwiz-viewer) GitHub App (issues, pull requests and metadata, read only). Its client ID and secret live only in the Cloudflare Pages project settings.

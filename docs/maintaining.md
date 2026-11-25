# Maintaining WizSite

How the site is built, checked and deployed. The [README](../README.md) is the short version.

## Build and check

Use Node.js 24, Python 3.11+ and Git. Install the pinned dependencies with `npm ci` first. The static build uses the checked-in GSAP file. The npm lockfile pins its upstream version so maintainers can verify or refresh the bundle with `npm ci --ignore-scripts`.

```sh
npm ci
npm run build
npm run check
npm test
```

`npm run build` copies the public runtime files (pages, fingerprinted styles and scripts, fonts, approved artwork, the two-minute launch video, the sample spec video, vendor licences and the logo files) into `dist/`. The checks require that build first. `npm run check` checks JavaScript syntax, exact build contents, local links and fragments, HTML/CSS resources, font signatures and OFL licences, landing copy, the Changelog (its name, reviewed content and release data), and private markers. `npm test` exercises those gates with synthetic broken links, missing resources and private markers.

To preview locally:

```sh
python3 -m http.server 8800 --bind 127.0.0.1 --directory dist
```

## Cloudflare Pages

Cloudflare Pages deploys from **main**. Configure the repository root as the build root, `npm run build` as the build command, and `dist` as the output directory. Both `/changelog` and `/changelog/` must resolve to `changelog/index.html`.

Changes merge after green CI and one review from the other model family. No per-change maintainer approval is required. This repository contains no deployment credentials or separate deploy workflow; the Pages project owns the Git integration.

## Security and cache headers

`_headers` sets site-wide security headers under `/*` (HSTS, a strict Content-Security-Policy with no `'unsafe-inline'` or `'unsafe-eval'`, `X-Frame-Options: DENY`, `Permissions-Policy`, `Cross-Origin-Opener-Policy: same-origin`, `X-Content-Type-Options: nosniff`, and `Referrer-Policy: strict-origin-when-cross-origin`). Under `/app/*`, `! Content-Security-Policy` and `! Referrer-Policy` detach the site-wide values before setting the stricter app policy so Cloudflare Pages does not comma-join both headers.

For caching, `/*` defaults to `Cache-Control: public, max-age=0, must-revalidate` (keeping HTML and any unhashed `.css`/`.js` revalidated on every visit so a deploy never serves stale HTML pointing at removed hashed files). More-specific rules detach with `! Cache-Control` before setting a single value: fingerprinted and version-pinned styles/scripts (`/*.:hash.css`, `/*.:hash.js`) use `public, max-age=31536000, immutable`; fingerprinted fonts (`/fonts/*.woff2`, named `name.<hash>.woff2` by the build) use `public, max-age=31536000, immutable`; and unhashed images, icons, art, video, and captions (`/art/*`, `/brand/*`, `/drivers/logos/*`, root favicons, `/app/*.svg|png|ico`, `/*.mp4`, `/*.vtt`) use `public, max-age=604800, stale-while-revalidate=2592000`. These rules take effect when the zone's Browser Cache TTL is set to respect existing headers.

The site-wide policy allows exactly two outside origins besides GitHub's API, both for Cloudflare Web Analytics: `script-src` allows `https://static.cloudflareinsights.com`, where the beacon script Cloudflare injects into every HTML page is served from, and `connect-src` allows `https://cloudflareinsights.com`, where the beacon reports (`/cdn-cgi/rum`). The `/app/*` policy does not allow them, because analytics is meant to exclude the app.

`npm run check` also validates `.well-known/security.txt` and fails when its `Expires` timestamp is within 60 days so renewal is enforced.

To verify the effective merged headers locally after `npm run build`:

```sh
npx wrangler pages dev dist --port 8788
curl -sI http://127.0.0.1:8788/
curl -sI http://127.0.0.1:8788/app/
curl -sI http://127.0.0.1:8788/.well-known/security.txt
curl -sI http://127.0.0.1:8788/robots.txt
```

## The Changelog's releases

`/changelog` lists one short entry per public release, newest first by semver. Each entry is one data file, `changelog/releases/<public name>.json`, which `build.mjs` reads (through `scripts/changelog.mjs`) and writes into the page; nothing is read from the network.

```json
{
  "name": "0.01",
  "semver": "0.1.0",
  "date": "2026-11-21",
  "headline": "Run your agents anywhere.",
  "bullets": ["Three drivers: your own computer, Cloudroom and boat.dev.", "..."],
  "notes": "https://github.com/openwizdev/OpenWiz/releases/tag/v0.1.0"
}
```

- **One entry:** the public name as its heading with the date and semver small beside it ("0.01 · Nov 21, 2026 (0.1.0)"), a one-line headline of what it lets you do, a short list of plain bullets, and one link to the full notes on GitHub.
- **A human-readable number of bullets:** aim for 2 to 5. The check refuses none, more than 6, a bullet over 120 characters, a headline over 80, a notes link that isn't that release's page on GitHub (`.../releases/tag/v<semver>`), a public name that doesn't name its file, or a semver before 0.1.0.
- **Who writes it:** an agent drafts each entry from the release's merged pull requests; Jake approves the words before it publishes.
- **The switch:** the entries sit behind the landing install box's switch (`data-install` in `index.html`). While it reads `coming-soon`, the page shows no entry, only one line linking OpenWiz's pre-releases on GitHub, so it never claims an unreleased version. When RL2 flips it to `live` as OpenWiz 0.1.0 publishes, every entry shows, so the install box and the Changelog go live together. After that, adding a release's file is publishing its entry: merge it when the release is out.

The generator's tests (`scripts/test_changelog.py`, run by `npm test`) use the synthetic data in `scripts/changelog-fixtures/`. To see the section either switch state produces, run `node scripts/changelog.mjs --switch live` (or `--switch coming-soon`).

The repository map and the *What exists today* text that used to open the page are in [docs/repos.md](repos.md), with the map as `docs/repo-map.svg`.

## Site assets

WizSite owns `tokens.css`. Every site page uses it with `site.css`; the Changelog and Market keep their own styles in `changelog/changelog.css` and `market/market.css`, so the landing never loads them and no page uses inline `<style>` blocks. The landing also loads the pinned GSAP 3.15.1 core and `site.js`. The build fingerprints these styles and scripts so new HTML gets the matching assets. The GreenSock Standard No Charge licence and the agent icon notices ship in `vendor/`.

The landing page opens on an Ember-style OpenWiz window that walks through one to-do build. Right under the hero (its headline, install box and demo window), above everything else, sits the two-minute launch video (`art/launch-video.mp4`, a 1280×666 web copy of the launch film with its 40 px black bars cropped: H.264 high profile at about 1.1 Mbps with 128 kbps AAC and `+faststart`) on a wide player: its poster (`art/launch-poster.webp`, the ship at sunset) and one **Watch OpenWiz in two minutes** button. It loads nothing until that button is pressed (`preload="none"`, never autoplay), then plays from the start with sound, native controls and captions on offer (`art/launch-video.vtt`, the narrator's lines, without the spell shouts). Without scripts it keeps the video's native controls. A two-sentence text alternative describes it to screen readers, and one small **See the launch post** link under it opens the launch post on X. Painted WebP costume and crew sprites sit alongside HTML ticket states and an SVG working pulse. Below it are the supported agent logos and three product moments. The spec card plays the real narrated spec video of the to-do app an OpenWiz fleet built (openwizdev/todo-demo, J267); the grill and ship cards link that run's grill questions and the live app. The spec video rests on its poster and loads nothing until a visitor presses Play with sound or the poster itself; only a real press starts it, with sound and captions. It never autoplays, and a plain link offers the file. The footer's twelve waving Wizes look toward the pointer. The demo pauses off screen, offers a Pause motion control and keeps a readable still when reduced motion is on or either script is unavailable. The install box shows the one line, `Install OpenWiz from github.com/openwizdev/OpenWiz`, with **Paste this into your agent** and a **Copy** button. While the box's `data-install` switch in `index.html` reads `coming-soon`, the button ships disabled as **Copy · coming soon**; once it reads `live` (since OpenWiz 0.1.0) the page ships **Copy**, `site.js` enables it, and a click copies the line with the Clipboard API, falling back to selecting the line and `document.execCommand('copy')`, then to leaving the line selected (**Line selected: copy it**). Sign in and the phone home-screen instructions lead to the existing app.

`/team` is the **team page**, and its one job is a booked call. Its hero says who it is for, what happens on the call, **Book a call**, what to bring, and the landing's two-minute launch film (the same click-to-play player: nothing loads until clicked, sound and captions on click, never autoplay). *On the call* walks through Connect, Decide and Ship. *What you’re setting up* holds four true lines and links to `/drivers/` for which drivers passed, rather than restating counts that go stale; then a closing **Book a call**. It shows no price, no Questions and no timeline, and `scripts/check.py` pins its exact words and refuses prices, customers, results, guarantees, driver counts or a CloudRoom claim. Every site page's top bar (the landing, `/drivers`, `/changelog` and `/team`) carries one buy button, **Get it for your team** (**For teams** on phones), to it: one snippet, `header-cta.html`, which the build adds to each page's top bar, so no page keeps its own copy. The booking link has one value: the `href` of the two `data-book` links in `team/index.html`, the hero's and the closing one (Jake's Cal.com booking page). The check accepts only an `https://` URL or the in-page placeholder `#book`, and refuses a booking link on another page, a third one, two that differ, or a price on the team page.

Every site page shares one **footer**, `footer.html`, which the build adds at each page's `<template data-slot="footer"></template>` slot, so no page keeps its own copy: two link groups (Product: Drivers, Changelog, Docs, the app; Company: For teams, Pro, GitHub with its star count, X @openwiz), the line "Apache-2.0. Owned by no one.", the wordmark shown whole and the twelve Wizes. Short pages pin it to the bottom of the window. Every site page loads GSAP and `site.js` for it, `/drivers` included, so the star count and the Wizes behave the same everywhere; `/drivers` itself still reads completely without them. The check refuses a page without it or with a second footer; the browser check refuses a clipped wordmark, a painted gap of more than 16 px between its ink and the Wizes, or a footer that ends above the window's bottom. The X account is the one external link allowed off GitHub, and only as the footer's link: never a resource, a CSS `url()` or a second link. The one other X link is the landing's **See the launch post**, to that exact post, once, under the launch video; the check refuses it anywhere else.

`/faq` is the **Questions** page. The FAQ has one source, `faq.html`: a *Questions* heading with its line, then seven flat rows, each a question on a button that opens its answer. The build adds it at the `<template data-slot="faq"></template>` slot near the bottom of the landing and above `/team`'s closing **Book a call**, and at `/faq`'s `<template data-slot="faq-h1"></template>` slot, where its title becomes the page's h1 and each question an h2. The page ships every answer open and every row's button disabled, so the answers read even if `faq.js` never loads; `faq.js` enables the buttons, closes the answers, then opens and closes them, at once with reduced motion. Its footer link sits in the Product group. The check refuses a page without the snippet, a second copy, a changed or missing question, a row that is not a button naming its answer, an answer linking off the site, and any form or input: the planned "Ask a Wiz..." row is a later change, appended as the last row.

`/changelog` is the **Changelog**: its title, one line, then one short entry per public release, newest first; see *The Changelog's releases* above. Its main holds no version number or date of its own, and never names a private repository.

## `/pro` and `/supporters`

`/pro` (`pro/index.html`) is the **OpenWiz Pro** page ($20 a year). Its exact words are pinned in `scripts/check.py`, which also refuses any other price, the word Ultra anywhere on the site, or a second checkout link. The checkout link has one value: the `href` of the `data-checkout` link in `pro/index.html`. It ships as the in-page placeholder `#checkout`; when the Polar checkout link is ready, replace `#checkout` with the `https://buy.polar.sh/...` URL. `scripts/check.py` accepts only `#checkout` or an `https://buy.polar.sh/...` URL.

`/supporters` (`supporters/index.html`) is built from one data file, `supporters/supporters.json`, through `scripts/supporters.mjs`; nothing is read from the network. Listing is opt-in only: to add a supporter, append an entry to `supporters/supporters.json` in a pull request:

```json
{"name": "Ada Lovelace", "github": "ada", "since": "2026-11"}
```

Set `"github"` to `null` if the supporter does not want a link to their GitHub profile. Entries render in the order given, with all text escaped. `scripts/check.py` validates the file's shape, lengths, dates, GitHub logins and duplicates, and `scripts/test_supporters.py` (run by `npm test`) tests the generator and checks with fixtures in `scripts/supporters-fixtures/`.

The logo files are the favicons (`favicon.ico` with 16, 32 and 48 px images, `favicon.svg`, `apple-touch-icon.png`), the header lockup `brand/openwiz-lockup.svg` and the 1200×630 social card `brand/og.png` (the lockup on the site ground, rendered from the SVG). The lockup's wordmark is converted to outlines: the SVG has no text and no font reference, and the check refuses one that does, so the wordmark font never ships.

The old README map (`docs/map.png`, and `docs/map-phone.png`) is for GitHub only, and the README no longer shows it: the build never copies it, and the check pins both by hash in `DOC_HASHES` like the icons. Its source is `maps/draw.mjs` in `openwizdev/.github`.

The Geist (Version 1.802) and Geist Mono (Version 1.802) variable fonts ship subsetted with `fonts/OFL.txt`. Keep the OFL licence in source and the static export. The build does not fetch fonts from an external service, fingerprints both `.woff2` files (`fonts/Geist-var.<hash>.woff2` and `fonts/GeistMono-var.<hash>.woff2`), rewrites `url()` in CSS and `<link rel="preload">` in HTML, and `_headers` caches `/fonts/*.woff2` for one year (`public, max-age=31536000, immutable`). Both `@font-face` rules declare `unicode-range` so characters outside the subset fall back to the system font, and `tokens.css` keeps `font-display: optional`.

To inspect the site's character set run `python3 scripts/font_chars.py`; `npm run check` fails if any built page, CSS `content:`, JS string, changelog or market entry uses a character outside the subset. To re-subset from upstream Geist 1.802 / Geist Mono 1.802 variable `.woff2` files (keeping the `wght` axis and `kern,liga,tnum,ccmp,locl,mark,mkmk` layout features):

```sh
UNICODES='U+0020-007E,U+00A0-00FF,U+0100-017F,U+2000-206F,U+20A0-20CF,U+2190-21FF,U+2212'
pyftsubset Geist-var.woff2 --output-file=fonts/Geist-var.woff2 --flavor=woff2 --unicodes="$UNICODES" --layout-features='kern,liga,tnum,ccmp,locl,mark,mkmk'
pyftsubset GeistMono-var.woff2 --output-file=fonts/GeistMono-var.woff2 --flavor=woff2 --unicodes="$UNICODES" --layout-features='kern,liga,tnum,ccmp,locl,mark,mkmk'
```

## Privacy and verification limits

CI uses only Node.js, Python's standard library, Git and the checkout/setup Actions, plus `npm ci` for the pinned dependencies below; it builds the landing from the checked-in vendor files.

**npm dependencies** (exact versions in `package.json`, locked in `package-lock.json`; small, maintained and licence-checked, under J187):

| Package | Version | Licence | Size | Why |
| --- | --- | --- | --- | --- |
| `@dagrejs/dagre` (with `@dagrejs/graphlib` 4.0.6, bundled in its file) | 3.1.3 | MIT | 49 KB minified | Lays out a spec's ticket graph in the app: layered, with fewer crossings and routed arrows. The build copies `dist/dagre.min.js` and its `LICENSE` into `dist/app/vendor/`; it makes no network calls |

`scripts/check.py` documents a small case-insensitive denylist of generic private-repository names, owner-home paths, private evidence/decision paths and thread identifiers. It scans tracked and non-ignored source paths and UTF-8 contents, plus the export. Only the denylist declaration itself is exempt from matching its own literals. Bundled font binaries and licences are pinned by hash; each `art/*.webp` must be plain WebP with no EXIF or XMP chunks, and the pinned artwork and spec video share a 2 MB budget; the launch video, its poster and captions have their own 24 MB budget, since Cloudflare Pages refuses any single file over 25 MiB; the PNG and ICO logo files are pinned by hash; other binary content and symlinks require review. Personal literal lists and private policy/history tooling are deliberately not copied into this public repository.

This denylist is a tripwire, not comprehensive detection of private names or secrets. Independent review must also assess privacy and unsettled claims. External link destinations are constrained to the public repositories and, in the footer, OpenWiz's X account; CI does not make network availability checks or validate remote fragments.

**Named gap — automated browser tests:** layout/overflow, keyboard and touch navigation, accessibility/contrast and animation/reduced-motion behavior are not covered by CI. The browser smoke check requires no additional project dependency; the app's own browser check (`npm run test:app`) covers its pages and their keyboard path. A browser smoke check is useful evidence but does not close this automated-test gap.

## Sign-in

openwiz.dev/app signs in through the read-only [OpenWiz Viewer](https://github.com/apps/openwiz-viewer) GitHub App (issues, pull requests and metadata, read only). Its client ID and secret live only in the Cloudflare Pages project settings.

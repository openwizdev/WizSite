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

WizSite owns `tokens.css`. The landing page and the Changelog use it with `site.css`; the Changelog keeps its own styles inline in `changelog/index.html`, so the landing never loads them. The landing also loads the pinned GSAP 3.15.1 core and `site.js`. The build fingerprints these styles and scripts so new HTML gets the matching assets. The GreenSock Standard No Charge licence and the agent icon notices ship in `vendor/`.

The landing page opens on an Ember-style OpenWiz window that walks through one to-do build. Right under the hero (its headline, install box and demo window), above everything else, sits the two-minute launch video (`art/launch-video.mp4`, a 1280×666 web copy of the launch film with its 40 px black bars cropped: H.264 high profile at about 1.1 Mbps with 128 kbps AAC and `+faststart`) on a wide player: its poster (`art/launch-poster.webp`, the ship at sunset) and one **Watch OpenWiz in two minutes** button. It loads nothing until that button is pressed (`preload="none"`, never autoplay), then plays from the start with sound, native controls and captions on offer (`art/launch-video.vtt`, the narrator's lines, without the spell shouts). Without scripts it keeps the video's native controls. A two-sentence text alternative describes it to screen readers, and one small **See the launch post** link under it opens the launch post on X. Painted WebP costume and crew sprites sit alongside HTML ticket states and an SVG working pulse. Below it are the supported agent logos and three product moments. The spec card plays the real narrated spec video of the to-do app an OpenWiz fleet built (openwizdev/todo-demo, J267); the grill and ship cards link that run's grill questions and the live app, muted and inline while in view, with Play with sound, captions, a poster and a plain link; it loads only when it first plays. The footer's twelve waving Wizes look toward the pointer. The demo pauses off screen, offers a Pause motion control and keeps a readable still when reduced motion is on or either script is unavailable. The install box shows the one line, `Install OpenWiz from github.com/openwizdev/OpenWiz`, with **Paste this into your agent** and a **Copy** button, which stays disabled as **Copy · coming soon** until the box's `data-install` switch in `index.html` reads `live`. Sign in and the phone home-screen instructions lead to the existing app.

`/team` is the **team page**: what you get, who it is for and custom pricing, then three short steps (*What you get*), the drivers by name linking to `/drivers/` (*Where your agents run*) and a closing **Book a call**. Every site page's top bar (the landing, `/drivers`, `/changelog` and `/team`) carries one buy button, **Get it for your team** (**For teams** on phones), to it: one snippet, `header-cta.html`, which the build adds to each page's top bar, so no page keeps its own copy. The booking link has one value: the `href` of the two `data-book` links in `team/index.html`, the hero's and the closing one (Jake's Cal.com booking page). The check accepts only an `https://` URL or the in-page placeholder `#book`, and refuses a booking link on another page, a third one, two that differ, or a price on the team page.

**The booking page** (`/book`, built from `book/index.html`, `book/book.css`, `book/book.js`, `book/manifest.webmanifest` and `book/sw.js`) is OpenWiz's own booking flow for the 30-minute team call and installs as a standalone web app. It shares the site's top bar and static footer (hidden in `standalone` display mode) and intentionally skips GSAP and `site.js` so its strict CSP in `_headers` (`connect-src 'self'`, `worker-src 'self'`, `manifest-src 'self'`, `form-action 'none'`) never attempts external star-count requests; `book/sw.js` stamps a build-tied cache name, serves the shell, manifest and icons network-first, caches fingerprinted assets and fonts, and passes through `/api/` and all requests to the Turnstile origin. It carries no price or payment copy. `scripts/book-check.mjs` verifies the full flow, states, keyboard path, cancel view, offline shell and Chrome installability against mocked `/api/book/*` responses.

Every site page shares one **footer**, `footer.html`, which the build adds at each page's `<template data-slot="footer"></template>` slot, so no page keeps its own copy: two link groups (Product: Drivers, Changelog, Docs, the app; Company: For teams, GitHub with its star count, X @openwiz), the line "Apache-2.0. Owned by no one.", the wordmark shown whole and the twelve Wizes. Short pages pin it to the bottom of the window. Every site page except `/book` loads GSAP and `site.js` for it, `/drivers` included, so the star count and the Wizes behave the same everywhere; `/drivers` itself still reads completely without them, and `/book` keeps the static footer so its `connect-src 'self'` policy stays clean. The check refuses a page without it or with a second footer; the browser check refuses a clipped wordmark, a painted gap of more than 16 px between its ink and the Wizes, or a footer that ends above the window's bottom. The X account is the one external link allowed off GitHub, and only as the footer's link: never a resource, a CSS `url()` or a second link. The one other X link is the landing's **See the launch post**, to that exact post, once, under the launch video; the check refuses it anywhere else.

`/faq` is the **Questions** page. The FAQ has one source, `faq.html`: a *Questions* heading with its line, then seven flat rows, each a question on a button that opens its answer. The build adds it at the `<template data-slot="faq"></template>` slot near the bottom of the landing and above `/team`'s closing **Book a call**, and at `/faq`'s `<template data-slot="faq-h1"></template>` slot, where its title becomes the page's h1 and each question an h2. The page ships every answer open and every row's button disabled, so the answers read even if `faq.js` never loads; `faq.js` enables the buttons, closes the answers, then opens and closes them, at once with reduced motion. Its footer link sits in the Product group. The check refuses a page without the snippet, a second copy, a changed or missing question, a row that is not a button naming its answer, an answer linking off the site, and any form or input: the planned "Ask a Wiz..." row is a later change, appended as the last row.

`/changelog` is the **Changelog**: its title, one line, then one short entry per public release, newest first; see *The Changelog's releases* above. Its main holds no version number or date of its own, and never names a private repository.

The logo files are the favicons (`favicon.ico` with 16, 32 and 48 px images, `favicon.svg`, `apple-touch-icon.png`), the header lockup `brand/openwiz-lockup.svg` and the 1200×630 social card `brand/og.png` (the lockup on the site ground, rendered from the SVG). The lockup's wordmark is converted to outlines: the SVG has no text and no font reference, and the check refuses one that does, so the wordmark font never ships.

The old README map (`docs/map.png`, and `docs/map-phone.png`) is for GitHub only, and the README no longer shows it: the build never copies it, and the check pins both by hash in `DOC_HASHES` like the icons. Its source is `maps/draw.mjs` in `openwizdev/.github`.

The Geist and Geist Mono fonts ship unmodified with `fonts/OFL.txt`. Keep the licence in source and the static export. The build does not fetch fonts from an external service.

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

## Booking

The booking API (`openwiz.book.v1`) runs on Cloudflare Pages Functions under `functions/api/book/` backed by D1 (`BOOK_DB`, falling back to `ASK_A_WIZ_COUNTERS`):

- `GET /api/book/slots`: lists open 30-minute UTC slots (`Cache-Control: no-store`).
- `POST /api/book`: validates a same-origin JSON booking, checks availability and atomically enforces the booking caps and buffer when inserting into `book_bookings`, writes a Google Calendar event when configured, and sends confirmation email via Resend.
- `POST /api/book/cancel`: cancels an upcoming booking by `id` and `token` (idempotent), deletes any Google Calendar event and sends cancellation email when the booking changes to cancelled.
- `GET /api/book/feed`: lists bookings from 7 days back to the horizon with UTC timestamps to the second. It returns `404` when `BOOK_FEED_TOKEN` is unset, `401` when the bearer token does not match, and `503` when the token matches and booking is off.

**Switch:** `BOOK_MODE` defaults to `off`. Set it to `fake` for local previews or `live` in production.

For local previews, run `node scripts/book-dev.mjs` and open `http://127.0.0.1:8801/book/`. The server defaults to fake mode and uses an in-memory SQLite D1 wrapper with synthetic busy times. In fake mode without a Resend key, the server simulates email delivery and prints the cancel link to its terminal.

**Enable human verification**

1. In the Cloudflare dashboard, open **Turnstile → Add widget**. Choose **Managed** mode and leave pre-clearance off. Add `openwiz.dev` and the booking preview hostname if the widget will be used there. The stable booking preview is `book.wizsite.pages.dev`.
2. In **Workers & Pages → WizSite → Settings → Variables and Secrets**, add the widget's site key as `TURNSTILE_SITE_KEY` and its secret as `TURNSTILE_SECRET_KEY`. Set both in the environment that serves the booking page and deploy it. Put preview credentials in Preview and live credentials in Production. The site key comes from the slots API at runtime.
3. Open `/book/` and submit a test booking on the preview. Verification applies to booking submissions. Unset `TURNSTILE_SECRET_KEY` to disable verification.

For a local test, set `TURNSTILE_SITE_KEY=1x00000000000000000000AA` and `TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA` in an untracked `.dev.vars` file. Run `node --env-file=.dev.vars scripts/book-dev.mjs`. In fake mode the preview server supplies local action and hostname values after Cloudflare accepts a dummy token, since the dummy response omits the action and returns a fixed hostname. Use `2x0000000000000000000000000000000AA` as the secret to test the rejection path.

**Settings and secrets:**

| Name | Secret | Default | Purpose |
| --- | --- | --- | --- |
| `TURNSTILE_SITE_KEY` | No | *(none)* | Public Managed Turnstile widget key served by the slots endpoint when verification is enabled |\n| `TURNSTILE_SECRET_KEY` | Yes | *(none)* | Siteverify key. Setting it requires verification on every booking POST |\n| `BOOK_MODE` | No | `off` | Switch: `off`, `fake`, or `live` |
| `BOOK_DB` | Binding | `ASK_A_WIZ_COUNTERS` | Cloudflare D1 database binding for `book_*` tables |
| `BOOK_TIMEZONE` | No | `America/Los_Angeles` | IANA timezone for working hours and daily caps |
| `BOOK_DAYS` | No | `1,2,3,4,5` | Comma-separated weekdays (`0` Sunday through `6` Saturday) |
| `BOOK_START` | No | `11:00` | Daily opening time (`HH:MM`) |
| `BOOK_END` | No | `18:00` | Daily closing time (`HH:MM`) |
| `BOOK_BUFFER_MIN` | No | `15` | Minutes clear on each side of busy events and bookings |
| `BOOK_NOTICE_HOURS` | No | `4` | Minimum advance notice in hours |
| `BOOK_HORIZON_DAYS` | No | `14` | Days ahead offered for booking and included in the feed |
| `BOOK_MAX_PER_DAY` | No | `4` | Maximum bookings per local day |
| `BOOK_ICAL_URL` | Yes | *(none)* | HTTPS iCal feed URL used in `live` mode when Google credentials are unset |
| `GOOGLE_CLIENT_ID` | Yes | *(none)* | Google OAuth client ID for free/busy reads and event writes |
| `GOOGLE_CLIENT_SECRET` | Yes | *(none)* | Google OAuth client secret |
| `GOOGLE_REFRESH_TOKEN` | Yes | *(none)* | Google OAuth refresh token |
| `BOOK_GOOGLE_CALENDAR` | No | `primary` | Google Calendar ID |
| `RESEND_API_KEY` | Yes | *(none)* | Resend API key; when unset, confirmation and cancel emails are skipped |
| `BOOK_FROM` | No | `OpenWiz <book@openwiz.dev>` | Email `From` header |
| `BOOK_OWNER_EMAIL` | No | *(none)* | Maintainer address notified on booking and cancellation |
| `BOOK_MEETING_URL` | No | *(none)* | Meeting link included in emails, `.ics`, and Google Calendar events |
| `BOOK_FEED_TOKEN` | Yes | *(none)* | Bearer token guarding `GET /api/book/feed` |

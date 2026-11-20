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

`npm run build` copies the public runtime files (pages, fingerprinted styles and scripts, fonts, approved artwork, the sample spec video, vendor licences and the logo files) into `dist/`. The checks require that build first. `npm run check` checks JavaScript syntax, exact build contents, local links and fragments, HTML/CSS resources, font signatures and OFL licences, landing copy, the Changelog (its name, picture, parts and reviewed content), and private markers. `npm test` exercises those gates with synthetic broken links, missing resources and private markers.

To preview locally:

```sh
python3 -m http.server 8800 --bind 127.0.0.1 --directory dist
```

## Cloudflare Pages

Cloudflare Pages deploys from **main**. Configure the repository root as the build root, `npm run build` as the build command, and `dist` as the output directory. Both `/changelog` and `/changelog/` must resolve to `changelog/index.html`.

Changes merge after green CI and one review from the other model family. No per-change maintainer approval is required. This repository contains no deployment credentials or separate deploy workflow; the Pages project owns the Git integration.

## The Changelog's releases

Nobody writes the Changelog's release entries by hand. At every build, `scripts/changelog.mjs` reads the published releases of the three versioned repositories (OpenWiz, WizSkills and WizLoops) from GitHub's public API, unauthenticated, and `build.mjs` adds them to `/changelog/` as a *Releases* section after *What exists today*. It holds one part per repository, in that order. Each part lists every published release from 0.1.0 on, patches included, newest first by version. Each entry shows that release's own notes. WizSkills' notes are its Changesets notes. Drafts, pre-releases and releases before 0.1.0 stay on GitHub.

- **OpenWiz entries list the versions they ship with,** read from a `**Ships with**` line in that release's notes and the list items under it (for example `- WizSkills 0.1.2`). An OpenWiz release whose notes have no such list says so.
- **A part with no release from 0.1.0 on** says "No release yet".
- **A failed read** says the part is missing: a network error, a non-200 answer, an answer that isn't a list of releases, or a published release whose tag isn't a plain version such as `v1.2.3`. The build never fails on it and never shows an empty history.
- **Notes are text.** They are escaped. Code and bold keep their look, and links keep only their words.

The generator's tests (`scripts/test_changelog.py`, run by `npm test`) use the synthetic release lists in `scripts/changelog-fixtures/`. To see the section a fixture case produces, run `node scripts/changelog.mjs --fixtures scripts/changelog-fixtures/full`.

### Owner step: rebuild on each release

A release can trigger a rebuild through a Cloudflare Pages deploy hook. This repository doesn't configure one. Setting it up is the owner's step, once the first versioned release ships:

1. In the Cloudflare dashboard, open the WizSite Pages project, then **Settings → Builds → Deploy hooks**. Add a hook named `release` for the `main` branch, and copy its URL. The URL is a secret: anyone who has it can start a build.
2. In each releasing repository (OpenWiz, WizSkills and WizLoops), add the URL as an Actions secret named `WIZSITE_DEPLOY_HOOK`.
3. In each of them, add a workflow that posts to the hook when a release is published:

   ```yaml
   name: Rebuild openwiz.dev
   on:
     release:
       types: [published]
   permissions: {}
   jobs:
     rebuild:
       runs-on: ubuntu-latest
       steps:
         - run: curl -fsS -X POST "$HOOK"
           env:
             HOOK: ${{ secrets.WIZSITE_DEPLOY_HOOK }}
   ```

4. Publish a release, or re-run the workflow, and check that a new production deployment starts in Pages and that `/changelog/` lists the release.

Without the hook, the Changelog changes only when WizSite itself next deploys.

## Site assets

WizSite owns `tokens.css`. The landing page and the Changelog use it with `site.css`; the Changelog keeps its own styles inline in `changelog/index.html`, so the landing never loads them. The landing also loads the pinned GSAP 3.15.1 core and `site.js`. The build fingerprints these styles and scripts so new HTML gets the matching assets. The GreenSock Standard No Charge licence and the agent icon notices ship in `vendor/`.

The landing page opens on an Ember-style OpenWiz window that walks through one to-do build. Painted WebP costume and crew sprites sit alongside HTML ticket states and an SVG working pulse. Below it are the supported agent logos and three product moments. The spec card plays the real narrated spec video of the to-do app an OpenWiz fleet built (openwizdev/todo-demo, J267); the grill and ship cards link that run's grill questions and the live app, muted and inline while in view, with Play with sound, captions, a poster and a plain link; it loads only when it first plays. The footer's twelve waving Wizes look toward the pointer. The demo pauses off screen, offers a Pause motion control and keeps a readable still when reduced motion is on or either script is unavailable. The install box shows the one line, `Install OpenWiz from github.com/openwizdev/OpenWiz`, with **Paste this into your agent** and a **Copy** button, which stays disabled as **Copy · coming soon** until the box's `data-install` switch in `index.html` reads `live`. Sign in and the phone home-screen instructions lead to the existing app.

`/team` is the **team page**: what you get, who it is for and custom pricing, then three short steps (*What you get*), the drivers by name linking to `/drivers/` (*Where your agents run*) and a closing **Book a call**. Every site page's top bar (the landing, `/drivers`, `/changelog` and `/team`) carries one buy button, **Get it for your team** (**For teams** on phones), to it: one snippet, `header-cta.html`, which the build adds to each page's top bar, so no page keeps its own copy. The booking link has one value: the `href` of the two `data-book` links in `team/index.html`, the hero's and the closing one (Jake's Cal.com booking page). The check accepts only an `https://` URL or the in-page placeholder `#book`, and refuses a booking link on another page, a third one, two that differ, or a price on the team page.

Every site page shares one **footer**, `footer.html`, which the build adds at each page's `<!-- footer.html -->` slot, so no page keeps its own copy: two link groups (Product: Drivers, Changelog, Docs, the app; Company: For teams, GitHub with its star count, X @openwiz), the line "Apache-2.0. Owned by no one.", the wordmark shown whole and the twelve Wizes. Short pages pin it to the bottom of the window. Every site page loads GSAP and `site.js` for it, `/drivers` included, so the star count and the Wizes behave the same everywhere; `/drivers` itself still reads completely without them. The check refuses a page without it or with a second footer; the browser check refuses a clipped wordmark, a painted gap of more than 16 px between its ink and the Wizes, or a footer that ends above the window's bottom. The X account is the one external link allowed off GitHub, and only as the footer's link: never a resource, a CSS `url()` or a second link.

`/faq` is the **Questions** page. The FAQ has one source, `faq.html`: a *Questions* heading with its line, then seven flat rows, each a question on a button that opens its answer. The build adds it at the `<!-- faq.html -->` slot near the bottom of the landing and above `/team`'s closing **Book a call**, and at `/faq`'s `<!-- faq.html h1 -->` slot, where its title becomes the page's h1 and each question an h2. The page ships every answer open and every row's button disabled, so the answers read even if `faq.js` never loads; `faq.js` enables the buttons, closes the answers, then opens and closes them, at once with reduced motion. Its footer link sits in the Product group. The check refuses a page without the snippet, a second copy, a changed or missing question, a row that is not a button naming its answer, an answer linking off the site, and any form or input: the planned "Ask a Wiz..." row is a later change, appended as the last row.

`/changelog` is the **Changelog**. A small picture of how the public repositories fit together opens it, then one *What exists today* section: one part per public repository, each opening with two or three plain sentences, then what a person can use now, written from merged code. Private repositories appear only as "private records and tools". *What exists today* holds no release entries, version numbers or dates. After it, the build adds a generated *Releases* section; see below.

The logo files are the favicons (`favicon.ico` with 16, 32 and 48 px images, `favicon.svg`, `apple-touch-icon.png`), the header lockup `brand/openwiz-lockup.svg` and the 1200×630 social card `brand/og.png` (the lockup on the site ground, rendered from the SVG). The lockup's wordmark is converted to outlines: the SVG has no text and no font reference, and the check refuses one that does, so the wordmark font never ships.

The old README map (`docs/map.png`, and `docs/map-phone.png`) is for GitHub only, and the README no longer shows it: the build never copies it, and the check pins both by hash in `DOC_HASHES` like the icons. Its source is `maps/draw.mjs` in `openwizdev/.github`.

The Geist and Geist Mono fonts ship unmodified with `fonts/OFL.txt`. Keep the licence in source and the static export. The build does not fetch fonts from an external service.

## Privacy and verification limits

CI uses only Node.js, Python's standard library, Git and the checkout/setup Actions, plus `npm ci` for the pinned dependencies below; it builds the landing from the checked-in vendor files.

**npm dependencies** (exact versions in `package.json`, locked in `package-lock.json`; small, maintained and licence-checked, under J187):

| Package | Version | Licence | Size | Why |
| --- | --- | --- | --- | --- |
| `@dagrejs/dagre` (with `@dagrejs/graphlib` 4.0.6, bundled in its file) | 3.1.3 | MIT | 49 KB minified | Lays out a spec's ticket graph in the app: layered, with fewer crossings and routed arrows. The build copies `dist/dagre.min.js` and its `LICENSE` into `dist/app/vendor/`; it makes no network calls |

`scripts/check.py` documents a small case-insensitive denylist of generic private-repository names, owner-home paths, private evidence/decision paths and thread identifiers. It scans tracked and non-ignored source paths and UTF-8 contents, plus the export. Only the denylist declaration itself is exempt from matching its own literals. Bundled font binaries and licences are pinned by hash; each `art/*.webp` must be plain WebP with no EXIF or XMP chunks, and the pinned artwork and spec video share a 2 MB budget; the PNG and ICO logo files are pinned by hash; other binary content and symlinks require review. Personal literal lists and private policy/history tooling are deliberately not copied into this public repository.

This denylist is a tripwire, not comprehensive detection of private names or secrets. Independent review must also assess privacy and unsettled claims. External link destinations are constrained to the public repositories and, in the footer, OpenWiz's X account; CI does not make network availability checks or validate remote fragments.

**Named gap — automated browser tests:** layout/overflow, keyboard and touch navigation, accessibility/contrast and animation/reduced-motion behavior are not covered by CI. The browser smoke check requires no additional project dependency; the app's own browser check (`npm run test:app`) covers its pages and their keyboard path. A browser smoke check is useful evidence but does not close this automated-test gap.

## Sign-in

openwiz.dev/app signs in through the read-only [OpenWiz Viewer](https://github.com/apps/openwiz-viewer) GitHub App (issues, pull requests and metadata, read only). Its client ID and secret live only in the Cloudflare Pages project settings.

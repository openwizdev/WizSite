<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/openwizdev/.github/main/profile/art/mark-dark.svg">
  <img alt="OpenWiz mark" src="https://raw.githubusercontent.com/openwizdev/.github/main/profile/art/mark-light.svg" width="56">
</picture>

# WizSite

**[openwiz.dev](https://openwiz.dev) and [the app](https://openwiz.dev/app/): where you meet [OpenWiz](https://github.com/openwizdev/OpenWiz) and watch your factory ship.** The app signs in with GitHub, read only, and shows your specs, tickets and agents straight from your repo's records. It is a static site; its only server piece is a small sign-in helper that keeps nothing.

**Status:** live at openwiz.dev, before OpenWiz 0.1.0. The landing page's install button says "coming soon" until 0.1.0 ships.

## Quick start

Node.js 24, Python 3.11+ and Git:

```sh
npm ci
npm run build    # writes the site to dist/
npm run check    # links, fonts, copy, privacy markers
npm test
python3 -m http.server 8800 --bind 127.0.0.1 --directory dist
```

Then open http://127.0.0.1:8800.

## How it works

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/openwizdev/.github/main/profile/art/map-dark.png">
  <img alt="How the repos fit: OpenWiz writes records to GitHub, and WizSite's app reads them." src="https://raw.githubusercontent.com/openwizdev/.github/main/profile/art/map-light.png" width="560">
</picture>

- **The landing page** (`index.html`) shows one build, start to finish, with the Wiz crew.
- **The app** (`app/`) reads GitHub's API from your browser through the read-only [OpenWiz Viewer](https://github.com/apps/openwiz-viewer) GitHub App. It never writes. The sign-in helper (`functions/`) swaps GitHub's code for your token and hands it straight back.
- **The Changelog** (`changelog/`) says what exists today, and lists every release of OpenWiz, WizSkills and WizLoops, read from GitHub at build time.
- **Deploy:** Cloudflare Pages builds `main`. Changes merge after green CI and a review from another model family.

The full build, check and deploy notes are in [docs/maintaining.md](docs/maintaining.md).

## Links

- [openwiz.dev](https://openwiz.dev) · [the app](https://openwiz.dev/app/) · [Changelog](https://openwiz.dev/changelog/)
- [OpenWiz](https://github.com/openwizdev/OpenWiz) · [all repos](https://github.com/openwizdev)
- [Apache License 2.0](LICENSE). Fonts, GSAP and icon licences ship in `fonts/` and `vendor/`.

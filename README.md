<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/openwizdev/.github/main/profile/art/wiz.png">
  <img alt="The OpenWiz Wiz" src="https://raw.githubusercontent.com/openwizdev/.github/main/profile/art/wiz.png" width="56">
</picture>

# WizSite

The website for [OpenWiz](https://github.com/openwizdev/OpenWiz), the open source kernel for an agent factory: fleets of coding agents like Claude Code and Codex on your own machines. Latest release: [v0.1.0](https://github.com/openwizdev/OpenWiz/releases/tag/v0.1.0) (2026-11-21).

- **[openwiz.dev](https://openwiz.dev)**: what OpenWiz is, one build start to finish, its drivers and the [Changelog](https://openwiz.dev/changelog/).
- **[openwiz.dev/app](https://openwiz.dev/app/)**: sign in with GitHub, read only, and see your specs, tickets and agents from your repo's records.

## Quick start

Node.js 24, Python 3.11+ and Git:

```sh
npm ci && npm run build   # writes the site to dist/
npm run check && npm test
python3 -m http.server 8800 --bind 127.0.0.1 --directory dist   # http://127.0.0.1:8800
```

## What's here

| Path | What |
| --- | --- |
| `index.html` | The landing page |
| `app/` | The app. It reads GitHub's API from your browser through the read-only [OpenWiz Viewer](https://github.com/apps/openwiz-viewer) GitHub App and never writes. |
| `functions/` | The one server piece: a sign-in helper that swaps GitHub's code for your token and keeps nothing |
| `changelog/` | The Changelog, one data file per release in `changelog/releases/` |

Build, checks, deploy and review rules: [docs/maintaining.md](docs/maintaining.md). How the repos fit: [docs/repos.md](docs/repos.md).

## License

[Apache License 2.0](LICENSE). Font, GSAP and icon licences ship in `fonts/` and `vendor/`.

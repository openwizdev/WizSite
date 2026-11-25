# WizSite

**[openwiz.dev](https://openwiz.dev) and [its app](https://openwiz.dev/app/) for [OpenWiz](https://github.com/openwizdev/OpenWiz), the open source agent factory that runs fleets of coding agents.** The app signs in with GitHub, reads only, and shows your specs, tickets and agents from your repo. It is a static site plus a sign-in helper that stores nothing.

To install OpenWiz ([v0.1.0](https://github.com/openwizdev/OpenWiz/releases/tag/v0.1.0)), paste this into your coding agent: `Install OpenWiz from github.com/openwizdev/OpenWiz`

## Develop

Node.js 24, Python 3.11+, Git:

```sh
npm ci
npm run build    # writes dist/
npm run check
npm test
```

Preview, deploy and checks: [docs/maintaining.md](docs/maintaining.md). How the repos fit: [docs/repos.md](docs/repos.md). [Changelog](https://openwiz.dev/changelog/) · [Apache 2.0](LICENSE)

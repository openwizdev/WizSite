# WizSite

**[openwiz.dev](https://openwiz.dev) and [its app](https://openwiz.dev/app/) for [OpenWiz](https://github.com/openwizdev/OpenWiz), the open source agent factory that runs fleets of coding agents.** OpenWiz 0.01 ([0.1.0](https://github.com/openwizdev/OpenWiz/releases/tag/v0.1.0)) is the current release. The site is static on Cloudflare Pages. The app signs in with GitHub, reads only, and shows your factory from your repository.

To install OpenWiz ([v0.1.0](https://github.com/openwizdev/OpenWiz/releases/tag/v0.1.0)), paste this into your coding agent: `Install OpenWiz from github.com/openwizdev/OpenWiz`

## Pages

- [https://openwiz.dev/](https://openwiz.dev/) is the landing page: the install line, a sample to-do build and the launch film.
- [https://openwiz.dev/what-is-openwiz/](https://openwiz.dev/what-is-openwiz/) says what OpenWiz is.
- [https://openwiz.dev/guides/run-many-coding-agents/](https://openwiz.dev/guides/run-many-coding-agents/) is the guide.
- [https://openwiz.dev/faq/](https://openwiz.dev/faq/) is the questions page.
- [https://openwiz.dev/drivers/](https://openwiz.dev/drivers/) lists drivers.
- [https://openwiz.dev/changelog/](https://openwiz.dev/changelog/) lists public releases.
- [https://openwiz.dev/market/](https://openwiz.dev/market/) lists what plugs into OpenWiz.
- [https://openwiz.dev/team/](https://openwiz.dev/team/) books a call.
- [https://openwiz.dev/pricing/](https://openwiz.dev/pricing/) lists Free and the $5 Supporter plan.
- [https://openwiz.dev/app/](https://openwiz.dev/app/) is the app. Its pages are You, Queue, Specs, Agents, Canvas and Models. A spec's page draws its ticket graph.
- [https://openwiz.dev/404.html](https://openwiz.dev/404.html) is the not-found page.

## Functions

Three Pages functions. None keeps an account.

- `/api/sign-in/start`, `/api/sign-in/token` and `/api/sign-in/refresh` sign in with the read-only OpenWiz Viewer app. Each attempt keeps its PKCE verifier in a short-lived `__Host-` cookie.
- `/api/ask` answers one question from the public docs when Ask a Wiz is on.
- `/api/count` records one named click when click counting is on. It keeps no request body.

## Develop

Node.js 24, Python 3.11+, Git:

```sh
npm ci
npm run build    # writes dist/
npm run check
npm test
```

Preview, deploy and checks: [docs/maintaining.md](docs/maintaining.md). How the repos fit: [docs/repos.md](docs/repos.md). [Changelog](https://openwiz.dev/changelog/) · [Apache 2.0](LICENSE)

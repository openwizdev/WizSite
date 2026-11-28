# The public repositories

How the OpenWiz repositories fit together, and what each one does. This text and picture used to open [openwiz.dev/changelog](https://openwiz.dev/changelog/), which now lists only what each public release shipped. The [org profile](https://github.com/openwizdev) has the current map and one line per repository; each repository's README is its own front page.

![How the repositories fit together. WizSkills gives OpenWiz a pinned release of the skills agents follow, and WizLoops gives it loop files. OpenWiz, the command and kernel, drives your agents’ threads in Cloudroom and reads your specs and tickets on GitHub. WizPlugins shows WizBar and WizDeck inside Cloudroom, and WizSite’s app at openwiz.dev reads GitHub. WizMarket holds the listings the market page reads. Private records and tools sit apart.](repo-map.svg)

Cloudroom and GitHub, dashed, are where your agents and your work live.

## What exists today (November 2026)

Written from the merged code in each public repository. Nothing here is a plan.

### [OpenWiz](https://github.com/openwizdev/OpenWiz#readme)

OpenWiz is the factory’s command and kernel. It reads and drives your coding agents’ threads in Cloudroom, and reads your fleets’ specs and tickets on GitHub. It pins a WizSkills release and reads WizLoops’ loop files.

- `openwiz ls` and `openwiz show` list and open your Cloudroom threads, and only read.
- `openwiz init` saves your project's harness, model and effort and makes its private brain. `openwiz models` shows the models your fleet uses and sets them.
- `openwiz fleets` and `openwiz fleet` show your fleets and each spec’s progress, read from GitHub.
- `openwiz loop` checks loop files, shows what would change, creates or updates one Cloudroom loop, and writes your live loops back to files.
- `openwiz help --agent` lists every command for scripts and agents, and most commands give one clean result with `--json`.

The current release is [OpenWiz 0.01 (0.1.0)](https://github.com/openwizdev/OpenWiz/releases/tag/v0.1.0) for macOS and Linux. It and the earlier pre-releases are on [GitHub](https://github.com/openwizdev/OpenWiz/releases) and trail main. Most of this is tested on synthetic fixtures only.

### [WizSkills](https://github.com/openwizdev/WizSkills#readme)

WizSkills holds the skills: plain instructions, with their scripts and tests, that a coding agent follows. With them, agents grill an idea, plan it into tickets, then build, review and merge each ticket as a fleet.

- One Claude Code plugin, `openwiz`, installed pinned to a release; `install.sh` installs the same release for Codex or any other agent.
- 22 skills, each a folder named in [skills/README.md](https://github.com/openwizdev/WizSkills/blob/main/skills/README.md) (read 2026-11-26): `ask-wiz`, `build-ticket`, `diagnose`, `dream-cycle`, `feedback`, `grill`, `handoff`, `hill-climb`, `huntr`, `image`, `install`, `launch-fleet`, `research`, `review-ticket`, `setup`, `son-of-anton`, `to-spec`, `to-tickets`, `triage`, `wayfind`, `where-are-we` and `write-driver`.
- The path through a build is `grill`, `to-spec`, `to-tickets`, `build-ticket`, `review-ticket` and `launch-fleet`. `install` and `setup` put them in place.

Each release has its own notes on [WizSkills’ GitHub releases](https://github.com/openwizdev/WizSkills/releases).

### [WizLoops](https://github.com/openwizdev/WizLoops#readme)

WizLoops keeps an agent’s loops as files: one Markdown file per loop, saying when it wakes, what it checks first and what the agent is told. It holds the format, a starter catalog with each loop's check script, and the rules for Cloudroom. OpenWiz’s `openwiz loop` commands read these files.

- The loop file format, with its JSON schema and fixtures.
- Five starter loops: `fleet-check`, `hourly-status`, `morning-digest`, `stall-sweep` and `workflow-kick`.
- The Cloudroom adapter rules: what maps to a Cloudroom loop, and what is refused rather than faked.
- CI checks every catalog loop and fixture with `openwiz loop validate`.

Cloudroom is the only adapter so far.

### [WizPlugins](https://github.com/openwizdev/WizPlugins#readme)

WizPlugins holds plugins that show the factory inside Cloudroom. Its one plugin so far, WizBar, is a sidebar of your agents’ threads with their issues, pull requests and child threads. WizDeck is the home panel WizBar opens in a thread: Needs you, versions and specs, and merges today, read from GitHub.

- WizBar’s cards link each thread’s issue or pull request and count its child threads; hover to list them.
- A running card with a live count of every running thread, and drag to pin.
- Every WizBar action is also a `room-cli wizbar` command with JSON.
- Install WizBar from the [BB Marketplace](https://getbb.app/marketplace/wizbar) (serving [0.7.0](https://github.com/openwizdev/WizPlugins/releases/tag/wizbar/v0.7.0)), or [from source](https://github.com/openwizdev/WizPlugins). Fixture tests prove the plugin.

### [WizMarket](https://github.com/openwizdev/WizMarket#readme)

WizMarket is the registry behind [openwiz.dev/market](https://openwiz.dev/market): one JSON file per listing, added by pull request. A listing is a driver, a harness, a skill or anything else that plugs into OpenWiz. **Verified** means it passed its kind’s test. The org profile’s public set is these six: OpenWiz, WizSkills, WizLoops, WizPlugins, WizMarket and WizSite.

### [WizSite](https://github.com/openwizdev/WizSite#readme)

WizSite is openwiz.dev. It is a static site on Cloudflare Pages. The app reads GitHub from your browser. OpenWiz 0.01 (0.1.0) is the current release, and the landing install box is live: **Copy** copies `Install OpenWiz from github.com/openwizdev/OpenWiz`.

- [The landing page](https://openwiz.dev/) walks through a sample to-do build and the agents OpenWiz works with.
- The other pages are [What is OpenWiz?](https://openwiz.dev/what-is-openwiz/), [the guide](https://openwiz.dev/guides/run-many-coding-agents/), [FAQ](https://openwiz.dev/faq/), [Drivers](https://openwiz.dev/drivers/), [Changelog](https://openwiz.dev/changelog/), [Market](https://openwiz.dev/market/), [For your team](https://openwiz.dev/team/) and [Pricing](https://openwiz.dev/pricing/).
- [openwiz.dev/app](https://openwiz.dev/app/): sign in with GitHub through the OpenWiz Viewer app, pick a repository, and put the app on your phone’s home screen.
- The app’s pages are You, Queue, Specs, Agents, Canvas and Models. You counts work needing you, building, in review and merged, then the specs to confirm, plans to approve and tickets waiting on you. Specs shows each open spec’s progress, and each spec’s page draws its ticket graph. Agents uses status notes to show agents at work and agents that finished or stopped in the last day. Queue, Canvas and Models are the newer pages.
- Three functions: `/api/sign-in/start`, `/api/sign-in/token` and `/api/sign-in/refresh` for sign-in; `/api/ask` for Ask a Wiz; `/api/count` for a named click. None keeps an account.

# The public repositories

How the OpenWiz repositories fit together, and what each one does. This text and picture used to open [openwiz.dev/changelog](https://openwiz.dev/changelog/), which now lists only what each public release shipped. The [org profile](https://github.com/openwizdev) has the current map and one line per repository; each repository's README is its own front page.

![How the repositories fit together. WizSkills gives OpenWiz a pinned release of the skills agents follow, and WizLoops gives it loop files. OpenWiz, the command and kernel, drives your agents’ threads in Cloudroom and reads your specs and tickets on GitHub. WizPlugins shows WizBar inside Cloudroom, and WizSite’s app at openwiz.dev reads GitHub. Private records and tools sit apart.](repo-map.svg)

Cloudroom and GitHub, dashed, are where your agents and your work live.

## What exists today (November 2026)

Written from the merged code in each public repository. Nothing here is a plan.

### [OpenWiz](https://github.com/openwizdev/OpenWiz#readme)

OpenWiz is the factory’s command and kernel. It reads and drives your coding agents’ threads in Cloudroom, and reads your fleets’ specs and tickets on GitHub. It pins a WizSkills release and reads WizLoops’ loop files.

- `openwiz ls` and `openwiz show` list and open your Cloudroom threads, and only read.
- `openwiz send` sends one message to a thread, queued or as a steer. `openwiz new` starts one new thread, and only with `--yes`. Both can attach files.
- `openwiz fleets` and `openwiz fleet` show your fleets and each spec’s progress, read from GitHub.
- `openwiz loop` checks loop files, shows what would change, creates or updates one Cloudroom loop, and writes your live loops back to files.
- `openwiz help --agent` lists every command for scripts and agents, and most commands give one clean result with `--json`.
- `openwiz-server` serves a web view on your own computer: your threads, fleets, the plan, decisions waiting on you, and loops.
- `openwiz-service` keeps that web view running on a PC and runs its registered jobs on a schedule.

Prebuilt pre-releases for macOS and Linux are on [OpenWiz’s GitHub releases](https://github.com/openwizdev/OpenWiz/releases), and trail main. Most of this is tested on synthetic fixtures only.

### [WizSkills](https://github.com/openwizdev/WizSkills#readme)

WizSkills holds the skills: plain instructions, with their scripts and tests, that a coding agent follows. With them, agents grill an idea, plan it into tickets, then build, review and merge each ticket as a fleet.

- One Claude Code plugin, `openwiz`, installed pinned to a release; `install.sh` installs the same release for Codex or any other agent.
- `grill`, `build-ticket`, `review-ticket` and `launch-fleet`: question an idea, build one ticket, review its pull request, and run the fleet.
- Helpers for the work around it: `wayfind`, `research`, `diagnose`, `where-are-we`, `handoff` and `triage`.

Each release has its own notes on [WizSkills’ GitHub releases](https://github.com/openwizdev/WizSkills/releases).

### [WizLoops](https://github.com/openwizdev/WizLoops#readme)

WizLoops keeps an agent’s loops as files: one Markdown file per loop, saying when it wakes, what it checks first and what the agent is told. It holds the format, a starter catalog and the rules for Cloudroom, and no code. OpenWiz’s `openwiz loop` commands read these files.

- The loop file format, with its JSON schema and fixtures.
- Five starter loops: `fleet-check`, `hourly-status`, `morning-digest`, `stall-sweep` and `workflow-kick`.
- The Cloudroom adapter rules: what maps to a Cloudroom loop, and what is refused rather than faked.
- CI checks every catalog loop and fixture with `openwiz loop validate`.

Cloudroom is the only adapter so far.

### [WizPlugins](https://github.com/openwizdev/WizPlugins#readme)

WizPlugins holds plugins that show the factory inside Cloudroom. Its one plugin so far, WizBar, is a sidebar of your agents’ threads with their issues, pull requests and child threads.

- WizBar’s cards link each thread’s issue or pull request and count its child threads; hover to list them.
- A running count with a stats panel, and drag to pin.
- Every WizBar action is also a `room-cli wizbar` command with JSON.

Not in the plugin marketplace yet: [install it from source](https://github.com/openwizdev/WizPlugins). Fixture tests prove it; its check on a real Cloudroom is still open.

### [WizSite](https://github.com/openwizdev/WizSite#readme)

WizSite is openwiz.dev: the landing page, this changelog and the app. It is a static site on Cloudflare Pages with one small sign-in helper, and the app reads GitHub from your browser.

- [The landing page](https://openwiz.dev/) walks through a sample to-do build and the agents OpenWiz works with. Its Install button says coming soon.
- [openwiz.dev/app](https://openwiz.dev/app/): sign in with GitHub through the read-only OpenWiz Viewer app, pick a repository, and put the app on your phone’s home screen.
- You shows what needs you: counts of work needing you, building, in review and merged, then the specs to confirm, plans to approve and tickets waiting on you, each linked to GitHub.
- Specs shows each open spec’s progress, and each spec’s page draws its ticket graph.
- The Agents page is a placeholder for now.

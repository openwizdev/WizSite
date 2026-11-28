# Install OpenWiz

Paste this one line into the coding agent you already use (Claude Code, Codex or another):

> Install OpenWiz from github.com/openwizdev/OpenWiz

The agent follows the [install skill](https://github.com/openwizdev/WizSkills/blob/v0.4.0/skills/install/SKILL.md). This page says what it does, the commands it runs, what it may change, and how to recover or remove it.

Using Grok Bot? See [Grok Bot + OpenWiz](grok-bot.md).

**Status:** this is the install for OpenWiz 0.1.1 ("OpenWiz 0.02"), which is coming and not released yet; the current release is OpenWiz 0.1.0. CloudRoom is optional: setup is done when GitHub's sign-in is verified, and CloudRoom's sign-in too only if you pick CloudRoom. Installing today? Follow [OpenWiz 0.1.0](#openwiz-010) at the end.

## Before you start

- **A supported computer:** macOS on Apple silicon or Intel, or Linux on x86_64 with glibc 2.34 or later (`ldd --version` shows it). Linux on ARM is not supported. **An Intel Mac installs with no CloudRoom,** on 0.1.1 and on 0.1.0 alike: preflight reads it ready. CloudRoom has no Intel Mac build, so on an Intel Mac, agents run on this computer or on boat.dev. On Linux older than glibc 2.39, `openwiz` may print a `GLIBC_2.39` warning and still work.
- **Python 3.9 or later, `git`, and the GitHub CLI** (`gh`, signed in with `gh auth login`).
- **Where your agents run,** asked first, before anything else: this computer, boat.dev or CloudRoom. CloudRoom is optional: only the CloudRoom choice needs it installed.
  - **This computer:** the Claude Code or Codex you're signed in to, and your `gh` login. Nothing else to sign in to.
  - **boat.dev:** its `boat` CLI, which you install and sign in to yourself, and in boat.dev's dashboard your GitHub account connected with write access to the repository, and your Claude Code or Codex key or account login. It bills per second while a sandbox runs, on your plan.
  - **CloudRoom:** installed, opened once and signed in (opening it once creates its `room-cli`).
- **For the automatic fleet on this computer or boat.dev:** `jq`, and Claude Code or Codex installed on this computer, because the heartbeat's GitHub check runs here even when your agents run on boat.dev. The orchestrator it starts runs on the host you chose: on this computer, or in a boat.dev sandbox, billed per second like the builders.

## What happens, in order

The agent runs each command itself and reads its JSON. `<root>` is the install folder, by default `~/.local/lib/openwiz`: use a new or empty folder that holds nothing else, because the installer also accepts a folder that already has other files in it. If you give `install install` a separate `--state-root`, it too must be a new or empty folder used by OpenWiz alone, never one shared with another app. `<target>` is `aarch64-apple-darwin`, `x86_64-apple-darwin`, `x86_64-unknown-linux-gnu` or `aarch64-unknown-linux-gnu`.

1. **Preflight.** It clones this repository at the `v0.1.1` tag into a private temporary folder as `$openwiz` (`git clone --depth 1 --branch v0.1.1 https://github.com/openwizdev/OpenWiz "$openwiz"`) and checks this computer: Python, a supported system, free disk space, and whether `room-cli`, `gh` and `git` are installed. It reads only; anything missing comes with its next step. A missing `room-cli` never stops it: it says CloudRoom is optional, needed only if you pick it. On an Intel Mac it reads ready and notes that agents run on this computer or on boat.dev.

   ```sh
   python3 -I "$openwiz"/tools/install/install preflight
   ```

2. **Verified download and install.** It downloads the release's checksum file, manifest and package from GitHub and checks the package's SHA-256 hash against the manifest before using it. No Rust, Node or source build is needed. A hash proves the files are the release's files; it is not a publisher signature. A failed check changes nothing, and an earlier install keeps working.

   ```sh
   python3 -I "$openwiz"/tools/install/install download --target <target> --dir <new private folder>
   python3 -I "$openwiz"/tools/install/install install --assets <that folder> --target <target> --root <root>
   ```

   `install` prints `"activated": true`, the version, and the `build` and `state_root` folders, written below as `<build>` and `<state>`. `download` reads GitHub's Latest release, which will be OpenWiz 0.1.1 once it is out; if it refuses with "could not be completed safely", check the [releases page](https://github.com/openwizdev/OpenWiz/releases). The same three files will be under `https://github.com/openwizdev/OpenWiz/releases/download/v0.1.1/` once 0.1.1 is out: `openwiz-<target>.sha256`, `openwiz-<target>.manifest.json` and `openwiz-0.1.1-<target>.tar.gz`. Put them in a new private folder (mode 700, files 600) and run `install install --assets` on it; it checks every hash the same way.

   Then it proves the build: `<root>/current/openwiz --build-identity` prints the version (`0.1.1`) and the source commit. The `openwiz` program lives there, not on your `PATH`: typing `openwiz` alone says "command not found".

3. **Setup and logins.** Nothing opens in a browser by itself: the agent reads each connection with one check, run from the installed build, and reruns it after each change.

   ```sh
   OPENWIZ_STATE_DIR=<state> python3 -I -B <build>/runtime/setup/setup.py check --state-dir <state>
   ```

   It prints one code per part: `cloudroom`, `personal_github`, `github_app`, `harness` and `project`. On a new computer expect codes such as `app_missing`, `harness_unselected`, `identity_unselected` and `project_unprepared`: those wait until you pick a repository. A connection is ready only when a check proves it, never because a setting was saved.

   - **CloudRoom,** only if you pick it; otherwise skip this row, and no `cloudroom_*` code `check` prints blocks the install: `runtime/cloudroom/cloudroom.py status` reads whether CloudRoom is installed and signed in; `runtime/cloudroom/cloudroom.py install` shows CloudRoom's published installer and its checksum and waits for your yes; `runtime/cloudroom/cloudroom.py sign-in` opens CloudRoom's own sign-in once, where you sign in yourself. Each takes `--state-dir <state>`. CloudRoom is done when `check` reads `cloudroom_login_verified`.
   - **GitHub:** `runtime/setup/github_login.py sign-in --state-dir <state>` reuses your existing `gh` login, or shows what GitHub's own browser sign-in will do and waits for your yes. You paste no token.
   - **`identity_unreadable`** (for `personal_github`): GitHub's answer could not be read just then. Wait a minute and run `check` again; it usually clears.

4. **Skills into your agents, then a restart.** Only now, with setup checked and the logins done, it copies OpenWiz's skills from the 0.1.1 package (WizSkills 0.4.0) into each agent found on this computer: `~/.claude/skills` (Claude Code), `~/.codex/skills` (Codex), `~/.cursor/skills` (Cursor), `~/.config/opencode/skills` (OpenCode) and `~/.grok/skills` (Grok). A skill of yours with the same name stops the step before anything is written.

   ```sh
   python3 -I "$openwiz"/tools/install/install skills --root <root>
   ```

   Your agent finds the skills the next time it starts. Restart it (a new session), then paste the one message for your host: `continue the OpenWiz install with host local` (this computer), `with host boat` (boat.dev) or `with host cloud` (CloudRoom). It resumes at the first unfinished step, from the installed files.

5. **Explain.** A few sentences on ideas, grills, specs, tickets, builders, independent review and merges.
6. **First fleet.** The same agent continues through the install skill's first-fleet section when you want to try it:
   - It offers a few quick ideas and a new private demo repository, or one of yours. That one repository is used from here on.
   - It connects GitHub for that repository. Then you choose your own OpenWiz App (Create, then Install on that repository only) or skip it. If you skip it, your personal GitHub login acts for the factory and setup says so; the App is never shown as verified.
   - It saves the project with your harness, model and effort, asked once, and makes its private brain (`openwiz init`): in your repository if it is private, or in a new private companion repository if it is public. It tells you where in one line and opens a pull request you merge.
   - On this computer it asks you once for each harness's permission mode, and never picks one for you. For this computer or boat.dev it opens one pull request naming the host, which you merge.
   - It grills you briefly and plans 4 to 7 small tickets. You confirm the spec, then approve the exact plan, as two separate answers.
   - It shows the start, naming the host and what it can cost. Only your yes to that starts anything.
   - In 0.1.1 the automatic fleet runs on this computer, on boat.dev or in CloudRoom. **With CloudRoom,** it runs in one fleet thread with its own loop, which starts the approved tickets' builders and their reviewers, and your yes covers its Cloud Credits. **With this computer or boat.dev,** a local heartbeat runs it instead: a scheduled job on this computer (launchd on macOS, a systemd user timer or cron on Linux), shown first and installed on your yes. It checks GitHub from this computer every ten minutes and starts or wakes the fleet's orchestrator only when work is due, on the host you chose: here, or in a boat.dev sandbox, billed per second. Saying "run the fleet now" runs the same check at once while the job is active; a paused job skips it until `resume`. The orchestrator starts builders, and reviewers through the same driver: a reviewer from the other family when you have both Claude Code and Codex, and with only one, a review by the same family, marked "same-family review".

## What it may change, and when

- **Nothing without your yes.** Before signing in, creating or skipping the GitHub App, saving project settings, creating the brain, setting up phone access or starting agents, the agent shows exactly what will happen and waits for your yes to that.
- **Installing is not approving work.** Saying yes to the install or setup approves no plan. Agents start only after you confirm a spec and approve its plan.
- **Your files.** The install writes only to its own folder (by default `~/.local/lib/openwiz`), its private state inside it, and OpenWiz's skills in your agents' skill folders (step 4). Existing settings, credentials and skills of your own are never replaced.
- **GitHub.** Your own OpenWiz App is private to your account and installed only on repositories you select, with read access to metadata, checks and actions and write access to contents, issues and pull requests. Your personal login acts only if you explicitly skip the App; an App that fails or is removed never switches to it on its own.
- **Credentials.** Never paste a key or token into the chat. **This computer** uses the Claude Code or Codex and `gh` logins you already have. **boat.dev** uses what you connect in its dashboard: your GitHub account with write access, and your Claude Code or Codex key or account login; OpenWiz touches none of it. **Your OpenWiz App's key,** if you create the App, is kept by setup in owner-only state on this computer (`<state>/service/app/`). With **CloudRoom**, if setup asks you for the App's key, paste it only into CloudRoom's secret prompt.
- **Cost.** OpenWiz stays free and open source. Every tier gets the same software, features and support; optional monthly supporter tiers ($1, $10, and $100 Business) are cosmetic only. CloudRoom and model charges are separate and not included. On this computer, agents use your own Claude Code or Codex plan. boat.dev bills its sandboxes per second on your boat.dev plan. If you pick CloudRoom, its cloud agents, including each fleet thread, use your CloudRoom Cloud Credits. Your model provider bills you directly. More credits are CloudRoom's own plan, bought from [CloudRoom](https://cloudroom.dev/pricing), not from OpenWiz. Referral verification is unavailable. No referral is applied.

## If it is interrupted or fails

Start a new session of your agent and say "continue the OpenWiz install": every step checks what is already done before doing anything. A repeated install reuses the verified build. A refused install or update leaves the last good build in use. Setup, sign-in, App and brain steps remember their operation, so an interrupted step is finished or replaced, never done twice; an unclear result is checked before anything is retried.

`install status --root <root>` checks the installed build against its manifest. If it reports `installed asset mismatch`, a file in the build was changed, and installing the same release again refuses the same way. To repair it and keep your settings, delete only the `<root>/current` link and the one build folder it points to (`<build>`, inside `<state>/service/builds/`), and nothing else in `<state>/service/`. Then run step 2's `install install` again. If a connection shows a code that is not ready, follow its step above, then run `setup.py check` again.

## Remove it

Ask the agent to remove OpenWiz. It goes in this order:

- **First, the heartbeat,** if a fleet runs on this computer or boat.dev. From the installed launch-fleet skill's folder (for example `~/.claude/skills/launch-fleet`), `python3 -I scripts/heartbeat.py status <owner>/<repo> <spec>` shows the job. `heartbeat.py pause <owner>/<repo> <spec>` stops it for now (`resume` brings it back). `heartbeat.py remove <owner>/<repo> <spec>` takes down the schedule, stops the fleet's orchestrator and deletes the heartbeat's state. Remove each one before deleting OpenWiz's files, or the job keeps running.
- **Then the install:** `python3 -I "$openwiz"/tools/install/install remove --root <root>` (from a 0.1.1 clone, as in step 1; add `--state-root <state>` if you gave one) previews exactly what OpenWiz made: the `current` link, `channel.json`, `install.lock`, its marked skill copies in `<root>/skills`, the verified builds and its settings in `<state>`. With `--yes` it deletes exactly those, then removes each folder left empty. Anything else stays, links are never followed, and it refuses while an install or update is running.
- **The skill copies in your agents stay:** `install remove` lists, for each agent, a `path` (a shared folder such as `~/.claude/skills`) and the `names` of OpenWiz's skill folders inside it. Remove just those named folders inside each `path`, never the listed folder itself: it also holds your own skills.
- Your repositories, branches, pull requests and CloudRoom threads are your work and are never deleted.

**Removing OpenWiz from this computer does not revoke its access.** To revoke it:

- uninstall OpenWiz's GitHub App, or remove repositories from it, in your GitHub settings;
- delete any Cloudflare Tunnel and Access application, or Tailscale rule, made for phone access;
- delete a fleet thread's loop in CloudRoom when you no longer want that fleet to run;
- remove each local heartbeat (`heartbeat.py remove`), as above, when a fleet runs on this computer or boat.dev.

## OpenWiz 0.1.0

OpenWiz 0.1.0 ("OpenWiz 0.01") also installs with no CloudRoom, on Apple silicon, an Intel Mac or Linux on x86_64. Its steps differ: its [install skill](https://github.com/openwizdev/WizSkills/blob/33eef93ba30cd8db256f6fe270e3ed28747a79bd/skills/install/SKILL.md) (WizSkills `maint/0.2`, version 0.2.2) clones the `v0.1.0` tag, installs the 0.1.0 files (build identity `0.1.0`), and after `install skills` replaces each agent's packaged `install` skill with that fixed copy. On 0.1.0 the automatic fleet runs in CloudRoom; without CloudRoom you plan (grill, spec, tickets), start each builder by hand on this computer or on boat.dev, and review and merge its pull request yourself. 0.1.0 has no `install remove`: its install skill lists exactly what to delete.

Today 0.1.0 is GitHub's Latest release, so 0.1.0's `download` step fetches 0.1.0. Once 0.1.1 is the Latest release, that step fetches 0.1.1, and 0.1.0's installer has no `--version`. Then select 0.1.0 explicitly instead of running `download`: put its three files from `https://github.com/openwizdev/OpenWiz/releases/download/v0.1.0/` (`openwiz-<target>.sha256`, `openwiz-<target>.manifest.json` and `openwiz-0.1.0-<target>.tar.gz`) in a new private folder (mode 700, files 600), then run `python3 -I "$openwiz"/tools/install/install install --assets <that folder> --target <target> --root <root>` from the `v0.1.0` clone. It checks every hash, and `<root>/current/openwiz --build-identity` reads `0.1.0`.

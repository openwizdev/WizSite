# Install OpenWiz

Paste this one line into the coding agent you already use (Claude Code, Codex or another):

> Install OpenWiz from github.com/openwizdev/OpenWiz

The agent follows the [install skill](../skills/install/SKILL.md). This page says what it does, what it may change, and how to recover or remove it.

Using Grok Bot? See [Grok Bot + OpenWiz](grok-bot.md).

**Status:** the install journey is tested on synthetic fixtures only. A real install on a fresh machine, and the time it takes, are not yet verified.

## What happens, in order

1. **Preflight.** The agent checks this computer: Python 3.9 or later, a supported system (macOS on Apple silicon or Intel, or Linux on x86_64), free disk space, and whether CloudRoom's `room-cli`, `gh` and `git` are installed. It reads only; nothing is installed or changed. Anything missing comes with its next step.
2. **Verified install.** It downloads the latest OpenWiz release from GitHub and checks every file's SHA-256 hash against the release's manifest before using it. No Rust, Node or source build is needed. A hash proves the files are the release's files; it is not a publisher signature. A failed check changes nothing, and an earlier install keeps working.
3. **Setup and connections.** It opens the setup page on your own computer (`http://127.0.0.1:7370/setup`) and checks each connection on its own. Existing CloudRoom sign-ins and harnesses are reused. A connection is ready only when a check proves it, never because a setting was saved. There is no engine to choose.
4. **Explain.** A few sentences on ideas, grills, specs, tickets, builders, independent review and merges.
5. **First fleet.** The same agent continues through [install's first-fleet branch](../skills/install/SKILL.md#5-first-fleet) when you want to try it:
   - It offers a few quick ideas and a new private demo repository, or one of yours. That one repository is used from here on.
   - It connects GitHub for that repository: your existing login is reused, or GitHub's own browser sign-in opens (no token is pasted). Then you choose your own OpenWiz App (Create, then Install on that repository only) or skip it. If you skip it, your personal GitHub login acts for the factory and setup says so; the App is never shown as verified.
   - It saves the project with your harness, model and effort, asked once, and makes its private brain (`openwiz init`): in your repository if it is private, or in a new private companion repository if it is public. It tells you where in one line and opens a pull request you merge.
   - It grills you briefly and plans 4 to 7 small tickets. You confirm the spec, then approve the exact plan, as two separate answers.
   - It asks where the agents run, then shows the start: one fleet thread with its own loop, which starts the approved tickets' builders and their reviewers. Only your yes to that starts anything, and that yes covers its Cloud Credits.

## What it may change, and when

- **Nothing without your yes.** Before signing in, creating or skipping the GitHub App, saving project settings, creating the brain, setting up phone access or starting agents, the agent shows exactly what will happen and waits for your yes to that.
- **Installing is not approving work.** Saying yes to the install or setup approves no plan. Agents start only after you confirm a spec and approve its plan.
- **Your files.** The install writes only to its own folder (by default `~/.local/lib/openwiz`) and its private state inside it. Existing settings and credentials are never replaced.
- **GitHub.** Your own OpenWiz App is private to your account and installed only on repositories you select, with read access to metadata, checks and actions and write access to contents, issues and pull requests. Your personal login acts only if you explicitly skip the App; an App that fails or is removed never switches to it on its own.
- **Credentials.** Keys stay in owner-only storage: OpenWiz's private state on this computer, or CloudRoom's own secret store. If setup asks you for the App's key, paste it only into CloudRoom's secret prompt. Never paste a key or token into the chat.
- **Cost.** OpenWiz stays free and open source. Supporter is $5 per month for priority support and to support the project, and it adds nothing else. CloudRoom and model charges are separate and not included. Cloud agents, including each fleet thread, use your CloudRoom Cloud Credits, and your model provider bills you directly. More credits are CloudRoom's own plan, bought from [CloudRoom](https://cloudroom.dev/pricing), not from OpenWiz. Referral verification is unavailable. No referral is applied.

## If it is interrupted or fails

Ask the agent to continue: every step checks what is already done before doing anything. A repeated install reuses the verified build. A refused install or update leaves the last good build in use. Setup, sign-in, App and brain steps remember their operation, so an interrupted step is finished or replaced, never done twice; an unclear result is checked before anything is retried.

If the setup page does not open, ask the agent to check the install's status and open setup again. If a connection shows refused or unknown, follow its next step, then check again.

## Remove it

Ask the agent to remove OpenWiz. It stops only this installation's own setup server, then deletes the install folder. It keeps your settings unless you ask it to delete them too. Your repositories, branches, pull requests and CloudRoom threads are your work and are never deleted.

**Removing OpenWiz from this computer does not revoke its access.** To revoke it:

- uninstall OpenWiz's GitHub App, or remove repositories from it, in your GitHub settings;
- delete any Cloudflare Tunnel and Access application, or Tailscale rule, made for phone access;
- delete a fleet thread's loop in CloudRoom when you no longer want that fleet to run.

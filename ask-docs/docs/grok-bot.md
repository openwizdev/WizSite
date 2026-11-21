# Grok Bot + OpenWiz

Grok Bot is xAI's always-on assistant, with its own cloud computer. This page shows how a Grok Bot user adds the OpenWiz skills, asks a first question and runs a first fleet. It also says what works today and what comes later.

**Status:** not yet tried end to end on a real Grok Bot. The steps follow Grok Bot's own docs and public code. Steps marked untested have not been run.

## What you get

- The OpenWiz skills inside your Bot, for the talking side of the work: grill an idea, plan it into a spec and tickets, research a question, ask where things stand.
- Your Bot reads and writes your GitHub repository through Grok Bot's GitHub app.
- Builders still run the normal way, from your coding agent on your computer.

## Before you start

- A plan that includes Grok Bot: The X Subscription Premium ($30 a month) or higher, or a paid legacy Cursor plan. Separately, SuperGrok or X Premium+ subscribers can link that plan with **Link Grok Account**. See [Get started](https://docs.x.ai/grok-bot/get-started#which-plans-include-grok-bot).
- The Grok Bot app for desktop or mobile, from [x.ai/bot](https://x.ai/bot).
- One GitHub repository to try it on. A new private demo repository is best.

## Steps

Every sign-in and connection below is your own click. OpenWiz never touches a login.

1. **Install the app and sign in.** Open the Grok Bot app and choose Sign in. Finish in the browser. If you link a Grok plan, choose **Link Grok Account** yourself.
2. **Connect GitHub.** Add Grok Bot's GitHub app. It acts as the GitHub account you authorize. Check what access it asks for, and go on only if you can limit it to your demo repository.
3. **Add the OpenWiz skills from one pinned source.** The skills run scripts that sit beside each skill file, so the text and the scripts must come from the same version. Ask your Bot:

   > On your computer, run `git clone --depth 1 --branch v0.1.2 https://github.com/openwizdev/WizSkills`. Save each `skills/<name>/SKILL.md` in it as a skill. When you use one, read it from that folder and run its scripts from there.

   `v0.1.2` is the version this OpenWiz release uses. A terminal command may stop on an **Allow / Skip** card. Allow it only if it is that command. Untested.
4. **Ask a first question.** For example:

   > Use the grill skill on: a small idea for my repository

   Or ask "Use ask-wiz: what should I do first?"

**About grok-bot.directory.** OpenWiz is submitted for listing on [grok-bot.directory](https://grok-bot.directory). The listing is pending and not yet checked. Install only from the pinned `v0.1.2` clone in step 3.

## Run a first fleet

Today a fleet starts from your computer, not from Grok Bot. In Claude Code or Codex, paste:

> Install OpenWiz from github.com/openwizdev/OpenWiz

Then follow [Install OpenWiz](install.md) and [Your first hour](first-hour.md). The fleet runs on CloudRoom. Your Bot may be able to follow it through the same GitHub issues and pull requests, for example "Use where-are-we on my repository". Untested.

## What works today, in 0.1.1 and later

| When | What | Status |
| --- | --- | --- |
| Today | `v0.1.2` skills in Grok Bot for talking work: grill, plan-graph, research, where-are-we, ask-wiz | Untested end to end |
| Today | A first fleet from Claude Code or Codex | The normal install path |
| Today | Your Bot watching that fleet through GitHub | Untested |
| 0.1.1 | Grok Bot as the orchestrator that starts builders ([#1396](https://github.com/openwizdev/OpenWiz/issues/1396)) | A planned proof |
| Later | Grok Bot as a builder that OpenWiz starts, wakes and stops | Not planned for 0.1.x: Grok Bot's public docs show no API to address or stop one run |

## Safety

- **Never paste a key or token into the chat.** Use Grok Bot's own secret prompt if a tool needs one.
- **The Bot uses the GitHub account you authorize.** How its comments and pull requests show on GitHub is unverified. Connect it only to the repository you want it to touch.
- **This recipe leaves the X plugin disconnected.** Nothing here posts to X.
- **Two separate ways to undo it.** Delete the OpenWiz skills in your Bot to stop using them. Revoke the GitHub app's access, or remove the repository from it, in your GitHub settings to stop it touching your code.

# Fleet settings

Every fleet that works in this repository starts from these settings. The fleet skills read this file instead of naming any project's agents, commands or rules. Each value names its source; when a source changes, run the `setup` skill again (or edit the line by hand) so the two agree. Keep the machine-read table headings, columns and agent rows unchanged.

WizSite's tickets live in the OpenWiz tracker (`issue-tracker.md`), so its agents are OpenWiz's.

## Builder

One per ticket. It builds its ticket on its own branch, and never reviews or merges.

| Setting | Value | `room-cli thread spawn` flag |
| --- | --- | --- |
| Harness | Claude Code | `--provider claude-code` |
| Model | Opus 5.5 | `--model claude-opus-5-5` |
| Effort | High | `--reasoning-level high` |

Source: [OpenWiz's Builder](https://github.com/openwizdev/OpenWiz/blob/main/docs/agents/fleet.md#builder).

## Builder for small tickets

Tickets with an exact `polish`, `huntr` or `proposal` label use this table; every other ticket uses `## Builder`.

| Setting | Value | `room-cli thread spawn` flag |
| --- | --- | --- |
| Harness | Codex | `--provider codex` |
| Model | Sol 6.1 | `--model gpt-6.1-sol` |
| Effort | High | `--reasoning-level high` |

Source: [OpenWiz's Builder for small tickets](https://github.com/openwizdev/OpenWiz/blob/main/docs/agents/fleet.md#builder-for-small-tickets).

## Reviewer for Claude-built

One per pull request, from a different model family than the builder. It reviews the exact head and never edits. If it can't be started, the review waits: it is never swapped for another model.

| Setting | Value | `room-cli thread spawn` flag |
| --- | --- | --- |
| Harness | Codex | `--provider codex` |
| Model | Sol 6.1 | `--model gpt-6.1-sol` |
| Effort | High | `--reasoning-level high` |

Source: [OpenWiz's Reviewer for Claude-built](https://github.com/openwizdev/OpenWiz/blob/main/docs/agents/fleet.md#reviewer-for-claude-built).

## Reviewer for GPT-built

Use the verified builder's provider, from its branch-matching `start checked` record and that exact thread's provider read. Unknown or conflicting family waits; existing reviewers retain their thread.

| Setting | Value | `room-cli thread spawn` flag |
| --- | --- | --- |
| Harness | Claude Code | `--provider claude-code` |
| Model | Opus 5.5 | `--model claude-opus-5-5` |
| Effort | High | `--reasoning-level high` |

Source: [OpenWiz's Reviewer for GPT-built](https://github.com/openwizdev/OpenWiz/blob/main/docs/agents/fleet.md#reviewer-for-gpt-built).

## Labels

The triage labels and their names are in `triage-labels.md`. A fleet adds one label of its own:

| Label | Means | Put on by | Taken off by |
| --- | --- | --- | --- |
| `held` | The ticket is held: it waits for the user's approval of a changed plan or contract, and never starts while it has this label. It has no ready label while held | `to-tickets`, before it changes an approved plan; `launch-fleet`, when a merge changes a contract the ticket relies on | `to-tickets`, as it puts the ready label back once the new approval is recorded; `launch-fleet`'s `release` line, if it is still on after that |

The label lives on the OpenWiz tracker, where the tickets are. The skill that holds a ticket first creates the label, once, with the description "Held: waits for the user's approval".

Source: the fleet skills, `to-tickets` and `launch-fleet`, which put it on and take it off. It is the same in every project.

## Test commands

The full set, in this order, from the repository root. Use Node.js 24, Python 3.11+ and Git. Commands 5 to 9 also need Chrome or Chromium (`CHROME=/path/to/chrome` picks one). A builder runs the red/green proof and every command its change can affect, then opens the ready pull request.

| # | Folder | Command | CI check |
| --- | --- | --- | --- |
| 1 | root | `python3 -I tools/comment-check/check.py diff --base origin/main` | `Build, links, resources and privacy` |
| 2 | root | `npm ci` | `Build, links, resources and privacy` |
| 3 | root | `npm run build` | `Build, links, resources and privacy` |
| 4 | root | `npm run check` | `Build, links, resources and privacy` |
| 5 | root | `npm test` | `Build, links, resources and privacy` |
| 6 | root | `npm run test:functions` | `Build, links, resources and privacy` |
| 7 | root | `npm run test:app` | `Build, links, resources and privacy` |
| 8 | root | `npm run test:v2` | `Build, links, resources and privacy` |
| 9 | root | `node --test tests/models-page.test.mjs` | `Build, links, resources and privacy` |

Command 1 is the comment check (`npm run test:comments` runs it locally against `origin/main`, the pull-request target; replace `origin/main` with another target branch if needed). CI runs the same checker only on a pull request, using `--base HEAD^1` on the merge checkout after fetching that head. Commands 4 to 9 need command 3's `dist/` first. `npm run test:v2` is command 8. `npm run test:models` is command 9.

Source: [`README.md`](../../README.md#build-and-check), [`package.json`](../../package.json) scripts and [`.github/workflows/site.yml`](../../.github/workflows/site.yml).

## CI checks

| Check | Runs | Required on |
| --- | --- | --- |
| `Build, links, resources and privacy` | Workflow `Site`, job `site`: test commands 1 to 9, in order. Command 1 runs only on a pull request, against `HEAD^1` on the merge checkout | `main`, by this project's merge rule below; no ruleset requires it |

The workflow runs for every pull request against `main` and every push to `main`, without path filters, so docs-only changes run it too. Cloudflare Pages also reports a `Cloudflare Pages` check from its own Git integration; it is the deploy preview, not one of these checks. The ruleset "protect" refuses branch deletion and force-pushes on the default branch and requires no status check.

Source: [`.github/workflows/site.yml`](../../.github/workflows/site.yml), and the branch rules (`gh api repos/openwizdev/WizSite/rulesets`, read 2026-11-20).

## Standing merge rules

| Pull request | Review | Merged by, and when |
| --- | --- | --- |
| A ticket in an approved plan graph | The reviewer above, from the other model family, on its exact head | The loop, once the reviewer's APPROVE names that exact commit, `Build, links, resources and privacy` is green on it and it has no conflict with `main`; no per-change maintainer approval. Then the merge is read back |
| Anything else, and every release or publication | None by rule | Jake only |

Source: [`README.md`](../../README.md#cloudflare-pages): changes merge after green CI and one review from the other model family, with no per-change maintainer approval; merging deploys through Cloudflare Pages.

## GitHub identity

| Setting | Value |
| --- | --- |
| Record authors | `openwiz[bot]`, `jparker2006` |

Source: [OpenWiz GitHub identity settings](https://github.com/openwizdev/OpenWiz/blob/main/docs/agents/fleet.md#github-identity) and the verified fallback account.

## Evidence

Evidence (red and green runs, logs, screenshots, review captures) goes in the pull request's description or comments, never in the tree.

Source: [cleanup wave 4](https://github.com/openwizdev/OpenWiz/issues/1860), Implementation Decisions, No regrowth.

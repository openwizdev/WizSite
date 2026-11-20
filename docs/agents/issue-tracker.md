# Issue tracker: GitHub

WizSite's specs and tickets live in the OpenWiz tracker, `openwizdev/OpenWiz`; their pull requests land here, in `openwizdev/WizSite`. Use the `gh` CLI (2.94 or later, for sub-issues and "blocked by" links) for everything. Inside this clone `gh` defaults to WizSite, so pass `-R openwizdev/OpenWiz` on every `gh issue` command and `-R openwizdev/WizSite` on every `gh pr` command.

## Where things live

| Thing | On GitHub |
| --- | --- |
| Version | A milestone on `openwizdev/OpenWiz`, named after the version |
| Spec | An issue on `openwizdev/OpenWiz`; its body is the spec |
| Ticket | A sub-issue of its spec on `openwizdev/OpenWiz`, with "blocked by" links to the tickets it waits for |
| A ticket's work | Its pull request here, against `main`, whose body says `Closes openwizdev/OpenWiz#<N>` |
| The user's approval of a spec or a plan graph | A public-form comment on the spec issue: the decision, date and private-comment pointer, naming the revision approved |

A ticket is ready when it has the `ready-for-agent` label and every ticket blocking it has a verified merge: a closed blocker alone is not enough. A ticket closes only on a verified merge, and a spec only when all its tickets are closed.

## Repositories

- **Development tracker:** `openwizdev/OpenWiz`, for issues, specs and tickets.
- **Code and pull requests:** `openwizdev/WizSite` (public).
- **Private records:** the private records repository [OpenWiz's issue tracker settings](https://github.com/openwizdev/OpenWiz/blob/main/docs/agents/issue-tracker.md#repositories) name: grills, exact replies and orchestrator state. WizSite's privacy check refuses its name in this repository, so it is not repeated here.

## Private records and approval forms

Nothing private goes in this repository or the tracker: no thread ids, no exact words of a decision, no personal details, no machine details or private paths. Save and read back an exact confirmation or approval in a private comment in the private records repository first, after verifying its private visibility; a public record carries only the decision in plain words, its date, and `Private record: <pointer>` on the very next line, where the pointer is the full private comment URL, in the form [OpenWiz's settings](https://github.com/openwizdev/OpenWiz/blob/main/docs/agents/issue-tracker.md#private-records-and-approval-forms) give.

## Commands

- **Create an issue:** `gh issue create -R openwizdev/OpenWiz --title "..." --body-file body.md`.
- **Blocking:** `gh issue create -R openwizdev/OpenWiz --blocked-by <n>,<n> ...`, or afterwards `gh issue edit <ticket> -R openwizdev/OpenWiz --add-blocked-by <blocker>`.
- **List a ticket's blockers:** `gh issue view <n> -R openwizdev/OpenWiz --json blockedBy --jq '.blockedBy.nodes[] | {number, state}'`. A closed blocker still needs its verified merge.
- **Read an issue:** `gh issue view <n> -R openwizdev/OpenWiz --json number,title,body,labels,comments,milestone,parent,blockedBy`.
- **Comment:** `gh issue comment <n> -R openwizdev/OpenWiz --body-file comment.md`.
- **Labels:** `gh issue edit <n> -R openwizdev/OpenWiz --add-label "..."` and `--remove-label "..."`.
- **Close:** post the reason with `gh issue comment`, then `gh issue close <n> -R openwizdev/OpenWiz`.

## Pull requests as triage input

**Outside pull requests count as requests: no.**

## When a skill says

- **"Publish to the issue tracker":** create a GitHub issue on `openwizdev/OpenWiz`.
- **"Fetch the ticket":** read it as in **Read an issue** above.

Source: the tickets WizSite's pull requests close (for example `Closes openwizdev/OpenWiz#1579`), and [OpenWiz's issue tracker settings](https://github.com/openwizdev/OpenWiz/blob/main/docs/agents/issue-tracker.md).

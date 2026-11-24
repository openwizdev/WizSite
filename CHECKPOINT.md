# Checkpoint: refresh-snapshots workflow (delete this file before opening the PR)

Done: `.github/workflows/refresh-snapshots.yml` drafted (every 6 h + manual dispatch, contents/pull-requests write only, pinned checkout v7.0.1 and setup-node v7.1.0 SHAs, concurrency group, fixed branch `refresh/snapshots`, no force-push: merges main into the branch with `-X theirs`, syncs, builds, checks, commits, pushes, then opens or edits ONE PR titled "Refresh market and landing snapshots" with before/after counts; closes the PR if main already matches). Landing step runs only when `scripts/landing-sync.mjs` exists (B5's signature: `<OpenWiz checkout> <open-PRs JSON file>`).

Not done: not run or validated (try `actionlint`, and run the shell/node parts locally); docs/maintaining.md section; full test run (`npm ci && npm run build && npm run check && npm test && npm run test:functions`); PR.

Gotchas:
- Repo setting "Allow GitHub Actions to create and approve pull requests" is OFF (`gh api repos/openwizdev/WizSite/actions/permissions/workflow` -> can_approve_pull_request_reviews false). `gh pr create` will fail until the owner turns it on. Say so in the PR; don't work around it.
- PRs opened/pushed with GITHUB_TOKEN don't trigger the Site workflow; a human close+reopen runs it. Document this.
- No comments and no `#` in the YAML: tools/comment-check checks .yml.
- reach.json will carry a sync date, so every run looks "changed"; consider ignoring date-only diffs.
- market-sync.mjs clones canonical WizMarket itself; the local clone only needs to be on main.

# Team page round 2: frozen public GitHub data

- `rest/`: the exact unauthenticated-shape REST answers GitHub gave at 2026-11-24 14:33 UTC for the live reader:
  `search.json` = GET /search/issues?q=repo:openwizdev/OpenWiz is:issue in:title "spec:"&sort=updated&per_page=20;
  `sub_issues-2963.json` = GET /repos/openwizdev/OpenWiz/issues/2963/sub_issues?per_page=20;
  `timeline-<n>.json` = GET /repos/openwizdev/OpenWiz/issues/<n>/timeline?per_page=100.
- `replay-packet.json`: spec #1927 (finished run, Nov 20-21) and spec #2963 (in progress), per ticket: building_at (first builder status note or fleet start), review_at (its first pull request opened), merged_at (ticket closed as completed), and its pull requests.
Use these as test fixtures; do not call GitHub from a sandbox.

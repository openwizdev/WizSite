# How OpenWiz works

![How OpenWiz works](how-openwiz-works.png)

OpenWiz runs a software factory on top of CloudRoom. Four parts:

- **You** use the OpenWiz app, CLI or phone to approve plans, answer "Needs you" and watch progress. An orchestrator chat (an agent you talk to for grills, plans and "where are we") is optional: the factory runs without one.
- **GitHub is the memory.** A fleet is one approved spec and its tickets; every decision and result is a record on GitHub (issues, pull requests, reviews, CI).
- **The engine is plain code on a timer, not an AI.** `openwiz fleet tick` reads GitHub, works out what is due, starts agents, sends review findings to builders, merges approved work, and exits; it prints nothing when nothing is due. By default it runs in the Cloud as a CloudRoom Loop, always on; it can run on your own computer instead.
- **CloudRoom agents are short-lived workers:** one builder per ticket (it builds, tests, opens a pull request, then stops), one reviewer per pull request from the other model family, and small helpers a builder or reviewer starts for chores.

There is no long-running orchestrator per fleet. Each tick re-reads everything from GitHub, so nothing is lost if a thread stops, and agents exist only while there is work.

**How OpenWiz talks to them:** to CloudRoom only through `room-cli`, and only with the commands in its allowlist (`crates/adapters/cloudroom/src/allowlist.rs`): listing and reading threads and projects, `thread tell` to send, `thread spawn` to start one; to GitHub through `gh` and OpenWiz's GitHub App. The tests run a fake `room-cli` and never touch a real account.


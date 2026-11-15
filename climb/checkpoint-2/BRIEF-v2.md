# WizSite hill-climb · rubric v2 (frozen for stretch 2, from 2026-11-15 late)

Owner feedback (paraphrased, 2026-11-15 23:00 PST): the live site is solid but has bugs and is still hard for a normal visitor to understand. Stretch 1 (rubric v1, BRIEF.md) is closed and kept as is.

All hard rules from BRIEF.md still hold, except as below. Changes:
- Copy and visuals may be simplified wherever that helps a first-time visitor understand. The headline and subline remain decided; the kicker may change; the hero's story may be simplified, but keep its order: idea, questions, plan, approve, build and review, merged, then many specs at once.
- **Bugs first:** every round starts with a bug sweep (console errors; layouts at 320, 375, 390, 768, 1024, 1440 and 1920 px; overflow and clipping; animation glitches such as jumps, stuck frames and overlapping labels; broken links; slow first paint; reduced motion; tab-away pause; Replay; touch). Any bug blocks a candidate until it's fixed.

## Primary measure: the cold read
Two fresh readers with no context (one Claude, one Codex) each see only one version: its first screen at 390 and 1440, and snapshots of the first 10 seconds. They say, in their own words, what it is, who it's for and what they'd do next. Two graders (one per family) score each answer against the intended answer below, 0–10 per question.

Intended answer:
- **What:** OpenWiz is open-source software that runs a team of AI coding agents like a factory: you give it an idea and approve a plan, and the agents build, review and merge the code for you.
- **Who:** developers, or anyone building software, who use AI coding agents.
- **Next:** star it on GitHub (installing is coming soon), or scroll down to see how it works.

## Secondary measure: the council (rubric v1 categories, as before)
clarity, story, mobile, identity, copy, shiplog, weight; same references and judges.

## Selection rule (stretch 2)
Eligible only with the bug sweep at zero, the held-out check passing, and build/check/test green. Then the highest cold-read score wins. A candidate within 0.5 of the top cold-read score can win instead on a higher council mean, but only if its cold read is no lower than the incumbent's.

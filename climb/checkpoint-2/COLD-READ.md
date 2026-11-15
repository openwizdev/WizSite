# Stretch 2 · cold read: before and after (2026-11-15)

Readers: fresh threads with no context, one Claude (Haiku 5.5) and one Codex (gpt-6.1-terra, low effort) per version. Each saw only two images: the first screen at 390 and 1440 px, plus snapshots of the first 10 seconds. Each reader's log was audited to confirm it opened only those images. Graders: Claude Opus 5.5 and Codex gpt-6.1-sol, scoring each answer 0–10 per question against the intended answer.

**Intended answer:** OpenWiz is open-source software that runs a team of AI coding agents like a factory: you give it an idea and approve a plan, and the agents build, review and merge the code. It's for developers using AI coding agents. Next: star it on GitHub (installing is coming soon), or scroll to see how it works.

## Scores (each round re-reads the incumbent in the same batch)

| Round | Version | what | who | next | score |
| --- | --- | --- | --- | --- | --- |
| r4 (baseline) | Live at the feedback (R3B) | 6.75 | 10.00 | 9.75 | **8.83** |
| r4 | R4A | 7.75 | 9.25 | 9.25 | **8.75** |
| r4 | R4B | 7.50 | 9.75 | 9.00 | **8.75** |
| r4 | R4C | 7.75 | 9.75 | 7.25 | **8.25** |
| r5 | R5B | 9.00 | 9.75 | 9.25 | **9.33** |
| r5 | incumbent (live) | 7.00 | 10.00 | 9.25 | **8.75** |
| r5 | R5A | 7.25 | 9.25 | 9.50 | **8.67** |
| r5 | R5C | 6.25 | 9.50 | 9.75 | **8.50** |
| r6 | R6B | 9.00 | 9.50 | 10.00 | **9.50** |
| r6 | R6C | 9.00 | 9.75 | 9.00 | **9.25** |
| r6 | incumbent (live, R5B) | 9.00 | 9.75 | 7.50 | **8.75** |
| r6 | R6A | 7.75 | 9.75 | 8.75 | **8.75** |

Winners shipped: R5B (one plain sentence saying what it is) as PR #11, and R6B (a plain next step) as PR #13.

Noise: two readers per version is a small sample. The same page (R5B) scored 9.33 in round 5 and 8.75 as the incumbent in round 6, because its round-6 readers wanted to type into the demo's input box. That's why every round compares versions within one batch.

## Before: the live page when Jake gave feedback (word for word)

**C1 (Claude Haiku)**
- What: It looks like a tool where you type an idea and AI coding agents plan it, build it, review it, and merge it. The name is OpenWiz and the tagline says it's a factory for coding agents.
- Who: It seems aimed at developers or people who build software and want to hand the coding work to AI agents.
- Next: I'd click "Star on GitHub" to learn more, since "Install" is greyed out as coming soon.
- Confused by: The Install button says "coming soon" and the note says it's not ready for everyone yet, so I can't tell if I can use it. I also don't know what the "Pause" button controls or whether the animated demo is live or just a preview.

**C2 (Codex Terra)**
- What: OpenWiz looks like a tool that helps coding agents turn an idea into a finished change while you make decisions and approve the work.
- Who: It seems to be for people who build software using coding agents.
- Next: I’d scroll down to learn how it works, since installation is coming soon. I might also check the GitHub page.
- Confused by: I’m not sure exactly what gets installed or how it works with my existing coding agent. It’s also unclear whether the panel is something I can interact with or just a demonstration.

## After: round 6 winner R6B (word for word)

**C2**
- What: OpenWiz is free, open-source software that uses a team of AI coding agents to build, review, and merge code after you approve a plan.
- Who: It seems to be for people who build software and want AI agents to help turn their ideas into code.
- Next: I would scroll down to learn more, then check out the GitHub page since installation is coming soon.
- Confused by: I don't know what Cloudroom is or what I would need to use OpenWiz. It's also not immediately clear whether the animated example is something I can interact with.

**C1**
- What: A dark, animated site for OpenWiz, described as free, open-source software that runs a team of AI coding agents in Cloudroom to build, review, and merge your code after you approve a plan.
- Who: People who build software and want AI agents to do the coding work, probably developers who use GitHub.
- Next: I'd click "Star on GitHub" to follow along, since the Install button says "coming soon."
- Confused by: I don't know what Cloudroom is, and the "Install · coming soon" button and "Not ready for everyone yet" note left me unsure whether I can try it. The "New idea" panel animation also doesn't say what it does on its own.

## Confusions still reported after round 6
- 'What is Cloudroom?' (it's named in the sentence; R6A removed it but scored lower on what).
- 'Is the animated example interactive?' (the demo's input box looks typeable).
- 'Can I use it today?' (Install is coming soon, as decided).

## Limits of this measure
- The readers are AI models. They already know what a "coding agent" is, so the "who" score likely flatters us. A non-technical person may still struggle with "AI coding agents" itself. A human cold read (two or three people, ten seconds each) would test that directly.
- Two readers per version: differences of 0.5 or less are within noise.

## Bug sweep (every round, before any scoring)
The sweep runs at 320 (overlay and classic scrollbars), 375, 390, 768, 1024, 1440 and 1920 px. It checks:
- console and network errors, and broken links;
- overflow and clipping;
- labels overlapping, running off screen or never shown during the pull-back (seeked every 0.1 s), and a camera stuck mid-move;
- layout shift and the buttons moving;
- first paint on a throttled phone connection;
- reduced motion, tab-away pause, Pause, Replay, and touch targets under 24 px;
- the ship log page.

Results:
- **Live page at Jake's feedback: 45 bugs.** Spec labels ran off the visible area, under the window and over each other. At 1024 px the product window ran 28 px past the edge. The web font arriving caused a layout shift. Two links had 23 px touch targets.
- **After #9 and #11: 0 bugs.** Two more were found and fixed along the way: buttons clipped at 320 px with classic scrollbars (and on slow fonts at 390), and a spec label hidden at 320 px.
- **Every candidate since round 4 passed the sweep with 0 bugs before it was scored.**

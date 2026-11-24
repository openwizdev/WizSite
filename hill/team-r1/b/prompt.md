# Candidate B targets

## Phone prompt

```text
Edit the supplied full-page screenshot of openwiz.dev/team into a full-page target for a copy-only change. Output a single flat screenshot with a 390 px wide canvas and approximately 2410 px full page height, preserving the full page including navigation and footer. No outer device frame, no blank margin. Same dark page, existing typography, existing button color, spacing, alignment, video poster and label, rules, and overall composition. Keep the header and footer as shown, with the GitHub icons but no numeric star badges. Keep the single column, full-width booking buttons, and the first Book a call fully within the first 844 px. Copy changes may affect wrapping but should not move content into new sections. Exactly two booking buttons, both “Book a call”. Replace only the following visible text, in this order. Render all text exactly and legibly.
Kicker (uppercase visually): For leads using Claude Code or Codex
Headline: See how your agents open a pull request
Lead: In 30 minutes, Jake, who built OpenWiz, walks your team through how your coding agents can build and review a change from your backlog.
Line under the first booking button: Bring a repo with working CI. Sign in to Claude Code or Codex before the call.
Steps heading: From task to pull request
1. Connect your tools
We connect OpenWiz to your repo and the coding agents you already use.
2. Pick a task
Choose one small change your team needs.
3. Review the change
Your agents build the change. A second agent reviews it, then a pull request opens in your repo. You decide whether to merge.
Facts heading: About OpenWiz
OpenWiz 0.01 is open source under Apache-2.0.
OpenWiz never touches your login. We run no server for it.
See which drivers passed a live check on the Drivers page.
Jake built OpenWiz on his own with fleets of agents.
Underline only “Drivers page” in the third fact.
Closing heading: Talk through a change with Jake
```

## Desktop prompt

```text
Edit the supplied full-page screenshot of openwiz.dev/team into a full-page target for a copy-only change. Output a single flat screenshot with a 1440 px wide canvas and approximately 2393 px full page height, preserving the full page including navigation and footer. No outer device frame, no blank margin. Same dark page, existing typography, existing button color, spacing, alignment, video poster and label, rules, and overall composition. Keep the header and footer as shown, with the GitHub icons but no numeric star badges. Keep the two-column hero, the three steps in columns, the four facts in columns, and the closing heading and button on the same row. Copy changes may affect wrapping but should not move content into new sections. Exactly two booking buttons, both “Book a call”. Replace only the following visible text, in this order. Render all text exactly and legibly.
Kicker (uppercase visually): For leads using Claude Code or Codex
Headline: See how your agents open a pull request
Lead: In 30 minutes, Jake, who built OpenWiz, walks your team through how your coding agents can build and review a change from your backlog.
Line under the first booking button: Bring a repo with working CI. Sign in to Claude Code or Codex before the call.
Steps heading: From task to pull request
1. Connect your tools
We connect OpenWiz to your repo and the coding agents you already use.
2. Pick a task
Choose one small change your team needs.
3. Review the change
Your agents build the change. A second agent reviews it, then a pull request opens in your repo. You decide whether to merge.
Facts heading: About OpenWiz
OpenWiz 0.01 is open source under Apache-2.0.
OpenWiz never touches your login. We run no server for it.
See which drivers passed a live check on the Drivers page.
Jake built OpenWiz on his own with fleets of agents.
Underline only “Drivers page” in the third fact.
Closing heading: Talk through a change with Jake
```

## Phone correction prompt

```text
Fix this generated phone target only by removing its wide white left and right gutters. The dark webpage itself fills the entire portrait canvas from left edge to right edge and from the navigation at the top to the footer at the bottom. Use the narrowest supported portrait aspect ratio. Preserve every line of copy, the existing full-page order, and the dark layout from the supplied generated target. There must be no white margins, device frame, surrounding background, new text, or clipped page content.
```

## Inspection

I used built-in image generation with full-page screenshots of the parent commit as references. I checked the header, hero, video, both booking buttons, steps, facts, and footer in both images. The first phone render had white side gutters, so I generated a corrected full-bleed version. I resized the selected PNGs proportionally to 390 and 1440 pixels wide. The targets approximate the site’s spacing, typography, and poster. The desktop target adds a period to the headline. The live page uses the exact copy above.

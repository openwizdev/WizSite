# RD4 · "How it works" wordings (pick one, or mix lines)

Rendered at 1440 and 390: `rd4-wordings/desktop.png`, `rd4-wordings/phone.png`.

## 1 · Plain
**How it works**
- **OpenWiz runs your factory.** The engine that plans, builds, reviews and merges, with a CLI and a web app to watch it work.
- **WizSkills are the playbooks.** The steps your agents follow: grill the idea, plan the tickets, build, review.
- **WizPlugins put the controls in your editor.** Approve and steer without leaving where you work.

You decide what gets built. WizSkills tell the agents how. OpenWiz runs the line and shows you every step.

## 2 · The factory
**How the factory works**
- **OpenWiz is the floor.** The engine, CLI and web app that turn an approved plan into merged work.
- **WizSkills are the playbooks.** Step-by-step methods your agents follow, from the first question to the last review.
- **WizPlugins are the controls.** Approve, steer and watch from your editor.

You approve the plan once. The agents follow the playbooks on OpenWiz's floor until the work is merged.

## 3 · Shortest
**Three repos, one factory**
- **OpenWiz.** Runs the factory. Engine, CLI, web app.
- **WizSkills.** The playbooks your agents follow.
- **WizPlugins.** The controls, in your editor.

One idea in: WizSkills shape it into a plan, you approve it, and OpenWiz builds, reviews and ships it.

## Accuracy notes (check before shipping)
- "Plans, builds, reviews and merges" and "grill, plan, build, review" match OpenWiz's README and the 0.0.5 fleet skills.
- "In your editor": WizPlugins' repo describes CloudRoom/BB plugins. If CloudRoom doesn't count as "your editor" to a stranger, use "in CloudRoom" instead.
- "Steer" matches 0.0.3 (queue or steer a thread). "Approve" from a plugin is not verified; drop it if the plugins can't approve yet.
- WizSkills is a private repo today, so its link 404s for strangers until it's published.

# Domain docs

Where WizSite keeps its words and its decisions.

## Before exploring, read these

- **`README.md`**: what the site is, how it builds and checks, and how it deploys.
- **`GLOSSARY.md`** and **`docs/adr/`** at the root, when they exist. There are none yet; carry on without them. The `grill` skill creates them as terms and decisions get settled.
- **Grills** are private: they live in the private records repository, where [OpenWiz's domain docs](https://github.com/openwizdev/OpenWiz/blob/main/docs/agents/domain.md) say, never in this repository. Read the grill that fed the spec; never copy it here.

## Private storage

The repository routing is in `issue-tracker.md`. Resolve the private checkout by its verified remote, never by a guessed current directory; verify private visibility before writing. The handoff and all orchestrator state stay in that private checkout, where OpenWiz's domain docs say. A public source names a decision and a private-comment pointer, never exact replies or thread ids. If a source is not available, report the gap.

## Use the spec's words

Use the words the spec uses. If something new needs a name, note it for the next grill.

## Flag ADR conflicts

If your output contradicts an ADR, say so plainly instead of quietly overriding it.

Source: [OpenWiz's domain docs](https://github.com/openwizdev/OpenWiz/blob/main/docs/agents/domain.md), whose private records repository and handoff WizSite shares.

# Triage labels

The skills talk about five triage roles. This file maps each role to the label the tracker uses for it. WizSite's tickets live on `openwizdev/OpenWiz` (`issue-tracker.md`), so these are OpenWiz's labels; WizSite's own labels are not used for triage.

## Labels

| Role | Label here | Meaning |
| --- | --- | --- |
| `needs-triage` | `needs-triage` | Maintainer needs to evaluate this issue |
| `needs-info` | `needs-info` | Waiting on reporter for more information |
| `ready-for-agent` | `ready-for-agent` | Fully specified, ready for an agent to take unattended |
| `ready-for-human` | `ready-for-human` | Requires human implementation |
| `wontfix` | `wontfix` | Will not be actioned |

When a skill names a role (for example, "label it ready for an agent"), use that role's label from this table. Each label exists in the tracker exactly once. A ready label grants preparation authority subject to blockers and approval gates, never publishing or live-run authority.

Source: [OpenWiz's triage labels](https://github.com/openwizdev/OpenWiz/blob/main/docs/agents/triage-labels.md).

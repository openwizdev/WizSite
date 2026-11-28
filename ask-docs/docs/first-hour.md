# Your first hour with OpenWiz

The aim: install OpenWiz, give it one small idea for your own repository, and
see your first pull request reviewed, checked and merged within an hour.

**Status:** the First hour page is tested on synthetic fixtures only. A real
first hour, and how long it takes, are not yet verified.

## Follow it in the app

Open `http://127.0.0.1:7370/#first-hour`. On a computer, **First hour** is
also in the sidebar. On a phone, search for "Go to First hour". The page shows
six steps, and each step shows only what OpenWiz has actually read:

1. **Install OpenWiz.** Paste the one install line into your coding agent; see
   [Install OpenWiz](install.md).
2. **Connect your accounts.** **Open setup** goes to the setup page. Each
   connection is checked on its own, and CloudRoom's one sign-in screen is on
   the CloudRoom step. Setup checks your agent harness login. It does not check
   a reviewer from the other model family, so the page shows that reviewer as
   unknown. Once the connections are verified, the step says which identity
   acts: your own OpenWiz App, or your personal GitHub login if you chose to
   skip the App. A skipped App needs nothing more, and there is no engine to
   choose. The private brain is made by your installing agent (`openwiz init`)
   and checked as part of the project.
3. **Give your first idea.** Your installing agent continues through
   [install's first-fleet branch](../skills/install/SKILL.md#5-first-fleet) with the same repository, or
   give it one small idea in a thread on your project. It grills you briefly.
4. **Confirm the spec and approve the plan.** Both happen in **Decisions**, as
   two separate answers. A sent answer counts only once Decisions shows it as
   saved. Approving work does not approve spending.
5. **Watch the fleet build.** Builders start only after you approve the exact
   plan and say yes to the start: one fleet thread with its own loop starts
   them. Counts are shown as reported, and a partial read shows as unknown, not
   zero. See [How OpenWiz works](how-openwiz-works.md).
6. **First verified merge.** A merge shows as verified only when GitHub reports
   the pull request merged and the merge commit has been read back on its
   base. A closed pull request or a progress count is never a verified merge.

The page reads setup, decisions and your first fleet once when it opens, and
again when you press **Refresh**. It never sends, starts or stops anything.

## When something goes wrong

- **Refused:** nothing took effect. Follow the step's next action, and your
  drafts stay.
- **Check first:** a reply was lost, so OpenWiz cannot tell whether the step
  took effect. Ask your installing agent to check the operation by its id
  before trying again, and never start it a second time.
- **Failed or unknown:** a read did not answer or answered only in part. Press
  **Refresh**. Work already running carries on.

Feedback and sharing are on **Home**. OpenWiz stays free and open source.
Every tier gets the same software, features and support; optional monthly
supporter tiers ($1, $10, and $100 Business) are cosmetic only. CloudRoom and
model charges are separate and not included.

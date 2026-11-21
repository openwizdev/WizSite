# OpenWiz's GitHub App

OpenWiz's service App acts on the repositories you select with its own installation
allowance, separate from your agents' GitHub login. It is registered and installed
with OpenWiz's established service profile: **Metadata read, Contents, Issues and
Pull requests write, Checks and Actions read**. It has no webhook subscription. GitHub
requires a URL in the webhook configuration; the manifest uses the selected repository
with delivery disabled. Your agents' commits and pull requests keep using their own
login: setup checks that identity separately and never uses a personal token for the App.

## Connect (on the engine host)

Run these tools in a terminal **on the host whose OpenWiz state keeps the key**, with
its browser. Never run real setup through a command that copies its response elsewhere.
Python 3 and `openssl` are the only runtime tools. No package install is needed.

Run as the owner of the OpenWiz state directory (by default
`~/.local/state/openwiz`), and pass its absolute path with `--state-dir` in every
example below.

```sh
# 1. Preview: records the proposed connect_app operation and prints its effects and id.
python3 tools/github-app/setup.py --state-dir "$HOME/.local/state/openwiz" --repo OWNER/NAME
# 2. Confirm exactly that proposal.
python3 tools/github-app/setup.py --state-dir "$HOME/.local/state/openwiz" --repo OWNER/NAME \
  --yes --operation OPERATION_ID
```

1. Open the `http://127.0.0.1:8765/start/...` address printed by step 2 in this host's
   browser. The page submits the ready manifest to GitHub. Choose a unique App name if
   GitHub asks, and confirm creation.
2. GitHub returns to the local page. The host exchanges the temporary code directly with
   GitHub; the key is saved without being displayed. Follow **Install the App** and select
   only the repositories OpenWiz needs.
3. GitHub returns to the local `/installed` page. Setup asks GitHub to confirm the
   installation belongs to this App and the selected repository's owner, then records the
   App and installation ids (never a token) in `<state>/setup/state.json`.
4. Run the setup check (`tools/install/setup/setup.py check`); the setup page shows the
   result. Registration and an installation alone never mark the App ready.

The App's setup URL is this loopback port, so keep the same `--port` when reconnecting.
Setup stops after installation or ten minutes. Do not tunnel the callback: the browser
and setup run on the same host. Keep this terminal out of transcript or HTTP debug capture.

**Resuming and reconnecting.** A preview of the same request reuses its operation id,
including after it completes, while its installation stays recorded. Only a proposed
operation may ask GitHub to create the App, once: it is claimed as `uncertain` first, and
any other confirmation of it is refused before a request. If setup is interrupted after the
key is saved, run both steps again: the same operation reconciles the saved App with GitHub
(`GET /app`) and continues to installation; nothing is registered twice. If GitHub's answer
was lost before the key was saved, setup refuses to register again: check GitHub's App
settings for an App this setup created (delete it if you want), then preview with
`--after-uncertain OPERATION_ID`, naming the newest uncertain registration. That
acknowledgment stays part of the request, so the same command reloads its result after it
completes; and the claim re-checks, under the state lock, that it is still the newest, so a
registration that became uncertain after confirmation blocks it before any request. The uncertain
record stays: of the 64 operations kept, uncertain ones are never dropped. After an uninstall or
revocation, the same two steps install the saved App again; the check captures the new
installation.

The state directory for these Python tools is selected by `--state-dir` first,
then non-empty `$OPENWIZ_STATE_DIR` (either must be absolute), then
`$XDG_STATE_HOME/openwiz` when XDG is absolute, else `.local/state/openwiz` under
Python's `Path.home()` (which can use the account's home when `$HOME` is unset).
The selected path must be absolute and outside a repository.
Unlike the [service](../contracts/service.v1.md#the-state-directory), these tools accept
absolute XDG without `$HOME` and do not select `~/Library/Application Support/openwiz`
on macOS. To use the service's state directory, pass its absolute path with
`--state-dir` or set `$OPENWIZ_STATE_DIR` for both setup and token minting.
Setup creates owner-only directories (0700) and writes:

```text
<state>/service/app/
├── private-key.pem    0600, never printed or copied
└── app.json           0600, App ID only
<state>/setup/
└── state.json         0600, operations and public ids only
```

Existing unsafe directories, symlinks and existing key/config files are refused.
The tools never overwrite an existing key. If a partial save leaves a key but no
`app.json`, keep that key on the host and create `app.json` there with
`{"app_id": NUMBER}` and mode 0600, using the ID from the App's settings.
Never paste or upload the key. Deleting the App and starting over is also possible;
revoke it before removing its local files.

**Installed copies.** A release bundle carries these tools: `runtime/github-app/` (`setup.py`,
`app.py`, `manifest.json`) and `runtime/setup/` (`setup.py`, `store.py`), and installation
refuses a bundle without any of them. Run them from the installed build, for example
`python3 -I <build>/runtime/github-app/setup.py --repo OWNER/NAME ...` and
`python3 -I <build>/runtime/setup/setup.py check`; installed, the check finds `<build>/openwiz`
and the pinned runtime by itself. No source checkout is needed.

## The setup check

`python3 tools/install/setup/setup.py check --state-dir STATE` checks each connection
independently and records one result code per component for the setup page:
CloudRoom (a live read through the installed `openwiz`; an inventory read alone never verifies
it, so even a complete read stays unknown until a current login source exists, and a partial
read is unknown too), the chosen harness, model and effort (`openwiz models`: a catalogue that may be
CloudRoom's saved copy, so a listed harness stays unknown and an unlisted one is refused; no
check here proves a harness login yet), your agents' own GitHub login (`gh`: a person's account
with push access), the App, and the project. For the App it signs a short JWT with the saved
key, finds this App's installation for the selected repository's owner (capturing its id),
requires it to be active, on selected repositories only and with exactly the service
profile, then mints one installation token for exactly the selected repository and
discards it: the answer counts only with a well-formed token and a valid expiry at most an
hour (plus five minutes of drift) ahead, else the App stays unknown. Read-only, all-repository,
wrong-repository, suspended, removed or key-rejected installations are refused, each with its
own reason, and so is a saved key or ID that is missing, unsafe or unusable on this host. Every
check saves a result for each component, failures included, so a broken connection replaces
earlier positive evidence. Each check takes a generation when it starts; one that finishes
after a later-started check has saved exits 7 and saves nothing. Project settings come
from `setup.py prepare` (preview, then `--yes --operation`): an explicit operator, an
open service record issue, the orchestrator thread in the selected CloudRoom project,
the repository's filled-in `docs/agents/fleet.md` from the setup skill (a harness, model and
effort for the builder and a reviewer, at least one test command and CI check, a merge rule,
every builder table present (small-ticket builders included) filled in, a merge rule as a filled
table row or the template's `None yet: every merge waits for the user.` line, a `Source:` line in
each of those sections and no unfilled `<...>` placeholder), and the
pinned packaged runtime. Returning to an earlier selection is a new proposal to confirm. Saved settings are never proof: each is checked, and evidence older than an
hour or for an earlier selection shows as unknown.

## Check the permissions and mint a token

In GitHub: **Settings → Developer settings → GitHub Apps → your App → Permissions
& events**. Metadata, Checks and Actions must be **Read-only** and Contents, Issues and Pull requests
**Read and write**; all other repository, organization and account permissions must be
**No access**. Under **Settings → Applications → Installed GitHub Apps → Configure**,
check the selected repositories.

For the live read check below, the token tool requires `--repository OWNER/NAME`,
requests exactly that repository and the six read permissions, and checks the
exact repository selection in the response. It makes one request and refuses a
response with missing, unknown or write permissions. The private
key stays in its file; OpenSSL signs through an inherited file descriptor. Unsafe
key/config modes and symlinks are refused. stdout contains the token and its Unix
expiry on separate lines; errors are fixed text, with no GitHub response body or credentials.
Nothing caches the token. It expires one hour after GitHub issues it; mint again
when needed. The expiry sanity check allows five minutes of PC clock drift; this
does not extend the token’s lifetime. No automatic retry is made.

After Jake authorizes the live check, on the PC:

```sh
# Supply the installation ID from GitHub. Do not enable shell tracing.
(
    APP_TOKEN="$(python3 tools/github-app/mint-token.py \
      --state-dir "$HOME/.local/state/openwiz" --installation-id NUMBER \
      --repository OWNER/NAME)" || exit
    APP_TOKEN="${APP_TOKEN%%[[:space:]]*}"
    GH_TOKEN="$APP_TOKEN" gh api rate_limit --jq '.resources.core | {limit, remaining}'
    unset APP_TOKEN
)
```

The subshell keeps a mint refusal from closing your terminal; its error stays
visible and the read is skipped. This override applies to that one read. Keep
`GH_TOKEN` out of global shell configuration, `gh auth login` and Git configuration.
Agents get theirs per run, as [Agent tokens](#agent-tokens-g2) says.
Never print a token in a thread or save it in a repository.
App-counted live reads and contribution credit remain unverified until that check.

## Agent tokens (G2)

Fleets, builders, reviewers, the war room collector and the map's readers read and
write GitHub as the App (`<app slug>[bot]`), not as the person's login, so their
API use comes out of the App's own allowance and their comments, reviews and pull
requests are signed by the App. Each command gets `GH_TOKEN` from the refresh helper:

```sh
# Do not enable shell tracing. Repeat --repository per repository (one owner per token).
GH_TOKEN="$(python3 -I tools/github-app/refresh-token.py --write \
  --state-dir STATE --installation-id NUMBER --repository OWNER/NAME)" gh issue comment ...
```

- **Per run, refreshed.** The helper mints an installation token on first use and
  reuses it while more than five minutes are left, then mints a fresh one. Its cache
  is `<state>/tokens/`: a 0700 directory of 0600 files, one per scope (API,
  installation, repositories, profile, key source), so a read token is never handed
  out for a write, nor one repository's token for another. A cache file with a wider
  mode, another owner or a symlink is refused, never used. Stdout is the token alone;
  on any refusal it prints nothing on stdout and one fixed sentence on stderr.
- **Scoped.** `--repository` is required: the token covers exactly the named selected
  repositories. `--write` asks for exactly the App's profile (Contents, Issues and Pull
  requests write; Metadata, Checks and Actions read) and refuses an answer with any
  other permission, so no token has `workflows`, `administration` or anything else.
  Without `--write` the token is read-only (the war room collector and the map's
  readers need no more).
- **Never exposed.** The token goes only to stdout, captured straight into `GH_TOKEN`
  for one command, never an argument, a URL, a log or a file outside the cache. Git
  reads it through a credential helper that reads the environment, never in a remote
  URL: `git -c credential.helper= -c 'credential.helper=!f() { [ "$1" = get ] &&
  printf "username=x-access-token\npassword=%s\n" "$GH_TOKEN"; }; f' push ...`.
  The key reaches OpenSSL only by descriptor; the secret's key is dropped from the
  helper's environment before any child starts, and on that route OpenSSL gets only
  `PATH`. `tools/github-app/test.py` (`AgentTokenTests`) checks each of these with a
  logging OpenSSL stand-in.
- **Cloud threads: the Cloudroom secret.** A cloud thread adds `--from-secret`: the
  helper signs with `OPENWIZ_GITHUB_APP_KEY` (base64 of the PEM, one line) and
  `OPENWIZ_GITHUB_APP_ID`, given only to threads that mint, and caches under the
  sandbox's own state. No key file is written. This route was chosen over handing a
  PC-minted token to the thread because a handed-over token has to pass through a
  transcript or a command's output to get there, and it expires within the hour with
  no way to refresh while the PC sleeps; the secret refreshes on its own and is
  revocable separately (give it its own key, below).
- **One minting path per profile.** `refresh-token.py` runs `mint-token.py`'s checks
  through the same `app.py` guards. `mint-token.py` itself stays the read-only tool,
  byte-identical to the copy `launch-fleet` carries.
- **Commits stay the person's.** Commits keep their author and committer (the
  person's GitHub noreply address); only the push and the GitHub records are the App's.

### Which identity does what

| Action | Identity |
| --- | --- |
| Reads, issue and pull request comments, labels, pull requests, reviews by agents, pushes of ordinary branches | The App, through `refresh-token.py` |
| Approvals the person gives (a pull request approval that counts for a rule, a grill's confirmation) | The person's login |
| Repository and organisation settings, rulesets, secrets, App installation | The person's login |
| Pushes that change `.github/workflows/` | The person's login: the App has no `workflows` permission and GitHub refuses the push |
| A refused or failed mint | Today's login, said on stderr; never silently |

### Rollout runbook

Owner and planner steps; an agent never handles the key. Live identifiers (App id,
installation id, state directory) stay in the private record, never on GitHub.

1. **Choose the App (owner).** The token's author is that App's `<slug>[bot]`. A user
   App mints only for repositories its owner's account owns; repositories on two
   accounts need the factory App under `OPENWIZ_GITHUB_APP_MODE=factory`. Set the
   chosen App's `--state-dir` and `--installation-id` (one per account) in the
   planner's private notes.
2. **The key (owner, once, for cloud threads only).** PC-run agents need nothing: the
   key stays in the PC state. For cloud threads, in the App's settings click
   **Generate a private key**, run `room-cli secret request OPENWIZ_GITHUB_APP_KEY`
   and paste the file's one-line base64 (`base64 -w0 FILE.pem`) into Cloudroom's prompt
   only, set `OPENWIZ_GITHUB_APP_ID` the same way, then delete the download. This is
   the only place the key leaves the PC. Revoke it alone by deleting that key in the
   App's settings.
3. **Before (PC hands, the person's login).** One hour before the switch, read the
   person's REST use with `gh api rate_limit --jq '.resources.core | {used, reset}'`
   (this endpoint is not counted) just after a reset and again just before the next,
   and record `used` for that hour on the ticket. Never run it with `GH_TOKEN` set.
4. **Bot-authored write (PC hands).** In a test repository the App is installed on:
   `GH_TOKEN="$(python3 -I tools/github-app/refresh-token.py --write --state-dir STATE
   --installation-id NUMBER --repository OWNER/TEST)" gh issue comment N --repo
   OWNER/TEST --body "G2 check"`, then read the comment's author (`gh api graphql`,
   `author { login }`), record that login on the ticket, and delete the comment.
5. **Switch each fleet loop (planner).** In each loop's tick, before its GitHub
   commands, set `GH_TOKEN` from the helper as above (`--write` for loops that comment,
   label or merge; read-only for the collector and the map) and use the Git credential
   helper above for pushes. Keep the person's login for the rows above. A loop's
   environment gets `GH_TOKEN` from its runner, never from a file in a repository.
6. **Switch each agent brief (planner).** Builders and reviewers on the PC run each
   GitHub command as `GH_TOKEN="$(python3 -I .../refresh-token.py --write ...)" gh ...`;
   cloud threads add `--from-secret` and get the two secrets. A brief names the
   repositories, never a token.
7. **After (PC hands).** One hour after the switch, repeat step 3 and record both
   numbers on the ticket.


## Revoke

In **Settings → Applications → Installed GitHub Apps → Configure**, choose
**Uninstall** to revoke the installation and its tokens. To retire the App too,
open **Developer settings → GitHub Apps → your App → Advanced → Delete GitHub App**.
Delete its private key in GitHub's App settings if rotating it. Remove the local
`service/app/` files only on the PC after revocation; deleting files alone does
not revoke already minted tokens. Then remove `<state>/tokens/`, the refresh
helper's cache.

## Fixture proof

```sh
python3 tools/github-app/test.py
```

`AgentTokenTests` there cover the write profile, the secret route and the refresh
helper. Tests generate disposable synthetic RSA keys in private temporary state and use
an HTTP endpoint on `127.0.0.1`, never GitHub or CloudRoom. (The setup page's browser
proofs went with the web view in #1264.) `--api-base` exists for
this seam: only the fixed production API or explicit HTTP `127.0.0.1:PORT` is
accepted, and redirects are refused. Never use real keys with the test endpoint.
The `rust` CI job runs these fixtures in its "The skills' tests" step
(`.github/workflows/ci.yml`).

Sources (GitHub documentation, read 2026-11-01):
[manifest registration](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest)
(its `setup_url` and `setup_on_update`; GitHub returning the installation URL's `state` to the
setup URL is documented, not yet observed live),
[JWT signing](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app),
[installation tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app),
[rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api),
[uninstalling](https://docs.github.com/en/apps/using-github-apps/reviewing-and-modifying-installed-github-apps).

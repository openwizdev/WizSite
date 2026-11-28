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

## The token service (GA2)

**This replaces the Cloudroom-secret route below.** Under spec #1837 and
[`token-service.v1`](../contracts/token-service.v1.md), the App's key stays on the
owner's machine, cloud threads included. Don't follow "Agent tokens (G2)"'s
`--from-secret` route or its rollout step 2. Put the key in no Cloudroom secret,
secret store, sandbox or prompt. That section stays only as the record of the
legacy flow.

The token service mints agents' one-hour `openwiz[bot]` installation tokens on the
owner's machine, beside the key. It listens on no port. An agent runs it per token:
through the owner's machine pairing from a cloud thread, or locally from a local
thread. The request goes on standard input and the answer comes back as one JSON
line on standard output. The answer holds the token only **sealed** to the one-time
public key in the request, so a kept copy of the output holds no usable token.

Run these commands **as the owner, on the machine that holds the App's state**. Pass the
same `--state-dir` as setup (by default `~/.local/state/openwiz`):

```sh
# Start: agents may now mint. A fresh install is stopped.
python3 -I tools/github-app/token-service.py start --state-dir "$HOME/.local/state/openwiz"
# The factory's App (installations on more than its owner's account): start it with the setting.
OPENWIZ_GITHUB_APP_MODE=factory python3 -I tools/github-app/token-service.py start \
  --state-dir "$HOME/.local/state/openwiz"
# Stop: every mint fails like an unreachable service, and agents fall back to your login.
python3 -I tools/github-app/token-service.py stop --state-dir "$HOME/.local/state/openwiz"
```

- **The App setting.** `start` records `OPENWIZ_GITHUB_APP_MODE` as it is then
  (unset or `user`, or `factory`), and every mint uses that recorded setting, whatever
  its own environment holds. A paired `mint` call carries no setting of its own, so
  this is how the factory's App reaches its named installations. To change it, run
  `start` again with the new setting. Any other value refuses to start.
- **What it mints.** A token for exactly the requested repositories (one owner, each
  in the App's selected installation) and permissions (at most the App's profile).
  GitHub's grant is checked against the request. A wider or different grant, or a
  request outside the installation or profile, gets the contract's refusal and never
  a token.
- **Sealing.** Each request carries `answer_key`, an RSA 3072-bit public key made for
  that request. The service encrypts the token to it with `/usr/bin/openssl` (RSA-OAEP,
  SHA-256), passing the key and the token through pipes, and answers `sealed_token`.
  Any other key is a `usage` refusal before GitHub is called. A minted token it can't
  seal is revoked at GitHub and answered `unavailable`.
- **Time left.** The expiry is checked on a fresh clock after GitHub answers. The
  token must have more than five minutes plus ten seconds left (for the log write and
  the pipe), and at most 65 minutes. A slow exchange can't hand over a token already
  due for refresh.
- **The key.** It stays at `<state>/service/app/private-key.pem`, owner-only. Only
  the service reads it, and only to sign the App's JWT. A key file that others can
  read, or that another user owns, makes every mint `unavailable` before GitHub is
  called. An agent never asks for, reads or holds it.
- **The mint log.** `<state>/service/token-service/mint-log.jsonl` (0600, in a 0700
  folder) has one line per request: when, the requester label, the repositories, the
  permissions granted, the outcome and the expiry. It never holds a token. A log
  that others can read, or a symlink in its place, makes every mint `unavailable`.
  The line is written before the token is handed over.
- **Never exposed.** No plaintext token reaches the command line, standard output,
  standard error or any file, and no key but the key's own file. Standard error stays empty except for the stopped
  service's one sentence.
- **Tests.** `python3 -I tools/github-app/test_token_service.py` runs every
  `contracts/fixtures/token-service/requests.json` case and the guards above against
  a fake GitHub with a throwaway key.

## Pairing App selection

When the owner's machine holds more than one App's state, the pairing mint must reach
the right App, not whatever the default state directory holds. Point
`OPENWIZ_TOKEN_SERVICE` at the selector, `tools/github-app/app-select.py`, instead of
the service. The contract's call is unchanged (`python3 -I '<OPENWIZ_TOKEN_SERVICE>'
mint`): the selector reads the same request, chooses one App's state directory, runs
`token-service.py mint --state-dir <that state>` and passes the service's one JSON line
and exit back unchanged. Start each App's service as above, with its own `--state-dir`.

Its config is `OPENWIZ_APP_SELECT_CONFIG`, by default
`~/.config/openwiz/app-select.json`: a regular file you own, with one link and no
group or other permission bits (0600 or 0400, say), opened without following a
symlink. It holds exactly one of:

```json
{"state_dir": "/home/someone/.local/state/openwiz-agents"}
{"routes": [{"repository": "someone/private-tool", "state_dir": "/home/someone/.local/state/openwiz"},
            {"repository": "someone/*", "state_dir": "/home/someone/.local/state/openwiz-agents"}]}
```

- **Named** (`state_dir`): every mint goes to exactly that App.
- **Route map** (`routes`): each route's `repository` is an exact `owner/name` or an
  owner glob `owner/*`, matched without regard to case; no other glob is accepted.
  Each requested repository takes the first route that matches it, and every
  requested repository must land on the same state directory. A repository no route
  matches, or a request split across two state directories, mints nothing.
- **The request is checked first, in both modes.** An invalid request gets the
  service's own `usage` refusal, and repositories of more than one owner its
  `one-owner` refusal (exit 2), before any config is read or service started.
- **Fails closed.** A missing, unreadable, symlinked or not-owner-only config, one
  with both or neither key, an unknown key, a route pattern outside the two forms, a
  relative or missing state directory, an unmatched repository or a split request:
  the selector answers the contract's refusal (`not-installed`, exit 3, when a
  repository matches no route; otherwise `unavailable`, exit 1) and writes one fixed
  sentence to standard error naming `OPENWIZ_APP_SELECT_CONFIG`. It starts no
  service and mints nothing.
- **Never exposed.** The selector opens no private key, signs nothing and makes no
  GitHub call: only the service it starts does. No key or token reaches its
  arguments, standard error or any file. The token crosses only in the service's
  answer, which the selector passes through on standard output.
- **Tests.** `python3 -I tools/github-app/test_app_select.py` runs two fake App states
  with throwaway keys against a fake GitHub: named, routed, unmatched, split, invalid
  request and unsafe-config cases, with an audit hook showing the selector opens no
  key and makes no request.

## Agent tokens (G2)

**The legacy Cloudroom-secret route is retired: use [the token service
(GA2)](#the-token-service-ga2) instead.** Put the App's key in no Cloudroom secret,
secret store, sandbox or prompt, and don't follow the earlier `--from-secret` route.

Agents read and write GitHub as the App (`<app slug>[bot]`), not as the person's
login, so their API use comes out of the App's own allowance and their comments,
reviews and pull requests are signed by the App. Since spec #1837 (GI6, option B),
they get their tokens from the owner's **token service**, under [the token-service
contract](../contracts/token-service.v1.md). This replaces the earlier route that
put the App's key in a Cloudroom secret for cloud threads.

- **The key never leaves the owner's machine.** It stays at
  `<state>/service/app/private-key.pem` (0600) on the owner's machine, read only by
  the token service. No sandbox, Cloudroom secret, pairing call, prompt, log or
  repository holds it, and no agent asks for it.
- **Agents ask the service.** Each agent runs [the agent helper](#the-agent-helper-ga3):
  it requests a token of at most one hour, scoped to its repositories and at most the
  App's permissions, refreshes it with 300 seconds or less left, and hands it to `gh`
  and git without printing it.
- **The cloud route is off until GA5's read-back.** A cloud thread reaches the service
  only through the owner's machine pairing, and only once the owner has set
  `OPENWIZ_TOKEN_SERVICE_READBACK=passed` after GA5's live check found no pairing log or
  `mac run` result record keeping a token. Until then cloud threads fall back.
- **Fallback.** With no service configured, agents work exactly as today. When the
  service is configured but gives no usable token, the agent uses the owner's login
  and says so in one standard-error line.
- **The owner's own tools stay.** `refresh-token.py` and `mint-token.py` still mint on
  the owner's machine from its key file. Their `--from-secret` route is not how agents
  get tokens.
- **Commits stay the person's.** Commits keep their author and committer (the
  person's GitHub noreply address); only the push and the GitHub records are the App's.

### Which identity does what

| Action | Identity |
| --- | --- |
| Reads, issue and pull request comments, labels, pull requests, reviews by agents, pushes of ordinary branches | The App, through the agent helper |
| Approvals the person gives (a pull request approval that counts for a rule, a grill's confirmation) | The person's login |
| Repository and organisation settings, rulesets, secrets, App installation | The person's login |
| Pushes that change `.github/workflows/` | The person's login: the App has no `workflows` permission and GitHub refuses the push |
| No service configured, a pairing whose read-back has not passed, or a failed or refused mint | The person's login, said on stderr when a service is configured; never silently |

### Rollout

The switch is GA5's person ticket: the owner installs the App on the selected
repositories, starts the token service on their machine (the token service's
runbook), and reads back that a cloud agent's comment shows `<app slug>[bot]` and
that, with the service stopped, the next agent falls back with its note. Live
identifiers (App id, installation id, state directory) stay in the private record,
never on GitHub. No key or token is recorded anywhere.

## The agent helper (GA3)

An agent gets its `openwiz[bot]` token from [the owner's token service
(GA2)](#the-token-service-ga2) through `tools/github-app/agent-token.py`, under [the
token-service contract](../contracts/token-service.v1.md), never through the legacy
Cloudroom-secret route. The App's key stays on the owner's
machine: the helper never asks for, reads or holds it.

```sh
# The request: who asks (a synthetic label), which repositories, and --read for read levels.
REQ="--requester builder-123 --repository OWNER/NAME"
# Once, at the agent's start: get the first token.
python3 -I tools/github-app/agent-token.py start $REQ
# Each GitHub command, with the same request: gh and git get this run's token, in this child only.
python3 -I tools/github-app/agent-token.py run $REQ -- gh issue comment 123 --body-file note.md
python3 -I tools/github-app/agent-token.py run $REQ -- git push origin HEAD
```

- **Configuration.** `OPENWIZ_TOKEN_SERVICE` (the service's absolute path on the
  owner's machine) and `OPENWIZ_TOKEN_SERVICE_ROUTE` (`pairing` for a cloud thread,
  `local` on the owner's machine). The pairing route is **off** until
  `OPENWIZ_TOKEN_SERVICE_READBACK` is exactly `passed`, which the owner sets only after
  GA5's live read-back finds that a kept pairing log or `mac run` result record holds
  only the sealed answer. With `OPENWIZ_TOKEN_SERVICE` unset, `start` and `run` change nothing and
  print nothing.
- **How the token crosses.** For each request the helper makes a one-time RSA 3072-bit
  key pair with `/usr/bin/openssl` and sends the public half as `answer_key`, on standard
  input. The private half stays in the helper's memory: no file, argument or environment
  variable holds it, and openssl reads it through a pipe. The token comes back only
  sealed to that key, as the piped standard output of one `room-cli mac run --stdin`
  call (or the local call). The helper opens it, checks it and writes it to the private
  file; the private key is then dropped. An answer it can't open is `bad-answer`; when
  it can't make a key it makes no call and falls back as `unreachable`. The call's
  standard error is discarded. No token is ever on a command line, in a terminal or in a log.
- **The private files.** One cache file (0600) per requester and scope, so agents on one
  account never share or replace each other's tokens, in a 0700 directory you own,
  outside every Git working tree and reached through no symlink: `OPENWIZ_AGENT_TOKEN_DIR`,
  else `$XDG_RUNTIME_DIR/openwiz-agent-token`, else `~/.cache/openwiz-agent-token`.
  The helper reaches it one folder at a time from `/`, through held descriptors and never
  through a symlink. Every folder on the way must be owned by root or you, and one that anyone
  else can write to, your own group included, must be sticky, like `/tmp`. Anything else is refused before any call.
- **Handing it over.** `run` copies the token into a snapshot file that exists only while
  the command runs. No child gets `GH_TOKEN`. The run's `gh` stand-in, first on `PATH`,
  hands over the token only for gh's own `api`, `cache`, `issue`, `label`, `pr`,
  `release`, `repo`, `run`, `search`, `status` and `workflow` commands. Anything else,
  such as `gh auth token`, `gh config`, an alias or an extension, is refused with one
  line, `openwiz: openwiz[bot] token withheld from gh (<reason>); gh stops rather than use
  another account`. It runs only the gh the run chose: the run records that gh's path
  and file identity in the private directory, and the stand-in refuses another path, or
  a file changed since, before the token is looked up. It runs gh through its open file on Linux
  and uses the resolved path on systems such as macOS only when every directory visited during
  resolution, including through symlinks, is owned by you or root and writable by no one else.
  The gh itself must be writable only by its owner, and owned by you, root or, as in a cloud
  sandbox's system gh, another non-root user. That last case works only on Linux, through
  `/proc/self/fd`: every folder from `/` down to it must be owned by root and writable by no
  one else, and the run records a SHA-256 of the gh it chose, then runs a sealed in-memory
  copy that matches it, so the gh's owner can't change what runs; the kernel and sandbox must
  allow executable memfds, or gh is refused with a message naming that restriction.
  For an allowed command, it reads
  the snapshot and starts that gh
  with `GH_TOKEN`, the owner's own `GH_CONFIG_DIR`, `GH_PAGER=cat`, and an editor and
  browser that refuse with that line, so gh starts no other program with the token. Any other child, a gh started by its full path included, sees an empty
  `GH_CONFIG_DIR`, so it fails rather than sign in as the owner. Through
  `GIT_CONFIG_*` variables, resets git's credential helpers for `https://github.com` to
  one that reads that snapshot, so gh and git use the same token. That helper answers
  only git's own HTTPS transport (`git-remote-https`), and only when it is the last
  credential helper git would use. In every other case inside a run, such as `git credential
  fill`, a hand-run call or a `-c credential.helper=...` after it, it writes one line to
  standard error, `openwiz: openwiz[bot] token withheld from git (<reason>); git stops
  rather than use another account`, and tells git to quit. git then fails, rather than
  print the token or sign in as the owner. The run also gives git its own exec folder
  (`GIT_EXEC_PATH`, removed when the command ends), put first on `PATH`. If it can't be
  built, for example because `git --exec-path` fails, the run refuses before handing
  anything over. The folder's `git` refuses with the same note when `GIT_EXEC_PATH`,
  `GIT_SSH_COMMAND` or `GIT_ALLOW_PROTOCOL` was changed or unset, or when an
  `--exec-path=` option overrides it. Otherwise it starts the
  real git without `GH_TOKEN`, even when gh starts it, so no git trace can show it. Its
  `git-remote-http(s)` checks first. It drops `GIT_TRACE_CURL`, `GIT_TRACE_CURL_NO_DATA` and `GIT_CURL_VERBOSE`, so
  no trace shows the Authorization header. For github.com it refuses with the same
  note unless this run's helper is the last credential helper, no `http.*.extraHeader`
  is set and the URL holds no credential, so a `-c` that replaces the helper list
  can't sign git in as the owner. SSH has no App identity, so the run sets
  `GIT_SSH_COMMAND` to the folder's `openwiz-ssh`, which refuses with the same note
  before the owner's ssh or key is used. This covers an SSH remote, an `insteadOf`
  rewrite to SSH and any `core.sshCommand`, because the environment variable overrides
  them. The run also sets `GIT_ALLOW_PROTOCOL=file:https:ssh`, so other transports,
  such as `ext::`, which can run any command, are off whatever the configuration says.
  Nothing is exported to the agent's shell.
- **The old App key.** With a token service configured, every helper command refuses
  while `OPENWIZ_GITHUB_APP_KEY` (the earlier route's Cloudroom secret) is set. It checks
  the name only, by listing the environment's names, before any value is read or copied, and names the variable,
  never its value. Remove that secret from the
  agent's environment, because the token service holds the key. The service call never
  gets it either.
- **Refresh.** Before each use, a token with 300 seconds or less left is replaced by a
  fresh request. An answer is used only when it names exactly the requested
  repositories and permissions and has more than 300 and at most 3900 seconds left.
- **Fallback.** When no token can be had, the helper takes the request's cache file and every
  running `run`'s snapshot of it out of use: it revokes a live token and deletes the file only
  after GitHub confirms, and keeps the file for a later `revoke` if that revoke fails or the
  file can't be read ([Revoke](#revoke)). It hands no App token, and no handle to one, to the
  command (one handed down by an outer `run` included), and
  writes exactly one line to standard error:
  `openwiz: no openwiz[bot] token (<reason>); using the owner's GitHub account`. The
  reasons are `unreachable`, `bad-answer`, `pairing-off` and the service's refusal
  codes. gh and git then both use the owner's existing login, as today.
- **Proof.** `python3 -I tools/github-app/test_agent_token.py` runs the helper against
  a fake service, a fake `room-cli` and a fake `gh`, with synthetic tokens only.

## Revoke

**An agent's token.** Revoke a token the helper holds with the same request, never with gh
and never by deleting its folder:

```sh
python3 -I tools/github-app/agent-token.py revoke $REQ
```

- It makes its own HTTPS call, `DELETE /installation/token` with the token in the
  `Authorization` header, to `https://api.github.com` only, through no proxy and following no
  redirect. It never runs gh, its guard or any shim, so a refused or missing gh can't stop it.
  `OPENWIZ_GITHUB_API_BASE` exists for the tests and accepts only `http://127.0.0.1:PORT`.
- It finds the request's tokens by name: the request's cache file, its kept files, and every
  run snapshot that records this request. Inside a `run` for the same request it asks the `run`
  itself, which holds its token in memory, through a socket the run hands down that can only ask
  for a revoke and never returns the token. So it still works when the folder is partly gone, the
  cache file is unreadable, or the folder was moved or deleted. A run asked about another request
  leaves it to the folder, and its own token is never used for it.
- Before its call it moves each token it found into a kept file, so it is never handed out
  again. A `run` whose folder was deleted first writes its token into a kept file in a fresh
  private folder at the same path, so a refused revoke leaves a copy that outlives the run.
  Only after GitHub confirms (`204`) does it remove every file holding exactly that token. A
  token minted meanwhile and another request's token are never touched, and the helper never
  removes the private folder itself, so a mint in flight can always store its answer. If the
  folder is deleted under a mint anyway, the helper revokes the new token and stops with one line.
- **Kept files.** A token is never deleted or replaced while it may be live and unrevoked. The
  helper moves it to its own `kept-<request>-<random>.json` file in the same 0700 folder, and
  revokes it there. The helper does this when it falls back, when a refresh replaces a token
  that no running `run` still holds, when a `run` ends holding a token nothing else holds, and
  when `revoke` starts. A fallback and `revoke` also move every run snapshot that records the
  request into a kept file, even when the cache file can't be read, and a run's gh and git read
  only their own snapshot, so a kept token never reaches gh, git or the caller again. A file the helper can't read is kept the same way, never deleted or
  overwritten; an expired token's file is deleted. Every later mint or fallback for the request
  tries the kept tokens' revoke again, and `revoke` with the same request tries it at once.
  Locking keeps two helpers from racing on these files, and no lock is held during a call to
  GitHub.
- It fails closed with exactly one line on standard error and exit 1, and never prints the
  token: `openwiz: openwiz[bot] token not revoked (no token found)` when it holds no current
  token, or `openwiz: openwiz[bot] token not revoked (<reason>); the token is kept for a later
  revoke` with `GitHub refused`, `GitHub unreachable` or `not the GitHub API`. The token then
  stays in its kept file, so you can retry; never delete it, which leaves a live token nobody
  can revoke.
- **Last resort.** GitHub revokes an installation token only with the token itself. If it is
  lost or can't be revoked, the owner suspends the installation (**Settings → Applications →
  Installed GitHub Apps → Configure → Suspend**), which stops every token it has minted.

**The installation.** In **Settings → Applications → Installed GitHub Apps → Configure**, choose
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

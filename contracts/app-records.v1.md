# OpenWiz app records contract, version 1 (`openwiz.app-records.v1`)

What the v2 app at openwiz.dev/app may write, and the browser interfaces the queue, the cards and the records layer share. Every write is one GitHub comment, posted as the signed-in user through `OW.records`. Nothing else in the app writes.

**Contract first** (openwizdev/OpenWiz#2528, AP1 of spec openwizdev/OpenWiz#2522). AP2 (#2535) builds `OW.records` and the switch, AP3 (#2539) the queue, AP4 (#2542) `OW.cards.decision` and AP5 (#2544) `OW.cards.spec`, each against this file. The fixtures are in [`tests/v2/fixtures/forms/`](../tests/v2/fixtures/forms/); [`tests/v2/contract.test.mjs`](../tests/v2/contract.test.mjs) reads the tables below and checks every fixture against them byte for byte, so a table row and its fixture never drift apart.

Sources, cited by path and never changed here:

- **decisions.v1**: `contracts/decisions.v1.md` in `openwizdev/OpenWiz`, "Response, risk and answers" and "Four request variants".
- **steer**: `skills/launch-fleet/references/steer.md` in `openwizdev/WizSkills`, and the video comment's form in `skills/to-spec/SKILL.md` there.

Where a source is silent, this contract chooses the smallest form and says **chosen** in the row.

## Forms

These are the only comments the app writes. A form is one card action on one kind of item. Every body is exact UTF-8, with no trailing newline unless the owner typed one.

### Decision answers

A decision answer is decisions.v1's contextual answer message, posted as a new comment on the request's own subject (the issue or pull request whose comment holds the request record). The whole body is exactly:

```text
openwiz decision answer v1
<context>

<answer segment>
```

The first line ends with one LF, `<context>` is the context line below followed by two LF, and the answer segment runs to the end of the body with nothing after it.

| Form | Card action | Request kind | Answer segment | Source |
| --- | --- | --- | --- | --- |
| `decision.yes` | Yes | `grill_round` | `<question_id> yes` | decisions.v1: the answer segment `G1 yes` takes the shown recommendation |
| `decision.yes` | Yes | `grill_confirmation` | `confirm` | decisions.v1: `confirm` for the grill summary |
| `decision.yes` | Yes | `spec_confirmation` | `confirm spec #<spec>` | decisions.v1: `confirm spec #N` |
| `decision.yes` | Yes | `plan_approval` | `approve #<spec>` | decisions.v1: `approve #N` |
| `decision.no` | No | `grill_round` | `<question_id> no` | chosen: decisions.v1 names no "no" segment; this mirrors `G1 yes` and is read as own words |
| `decision.no` | No | `grill_confirmation` | `no` | chosen: decisions.v1 names no "no" segment; read as own words |
| `decision.no` | No | `spec_confirmation` | `no` | chosen: decisions.v1 names no "no" segment; read as own words |
| `decision.no` | No | `plan_approval` | `no` | chosen: decisions.v1 names no "no" segment; read as own words |
| `decision.own` | Typed reply | `grill_round` | `<words>` | decisions.v1: the exact own-words answer, every byte kept |
| `decision.own` | Typed reply | `grill_confirmation` | `<words>` | decisions.v1: the exact own-words answer, every byte kept |
| `decision.own` | Typed reply | `spec_confirmation` | `<words>` | decisions.v1: the exact own-words answer, every byte kept |
| `decision.own` | Typed reply | `plan_approval` | `<words>` | decisions.v1: the exact own-words answer, every byte kept |

`<question_id>` is the action's `question_id`, `<spec>` the request's `spec` as a decimal integer, and `<words>` the action's `words` exactly as typed: no trimming, escaping, normalization or prefix, never parsed. decisions.v1's `simplify G1` has no button; the owner can type it as a reply.

### Context line

decisions.v1's compact JSON context object: these keys in this order, no whitespace outside strings, decimal integers, ordinary JSON string escaping and no escaped `/` (what `JSON.stringify` writes).

| Request kind | Keys, in order |
| --- | --- |
| `grill_round` | `subject`, `comment_id`, `request_id`, `request_kind`, `fingerprint`, `grill_file`, `round`, `question_id` |
| `grill_confirmation` | `subject`, `comment_id`, `request_id`, `request_kind`, `fingerprint`, `grill_file` |
| `spec_confirmation` | `subject`, `comment_id`, `request_id`, `request_kind`, `fingerprint`, `spec` |
| `plan_approval` | `subject`, `comment_id`, `request_id`, `request_kind`, `fingerprint`, `spec` |

### Context values

| Key | From |
| --- | --- |
| `subject` | `action.item.repository`, `action.item.subject.kind`, `action.item.subject.number` (as keys `repository`, `kind`, `number`, in that order) |
| `comment_id` | `action.item.comment_id` |
| `request_id` | `action.item.request.id` |
| `request_kind` | `action.item.request.kind` |
| `fingerprint` | `action.item.request.fingerprint` |
| `grill_file` | `action.item.request.grill_file` |
| `round` | `action.item.request.round` |
| `question_id` | `action.question_id` |
| `spec` | `action.item.request.spec` |

The grill fixtures spell `grill_file`'s slashes as `\/` inside their JSON files only because the site's privacy check refuses that path prefix in any tracked file; the decoded value, and the body the app writes, has plain `/`.

### Spec steers

A steer is a new comment on the spec issue itself, not on its video comment's text (GitHub comments have no replies). steer.md says no comment steers yet, until openwizdev/openwiz#1402; until then the orchestrator reads app steers as the owner's words, as the spec says.

| Form | Card action | Body | Goes on | Source |
| --- | --- | --- | --- | --- |
| `spec.ship` | Ship it | `go on` | the spec issue | chosen: steer.md names `stop`, `reset` and "anything else" and no go-on word; `go on` is the smallest plain go-on steer |
| `spec.change` | Change something | `<words>` | the spec issue | steer: "anything else", the owner's typed words verbatim |
| `spec.not_now` | Not now | `stop` | the spec issue | steer: `stop` |

`reset` has no button; the owner can type it under Change something.

### Action fields

An action is a plain object with exactly these fields. A missing or extra field is `not_a_form`.

| Form | Fields | For grill_round |
| --- | --- | --- |
| `decision.yes`, `decision.no` | `form`, `item` | `question_id` |
| `decision.own` | `form`, `item`, `words` | `question_id` |
| `spec.ship`, `spec.not_now` | `form`, `item` | none |
| `spec.change` | `form`, `item`, `words` | none |

"For grill_round" fields are added when `item.request.kind` is `grill_round`. `item` is a queue item (below) whose `type` matches the form's first word.

### Confirmation

| Risk | Confirms before the send |
| --- | --- |
| `ordinary` | 1 |
| `live`, `release`, `publish` | 2 (decisions.v1: always a second explicit confirmation) |
| a spec steer | 1 |

Each confirm shows the same full preview: body, repository, subject and visibility. A second confirm is a separate tap after the first, never one tap counted twice.

## Refusals

`compose` checks these in order and returns the first that applies. Checks 3 to 7 apply to decision items only.

| Order | Reason | When |
| --- | --- | --- |
| 1 | `not_a_form` | the form is not in the tables above, the item's `type` is not the form's card, or the action's fields are not exactly its row in "Action fields" |
| 2 | `other_repository` | `item.repository` is not the picked repository's full name, exactly |
| 3 | `unreadable` | `item.request` is null: an unreadable or unchecked record |
| 4 | `not_open` | `item.request.status` is not `open` (resolved or superseded) |
| 5 | `not_current` | `item.current` is not `true` (stale, or currentness unknown) |
| 6 | `risk_unknown` | `item.request.risk` is not `ordinary`, `live`, `release` or `publish` |
| 7 | `answered` | for `grill_round`, `question_id` is not one of the request's questions, or is in its `answered` list |
| 8 | `empty` | `words` is not a string, or has no non-whitespace character |
| 9 | `refused_form` | the composed body holds a refused form below |
| 10 | `too_long` | the composed body is longer than 65,536 characters (JavaScript string length, GitHub's comment limit); it is never cut or split |

### Refused forms

The app never writes these, in any form, own words and steer words included. A marker at "line start" counts after any leading spaces or tabs, on any line split at LF, CR LF or CR.

| Record | Marker | Where |
| --- | --- | --- |
| launch-fleet records | `launch-fleet:` | line start |
| decisions.v1 request records | `openwiz.decisions.` | anywhere |
| machine plan approvals | `**Machine plan approval` | line start |
| human plan approvals | `**Plan graph approved by` | line start |
| late-look records | `**Late look by` | line start |

Anything not in "Forms" is refused too, as `not_a_form`: the app writes no labels, edits, reactions, issues, reviews or other records.

## The queue

### Items

AP3 builds these from the v1 model: `OW.factory.model(feeds)` for the spec list and each spec's `detail.comments`, `OW.factory.readRecord` for each comment's record and `OW.factory.recordAuthors(feeds.specs.data.fleet.text)` for its author check. `repository` is `OW.data.repo.get().full`.

A **decision item**, one per request record by a record author:

```text
{ type: 'decision', key: 'decision:<repository>#<number>:<comment_id>',
  repository, subject: { kind: 'issue' | 'pull_request', number },
  title, url, comment_id, at,
  current: true | false | null,
  request: <the decisions.v1 request object, as read> | null }
```

`title` is the subject's title, `url` the record comment's link and `at` its creation time in milliseconds. `request` is null when the record is malformed or its author couldn't be checked; the card says why and offers no answer. `current` is `true` only when the subject's comments were read completely in the latest good read, the record is `open`, and no later record of the same kind and spec (or grill file) follows it on that subject; `false` when such a later record exists; otherwise `null`. The orchestrator still checks currentness itself on receipt (decisions.v1).

A **spec item**, one per open spec with tickets not all done (`total > 0` and `done < total`):

```text
{ type: 'spec', key: 'spec:<repository>#<number>',
  repository, subject: { kind: 'issue', number },
  title, url, at,
  video: { url } | null,
  graph: <the v1 model's spec graph> | null }
```

`video.url` is the `https` link from the latest record author's comment that is exactly to-spec's video form: `[Watch the narrated spec](<url>)`, a blank line, then one of to-spec's two steer lines. `graph` is the v1 model's `spec.graph`, which `app/pages/spec.js` draws.

### Order

Decision items first, oldest `at` first (decisions.v1's order); then spec items, newest `at` first. Ties sort by `key`. A partial read keeps the You page's honest gap line: the list may be missing items, never "nothing needs you".

## Interfaces

### `OW.records`

- `enabled() -> boolean`: true when the switch is `on` or `dry-run`.
- `dryRun() -> boolean`: true when the switch is `dry-run`.
- `compose(action) -> Promise<preview | { refused: <reason> }>`: never sends anything.
- `post(preview) -> Promise<outcome>`: sends only a preview `compose` returned, unchanged, after its confirms.

A **preview**:

```text
{ op, form, body, repository, subject: { kind, number }, url, visibility: 'public' | 'repository', confirms: 1 | 2 }
```

`url` is the subject's GitHub page. `visibility` is `public` for a public repository and `repository` (everyone who can read it) for a private one, from the installation's repository list. The comment is posted as `POST https://api.github.com/repos/<repository>/issues/<number>/comments` with JSON `{"body": <body>}`, for issues and pull requests alike.

An **outcome**:

| Outcome | Shape | Means |
| --- | --- | --- |
| posted | `{ outcome: 'posted', op, comment: { id, url } }` | GitHub created the comment, or a re-read found it |
| refused | `{ outcome: 'refused', op, reason }` | nothing was posted: `dry_run`, `disabled`, `not_composed`, `signed_out`, or `github` (GitHub answered 4xx) |
| unknown | `{ outcome: 'unknown', op, reason }` | it may have posted (a network failure, a timeout or a 5xx); never shown as sent |

### Operation id

`op` is `op-` and the first 32 lowercase hex digits of SHA-256 over the UTF-8 of `<repository>` LF `<subject kind>` LF `<subject number>` LF `<body>`. The same action gives the same id across retries, reloads and double taps. A `posted` id returns its saved outcome and sends nothing. After an `unknown`, `post` first reads the subject's comments for one by the signed-in user with that exact body: found is `posted`; a complete read without it may send once more; an incomplete read stays `unknown`. Worked example: fixture `spec-not_now` has the operation id `op-495e41e234d773e20c706371bd373f8f`.

### Cards

`OW.cards.decision(item, el)` and `OW.cards.spec(item, el)` each draw one card for one queue item into `el`, replacing its children, and return nothing. A card writes only through `OW.records.compose` and `OW.records.post`, shows the preview exactly before any post, and shows each outcome plainly. Each card module adds its own key to `OW.cards = OW.cards || {}`.

## The switch

| Setting | Value |
| --- | --- |
| Storage | `localStorage`, key `openwiz.app.v2`, per browser |
| Values | `"on"`, `"dry-run"` or `"off"`, JSON strings as the app's store writes them |
| Default | `off`: no value, or any other value, is off |
| Setting it | opening `/app/?v2=on`, `?v2=dry-run` or `?v2=off` stores that value and removes the parameter from the address |

Off, the app is v1: no queue and no write. `dry-run` shows the queue and every preview, and `post` refuses with `dry_run` before any request. Signing out keeps the switch.

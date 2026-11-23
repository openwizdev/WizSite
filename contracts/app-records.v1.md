# OpenWiz app records contract, version 1 (`openwiz.app-records.v1`)

What the v2 app at openwiz.dev/app may write, and the browser interfaces the queue, the cards and the records layer share. Every write is one GitHub comment, posted as the signed-in user through `OW.records`. Nothing else in the app writes.

**Contract first** (openwizdev/OpenWiz#2528, AP1 of spec openwizdev/OpenWiz#2522). AP2 (#2535) builds `OW.records` and the switch, AP3 (#2539) the queue, AP4 (#2542) `OW.cards.decision` and AP5 (#2544) `OW.cards.spec`, each against this file. The fixtures are in [`tests/v2/fixtures/`](../tests/v2/fixtures/): `forms/` (one per form, plus `refused/` and `accepted/`), `queue/` (recorded grill pull request reads, one or more refreshes each) and `posts/` (recorded compose, confirm and post sequences, with their write counts). Every GitHub answer in them is recorded under `METHOD /path?query`, exactly as the app asks. [`tests/v2/contract.test.mjs`](../tests/v2/contract.test.mjs) reads the tables below and checks every fixture against them, bodies byte for byte, so a table row and its fixture never drift apart; AP2 and AP3 run the same recordings in the browser harness.

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

Each confirm is recorded in `OW.records` itself, never only in the card: the card calls `OW.records.confirm(preview, event)` once per tap, from that tap's own click handler (see "Interfaces"). `post` reads the recorded confirms, not the card's word for them: with no recorded confirm, or with only the first of a risky preview's two, it makes **zero requests** and answers `refused` `not_confirmed`; after the final required confirm it makes the fresh source check and then exactly one write.

## Refusals

`compose` checks these in order and returns the first that applies. Checks 3 to 7, 11 and 12 apply to decision items only. Checks 1 to 10 use only the action; checks 11 and 12 are the fresh source check (below), the only reads `compose` makes.

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
| 11 | `source_changed` | the fresh source check positively found the request or its saved source changed |
| 12 | `source_unchecked` | the fresh source check could not finish: a read failed, was incomplete or was unreadable |

### Refused forms

The app never writes these, in any form, own words and steer words included. A marker at "line start" counts after any leading spaces or tabs, on any line split at LF, CR LF or CR. A marker "in a decoded string" counts at the start of any decoded JSON string token of the body (below).

| Record | Marker | Where |
| --- | --- | --- |
| launch-fleet records | `launch-fleet:` | line start |
| decisions.v1 request records | `openwiz.decisions.` | anywhere, or in a decoded string |
| machine plan approvals | `**Machine plan approval` | line start |
| human plan approvals | `**Plan graph approved by` | line start |
| late-look records | `**Late look by` | line start |

Anything not in "Forms" is refused too, as `not_a_form`: the app writes no labels, edits, reactions, issues, reviews or other records.

**Decoded strings** follow decisions.v1's candidate discovery ("inspect raw text and decoded JSON string tokens"), so a request record spelled with Unicode escapes, an unsupported version or escaped keys is refused like a literal one. A JSON string token is a `"`, then any run of characters other than `"`, `\` and U+0000 to U+001F, or of `\` and one more character, then a closing `"`. Every `"` in the body starts one candidate token, so overlapping pairings are all tried, inside a fence or not. A token is decoded with `JSON.parse`; when that refuses it (a bad escape), it is decoded leniently instead: each valid `\uXXXX` and each of `\" \\ \/ \b \f \n \r \t` becomes its character, and any other backslash stays as written. The body is refused when any decoded token starts with `openwiz.decisions.`. Decoding is for detection only: an accepted body is written byte for byte as composed, its escapes untouched.

## The queue

### Items

AP3 builds these from two reads. **Spec issues** come from the v1 model: `OW.factory.model(feeds)` for the spec list and each spec's `detail.comments`, which hold `spec_confirmation` and `plan_approval` records. **Grill pull requests** come from the read below, which holds `grill_round` and `grill_confirmation` records (decisions.v1: "a round record is posted on that grill's PR; summary confirmation goes there too"). Both use `OW.factory.readRecord` for each comment's record and `OW.factory.recordAuthors(feeds.specs.data.fleet.text)` for its author check. `repository` is `OW.data.repo.get().full`.

A **decision item**, one per request record by a record author:

```text
{ type: 'decision', key: 'decision:<repository>#<number>:<comment_id>',
  repository, subject: { kind: 'issue' | 'pull_request', number },
  title, url, comment_id, at,
  current: true | false | null, checked_at: <milliseconds> | null,
  request: <the decisions.v1 request object, as read> | null }
```

`title` is the subject's title and `subject` its kind and number, both from GitHub's metadata for the subject, never from the record's JSON. `url` is the record comment's link and `at` its creation time in milliseconds. `request` is null when the record is malformed, sits on the wrong kind of subject (a grill kind on an issue, a spec kind on a pull request) or its author couldn't be checked; the card says why and offers no answer.

`current` is `true` only when, in the **latest** refresh, all of these held: the subject's comments were read completely, the record is `open`, no later record of the same kind and spec (or grill file) follows it on that subject, and the source check below positively matched it. `checked_at` is when that check's reads finished, and null when no check ran or it couldn't finish. `current` is `false` when a later record exists or the check positively found a change, and `null` (with a gap) in every other case. A failed refresh never keeps an earlier `true`: any read the item rests on that fails in the latest refresh sets it to `null`, however good the cached read was. The orchestrator still checks currentness itself on receipt (decisions.v1).

A **spec item**, one per open spec with tickets not all done (`total > 0` and `done < total`):

```text
{ type: 'spec', key: 'spec:<repository>#<number>',
  repository, subject: { kind: 'issue', number },
  title, url, at,
  video: { url } | null,
  graph: <the v1 model's spec graph> | null }
```

`video.url` is the `https` link from the latest record author's comment that is exactly to-spec's video form: `[Watch the narrated spec](<url>)`, a blank line, then one of to-spec's two steer lines. `graph` is the v1 model's `spec.graph`, which `app/pages/spec.js` draws.

### Grill pull requests

The v1 spec read searches issues only, so AP3 adds this read for the picked repository, one pass per queue refresh, with the same GitHub client, pacing and sign-out handling as `app/data.js`:

1. **Subjects.** `GET /repos/<repository>/pulls?state=open&per_page=100&page=<n>`, every page until `Link` has no `rel="next"`. Each pull request whose `head.repo.full_name` is exactly `<repository>` is a subject, with kind `pull_request`, `number`, `title`, `html_url` and `head.sha` taken from this read. A fork's pull request is not a subject (**chosen**: its head is not the grill under review).
2. **Comments.** For each subject, `GET /repos/<repository>/issues/<number>/comments?per_page=100&page=<n>`, every page: its conversation comments. Inline review comments are not read (decisions.v1: "inline code-review comments are not posting locations").
3. **Authors.** A comment whose `user.login` is not a record author is an ordinary comment and is skipped. When the record authors couldn't be read, every candidate record becomes an item with `request` null.
4. **Requests.** `readRecord` validates each candidate by decisions.v1's grill variants: exactly the schema's keys; `grill_file` the relative grills-folder path decisions.v1 names, with no traversal; `round` a positive integer; 1 to 3 questions, each exactly `id`, `decides`, `context`, `recommendation`, all nonempty strings, ids one or two uppercase letters and a positive counter, unique; `answered` unique question ids in question order; `summary` 1 to 10 nonempty lines with no CR or LF. Candidate discovery is decisions.v1's, raw and decoded, as in "Decoded strings" above. Anything else is malformed: an item with `request` null.
5. **Completeness.** The read is complete only when every page of step 1 and of each subject's step 2 was read. A failed or capped page is a gap naming the pull request, and its items' `current` is `null`.

Closed pull requests are not read (**chosen**: the queue shows open work only). So the queue is complete only for open spec issues and open grill pull requests, and its empty line says exactly that: "No open spec or grill pull request is waiting on you", never "nothing needs you".

### Source check

decisions.v1: `current` is known true "only after reading and checking those current source inputs". One check serves the queue's `current`, `compose` (checks 11 and 12) and `post` (after the final confirm). It makes fresh reads only, never answered from a cache, and every read must succeed; any failed, incomplete or unreadable read makes the result **unchecked**. Otherwise it is **matched** when every row below holds, and **changed** when any fails.

| Request kind | Reads | Matched when | Binding |
| --- | --- | --- | --- |
| all | `GET /repos/<repository>/issues/comments/<comment_id>` | its `issue_url` ends `/issues/<subject number>`, its author is a record author, and its record, read by `readRecord`, deep-equals `item.request` | |
| `grill_round`, `grill_confirmation` | `GET /repos/<repository>/pulls/<number>`, then `GET /repos/<repository>/contents/<grill_file>?ref=<head.sha>` | the pull request is open with `head.repo.full_name` equal to `<repository>`, and the grill file at that head, decoded as UTF-8, read by grill's `latest()` (`skills/grill/scripts/records.py` in WizSkills), gives exactly the request's kind, risk and round with its questions in order, or its summary lines | `ref` the head commit, `digest` the SHA-256 of the grill file's bytes |
| `spec_confirmation` | `GET /repos/<repository>/issues/<spec>` | the spec is open, and the first nonblank line of its body's `## Changelog headline` section equals `headline` | `ref` `issue`, `digest` the SHA-256 of the issue body |
| `plan_approval` | the `spec_confirmation` read, then `GET /repos/<repository>/issues/<spec>/sub_issues?per_page=100` (every page) and `GET /repos/<repository>/issues/<ticket>/dependencies/blocked_by?per_page=100` for each ticket | the `spec_confirmation` row holds, the tickets (number, title, sorted blockers) equal `tickets`, and the SHA-256 of the revision-v2 text, built exactly as `skills/to-tickets/revision.sh` in WizSkills prints it, equals `fingerprint` | `ref` `revision-v2`, `digest` that SHA-256 |

A matched check gives the binding `{ ref, digest }`. `compose` puts it in the preview as `source`, and `post` repeats the whole check after the final confirm and sends only when it matches again with the same binding: a source edited after `compose`, between the confirms, or a check that can't finish, fails closed with zero writes. Spec steers carry `source: null` and have no source check.

### Order

Decision items first, oldest `at` first (decisions.v1's order); then spec items, newest `at` first. Ties sort by `key`. A partial read keeps the You page's honest gap line: the list may be missing items, never "nothing needs you".

## Interfaces

### `OW.records`

- `enabled() -> boolean`: true when the switch is `on` or `dry-run`.
- `dryRun() -> boolean`: true when the switch is `dry-run`.
- `compose(action) -> Promise<preview | { refused: <reason> }>`: never writes. Its only reads are the source check.
- `confirm(preview, event) -> { confirmed, of }`: records one explicit confirm of that exact preview and returns how many it has (`confirmed`) of how many it needs (`of`, the preview's `confirms`).
- `post(preview) -> Promise<outcome>`: sends only a preview `compose` returned, unchanged, after all its recorded confirms.
- `pending() -> [preview]`: the signed-in account's intents still `sending` or `unknown`, restored after a reload, so the card can show each one and offer to check it again with `post`.

A **preview**:

```text
{ op, form, body, repository, subject: { kind, number }, url, visibility: 'public' | 'repository', confirms: 1 | 2,
  source: { ref, digest } | null }
```

`url` is the subject's GitHub page. `visibility` is `public` for a public repository and `repository` (everyone who can read it) for a private one, from the installation's repository list. `source` is the source check's binding (null for a steer). The comment is posted as `POST https://api.github.com/repos/<repository>/issues/<number>/comments` with JSON `{"body": <body>}`, for issues and pull requests alike.

**Confirms.** `OW.records` keeps every preview it issued (a `WeakMap`), so a copied, edited or forged preview is `not_composed`. `confirm` counts a call only when `event` is a trusted click (`event.isTrusted` is true) that no earlier `confirm` used, and the preview's previous confirm, if any, is recorded; any other call changes nothing. Calls past `confirms` change nothing. `post` refuses `not_confirmed` with zero requests, reads included, until the recorded count equals `confirms`. A post consumes the confirms: checking an `unknown` intent again needs its confirms again.

**`post`, in order.** The first step that answers ends it:

1. a preview `OW.records` didn't issue, or one changed since: `refused` `not_composed`;
2. the switch off: `disabled`; `dry-run`: `dry_run`; signed out: `signed_out`;
3. the same intent already in flight: that call's promise;
4. the intent's saved outcome is `posted`: that outcome, sending nothing;
5. fewer recorded confirms than `confirms`: `not_confirmed`;
6. another intent of this account on the same subject `sending` or `unknown`: `pending`;
7. the source check (decision previews only), which must match with the preview's `source`: else `source_changed` or `source_unchecked`;
8. after an earlier `unknown` of this intent, the unknown-outcome read below;
9. save the `sending` receipt, then exactly one write.

Steps 1 to 6 make no request.

An **outcome**:

| Outcome | Shape | Means |
| --- | --- | --- |
| posted | `{ outcome: 'posted', op, comment: { id, url } }` | GitHub created the comment, or a re-read found it |
| refused | `{ outcome: 'refused', op, reason }` | nothing was posted: `dry_run`, `disabled`, `not_composed`, `not_confirmed`, `signed_out`, `pending`, `source_changed`, `source_unchecked`, or `github` (GitHub answered 4xx) |
| unknown | `{ outcome: 'unknown', op, reason }` | it may have posted (a network failure, a timeout or a 5xx); never shown as sent |

`pending` means another intent of this account on the same subject is still `sending` or `unknown`; the card shows that one and offers checking it, and `post` makes zero requests.

### Operation id

`op` is `op-` and 32 lowercase hex digits from `crypto.getRandomValues` (16 bytes). `compose` gives every new intent a new id, so two separate steers with identical text on the same subject (Not now, Ship it, Not now) are three intents, three ids and three writes. An id is reused only for that same pending intent: a double tap (a `post` while its first is in flight returns the same promise), a retry of an `unknown`, and a reload (`pending()` restores it). A `posted` id returns its saved outcome and sends nothing.

**Receipts.** Just before its one write (step 9), `post` saves the intent (`op`, `body`, `repository`, `subject`, `source`, the preview, for a decision its queue item, state `sending`, and `sent_at` the time just before the write) in `localStorage` under `openwiz.app.v2.receipts.<user id>`, the signed-in account's numeric GitHub id from `GET /user`. It then saves each outcome there. Receipts are per account: another account signed in on the same browser reads none of them, and signing out keeps them.

**Unknown outcomes.** Before sending again after an `unknown`, `post` reads every page of the subject's comments and looks only for comments that could have come from that send: author id the signed-in account's, body exactly the intent's, `created_at` no earlier than `sent_at` minus five minutes, and not already the comment of another receipt of this account. One found is `posted` with that comment. A complete read with none may send once more; an incomplete read stays `unknown`. A comment with the same words from another account, or from before the send, is never taken as this send.

### Cards

`OW.cards.decision(item, el)` and `OW.cards.spec(item, el)` each draw one card for one queue item into `el`, replacing its children, and return nothing. A card writes only through `OW.records.compose`, `OW.records.confirm` and `OW.records.post`, shows the preview exactly before any post, and shows each outcome plainly. Each card module adds its own key to `OW.cards = OW.cards || {}`.

## The switch

| Setting | Value |
| --- | --- |
| Storage | `localStorage`, key `openwiz.app.v2`, per browser |
| Values | `"on"`, `"dry-run"` or `"off"`, JSON strings as the app's store writes them |
| Default | `off`: no value, or any other value, is off |
| Setting it | opening `/app/?v2=on`, `?v2=dry-run` or `?v2=off` stores that value and removes the parameter from the address |

Off, the app is v1: no queue and no write. `dry-run` shows the queue and every preview, and `post` refuses with `dry_run` before any request. Signing out keeps the switch.

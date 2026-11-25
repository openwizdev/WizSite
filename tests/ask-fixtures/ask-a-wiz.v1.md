# Ask a Wiz v1 (`openwiz.ask-a-wiz.v1`)

FA1 of spec #1898 (0.1.1), its contract-first ticket (#1899). This contract
fixes openwiz.dev's "Ask a Wiz..." FAQ row end to end: the request, the
streamed answer and every refusal, the exact not-covered answer, the rate
limit, the daily cap, the docs index the answers draw from, the names of the
secret, the settings and the counter store, the off switch, and what is
stored. FA2 (#1900) builds the index, FA3 (#1901) the function, FA4 (#1902)
the row, and FA5 (#1903) is Jake setting the secret, the store and the cap.
They build to this contract.

**This contract grants nothing.** It sets no secret, binds no store, calls no
model, turns no switch on and spends nothing. A fixture or test that passes
here proves the contract is consistent, never that any of it is live. Every
fixture is synthetic: its questions, answers, passages, visitors and counter
values are made up, and its upstream is a fake OpenRouter.

## The pin

The JSON block below is the machine-readable pin.
[`fixtures/ask-a-wiz/test_fixtures.py`](fixtures/ask-a-wiz/test_fixtures.py)
checks every fixture against it. The prose explains it. Where they disagree,
the contract is wrong and must be fixed.

```json
{
  "schema": "openwiz.ask-a-wiz.v1",
  "authority": {"secret": false, "store": false, "model_call": false, "switch": false, "spend": false},
  "endpoint": {"path": "/api/ask", "probe": "GET", "ask": "POST"},
  "names": {
    "secret": "OPENROUTER_API_KEY",
    "store": "ASK_A_WIZ_COUNTERS",
    "store_kind": "d1",
    "switch": "ASK_A_WIZ",
    "switch_on": "on",
    "model": "ASK_A_WIZ_MODEL",
    "daily_cap": "ASK_A_WIZ_DAILY_CAP",
    "daily_cap_usd": "ASK_A_WIZ_DAILY_CAP_USD",
    "max_prompt_price": "ASK_A_WIZ_MAX_PROMPT_PRICE",
    "max_completion_price": "ASK_A_WIZ_MAX_COMPLETION_PRICE",
    "max_request_price": "ASK_A_WIZ_MAX_REQUEST_PRICE",
    "index_path": "/ask-index.json",
    "turnstile_secret": "TURNSTILE_SECRET_KEY",
    "turnstile_site_key": "TURNSTILE_SITE_KEY"
  },
  "request": {
    "content_type": "application/json",
    "keys": ["question"],
    "max_body_bytes": 4096,
    "max_question_chars": 300,
    "min_question_chars": 1,
    "same_origin": true,
    "turnstile_header": "CF-Turnstile-Response"
  },
  "turnstile": {
    "siteverify": "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    "action": "ask",
    "hostname": "the request's own",
    "probe_key": "turnstile_site_key",
    "on_when": "TURNSTILE_SECRET_KEY is set"
  },
  "response": {
    "content_type": "application/x-ndjson; charset=utf-8",
    "cache_control": "no-store",
    "escaped": {"<": "\\u003c", ">": "\\u003e", "&": "\\u0026", "\u2028": "\\u2028", "\u2029": "\\u2029"}
  },
  "events": {
    "text": ["type", "text"],
    "sources": ["type", "sources"],
    "done": ["type"],
    "not_covered": ["type", "text", "links"],
    "refused": ["type", "reason", "message"]
  },
  "max_sources": 6,
  "source_url_prefixes": ["https://openwiz.dev/", "https://github.com/openwizdev/"],
  "not_covered": {
    "text": "The OpenWiz docs don't cover that yet, so I won't guess. Book a call or open a GitHub issue, and we'll answer it.",
    "links": [
      {"label": "Book a call", "href": "https://openwiz.dev/team/#book"},
      {"label": "GitHub issues", "href": "https://github.com/openwizdev/openwiz/issues"}
    ],
    "sentinel": "NOT_COVERED"
  },
  "refusals": {
    "bad_request": {"status": 400, "message": "That question couldn't be read. Try again."},
    "not_human": {"status": 403, "message": "Please confirm you're human and try again."},
    "too_long": {"status": 413, "message": "That question is too long. Keep it to 300 characters or fewer."},
    "rate_limited": {"status": 429, "message": "That's a lot of questions at once. Try again in a few minutes."},
    "daily_cap": {"status": 429, "message": "Ask a Wiz has answered all it can for today. Try again tomorrow."},
    "upstream_error": {"status": 502, "message": "Ask a Wiz couldn't answer just now. Try again."},
    "unavailable": {"status": 503, "message": "Ask a Wiz isn't available right now."},
    "store_error": {"status": 503, "message": "Ask a Wiz couldn't keep count just now. Try again."},
    "no_private_route": {"status": 503, "message": "Ask a Wiz can't answer privately just now. Try again later."}
  },
  "rate_limit": {"per_visitor": 10, "window": "utc_hour"},
  "daily_cap": {"counts": "model_calls", "day": "utc", "min": 1, "max": 100000, "unset_or_invalid": 0},
  "upstream": {
    "url": "https://openrouter.ai/api/v1/chat/completions",
    "stream": true,
    "temperature": 0,
    "provider": {"require_parameters": true, "data_collection": "deny", "zdr": true},
    "no_route_status": 404,
    "usage": {"include": true},
    "retries": 0
  },
  "prices": {"unit": "USD per million tokens; the request price in USD per request", "pattern": "^[0-9]{1,4}(\\.[0-9]{1,6})?$", "min_exclusive": 0, "max": 1000},
  "limits": {
    "max_output_tokens": 500,
    "max_passages": 6,
    "max_passage_chars": 1200,
    "max_prompt_bytes": 10000,
    "framing_tokens": 4096,
    "max_prompt_tokens": 14096,
    "max_answer_bytes": 4000
  },
  "prompt": {
    "system": "You answer questions about OpenWiz for visitors to openwiz.dev. Answer only from the passages in the user's message, in plain text, in at most three short paragraphs. If the passages do not answer the question, reply with exactly NOT_COVERED and nothing else.",
    "passage": "Passage {n} from {url}:\n{text}\n\n",
    "question": "Question: {question}"
  },
  "spend": {
    "key": "spend",
    "unit": "micro-USD",
    "to_micro": "ceil(round(usd * 1000000, 3))",
    "call_max": "ceil(round(max_prompt_tokens * ASK_A_WIZ_MAX_PROMPT_PRICE + max_output_tokens * ASK_A_WIZ_MAX_COMPLETION_PRICE + 1000000 * ASK_A_WIZ_MAX_REQUEST_PRICE, 3))",
    "cap_usd": {"pattern": "^[0-9]{1,4}(\\.[0-9]{1,6})?$", "min_exclusive": 0, "max": 1000, "unset_or_invalid": 0},
    "per_day": "min(ASK_A_WIZ_DAILY_CAP_USD + call_max, ASK_A_WIZ_DAILY_CAP * call_max)"
  },
  "index": {"schema": "openwiz.ask-a-wiz.index.v1", "keys": ["schema", "sources", "passages"], "max_bytes": 2000000},
  "stored": {
    "tables": {"ask_counters": ["day", "key", "count"], "ask_salts": ["day", "salt"]},
    "keys": ["cap", "spend", "visitor:<32 hex>:<hour>"],
    "nothing_else": true
  },
  "fixtures": [
    "answer", "answer-escaped", "not-covered", "not-covered-model", "too-long", "rate-limited",
    "daily-cap", "upstream-error", "upstream-error-midstream", "bad-request", "unavailable",
    "off", "probe-on", "probe-off", "answer-trimmed-count", "answer-trimmed-bytes", "answer-overflow",
    "off-not-exact", "unavailable-price", "store-error", "midnight-cap", "midnight-answer", "first-write-race",
    "spend-cap", "spend-near-cap", "spend-missing-cost",
    "spend-flat-fee", "unavailable-request-price", "no-private-route"
  ]
}
```

## The names Jake uses

All of them belong to the openwiz.dev Cloudflare Pages project. FA5 (#1903)
sets the secret, the store, the model, the three maximum prices and the two caps,
and the OpenRouter privacy settings in "The privacy promise";
Jake turns the switch on after FA6's go.

| Name | Kind | Holds |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | Pages secret (encrypted) | The OpenRouter key, and nothing else |
| `ASK_A_WIZ_COUNTERS` | D1 database binding | The counter store (see "What is stored") |
| `ASK_A_WIZ_MODEL` | Pages variable | The OpenRouter model id, such as a cheap chat model's id |
| `ASK_A_WIZ_DAILY_CAP_USD` | Pages variable | The most a UTC day may spend, in US dollars, on the calls' reported cost: a decimal such as `1.00`, above 0 and at most 1000 |
| `ASK_A_WIZ_DAILY_CAP` | Pages variable | A second guard: the most model calls a UTC day may make, an integer from 1 to 100000 |
| `ASK_A_WIZ_MAX_PROMPT_PRICE` | Pages variable | The most any route may charge for input, in US dollars per million tokens: a decimal such as `0.10`, above 0 and at most 1000 |
| `ASK_A_WIZ_MAX_COMPLETION_PRICE` | Pages variable | The same for output, reasoning included |
| `ASK_A_WIZ_MAX_REQUEST_PRICE` | Pages variable | The most any route may charge as a flat fee per request, in US dollars: a decimal such as `0.001`, above 0 and at most 1000 |
| `ASK_A_WIZ` | Pages variable | The off switch: exactly `on` turns Ask a Wiz on; anything else, or unset, is off |
| `TURNSTILE_SECRET_KEY` | Pages secret (encrypted) | The Cloudflare Turnstile widget's secret key. Unset: no human check, exactly as before |
| `TURNSTILE_SITE_KEY` | Pages variable | The same widget's public site key. Required once the secret is set, or every question is `unavailable` |

The key is read only as `env.OPENROUTER_API_KEY` inside the function, and is
sent only in the `Authorization` header of the upstream call. It never
appears in a response, an event, a log line, an error, the index, a fixture,
the repository, chat, an issue or a pull request. The function writes no log
line at all.

**The switch is off by default.** The row ships behind it. Production keeps it
unset until Jake's preview go (FA6, #1904); a preview deploy may set it to
`on`. When it is off, the function answers every request `404` with no
body, and the row does not appear.

## The probe: `GET /api/ask`

The row asks once, on page load, whether Ask a Wiz is on.

- **On** (`ASK_A_WIZ` is `on`): `200`, `Cache-Control: no-store`, the JSON
  `{"schema": "openwiz.ask-a-wiz.v1", "enabled": true, "max_question_chars": 300}`.
- **Off:** `404`, no body. The row stays hidden; the FAQ shows only its
  hand-written rows.

When `TURNSTILE_SECRET_KEY` is set and `TURNSTILE_SITE_KEY` is valid, the
probe adds one key, `"turnstile_site_key"`, the public site key, after
`max_question_chars`. Otherwise its body is exactly the one above.

The probe reads no store and no counter, and sends no secret. It says only
that the switch is on, and whether the row must carry a Turnstile token; a
missing secret, model or store shows as `unavailable` on the first question.

## The request: `POST /api/ask`

- `Content-Type: application/json`; the body is at most 4096 bytes and is a
  JSON object with exactly one key, `question`, a string.
- The question is trimmed of white space at both ends, then counted in Unicode
  code points. It must be 1 to 300 of them.
- The request's `Origin` header must equal the origin of the request's own
  URL (so production and a preview deploy both work, and no other site does).
- With Turnstile on, the request carries a fresh Turnstile token in the
  `CF-Turnstile-Response` header (rendered with action `ask`; tokens are
  single-use, so one per question). The body is unchanged.
- Anything else (another method, content type or key, bad JSON, a body over
  4096 bytes, a missing or foreign `Origin`, an empty question) is
  `bad_request`. A question of 301 or more code points is `too_long`.

## The answer stream

Every `POST` response is `Content-Type: application/x-ndjson; charset=utf-8`
with `Cache-Control: no-store`: one JSON object per line, each line ending in
`\n`, each object an **event** with a `type`. Each event has exactly the keys
the pin lists for its type.

| Event | Keys | Means |
| --- | --- | --- |
| `text` | `type`, `text` | The next piece of the answer, a non-empty plain-text string. Pieces join with nothing between them |
| `sources` | `type`, `sources` | The pages the answer drew on: 1 to 6 `{"title", "url"}` objects, each URL once and under `https://openwiz.dev/` or `https://github.com/openwizdev/` |
| `done` | `type` | The answer is complete |
| `not_covered` | `type`, `text`, `links` | The docs don't cover the question: exactly the pin's text and links |
| `refused` | `type`, `reason`, `message` | A refusal, with exactly its reason's message from the pin |

A stream is exactly one of these shapes:

1. **An answer:** status `200`; one or more `text`, then one `sources`, then
   `done`.
2. **Not covered:** status `200`; one `not_covered` and nothing else.
3. **A refusal before any text:** the reason's status; one `refused` and
   nothing else.
4. **An upstream error mid-answer:** status `200`; one or more `text`, then
   one `refused` with reason `upstream_error`. No `sources`, no `done`.

The last event is always `done`, `not_covered` or `refused`. A stream that
ends without one of them (the visitor stopped it, or the connection dropped)
is incomplete; the row offers retry and shows nothing it received as a
finished answer.

**Plain text, escaped.** Every string in every event is plain text, never
HTML or Markdown to be rendered. The function writes `<`, `>`, `&`, U+2028
and U+2029 inside JSON strings as `\u003c`, `\u003e`, `\u0026`, `\u2028` and
`\u2029`, so no response body ever holds one of those characters raw. The row
sets text only as text (never through `innerHTML`), and renders links only
from the not-covered event, whose hrefs must equal the pin's.

## The not-covered answer

When the docs don't cover a question the answer says so, and never guesses:

> The OpenWiz docs don't cover that yet, so I won't guess. Book a call or open
> a GitHub issue, and we'll answer it.

with two links, in this order: **Book a call** to
`https://openwiz.dev/team/#book`, and **GitHub issues** to
`https://github.com/openwizdev/openwiz/issues`.

It is given in two cases:

- **No supporting passage.** The index's keyword scoring finds no passage
  with a score above zero. The function calls no model, and the daily cap is
  not touched.
- **The model says so.** The model is told to answer only from the passages
  it is given and, when they don't answer the question, to reply with
  exactly `NOT_COVERED`. The function holds back the answer's first 16
  characters; if the answer, trimmed, starts with `NOT_COVERED`, it sends the
  not-covered event and nothing else. The sentinel itself never reaches the
  visitor.

## Refusals

| Reason | Status | Message | When |
| --- | --- | --- | --- |
| `bad_request` | 400 | That question couldn't be read. Try again. | The request breaks "The request" |
| `not_human` | 403 | Please confirm you're human and try again. | Turnstile is on and the request's token is missing or does not pass (see "The order of checks") |
| `too_long` | 413 | That question is too long. Keep it to 300 characters or fewer. | 301 or more code points |
| `rate_limited` | 429 | That's a lot of questions at once. Try again in a few minutes. | The visitor's hour is used up |
| `daily_cap` | 429 | Ask a Wiz has answered all it can for today. Try again tomorrow. | The day's spend has reached the dollar cap, or its calls the call-count cap, or a cap is unset or invalid |
| `upstream_error` | 502, or 200 mid-answer | Ask a Wiz couldn't answer just now. Try again. | OpenRouter refused, failed, timed out or sent something unreadable |
| `unavailable` | 503 | Ask a Wiz isn't available right now. | The switch is on but the secret, the model, the store binding, a maximum price or the index is missing or invalid |
| `store_error` | 503 | Ask a Wiz couldn't keep count just now. Try again. | A store operation before the call failed (an error or a timeout from D1) |
| `no_private_route` | 503 | Ask a Wiz can't answer privately just now. Try again later. | OpenRouter answered `404` before any content: no route for the model meets the request's privacy and price rules |

A `429` carries a `Retry-After` header: the whole seconds until the visitor's
UTC hour ends (`rate_limited`) or the UTC day ends (`daily_cap`). No refusal
names a provider, a URL, a status from upstream, a setting's value or the
key.

### The order of checks

The function checks in this order, and stops at the first that fails:

1. The switch (off: `404`, no body).
2. The configuration (`unavailable`): the secret, the model, the store
   binding, the three maximum prices, each valid, and (when the Turnstile
   secret is set) the Turnstile site key.
3. The request (`bad_request`), then its length (`too_long`).
3a. With Turnstile on, the human check (`not_human`): one siteverify call
   with the secret, the token, `remoteip` (`CF-Connecting-IP`) and an
   idempotency key, under a short timeout. Only `success: true` with action
   `ask` and the request's own hostname passes (a result Cloudflare marks
   `result_with_testing_key` passes on `success` alone only on loopback hosts
   `localhost`, `127.0.0.1` and `[::1]`; elsewhere it must pass the normal
   action and hostname checks). A
   missing or overlong token, a failed check, a non-200 or a network error
   all refuse, before any store write or model call.
4. The visitor's rate limit (`rate_limited`). A question that passes counts,
   whatever its outcome. This is the first store write.
5. The passages (none: `not_covered`, no model call).
6. The daily caps (`daily_cap`): the call count, then the dollar
   reservation, on the day the call is sent (see "The rate limit and the
   daily caps").
7. The model call (`no_private_route`, `upstream_error`, the model's
   `NOT_COVERED`, or the answer).
8. Settling the call's reported cost (after the stream ends; it changes no
   response).

**A failing store refuses with `store_error`.** Every store operation in
steps 4 and 6 (creating the tables, deleting earlier days, the salt, each
count and reservation) either completes or fails. A completed conditional
update that returns no row means the limit is reached. A failed operation
(an error or a timeout from D1) ends the question at once with `503
store_error`, one `refused` event, and no model call. All of that happens
before the call. Only the settling write (step 8) comes after it; if it
fails, the reservation stays, counted at the maximum, and the visitor's
answer is unchanged.

## The rate limit and the daily caps

- **Rate limit:** at most 10 questions per visitor per UTC clock hour. The
  visitor is the request's `CF-Connecting-IP`, kept only as a hash (see "What
  is stored"). The 11th question in the same hour is `rate_limited`.
- **The dollar cap, on actual cost.** `ASK_A_WIZ_DAILY_CAP_USD` is the most a
  UTC day may spend, in US dollars (a decimal such as `1.00`, above 0 and at
  most 1000). The day's spend is the `spend` counter, in whole micro-dollars.
  Every dollar amount becomes micro-dollars as `ceil(round(usd * 1000000, 3))`.
  - **Reserve before the call.** `call_max`, one call's most possible cost, is
    `ceil(round(14096 * P + 500 * C + 1000000 * R, 3))` micro-dollars, with
    `P` and `C` the two maximum token prices and `R` the maximum flat fee per
    request. Before the call, the function adds `call_max` to
    `spend` only if `spend` is still below the cap:
    `UPDATE ask_counters SET count = count + ? WHERE day = ? AND key = 'spend' AND count < ? RETURNING count`.
    No row back is `daily_cap`.
  - **Settle after the call.** The call asks for its cost (`usage: {"include":
    true}`), and OpenRouter reports it in US dollars as `usage.cost` in the
    stream's last chunk. When the call ends, the function replaces the
    reservation with that cost:
    `UPDATE ask_counters SET count = count - ? + ? WHERE day = ? AND key = 'spend'`
    (`call_max`, then the reported cost in micro-dollars), on the reservation's
    own day.
  - **No reported cost counts at the maximum.** A call that fails, is
    cancelled, times out or ends with no valid `usage.cost` (a number from 0)
    keeps its whole reservation. So does a call whose settling write fails.
- **The call-count cap, a second guard.** `ASK_A_WIZ_DAILY_CAP` is the most
  model calls a UTC day may make (1 to 100000). The function checks it first,
  with the same conditional update on the `cap` counter, then reserves the
  dollars.
- **Both fail closed.** An unset or invalid value counts as `0`, so every
  question that reaches step 6 is `daily_cap`. Nothing is given back: a count
  or reservation made for a question that is then refused stays spent.
- **One UTC day per row; a reservation never crosses midnight.** Every
  counter row belongs to one UTC day. The function reserves (count, then
  dollars) at step 6, then reads the clock again just before the call. If
  the UTC day has changed, it reserves again on the new day (both counters,
  the same conditional updates); if either fails, the question is
  `daily_cap` with `Retry-After` to the new day's end, and nothing is sent. A
  call is settled only on the row of the day it was sent; if that day's rows
  are already gone, the settling write changes nothing.
- **Every attempt counts, and there are no retries.** The function makes at
  most one upstream attempt per question, and that attempt has been counted
  and reserved before it is sent.
- **Counting is atomic.** Each count and reservation is one conditional
  statement that adds only below its limit (after inserting the row at `0` if
  it is missing). No row back means the limit is reached: the question is
  refused, and nothing is added.

## The model call, bounded

`POST https://openrouter.ai/api/v1/chat/completions` with
`Authorization: Bearer <OPENROUTER_API_KEY>` and exactly this JSON body:
`model` from `ASK_A_WIZ_MODEL`; `stream: true`; `max_tokens: 500`;
`temperature: 0`; `provider: {"max_price": {"prompt": P, "completion": C,
"request": R}, "require_parameters": true, "data_collection": "deny", "zdr":
true}`, with `P`, `C` and `R` the three maximum price settings as numbers; `usage: {"include": true}`, so the stream reports the call's
cost; and `messages`: one `system` message whose content is the pin's
`prompt.system`, then one `user` message. No `models` list and no fallback
model. `max_price` is the request's price ceiling: OpenRouter routes it to no
provider dearer than `P` and `C` per million tokens or charging a flat fee
above `R` per request, so no call can cost more than `call_max`. The request
sends only text, so no image or audio price applies. `require_parameters`
routes only to providers that honour `max_tokens`. `data_collection: "deny"`
and `zdr: true` are the privacy promise (below). If no route meets all of
these, OpenRouter answers `404` before any content; the function sends
`no_private_route`, never retries without a rule, and the call stays counted
at `call_max`. Tests use a fake OpenRouter only; no test or fixture calls the
real one.

**The privacy promise.** A visitor's question goes only to a route that
keeps no data: `data_collection: "deny"` excludes providers that store or
train on inputs, and `zdr: true` restricts routing to OpenRouter's Zero Data
Retention endpoints. Both are in every request body, so no call can leave
without them. The request alone is not enough, because OpenRouter lets a
`zdr: true` request use "Safety Retention" endpoints (which may keep prompts
to detect abuse) unless the account or the key's guardrail says **ZDR only**.
So the promise holds only with these, which each later ticket must keep:

- **FA3 (#1901)** sends exactly the body above on every call, with no
  `provider` field added, dropped or loosened, no fallback and no retry
  without it, and maps OpenRouter's `404` before any content to
  `no_private_route`, replayed from `no-private-route`.
- **FA5 (#1903)** uses an OpenRouter key made only for Ask a Wiz and sets, in
  OpenRouter's privacy settings or on that key's guardrail: ZDR enforced for
  the chosen model's group, with Safety Retention excluded (**ZDR only**);
  providers that may train on inputs disabled; and OpenRouter's own
  input and output logging off. It picks a model with at least one ZDR
  endpoint within `P`, `C` and `R` (OpenRouter lists them at
  `/api/v1/endpoints/zdr`), and records these settings, without the key, in
  its setup notes for Jake. Until they are set, the switch stays off.

OpenRouter documents one exception it applies to all traffic, ZDR included:
content flagged in screening for child sexual abuse material may be kept as
the law requires. Nothing in this contract can change that.

Every limit is a constant of this contract, not a setting, so the dollar
figure for a cap depends only on the cap and the three maximum prices:

| Constant | Value | What it bounds |
| --- | --- | --- |
| `max_output_tokens` | 500 | The `max_tokens` of every call: the most output a call is billed for |
| `max_passages` | 6 | Passages sent in one call |
| `max_passage_chars` | 1200 | Code points of one passage's text (the index never holds a longer one) |
| `max_prompt_bytes` | 10000 | UTF-8 bytes of the system and user message contents together |
| `framing_tokens` | 4096 | A margin for the chat format's own tokens around the message contents |
| `max_prompt_tokens` | 14096 | Input tokens of one call: `max_prompt_bytes`, at one token per byte at most, plus `framing_tokens` |
| `max_answer_bytes` | 4000 | UTF-8 bytes of answer text the function passes on |

**The user message** is built from the question and the passages the index's
scoring ranked, best first. Each passage is the pin's `prompt.passage` with
`{n}` its number from 1, `{url}` its source's URL and `{text}` its text; then
comes the pin's `prompt.question` with `{question}` the trimmed question. The
function adds passages in rank order and **stops at the first** that would
be a seventh passage or take the system and user contents past
`max_prompt_bytes`; it drops that passage and every lower one. The system
text is under 1000 bytes and a question at most 1200, so the best passage
always fits. Only the passages sent count as used.

**The answer is bounded too.** `max_tokens` stops the model at 500 tokens.
If the stream still carries more than `max_answer_bytes` of text (a provider
that ignores `max_tokens`), the function passes on only the pieces that fit
whole, cancels the upstream call and ends with `upstream_error`: status `200`
after some text, or `502` if not even the first piece fits.

**The worst-case spend.** The dollar cap is checked before each call against
the day's actual reported spend plus the reservations of calls still
running, and each call can cost at most `call_max`. So a day spends at most
the cap plus one bounded call, and never more than the call-count guard
allows:

```text
call_max = ceil(round(14096 * P + 500 * C + 1000000 * R, 3)) micro-dollars
one day <= min(ASK_A_WIZ_DAILY_CAP_USD + call_max, ASK_A_WIZ_DAILY_CAP * call_max)
```

For example, with `P` = `0.10`, `C` = `0.40` and `R` = `0.001` (synthetic
prices), `call_max` is 2610 micro-dollars ($0.00261); a dollar cap of `1.00`
and a call cap of 200 give at most min($1.00261, $0.522) = $0.522 a day. A
route with a flat fee above `R` is never used, so it can't push a call past
`call_max`. FA5 shows
Jake this figure for the caps and prices he sets, with the prices at or above
the chosen model's listed prices so a route exists. `call_max` holds only for
a model billed for no output beyond `max_tokens`: FA5 picks a model without
separately billed reasoning tokens.

## The docs index

FA2 builds it into the site as `/ask-index.json`, a public static file holding
only public docs and site pages. The function reads it through the site's own
assets. Its form:

```json
{
  "schema": "openwiz.ask-a-wiz.index.v1",
  "sources": [{"title": "Synthetic page", "url": "https://openwiz.dev/synthetic/"}],
  "passages": [{"source": 0, "text": "Synthetic passage text."}]
}
```

- `sources`: one or more `{"title", "url"}`, each URL once, under the two
  prefixes above. `title` and `url` are each 1 to 200 characters.
- `passages`: one or more `{"source", "text"}`. `source` is an index into
  `sources`; `text` is 1 to 1200 characters of plain text.
- The whole file is at most 2,000,000 bytes, with no other keys.

A `sources` event lists the sources of the passages sent to the model, each
once, in the order first used.

## What is stored

Only the daily counters and the day's salt, in the `ASK_A_WIZ_COUNTERS` D1
database, in two tables the function creates if they are missing. `day` is
the UTC date, `YYYY-MM-DD`.

- `ask_counters (day TEXT, key TEXT, count INTEGER, PRIMARY KEY (day, key))`,
  where `key` is `cap` (the day's model calls), `spend` (the day's spend in
  micro-dollars, reported costs plus open reservations) or
  `visitor:<hash>:<hour>` (one visitor's questions in that UTC hour, `00` to
  `23`).
- `ask_salts (day TEXT PRIMARY KEY, salt TEXT NOT NULL)`: one salt per day,
  32 random bytes as 64 lower-case hex digits.

**One salt per day, shared by every writer.** On a question, the function
makes a fresh salt and runs
`INSERT INTO ask_salts (day, salt) VALUES (?, ?) ON CONFLICT (day) DO NOTHING`,
then `SELECT salt FROM ask_salts WHERE day = ?`, and uses the salt it reads,
never the one it made. Two first questions at the same moment therefore
share the salt that was stored first.

`<hash>` is the first 32 lower-case hex digits of SHA-256 of `<salt>:<ip>`.
Every write first deletes the rows of earlier days from both tables, so
yesterday's salt is gone and its hashes can no longer be linked to anyone.

Nothing else is stored or logged: no question, answer, IP address, user
agent, cookie, header or timestamp beyond the day and hour. The function sets
no cookie.

## Fixtures

[`fixtures/ask-a-wiz/`](fixtures/ask-a-wiz/) holds one file per case named in
the pin, plus `index.json` (a valid index) and `store.json` (the store after
some synthetic questions). Each case is a JSON object:

| Key | What |
| --- | --- |
| `case` | Its name, the file's name without `.json` |
| `now` | The synthetic UTC time the case runs at, ISO 8601 |
| `request` | `{"method", "headers", "body"}`, sent to `https://openwiz.dev/api/ask`; `body` is the exact request body string, or `null` |
| `settings` | The Pages settings and bindings the case runs with: the secret as the synthetic value `fake-openrouter-key`, a bound store as `"bound"`, an unset one left out |
| `retrieved` | Optional: the passages the index's scoring ranked for the question, best first, each `{"source": {"title", "url"}, "text"}`; `[]` when none scores above zero |
| `store` | The fake store before the request: `{"salts": [{"day", "salt"}], "counters": [{"day", "key", "count"}]}` |
| `store_after` | The fake store after the request, the same shape: what the order of checks must leave |
| `new_salt` | Optional: the salt this request makes if it is the day's first |
| `rival_salt` | Optional: a salt a concurrent first request stored before this one's insert |
| `dispatch_at` | Optional: the clock just before the model call, when it differs from `now` |
| `store_fails` | Optional, `true`: every store operation fails |
| `upstream` | The fake OpenRouter: `null` (never called), or `{"request", "chunks"}`, with `"status": 404` when it finds no route: `request` is the exact JSON body the function must send, `chunks` the content pieces it streams back, and `cost` the `usage.cost` in US dollars its last chunk reports (left out when it reports none); with `"fails": true` it errors after `after_chunks` pieces |
| `response` | `{"status", "headers", "body"}`; `body` is the exact response body string (the NDJSON lines), or `null` |

`test_fixtures.py` checks every case: the shape of each event and stream,
the statuses and messages, the escaping, the not-covered text and links, the
store before and after, that no call goes upstream while off, on a probe or
after a refusal, that the synthetic key never appears in a response, and that
the index fixture is valid. FA3 replays the cases against the function with a
fake OpenRouter and a fake counter store; FA4 replays their bodies as fake
streams.

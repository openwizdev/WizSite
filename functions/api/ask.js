// FA3 (#1901): Ask a Wiz, the FAQ's "Ask a Wiz..." row, as contract openwiz.ask-a-wiz.v1 fixes it end to end.
// GET /api/ask says whether the switch is on; POST /api/ask answers one question from the docs index
// (/ask-index.json, FA2) through one bounded, zero-data-retention OpenRouter call, streamed as NDJSON events.
// It checks in the contract's order: the switch, the configuration, the request, the visitor's hour, the
// passages, the day's caps, the call, then settles the call's reported cost. It stores only the daily counters
// and the day's salt in the ASK_A_WIZ_COUNTERS D1 database, and it writes no log line at all.
// The key is read only as env.OPENROUTER_API_KEY and sent only in the upstream call's Authorization header.

const SCHEMA = 'openwiz.ask-a-wiz.v1';
const INDEX_SCHEMA = 'openwiz.ask-a-wiz.index.v1';
const UPSTREAM = 'https://openrouter.ai/api/v1/chat/completions';
const SOURCE_PREFIXES = ['https://openwiz.dev/', 'https://github.com/openwizdev/'];

const MAX_BODY_BYTES = 4096;
const MAX_QUESTION = 300; // code points, after trimming
const PER_VISITOR = 10; // questions per UTC hour
const MAX_OUTPUT_TOKENS = 500;
const MAX_PASSAGES = 6;
const MAX_PASSAGE = 1200; // code points
const MAX_FIELD = 200; // code points of a source's title or URL
const MAX_PROMPT_BYTES = 10000;
const MAX_PROMPT_TOKENS = 14096; // MAX_PROMPT_BYTES at one token per byte, plus 4096 framing tokens
const MAX_ANSWER_BYTES = 4000;
const MAX_INDEX_BYTES = 2_000_000;
const HOLD = 16; // characters of the answer held back to catch the model's NOT_COVERED
const SENTINEL = 'NOT_COVERED';
const PRICE = /^[0-9]{1,4}(\.[0-9]{1,6})?$/; // US dollars: per million tokens, or per request
const UPSTREAM_TIMEOUT = 60_000; // ms for the whole call, first byte to last
const STORE_TIMEOUT = 5_000; // ms for one store operation

const SYSTEM = "You answer questions about OpenWiz for visitors to openwiz.dev. Answer only from the passages in the user's message, in plain text, in at most three short paragraphs. If the passages do not answer the question, reply with exactly NOT_COVERED and nothing else.";
const NOT_COVERED = {
  type: 'not_covered',
  text: "The OpenWiz docs don't cover that yet, so I won't guess. Book a call or open a GitHub issue, and we'll answer it.",
  links: [
    { label: 'Book a call', href: 'https://openwiz.dev/team/#book' },
    { label: 'GitHub issues', href: 'https://github.com/openwizdev/openwiz/issues' },
  ],
};
const REFUSALS = {
  bad_request: [400, "That question couldn't be read. Try again."],
  too_long: [413, 'That question is too long. Keep it to 300 characters or fewer.'],
  rate_limited: [429, "That's a lot of questions at once. Try again in a few minutes."],
  daily_cap: [429, 'Ask a Wiz has answered all it can for today. Try again tomorrow.'],
  upstream_error: [502, "Ask a Wiz couldn't answer just now. Try again."],
  unavailable: [503, "Ask a Wiz isn't available right now."],
  store_error: [503, "Ask a Wiz couldn't keep count just now. Try again."],
  no_private_route: [503, "Ask a Wiz can't answer privately just now. Try again later."],
};

// Words too common to show that a passage supports a question.
const STOP = new Set(('a about after all also am an and any are as at be been before but by can could did do does doing ' +
  'for from had has have he her his how i if in into is it its just me more most my no nor not of on or our out over ' +
  'own same she should so some such than that the their them then there these they this those through to too under ' +
  'until very was we were what when where which while who whom why will with would you your yours').split(' '));

const encoder = new TextEncoder();
const bytes = text => encoder.encode(text).length;
const points = text => [...text].length;
const NDJSON = { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' };

// One event as one NDJSON line, with < > & U+2028 U+2029 written as \u escapes so no body holds them raw.
const line = event => `${JSON.stringify(event).replace(/[<>&\u2028\u2029]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)}\n`;
const refused = reason => line({ type: 'refused', reason, message: REFUSALS[reason][1] });

function refuse(reason, retryAfter) {
  const headers = { ...NDJSON };
  if (retryAfter !== undefined) headers['Retry-After'] = String(retryAfter);
  return new Response(refused(reason), { status: REFUSALS[reason][0], headers });
}

// ---- Settings ---------------------------------------------------------------------------------------------------

const price = value => (typeof value === 'string' && PRICE.test(value) && Number(value) > 0 && Number(value) <= 1000 ? Number(value) : null);
const micro = usd => Math.ceil(Number(usd.toFixed(3))); // ceil(round(x, 3)), x already in micro-dollars

function configure(env) {
  const key = env.OPENROUTER_API_KEY;
  const model = env.ASK_A_WIZ_MODEL;
  const db = env.ASK_A_WIZ_COUNTERS;
  const prices = [env.ASK_A_WIZ_MAX_PROMPT_PRICE, env.ASK_A_WIZ_MAX_COMPLETION_PRICE, env.ASK_A_WIZ_MAX_REQUEST_PRICE].map(price);
  if (typeof key !== 'string' || !key || typeof model !== 'string' || !model.trim()) return null;
  if (!db || typeof db.prepare !== 'function' || typeof db.batch !== 'function') return null;
  if (prices.includes(null)) return null;
  const [prompt, completion, request] = prices;
  // One call's most possible cost, in micro-dollars: every input and output token at the ceiling, plus the flat fee.
  const callMax = micro(MAX_PROMPT_TOKENS * prompt + MAX_OUTPUT_TOKENS * completion + 1_000_000 * request);
  return { key, model, db, prices: { prompt, completion, request }, callMax };
}

// The two daily caps, read at step 6: anything unset or invalid is 0, so the day is closed.
function caps(env) {
  const calls = env.ASK_A_WIZ_DAILY_CAP;
  const usd = env.ASK_A_WIZ_DAILY_CAP_USD;
  const count = typeof calls === 'string' && /^[0-9]{1,6}$/.test(calls) && Number(calls) >= 1 && Number(calls) <= 100000 ? Number(calls) : 0;
  const dollars = price(usd);
  return { calls: count, spend: dollars === null ? 0 : micro(dollars * 1_000_000) };
}

// ---- The request ------------------------------------------------------------------------------------------------

// A JSON object of one member whose name and value are both strings: '{' name ':' value '}', JSON white space around.
const JSON_STRING = String.raw`"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"`;
const WS = '[ \\t\\n\\r]*';
const ONE_STRING_MEMBER = new RegExp(`^${WS}\\{${WS}(${JSON_STRING})${WS}:${WS}(${JSON_STRING})${WS}\\}${WS}$`);

// The trimmed question, or the refusal it earns.
async function readQuestion(request) {
  const bad = { refusal: 'bad_request' };
  if (request.method !== 'POST') return bad;
  const type = (request.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') return bad;
  if (request.headers.get('Origin') !== new URL(request.url).origin) return bad;
  const body = await readLimited(request.body, MAX_BODY_BYTES);
  if (body === null) return bad;
  // Exactly one member, written once: JSON.parse alone would keep the last of a repeated key.
  let key, value;
  try {
    const shape = new TextDecoder('utf-8', { fatal: true }).decode(body).match(ONE_STRING_MEMBER);
    if (!shape) return bad;
    key = JSON.parse(shape[1]);
    value = JSON.parse(shape[2]);
  } catch {
    return bad;
  }
  if (key !== 'question' || typeof value !== 'string') return bad;
  const question = value.trim();
  const length = points(question);
  if (length < 1) return bad;
  if (length > MAX_QUESTION) return { refusal: 'too_long' };
  return { question };
}

// The body's bytes, or null past `max`.
async function readLimited(stream, max) {
  if (!stream) return new Uint8Array(0);
  const reader = stream.getReader();
  const parts = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

// ---- The store --------------------------------------------------------------------------------------------------

// Every store operation is one D1 batch (one transaction) that first deletes earlier days' rows from both tables,
// and fails if D1 errs or takes longer than `timeout` ms.
function counters(db, timeout) {
  const prune = day => [
    db.prepare('DELETE FROM ask_counters WHERE day < ?').bind(day),
    db.prepare('DELETE FROM ask_salts WHERE day < ?').bind(day),
  ];
  const write = (day, statements, setup = []) => {
    let timer;
    const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('store timeout')), timeout); });
    return Promise.race([db.batch([...setup, ...prune(day), ...statements]), late]).finally(() => clearTimeout(timer));
  };
  return {
    // The day's salt: a fresh one is offered, and the stored one (whoever stored it first) is used.
    async salt(day, fresh) {
      const results = await write(day, [
        db.prepare('INSERT INTO ask_salts (day, salt) VALUES (?, ?) ON CONFLICT (day) DO NOTHING').bind(day, fresh),
        db.prepare('SELECT salt FROM ask_salts WHERE day = ?').bind(day),
      ], [
        db.prepare('CREATE TABLE IF NOT EXISTS ask_counters (day TEXT, key TEXT, count INTEGER, PRIMARY KEY (day, key))'),
        db.prepare('CREATE TABLE IF NOT EXISTS ask_salts (day TEXT PRIMARY KEY, salt TEXT NOT NULL)'),
      ]);
      const salt = results.at(-1)?.results?.[0]?.salt;
      if (typeof salt !== 'string' || !/^[0-9a-f]{64}$/.test(salt)) throw new Error('store: no salt');
      return salt;
    },
    // Adds `add` to the day's `key` only while it is below `limit`; false when the limit is reached.
    async count(day, key, add, limit) {
      const results = await write(day, [
        db.prepare('INSERT INTO ask_counters (day, key, count) VALUES (?, ?, 0) ON CONFLICT (day, key) DO NOTHING').bind(day, key),
        db.prepare('UPDATE ask_counters SET count = count + ? WHERE day = ? AND key = ? AND count < ? RETURNING count').bind(add, day, key, limit),
      ]);
      const rows = results.at(-1)?.results;
      if (!Array.isArray(rows)) throw new Error('store: no result');
      return rows.length > 0;
    },
    // Replaces a call's reservation with its reported cost, on the day it was sent.
    settle(day, reserved, cost) {
      return write(day, [
        db.prepare("UPDATE ask_counters SET count = count - ? + ? WHERE day = ? AND key = 'spend'").bind(reserved, cost, day),
      ]);
    },
  };
}

function randomSalt() {
  const salt = new Uint8Array(32);
  crypto.getRandomValues(salt);
  return [...salt].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function visitorHash(salt, ip) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(`${salt}:${ip}`)));
  return [...digest].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

const utcDay = time => time.toISOString().slice(0, 10);
const utcHour = time => time.toISOString().slice(11, 13);
const untilHourEnds = time => Math.ceil((3_600_000 - (time.getTime() % 3_600_000)) / 1000);
const untilDayEnds = time => Math.ceil((86_400_000 - (time.getTime() % 86_400_000)) / 1000);

// ---- The index and the passages ---------------------------------------------------------------------------------

const exactKeys = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join() === keys;

function validIndex(index) {
  if (!exactKeys(index, 'passages,schema,sources') || index.schema !== INDEX_SCHEMA) return false;
  if (!Array.isArray(index.sources) || !index.sources.length || !Array.isArray(index.passages) || !index.passages.length) return false;
  const urls = new Set();
  for (const s of index.sources) {
    if (!exactKeys(s, 'title,url') || typeof s.title !== 'string' || typeof s.url !== 'string') return false;
    if (points(s.title) < 1 || points(s.title) > MAX_FIELD || points(s.url) < 1 || points(s.url) > MAX_FIELD) return false;
    if (!SOURCE_PREFIXES.some(prefix => s.url.startsWith(prefix)) || urls.has(s.url)) return false;
    urls.add(s.url);
  }
  return index.passages.every(p => exactKeys(p, 'source,text') && Number.isInteger(p.source) && p.source >= 0 &&
    p.source < index.sources.length && typeof p.text === 'string' && points(p.text) >= 1 && points(p.text) <= MAX_PASSAGE);
}

// The site's own /ask-index.json, or null when it is missing or not the contract's form.
async function loadIndex(env, request) {
  try {
    const response = await env.ASSETS.fetch(new URL('/ask-index.json', request.url).toString());
    if (!response.ok) return null;
    const text = await response.text();
    if (bytes(text) > MAX_INDEX_BYTES) return null;
    const index = JSON.parse(text);
    return validIndex(index) ? index : null;
  } catch {
    return null;
  }
}

const terms = text => new Set((text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(word => word.length > 1 && !STOP.has(word)));

// Keyword scoring: each question word a passage holds adds that word's rarity across the index. Passages that
// score above zero come back best first (ties in index order), as {source: {title, url}, text}.
export function rankPassages(index, question) {
  const wanted = terms(question);
  if (!wanted.size) return [];
  const held = index.passages.map(p => terms(p.text));
  const rarity = new Map([...wanted].map(word => [word, Math.log(1 + index.passages.length / Math.max(1, held.filter(t => t.has(word)).length))]));
  return index.passages
    .map((passage, at) => ({ passage, at, score: [...wanted].reduce((sum, word) => sum + (held[at].has(word) ? rarity.get(word) : 0), 0) }))
    .filter(scored => scored.score > 0)
    .sort((a, b) => b.score - a.score || a.at - b.at)
    .map(({ passage }) => ({ source: index.sources[passage.source], text: passage.text }));
}

// The user message: ranked passages in order, stopping at the first that would be a seventh or take the system
// and user contents past MAX_PROMPT_BYTES; then the question. Returns the message and the passages sent.
function userMessage(question, ranked) {
  const tail = `Question: ${question}`;
  const room = MAX_PROMPT_BYTES - bytes(SYSTEM) - bytes(tail);
  const used = [];
  let passages = '';
  for (const passage of ranked) {
    if (used.length === MAX_PASSAGES) break;
    const piece = `Passage ${used.length + 1} from ${passage.source.url}:\n${passage.text}\n\n`;
    if (bytes(passages) + bytes(piece) > room) break;
    passages += piece;
    used.push(passage);
  }
  return { content: passages + tail, used };
}

function sourcesOf(used) {
  const seen = new Map();
  for (const { source } of used) if (!seen.has(source.url)) seen.set(source.url, { title: source.title, url: source.url });
  return [...seen.values()];
}

// ---- The upstream call ------------------------------------------------------------------------------------------

// The answer's content pieces from OpenRouter's server-sent events. `usage.cost` lands in `report.cost` when it
// is a valid number. It returns only at [DONE]; an error event, unreadable data or a stream that stops early throws.
async function* answerPieces(reader, report) {
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) throw new Error('upstream: the stream stopped early');
    buffer += decoder.decode(value, { stream: true });
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const text = buffer.slice(0, end).replace(/\r$/, '');
      buffer = buffer.slice(end + 1);
      if (!text.startsWith('data:')) continue; // a comment, a blank line or another field
      const data = text.slice(5).trim();
      if (data === '[DONE]') return;
      const chunk = JSON.parse(data);
      if (!chunk || typeof chunk !== 'object' || chunk.error) throw new Error('upstream: error event');
      const cost = chunk.usage?.cost;
      if (typeof cost === 'number' && Number.isFinite(cost) && cost >= 0) report.cost = cost;
      for (const choice of Array.isArray(chunk.choices) ? chunk.choices : []) {
        if (choice?.finish_reason === 'error') throw new Error('upstream: error finish');
        const content = choice?.delta?.content;
        if (typeof content === 'string' && content) yield content;
      }
    }
  }
}

// ---- The function -----------------------------------------------------------------------------------------------

export function onRequest(context) {
  return handle(context);
}

// `options` are the test seams: the clock, the salt, the passage ranking and the two timeouts.
export async function handle(context, options = {}) {
  const { request, env } = context;
  const {
    clock = () => new Date(), salt: makeSalt = randomSalt, rank = rankPassages,
    upstreamTimeout = UPSTREAM_TIMEOUT, storeTimeout = STORE_TIMEOUT,
  } = options;
  const keep = promise => { try { context.waitUntil?.(promise); } catch { /* no runtime to keep it alive */ } };

  // 1. The switch: exactly "on", or nothing is here.
  if (env.ASK_A_WIZ !== 'on') return new Response(null, { status: 404 });
  if (request.method === 'GET') {
    return new Response(JSON.stringify({ schema: SCHEMA, enabled: true, max_question_chars: MAX_QUESTION }),
      { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  }

  // 2. The configuration.
  const config = configure(env);
  if (!config) return refuse('unavailable');

  // 3. The request, then its length.
  const asked = await readQuestion(request);
  if (asked.refusal) return refuse(asked.refusal);
  const { question } = asked;

  // 4. The visitor's hour: the first store write; a question that passes counts, whatever comes next.
  const now = clock();
  const day = utcDay(now);
  const store = counters(config.db, storeTimeout);
  try {
    const salt = await store.salt(day, makeSalt());
    const visitor = `visitor:${await visitorHash(salt, request.headers.get('CF-Connecting-IP') ?? '')}:${utcHour(now)}`;
    if (!await store.count(day, visitor, 1, PER_VISITOR)) return refuse('rate_limited', untilHourEnds(now));
  } catch {
    return refuse('store_error');
  }

  // 5. The passages: none scoring above zero is the not-covered answer, with no model call.
  const index = await loadIndex(env, request);
  if (!index) return refuse('unavailable');
  const { content, used } = userMessage(question, rank(index, question));
  if (!used.length) return new Response(line(NOT_COVERED), { headers: NDJSON });

  // 6. The day's caps: the call count, then the dollar reservation; again on the new day if midnight passed.
  const cap = caps(env);
  const reserve = async when => await store.count(when, 'cap', 1, cap.calls) && await store.count(when, 'spend', config.callMax, cap.spend);
  let sentOn = day;
  try {
    if (!await reserve(day)) return refuse('daily_cap', untilDayEnds(now));
    const dispatch = clock();
    if (utcDay(dispatch) !== day) {
      sentOn = utcDay(dispatch);
      if (!await reserve(sentOn)) return refuse('daily_cap', untilDayEnds(dispatch));
    }
  } catch {
    return refuse('store_error');
  }

  // 7. The model call: one attempt, bounded, private, timed.
  const abort = new AbortController();
  let reader = null;
  let finished = false;
  let release;
  keep(new Promise(resolve => { release = resolve; }));
  const timer = setTimeout(() => { stop(); finish(); }, upstreamTimeout);
  function stop() {
    abort.abort();
    reader?.cancel().catch(() => {});
  }
  // 8. Settling: the reported cost replaces the reservation; anything else keeps it, counted at call_max.
  function finish(cost) {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    const settled = cost === undefined ? Promise.resolve() : store.settle(sentOn, config.callMax, micro(cost * 1_000_000));
    settled.catch(() => {}).then(() => release());
  }

  let response;
  try {
    response = await fetch(UPSTREAM, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        stream: true,
        max_tokens: MAX_OUTPUT_TOKENS,
        temperature: 0,
        provider: { max_price: config.prices, require_parameters: true, data_collection: 'deny', zdr: true },
        usage: { include: true },
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content }],
      }),
      signal: abort.signal,
    });
  } catch {
    finish();
    return refuse('upstream_error');
  }
  if (response.status !== 200 || !response.body) {
    response.body?.cancel().catch(() => {});
    finish();
    return refuse(response.status === 404 ? 'no_private_route' : 'upstream_error');
  }
  reader = response.body.getReader();
  const report = {};
  const pieces = answerPieces(reader, report);

  // Hold back the answer's start until it can't be NOT_COVERED, or the answer ends.
  const held = [];
  let start = '';
  let ended = false;
  try {
    while (start.trimStart().length < HOLD) {
      const next = await pieces.next();
      if (next.done) { ended = true; break; }
      held.push(next.value);
      start += next.value;
    }
  } catch {
    stop();
    finish();
    return refuse('upstream_error');
  }
  if (start.trimStart().startsWith(SENTINEL)) {
    // The model's not-covered answer; the rest of the stream is read only for its reported cost.
    keep((async () => {
      try {
        if (!ended) for await (const _ of pieces) { /* discarded */ }
        finish(report.cost);
      } catch {
        finish();
      }
    })());
    return new Response(line(NOT_COVERED), { headers: NDJSON });
  }
  if (!held.length || bytes(held[0]) > MAX_ANSWER_BYTES) {
    if (ended) finish(report.cost); else { stop(); finish(); }
    return refuse('upstream_error');
  }

  // The answer: text pieces that fit whole within MAX_ANSWER_BYTES, then sources and done.
  let sent = 0;
  let closed = false;
  const body = new ReadableStream({
    async pull(controller) {
      const emit = text => { if (!closed) controller.enqueue(encoder.encode(text)); };
      const close = () => { if (!closed) { closed = true; controller.close(); } };
      let piece;
      if (held.length) piece = held.shift();
      else if (ended) piece = null;
      else {
        try {
          const next = await pieces.next();
          piece = next.done ? null : next.value;
          if (next.done) ended = true;
        } catch {
          emit(refused('upstream_error'));
          close();
          stop();
          finish();
          return;
        }
      }
      if (piece === null) {
        emit(line({ type: 'sources', sources: sourcesOf(used) }));
        emit(line({ type: 'done' }));
        close();
        finish(report.cost);
        return;
      }
      if (sent + bytes(piece) > MAX_ANSWER_BYTES) {
        emit(refused('upstream_error'));
        close();
        stop();
        finish();
        return;
      }
      sent += bytes(piece);
      emit(line({ type: 'text', text: piece }));
    },
    cancel() {
      closed = true;
      stop();
      finish();
    },
  });
  return new Response(body, { headers: NDJSON });
}

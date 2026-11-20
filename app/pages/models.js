// The Models page (MD6): which models the project's agents run on, and a Change button per role.
//
// It reads docs/agents/fleet.md's Models table (or the older five tables) and the offered-models snapshot
// docs/agents/models-offered.json, exactly as the models contract (openwiz.models.v1) pins them; a file it can't
// read is refused, never guessed. Change opens a picker of the snapshot's settable choices, the recommended one
// marked, and a pick shows and copies the contract's exact line for the user's agent. The page only reads: the
// agent runs `openwiz models set` and commits the change.
'use strict';
(() => {
  const OW = window.OW;

  // ---- The reader (OW.models), the contract's rules ----

  // [key, the table's word, the command line's word, what the role does]
  const ROLES = [
    ['orchestrator', 'Orchestrator', 'orchestrator', 'Starts each spec\'s fleet thread.'],
    ['builder', 'Builder', 'builder', 'Builds each ticket.'],
    ['reviewer', 'Reviewer', 'reviewer', 'Reviews each pull request, from the other model family than its builder.'],
    ['small_builder', 'Small builder', 'small-builder', 'Builds tickets labelled polish, huntr or proposal.'],
    ['fixer', 'Fixer', 'fixer', 'Runs a pull request\'s one fresh fix round, in its builder\'s family.'],
  ];
  const HEADER = ['Role', 'Harness', 'Model', 'Effort', '`room-cli thread spawn` flags'].join('|');
  const OLDER = ['Builder', 'Builder for small tickets', 'Reviewer for Claude-built', 'Reviewer for GPT-built', 'Fixer'];
  const FAMILY = { 'claude-code': 'claude', codex: 'gpt' };
  const WRITTEN = { 'claude-code': 'Claude Code', codex: 'Codex', 'claude-opus-5-5': 'Opus 5.5', 'claude-sonnet-5-5': 'Sonnet 5.5', 'gpt-6.2-sol': 'Sol 6.2' };

  class Refused extends Error {}
  const refuse = why => { throw new Refused(why); };
  const isId = word => typeof word === 'string' && /^[A-Za-z0-9._-]+$/.test(word);
  const isModel = word => typeof word === 'string' && word.split('/').every(isId);
  const cells = line => (line.length > 1 && line.startsWith('|') && line.endsWith('|') ? line.slice(1, -1).split('|').map(c => c.trim()) : null);
  const row = line => cells(line) || refuse('a table line that is not a table row');

  // The lines under the one `## <name>` heading, to the next `## `; null when there is none.
  function section(lines, name) {
    const at = lines.flatMap((line, i) => (line === `## ${name}` ? [i] : []));
    if (at.length > 1) refuse(`more than one ## ${name} heading`);
    if (!at.length) return null;
    const end = lines.findIndex((line, i) => i > at[0] && line.startsWith('## '));
    return lines.slice(at[0] + 1, end === -1 ? lines.length : end);
  }

  function choice([harness, model, effort], [provider, modelId, effortId]) {
    if (!harness || !model || !effort) refuse('an empty name cell');
    return { provider, model: modelId, effort: effortId, family: FAMILY[provider] ?? null, names: { harness, model, effort } };
  }

  // `--provider P --model M --reasoning-level E`, in one code span.
  function flags(cell) {
    const words = /^`(.*)`$/.exec(cell)?.[1].split(' ') || refuse('flags not in one code span');
    if (words.length !== 6 || words[0] !== '--provider' || words[2] !== '--model' || words[4] !== '--reasoning-level'
      || !isId(words[1]) || !isModel(words[3]) || !isId(words[5])) refuse('broken flags');
    return [words[1], words[3], words[5]];
  }

  function modelsTable(lines) {
    const start = lines.findIndex(line => line.startsWith('|'));
    if (start === -1) refuse('no Models table');
    const end = lines.findIndex((line, i) => i > start && !line.startsWith('|'));
    const rows = lines.slice(start, end === -1 ? lines.length : end).map(row);
    if (rows.length < 2 || rows[0].join('|') !== HEADER || rows[1].join('|') !== '---|---|---|---|---') refuse('a broken Models header');
    const roles = {};
    let next = 0;
    for (const cellsOf of rows.slice(2)) {
      if (cellsOf.length !== 5) refuse('a Models row without five cells');
      const at = ROLES.findIndex(([, word], i) => i >= next && word === cellsOf[0]);
      if (at === -1) refuse(`the ${cellsOf[0]} row is out of place`);
      if (at > next && next < 3) refuse('a required row is missing');
      if (cellsOf[1] === 'follows Builder' && cellsOf.slice(2).every(c => c === '')) {
        if (at < 3) refuse(`the ${cellsOf[0]} row cannot follow`);
        roles[ROLES[at][0]] = { follows: 'builder', choice: null };
      } else {
        roles[ROLES[at][0]] = { follows: null, choice: choice(cellsOf.slice(1, 4), flags(cellsOf[4])) };
      }
      next = at + 1;
    }
    if (next < 3) refuse('a required row is missing');
    for (const [key] of ROLES.slice(3)) roles[key] ||= { follows: 'builder', choice: null };
    for (const role of Object.values(roles)) if (role.follows) role.choice = roles.builder.choice;
    return roles;
  }

  // One older `| Setting | Value | flag |` table: its Harness, Model and Effort rows.
  function settingTable(lines) {
    const rows = lines.filter(line => line.startsWith('|')).map(row);
    const names = [];
    const ids = [];
    [['Harness', '--provider'], ['Model', '--model'], ['Effort', '--reasoning-level']].forEach(([setting, flag], i) => {
      const r = rows[i + 2];
      const value = r?.length === 3 && r[0] === setting ? new RegExp(`^\`${flag} (.*)\`$`).exec(r[2])?.[1] : null;
      if (value == null || !(i === 1 ? isModel(value) : isId(value))) refuse(`a broken ${setting} row`);
      names.push(r[1]);
      ids.push(value);
    });
    return choice(names, ids);
  }

  function olderTables(lines) {
    const tables = OLDER.slice(0, 4).map(name => settingTable(section(lines, name) || refuse(`no ## ${name}`)));
    const fixer = (section(lines, 'Fixer') || refuse('no ## Fixer')).map(cells).filter(Boolean);
    const fixers = ['Claude', 'GPT'].map(family => {
      const r = fixer.find(c => c.length === 5 && c[0] === family) || refuse(`no Fixer row ${family}`);
      return choice(r.slice(1, 4), flags(r[4]));
    });
    const builder = tables[0];
    const at = { claude: 0, gpt: 1 }[builder.family] ?? refuse('an older Builder of no known family');
    return {
      roles: {
        orchestrator: { follows: 'builder', choice: builder },
        builder: { follows: null, choice: builder },
        reviewer: { follows: null, choice: tables[2 + at] },
        small_builder: { follows: null, choice: tables[1] },
        fixer: { follows: null, choice: fixers[at] },
      },
      // The six older rows, in KEPT's order, as written.
      rows: [tables[0], tables[1], tables[2], tables[3], fixers[0], fixers[1]],
    };
  }

  // The older rows `set` keeps in step while both forms are present, and what each must equal from the Models table:
  // the Builder, the Small builder, each family's review (cross-family rule) and fix round (fixer rule); null waits.
  const KEPT = ['Builder', 'Builder for small tickets', 'Reviewer for Claude-built', 'Reviewer for GPT-built', 'Fixer, Claude', 'Fixer, GPT'];
  function resolved({ builder, reviewer, small_builder: small, fixer }) {
    const review = family => [reviewer, builder].find(r => r.choice.family && r.choice.family !== family)?.choice ?? null;
    const fix = family => [fixer, reviewer].find(r => r.choice.family === family)?.choice ?? null;
    return [builder.choice, small.choice, review('claude'), review('gpt'), fix('claude'), fix('gpt')];
  }
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  // A kept row's two values: the model ids (or waits); when equal, model and effort; when those are too, all three.
  function values(now, was) {
    for (const keys of [['model'], ['model', 'effort'], ['provider', 'model', 'effort']]) {
      const [a, b] = [now, was].map(c => (c ? keys.map(k => c[k]).join(' ') : 'waits'));
      if (a !== b) return [a, b];
    }
    return [null, null];
  }

  // fleet.md's text -> {form, olderPresent, roles: {key: {follows, choice}}, warnings: [text]}, or throws Refused.
  function read(text) {
    const lines = String(text).split(/\r?\n/);
    const olderPresent = OLDER.some(name => lines.includes(`## ${name}`));
    const models = section(lines, 'Models');
    if (!models && !olderPresent) refuse('no model settings');
    const roles = models ? modelsTable(models) : olderTables(lines).roles;
    const warnings = [];
    const { reviewer, builder } = roles;
    if (reviewer.choice.family && reviewer.choice.family === builder.choice.family) {
      const word = reviewer.choice.family === 'claude' ? 'Claude' : 'GPT';
      warnings.push(`The Reviewer and the Builder are both ${word} models, so reviews of ${word}-built work wait (ADR 0008).`);
    }
    // While both forms are present, each older row that differs from what the Models table resolves to is named:
    // today's fleets still start from it. Unreadable older tables are ignored, as the Models table wins.
    let older = null;
    if (models && olderPresent) try { older = olderTables(lines).rows; } catch (error) { if (!(error instanceof Refused)) throw error; }
    if (older) {
      resolved(roles).forEach((now, i) => {
        if (same(now, older[i])) return;
        const [next, old] = values(now, older[i]);
        warnings.push(`Models table: ${next}; older ${KEPT[i]} table kept at ${old}; fleets start ${old} until launch-fleet reads the Models table (MD4)`);
      });
    }
    return { form: models ? 'models_table' : 'older_tables', olderPresent: Boolean(models) && olderPresent, roles, warnings };
  }

  // The names `set` writes for a choice's ids.
  const written = (provider, model, effort) => ({
    harness: WRITTEN[provider] || provider, model: WRITTEN[model] || model, effort: effort.charAt(0).toUpperCase() + effort.slice(1) });
  const said = names => `${names.model} ${names.effort} on ${names.harness}`;

  // The exact line for the user's agent: a choice ({provider, model, effort}), or null to follow the builder.
  function line(key, to) {
    const [, word, token] = ROLES.find(([k]) => k === key);
    if (!to) return `Set the ${word.toLowerCase()} to follow the builder: run \`openwiz models set ${token} follows-builder\` and commit the change.`;
    return `Set the ${word.toLowerCase()} to ${said(written(to.provider, to.model, to.effort))}: run \`openwiz models set ${token} ${to.provider} ${to.model} ${to.effort}\` and commit the change.`;
  }

  // The snapshot's text -> {readAt, label, choices: [{provider, model, effort, names, settable, recommended: [key]}]},
  // or throws Refused. Every offered choice is listed; only those `set` can write are settable.
  function offered(text) {
    let snap;
    try { snap = JSON.parse(text); } catch { refuse('not JSON'); }
    if (snap?.schema !== 'openwiz.models-offered.v1' || !Number.isSafeInteger(snap.read_at) || snap.state?.kind !== 'offered'
      || !Array.isArray(snap.harnesses)) refuse('not an offered-models snapshot');
    const str = s => typeof s === 'string' && s !== '';
    const choices = snap.harnesses.flatMap(harness => {
      if (!str(harness?.provider) || !Array.isArray(harness.models)) refuse('a broken harness');
      return harness.models.flatMap(m => {
        if (!str(m?.model) || !Array.isArray(m.efforts) || !m.efforts.every(str)) refuse('a broken model');
        return m.efforts.map(effort => ({ provider: harness.provider, model: m.model, effort, names: written(harness.provider, m.model, effort),
          settable: isId(harness.provider) && isModel(m.model) && isId(effort), recommended: [] }));
      });
    });
    for (const key of ['orchestrator', 'builder', 'reviewer']) {
      const pick = snap.recommended?.[key];
      if (pick?.offered !== true || !pick.choice) continue;
      const same = choices.find(c => c.settable && c.provider === pick.choice.provider && c.model === pick.choice.model && c.effort === pick.choice.effort);
      same?.recommended.push(key);
    }
    return { readAt: snap.read_at, label: str(snap.label) ? snap.label : '', choices };
  }

  OW.models = { read, offered, line, Refused };

  // ---- The page ----

  // The shell draws a page's icon from OW.ui.icon; this page brings its own (three stacked layers).
  const baseIcon = OW.ui.icon;
  OW.ui.icon = name => (name === 'models'
    ? OW.ui.h('svg', { class: 'ic', viewBox: '0 0 24 24', 'aria-hidden': 'true' }, OW.ui.h('path', { d: 'm12 3 9 5-9 5-9-5ZM3 12l9 5 9-5M3 16l9 5 9-5' }))
    : baseIcon(name));

  const MAKE = 'Ask your agent to run `openwiz models list --save` and commit docs/agents/models-offered.json; the choices your harnesses offer then show here.';
  const shown = { repo: null, open: null, picked: {} }; // for one repository: the open picker and each role's picked line

  function render(el, feed) {
    const { h, time } = OW.ui;
    const data = feed.data;
    const repo = OW.data.repo.get()?.full;
    if (shown.repo !== repo) Object.assign(shown, { repo, open: null, picked: {} });
    if (!data) return el.replaceChildren(OW.ui.placeholder('Reading GitHub…'));
    if (!data.fleet) {
      return el.replaceChildren(OW.ui.unknown('This repository has no docs/agents/fleet.md on its default branch, so its models aren\'t set. Ask your agent to run the setup skill, which writes it.'));
    }
    let config;
    try {
      config = read(data.fleet.text ?? '');
    } catch (error) {
      if (!(error instanceof Refused)) throw error;
      return el.replaceChildren(OW.ui.unknown(`The model settings in docs/agents/fleet.md couldn't be read (${error.message}), so no reader starts from them as written. Ask your agent to run \`openwiz models show\`, which says what to fix.`));
    }
    let snapshot = null;
    let snapshotNote = null;
    if (!data.offered) {
      snapshotNote = h('div', { class: 'notice' }, h('span', {}, h('b', {}, 'No list of offered models yet. '), MAKE));
    } else {
      try {
        snapshot = offered(data.offered.text ?? '');
      } catch (error) {
        if (!(error instanceof Refused)) throw error;
        snapshotNote = h('div', { class: 'notice bad' }, h('span', {}, h('b', {}, 'The list of offered models couldn\'t be read. '), MAKE));
      }
    }
    const notes = [snapshotNote, ...config.warnings.map(text => h('div', { class: 'notice slow' }, h('span', {}, text)))].filter(Boolean);
    const intro = h('p', { class: 'small' }, config.form === 'older_tables'
      ? 'Read from fleet.md\'s older model tables. A change through your agent adds the one Models table.'
      : 'Read from the Models table in docs/agents/fleet.md. A change reaches the next agent started; running agents keep their model.');

    const cards = ROLES.map(([key, word, , does]) => {
      const role = config.roles[key];
      const now = said(role.choice.names);
      const ids = `${role.choice.provider} ${role.choice.model} ${role.choice.effort}`;
      const open = shown.open === key;
      const picked = shown.picked[key];
      const pick = to => {
        const text = line(key, to);
        shown.picked[key] = { text, copied: null };
        Promise.resolve().then(() => navigator.clipboard.writeText(text)).then(() => true, () => false).then(copied => {
          if (shown.picked[key]?.text === text) shown.picked[key].copied = copied;
          OW.factory.redraw(el, () => render(el, feed));
        });
        OW.factory.redraw(el, () => render(el, feed));
      };
      const option = (label, tag, to, focusKey) => h('li', {},
        h('button', { type: 'button', 'data-focus': `models:${key}:${focusKey}`, onclick: () => pick(to) }, label),
        tag ? h('span', { class: 'tag' }, tag) : null);
      const picker = !open ? null : h('div', { class: 'picker' },
        snapshot
          ? h('p', { class: 'small' }, `Offered by your harnesses at ${time(snapshot.readAt)}${snapshot.label ? ` (${snapshot.label})` : ''}. Pick one to copy the line for your agent.`)
          : h('p', { class: 'small' }, MAKE),
        h('ul', { class: 'repos' },
          key === 'small_builder' || key === 'fixer' ? option('Follow the Builder', null, null, 'follow') : null,
          (snapshot?.choices || []).map(c => (c.settable
            ? option(said(c.names), c.recommended.includes(key) ? 'Recommended' : null, c, `${c.provider} ${c.model} ${c.effort}`)
            : h('li', {}, h('span', {}, said(c.names)), h('span', { class: 'tag' }, 'Can\'t be set from here'))))));
      const handoff = !picked ? null : h('div', { class: 'handoff notice', role: 'status' },
        h('span', {}, h('b', {}, picked.copied === false ? 'Copy this line for your agent: ' : picked.copied ? 'Copied. Paste it to your agent: ' : 'The line for your agent: '),
          picked.text));
      return h('div', { class: `card ${key}` },
        h('h3', {}, word),
        h('p', {}, role.follows ? `Follows the Builder: ${now}` : now),
        h('div', { class: 'num' }, ids),
        h('p', {}, does),
        h('p', { class: 'actions' }, h('button', { class: 'btn', type: 'button', 'aria-expanded': String(open), 'data-focus': `models:${key}`,
          onclick: () => { shown.open = open ? null : key; OW.factory.redraw(el, () => render(el, feed)); } }, 'Change')),
        picker, handoff);
    });
    el.replaceChildren(h('div', { class: 'models' }, notes.length ? h('div', { class: 'notices' }, notes) : null, intro, h('div', { class: 'cards' }, cards)));
  }

  OW.page({
    id: 'models',
    title: 'Models',
    icon: 'models',
    feeds: ['models'],
    render(el, feeds) {
      OW.factory.redraw(el, () => render(el, feeds.models));
    },
  });
})();

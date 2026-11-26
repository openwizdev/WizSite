import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAGES,
  DUMMY_TOKEN,
  isReadOnlyRequest,
  formatResults,
  runLiveCheck,
} from '../scripts/live-check.mjs';

const REAL_TOKEN = 'ghu_SYNTHETIC_REAL_SECRET_99999999999999';

const FLEET_MD = `# Fleet settings

## GitHub identity

| Setting | Value |
| --- | --- |
| App | Synthetic |
| Record authors | \`factory-bot[bot]\`, \`acme-owner\` |

## Models

| Role | Harness | Model | Effort | \`room-cli thread spawn\` flags |
|---|---|---|---|---|
| Orchestrator | Claude Code | Opus 5.5 | High | \`--provider claude-code --model claude-opus-5-5 --reasoning-level high\` |
| Builder | Claude Code | Opus 5.5 | High | \`--provider claude-code --model claude-opus-5-5 --reasoning-level high\` |
| Reviewer | Codex | Sol 6.2 | High | \`--provider codex --model gpt-6.2-sol --reasoning-level high\` |
| Small builder | follows Builder | | | |
| Fixer | follows Builder | | | |
`;

const FOUR_TABLE_FLEET = `# Fleet settings

Every fleet in this project starts from these settings.

## Builder

One per ticket. It builds its ticket on its own branch, and never reviews or merges.

| Setting | Value | \`room-cli thread spawn\` flag |
| --- | --- | --- |
| Harness | Antigravity | \`--provider antigravity\` |
| Model | Gemini Neon | \`--model gemini-4-neon\` |
| Effort | Medium | \`--reasoning-level medium\` |

## Builder for small tickets

Tickets with an exact \`polish\`, \`huntr\` or \`proposal\` label use this table; every other ticket uses \`## Builder\`.

| Setting | Value | \`room-cli thread spawn\` flag |
| --- | --- | --- |
| Harness | Antigravity | \`--provider antigravity\` |
| Model | Gemini Neon | \`--model gemini-4-neon\` |
| Effort | Medium | \`--reasoning-level medium\` |

## Reviewer for Claude-built

One per pull request, from a different model family than the builder.

| Setting | Value | \`room-cli thread spawn\` flag |
| --- | --- | --- |
| Harness | Codex | \`--provider codex\` |
| Model | Sol 6.1 | \`--model gpt-6.1-sol\` |
| Effort | High | \`--reasoning-level high\` |

## Reviewer for GPT-built

Use the verified builder's provider.

| Setting | Value | \`room-cli thread spawn\` flag |
| --- | --- | --- |
| Harness | Claude Code | \`--provider claude-code\` |
| Model | Opus 5.5 | \`--model claude-opus-5-5\` |
| Effort | Medium | \`--reasoning-level medium\` |
`;

function statusNote({ agent, state, step, time, pr }) {
  return [
    '<!-- openwiz:status v1 -->',
    `agent: ${agent}`,
    `state: ${state}`,
    'harness: Claude Code',
    'model: Opus 5.5',
    'skills: build-ticket@0.1.2',
    `step: ${step}`,
    `time: ${time}`,
    ...(pr ? [`pr: ${pr}`] : []),
  ].join('\n');
}

function decisionBody({ spec, kind, status, id }) {
  return [
    'Decision request.',
    '```json',
    JSON.stringify({
      schema: 'openwiz.decisions.v1',
      kind,
      id,
      status,
      fingerprint: 'a'.repeat(64),
      risk: 'ordinary',
      spec,
      summary: ['One decision summary'],
      headline: 'One headline',
      tickets: [],
      graph: [],
    }),
    '```',
  ].join('\n');
}

function makeFakeGitHub({ askHasNeedsInfo = true, fleet = FLEET_MD } = {}) {
  const now = new Date();
  const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const upstreamLog = [];

  const youIssueNodes = [
    {
      number: 46,
      title: 'Pick the release name',
      url: 'https://github.com/acme/factory/issues/46',
      updatedAt: fiveMinAgo,
      labels: { nodes: [{ name: 'needs-info' }] },
      issueDependenciesSummary: { blockedBy: 0 },
    },
    ...(askHasNeedsInfo
      ? [{
        number: 54,
        title: 'Search ranking',
        url: 'https://github.com/acme/factory/issues/54',
        updatedAt: fiveMinAgo,
        labels: { nodes: [{ name: 'needs-info' }, { name: 'ready-for-agent' }] },
        issueDependenciesSummary: { blockedBy: 0 },
      }]
      : []),
  ];

  const specsData = {
    rateLimit: { limit: 5000, remaining: 4900, resetAt: '2099-01-01T00:00:00Z' },
    specSearch: {
      totalCount: 2,
      nodes: [
        {
          number: 60,
          title: '0.1.2 spec: dark mode',
          url: 'https://github.com/acme/factory/issues/60',
          updatedAt: fiveMinAgo,
          labels: { nodes: [{ name: 'spec' }] },
          subIssuesSummary: { total: 0, completed: 0 },
        },
        {
          number: 50,
          title: '0.1.2 spec: search',
          url: 'https://github.com/acme/factory/issues/50',
          updatedAt: fiveMinAgo,
          labels: { nodes: [{ name: 'spec' }] },
          subIssuesSummary: { total: 4, completed: 1 },
        },
      ],
    },
    repository: {
      issues: {
        totalCount: 2,
        nodes: [],
      },
      youIssues: {
        totalCount: youIssueNodes.length,
        nodes: youIssueNodes,
      },
      peopleIssues: {
        totalCount: 2,
        nodes: [
          {
            number: 48,
            title: 'Manual DNS cutover',
            url: 'https://github.com/acme/factory/issues/48',
            updatedAt: twoHoursAgo,
            labels: { nodes: [{ name: 'ready-for-human' }] },
            issueDependenciesSummary: { blockedBy: 0 },
          },
          {
            number: 49,
            title: 'Manual billing check',
            url: 'https://github.com/acme/factory/issues/49',
            updatedAt: twoHoursAgo,
            labels: { nodes: [{ name: 'ready-for-human' }] },
            issueDependenciesSummary: { blockedBy: 0 },
          },
        ],
      },
      fleet: { text: fleet },
    },
  };

  const specDetails = {
    s60: {
      number: 60,
      comments: {
        totalCount: 1,
        nodes: [
          {
            databaseId: 9001,
            body: decisionBody({ spec: 60, kind: 'spec_confirmation', status: 'open', id: 'dec-60' }),
            url: 'https://github.com/acme/factory/issues/60#issuecomment-9001',
            createdAt: fiveMinAgo,
            updatedAt: fiveMinAgo,
            author: { login: 'factory-bot[bot]' },
          },
        ],
      },
      subIssues: { totalCount: 0, nodes: [] },
    },
    s50: {
      number: 50,
      comments: { totalCount: 0, nodes: [] },
      subIssues: {
        totalCount: 4,
        nodes: [
          {
            number: 51,
            title: 'Search contract',
            url: 'https://github.com/acme/factory/issues/51',
            state: 'CLOSED',
            stateReason: 'COMPLETED',
            repository: { nameWithOwner: 'acme/factory' },
            labels: { nodes: [] },
            blockedBy: { totalCount: 0, nodes: [] },
            closedByPullRequestsReferences: { totalCount: 0, nodes: [] },
            comments: { totalCount: 0, nodes: [] },
          },
          {
            number: 52,
            title: 'Search index',
            url: 'https://github.com/acme/factory/issues/52',
            state: 'OPEN',
            stateReason: null,
            repository: { nameWithOwner: 'acme/factory' },
            labels: { nodes: [{ name: 'ready-for-agent' }] },
            blockedBy: { totalCount: 0, nodes: [] },
            closedByPullRequestsReferences: { totalCount: 0, nodes: [] },
            comments: {
              totalCount: 1,
              nodes: [
                {
                  databaseId: 9101,
                  body: statusNote({ agent: 'builder', state: 'working', step: 'Writing index tests', time: fiveMinAgo }),
                  createdAt: fiveMinAgo,
                  updatedAt: fiveMinAgo,
                  author: { login: 'factory-bot[bot]' },
                },
              ],
            },
          },
          {
            number: 53,
            title: 'Search UI',
            url: 'https://github.com/acme/factory/issues/53',
            state: 'OPEN',
            stateReason: null,
            repository: { nameWithOwner: 'acme/factory' },
            labels: { nodes: [{ name: 'ready-for-agent' }] },
            blockedBy: { totalCount: 0, nodes: [] },
            closedByPullRequestsReferences: {
              totalCount: 1,
              nodes: [
                {
                  url: 'https://github.com/acme/factory/pull/153',
                  state: 'OPEN',
                  isDraft: false,
                  reviewDecision: 'REVIEW_REQUIRED',
                },
              ],
            },
            comments: {
              totalCount: 1,
              nodes: [
                {
                  databaseId: 9102,
                  body: statusNote({
                    agent: 'builder',
                    state: 'done',
                    step: 'Handed back PR #153',
                    time: twoHoursAgo,
                    pr: 'https://github.com/acme/factory/pull/153',
                  }),
                  createdAt: twoHoursAgo,
                  updatedAt: twoHoursAgo,
                  author: { login: 'factory-bot[bot]' },
                },
              ],
            },
          },
          {
            number: 54,
            title: 'Search ranking',
            url: 'https://github.com/acme/factory/issues/54',
            state: 'OPEN',
            stateReason: null,
            repository: { nameWithOwner: 'acme/factory' },
            labels: { nodes: [{ name: 'ready-for-agent' }] },
            blockedBy: { totalCount: 0, nodes: [] },
            closedByPullRequestsReferences: { totalCount: 0, nodes: [] },
            comments: {
              totalCount: 1,
              nodes: [
                {
                  databaseId: 9103,
                  body: statusNote({ agent: 'builder', state: 'asking', step: 'Confirm ranking weights', time: fiveMinAgo }),
                  createdAt: fiveMinAgo,
                  updatedAt: fiveMinAgo,
                  author: { login: 'factory-bot[bot]' },
                },
              ],
            },
          },
        ],
      },
    },
  };

  const agentsData = {
    rateLimit: { limit: 5000, remaining: 4890, resetAt: '2099-01-01T00:00:00Z' },
    repository: {
      issues: {
        totalCount: 2,
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [
          {
            number: 52,
            title: 'Search index',
            url: 'https://github.com/acme/factory/issues/52',
            state: 'OPEN',
            updatedAt: fiveMinAgo,
            comments: {
              totalCount: 1,
              nodes: [
                {
                  databaseId: 9101,
                  body: statusNote({ agent: 'builder', state: 'working', step: 'Writing index tests', time: fiveMinAgo }),
                  createdAt: fiveMinAgo,
                  updatedAt: fiveMinAgo,
                  author: { login: 'factory-bot[bot]' },
                },
              ],
            },
            closedByPullRequestsReferences: { totalCount: 0, nodes: [] },
          },
          {
            number: 53,
            title: 'Search UI',
            url: 'https://github.com/acme/factory/issues/53',
            state: 'OPEN',
            updatedAt: twoHoursAgo,
            comments: {
              totalCount: 1,
              nodes: [
                {
                  databaseId: 9102,
                  body: statusNote({
                    agent: 'builder',
                    state: 'done',
                    step: 'Handed back PR #153',
                    time: twoHoursAgo,
                    pr: 'https://github.com/acme/factory/pull/153',
                  }),
                  createdAt: twoHoursAgo,
                  updatedAt: twoHoursAgo,
                  author: { login: 'factory-bot[bot]' },
                },
              ],
            },
            closedByPullRequestsReferences: {
              totalCount: 1,
              nodes: [
                {
                  url: 'https://github.com/acme/factory/pull/153',
                  state: 'OPEN',
                  isDraft: false,
                  reviewDecision: 'REVIEW_REQUIRED',
                  commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] },
                },
              ],
            },
          },
        ],
      },
      fleet: { text: fleet },
    },
  };

  const modelsData = {
    rateLimit: { limit: 5000, remaining: 4880, resetAt: '2099-01-01T00:00:00Z' },
    repository: {
      fleet: { text: fleet },
      offered: null,
    },
  };

  async function githubFetch(url, init = {}) {
    const method = (init.method || 'GET').toUpperCase();
    const body = init.body || '';
    upstreamLog.push({ method, url, headers: init.headers || {}, body });
    const parsed = new URL(url);
    if (method === 'POST' && parsed.pathname === '/graphql') {
      const payload = JSON.parse(body || '{}');
      const op = (String(payload.query || '').match(/^\s*query\s+(\w+)/) || [])[1];
      if (op === 'Specs') return jsonResponse(200, { data: specsData });
      if (op === 'SpecTickets') {
        const repo = {};
        for (const key of Object.keys(specDetails)) {
          if (payload.query.includes(`${key}:`)) repo[key] = specDetails[key];
        }
        return jsonResponse(200, {
          data: {
            rateLimit: { limit: 5000, remaining: 4895, resetAt: '2099-01-01T00:00:00Z' },
            repository: repo,
          },
        });
      }
      if (op === 'Agents') return jsonResponse(200, { data: agentsData });
      if (op === 'Models') return jsonResponse(200, { data: modelsData });
    }
    return jsonResponse(404, { message: 'Not Found' });
  }

  return { githubFetch, upstreamLog };
}

function jsonResponse(status, json) {
  const raw = Buffer.from(JSON.stringify(json));
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers({ 'content-type': 'application/json' }),
    async arrayBuffer() {
      return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
    },
    async json() {
      return json;
    },
  };
}

test('isReadOnlyRequest allows only GET and GraphQL query reads', () => {
  assert.equal(isReadOnlyRequest('GET', 'https://api.github.com/repos/acme/factory/issues/1/comments', ''), true);
  assert.equal(
    isReadOnlyRequest('POST', 'https://api.github.com/graphql', JSON.stringify({ query: 'query Specs { viewer { login } }' })),
    true,
  );
  assert.equal(
    isReadOnlyRequest('POST', 'https://api.github.com/graphql', JSON.stringify({ query: 'mutation { addComment(input: {}) { clientMutationId } }' })),
    false,
  );
  assert.equal(
    isReadOnlyRequest('POST', 'https://api.github.com/graphql', JSON.stringify({ query: 'subscription { updates }' })),
    false,
  );
  assert.equal(isReadOnlyRequest('POST', 'https://api.github.com/graphql', '{not-json'), false);
  assert.equal(isReadOnlyRequest('POST', 'https://api.github.com/repos/acme/factory/issues/1/comments', '{"body":"hi"}'), false);
  assert.equal(isReadOnlyRequest('PATCH', 'https://api.github.com/repos/acme/factory/issues/1', '{"state":"closed"}'), false);
  assert.equal(isReadOnlyRequest('DELETE', 'https://api.github.com/repos/acme/factory/issues/1', ''), false);
  assert.equal(isReadOnlyRequest('PUT', 'https://api.github.com/repos/acme/factory/contents/a', '{}'), false);
  assert.equal(isReadOnlyRequest('GET', 'https://example.com/data', ''), false);
  assert.equal(isReadOnlyRequest('GET', 'https://user:pass@api.github.com/repos/acme/factory', ''), false);
});

test('consistent repository passes all 5 pages, keeps real token out of browser, and refuses writes', async () => {
  const { githubFetch, upstreamLog } = makeFakeGitHub();
  let browserTokenSeen = null;
  let browserCookieSeen = null;
  let writeStatuses = null;

  const result = await runLiveCheck({
    repo: 'acme/factory',
    token: REAL_TOKEN,
    githubFetch,
    async onPage(page, pageName) {
      if (pageName !== 'You') return;
      browserTokenSeen = await page.run(`localStorage.getItem('openwiz.app.auth') || ''`);
      browserCookieSeen = await page.run(`document.cookie`);
      writeStatuses = await page.run(`Promise.all([
        fetch('https://api.github.com/repos/acme/factory/issues/46/comments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: 'blocked' }),
        }).then(r => r.status),
        fetch('https://api.github.com/repos/acme/factory/issues/46', { method: 'DELETE' }).then(r => r.status),
        fetch('https://api.github.com/graphql', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: 'mutation { addComment(input: { subjectId: "x", body: "y" }) { clientMutationId } }' }),
        }).then(r => r.status),
      ])`);
    },
  });

  assert.equal(result.ok, true, `expected all pages to pass, got:\n${formatResults(result)}`);
  assert.equal(result.truth.needsYou, 3);
  assert.equal(result.truth.canvasNeedsYou, 3);
  assert.deepEqual(result.pages.map(p => p.page), PAGES);
  assert.equal(result.pages.every(p => p.pass), true);
  assert.equal(result.tokenLeaked, false);

  const lines = formatResults(result).split('\n');
  assert.equal(lines.length, 5);
  for (let i = 0; i < PAGES.length; i += 1) {
    assert.match(lines[i], new RegExp(`^PASS ${PAGES[i]}: `));
  }

  assert.ok(browserTokenSeen.includes(DUMMY_TOKEN), 'browser should hold only the dummy token');
  assert.equal(browserTokenSeen.includes(REAL_TOKEN), false, 'browser must never hold the real token');
  assert.equal(browserCookieSeen, '', 'browser must not hold cookies');

  assert.deepEqual(writeStatuses, [403, 403, 403]);
  assert.equal(result.refusedWrites.length, 3);

  assert.ok(upstreamLog.length > 0, 'upstream GitHub should have been queried');
  assert.equal(
    upstreamLog.every(r => r.headers.Authorization === `Bearer ${REAL_TOKEN}`),
    true,
    'upstream GitHub reads must use the real token from Node',
  );
  assert.equal(
    upstreamLog.some(r => r.method === 'DELETE' || r.url.includes('/comments') || r.body.includes('mutation')),
    false,
    'no write may ever leave to upstream GitHub',
  );
});

test('P4 seeded contradiction: Canvas showing "No tickets yet" where GitHub counts tickets fails Canvas', async () => {
  const { githubFetch } = makeFakeGitHub();
  const result = await runLiveCheck({
    repo: 'acme/factory',
    token: REAL_TOKEN,
    githubFetch,
    siteTransform(pathname, reply) {
      if (!/^\/app\/pages\/canvas(?:\.[0-9a-f]{10})?\.js$/.test(pathname)) return reply;
      const source = reply.raw.toString('utf8').replace(
        'else if (!sheet.read || !sheet.tickets.length) {',
        'else if (sheet.number === 50 || !sheet.read || !sheet.tickets.length) {',
      ).replace(
        'const said = sheet.total ? `GitHub counts ${sheet.done} of ${sheet.total} tickets done, ` : \'\';',
        'const said = "";',
      ).replace(
        'stage = h(\'div\', { class: \'cv-empty\' }, OW.ui.placeholder(!sheet.read || sheet.total',
        'stage = h(\'div\', { class: \'cv-empty\' }, OW.ui.placeholder(false',
      );
      return { ...reply, raw: Buffer.from(source) };
    },
  });

  assert.equal(result.ok, false);
  const canvas = result.pages.find(p => p.page === 'Canvas');
  assert.equal(canvas.pass, false);
  assert.match(formatResults(result), /FAIL Canvas:.*No tickets yet/i);
  for (const name of ['You', 'Specs', 'Agents', 'Models']) {
    assert.equal(result.pages.find(p => p.page === name).pass, true, `${name} should still pass`);
  }
});

test('P4 seeded contradiction: You counting ready-for-human in Needs you fails You', async () => {
  const { githubFetch } = makeFakeGitHub();
  const result = await runLiveCheck({
    repo: 'acme/factory',
    token: REAL_TOKEN,
    githubFetch,
    siteTransform(pathname, reply) {
      if (!/^\/app\/pages\/you(?:\.[0-9a-f]{10})?\.js$/.test(pathname)) return reply;
      const source = reply.raw.toString('utf8').replace(
        '{ label: \'Needs you\', value: c?.you, state: \'you\' },',
        '{ label: \'Needs you\', value: (Number(c?.you || 0) + (seen?.peopleTotal || 0)), state: \'you\' },',
      );
      return { ...reply, raw: Buffer.from(source) };
    },
  });

  assert.equal(result.ok, false);
  const you = result.pages.find(p => p.page === 'You');
  assert.equal(you.pass, false);
  assert.match(formatResults(result), /FAIL You:.*Needs you/i);
  for (const name of ['Specs', 'Agents', 'Canvas', 'Models']) {
    assert.equal(result.pages.find(p => p.page === name).pass, true, `${name} should still pass`);
  }
});

test('P4 seeded contradiction: Specs showing "No tickets yet" where GitHub counts tickets fails Specs', async () => {
  const { githubFetch } = makeFakeGitHub();
  const result = await runLiveCheck({
    repo: 'acme/factory',
    token: REAL_TOKEN,
    githubFetch,
    siteTransform(pathname, reply) {
      if (!/^\/app\/pages\/specs(?:\.[0-9a-f]{10})?\.js$/.test(pathname)) return reply;
      const source = reply.raw.toString('utf8').replace(
        'if (!spec.total) {',
        'if (!spec.total || spec.number === 50) {',
      ).replace(
        "spec.total === 0 ? 'No tickets yet: its plan graph isn\\'t written.' : 'Its tickets couldn\\'t be counted.'",
        "'No tickets yet: its plan graph isn\\'t written.'",
      );
      return { ...reply, raw: Buffer.from(source) };
    },
  });

  assert.equal(result.ok, false);
  const specs = result.pages.find(p => p.page === 'Specs');
  assert.equal(specs.pass, false);
  assert.match(formatResults(result), /FAIL Specs:.*No tickets yet/i);
});

test('P4 seeded contradiction: Agents missing a working agent fails Agents', async () => {
  const { githubFetch } = makeFakeGitHub();
  const result = await runLiveCheck({
    repo: 'acme/factory',
    token: REAL_TOKEN,
    githubFetch,
    siteTransform(pathname, reply) {
      if (!/^\/app\/pages\/agents(?:\.[0-9a-f]{10})?\.js$/.test(pathname)) return reply;
      const source = reply.raw.toString('utf8').replace(
        "...section('Working now', seen.now, 'No agent is working right now.', now),",
        "...section('Working now', [], 'No agent is working right now.', now),",
      );
      return { ...reply, raw: Buffer.from(source) };
    },
  });

  assert.equal(result.ok, false);
  const agents = result.pages.find(p => p.page === 'Agents');
  assert.equal(agents.pass, false);
  assert.match(formatResults(result), /FAIL Agents:.*Working now/i);
});

test('P4 seeded contradiction: Models showing a wrong role model fails Models', async () => {
  const { githubFetch } = makeFakeGitHub();
  const result = await runLiveCheck({
    repo: 'acme/factory',
    token: REAL_TOKEN,
    githubFetch,
    siteTransform(pathname, reply) {
      if (!/^\/app\/pages\/models(?:\.[0-9a-f]{10})?\.js$/.test(pathname)) return reply;
      const source = reply.raw.toString('utf8').replace(
        'const ids = role.choice ? `${role.choice.provider} ${role.choice.model} ${role.choice.effort}` : null;',
        'const ids = role.choice ? (key === "builder" ? "wrong-provider wrong-model low" : `${role.choice.provider} ${role.choice.model} ${role.choice.effort}`) : null;',
      );
      return { ...reply, raw: Buffer.from(source) };
    },
  });

  assert.equal(result.ok, false);
  const models = result.pages.find(p => p.page === 'Models');
  assert.equal(models.pass, false);
  assert.match(formatResults(result), /FAIL Models:.*builder/i);
});

test('four-table fleet without ## Fixer passes Models', async () => {
  const { githubFetch } = makeFakeGitHub({ fleet: FOUR_TABLE_FLEET });
  const result = await runLiveCheck({
    repo: 'acme/factory',
    token: REAL_TOKEN,
    githubFetch,
  });

  const models = result.pages.find(p => p.page === 'Models');
  assert.equal(models.pass, true, models.detail);
  assert.doesNotMatch(models.detail, /couldn't be read|unreadable/i);
  assert.match(formatResults(result), /PASS Models:/);
});

test('R1: a page that fails to render gets a FAIL line and the other four pages still run', async () => {
  const { githubFetch } = makeFakeGitHub();
  const result = await runLiveCheck({
    repo: 'acme/factory',
    token: REAL_TOKEN,
    githubFetch,
    pageWaitMs: 600,
    siteTransform(pathname, reply) {
      if (!/^\/app\/pages\/specs(?:\.[0-9a-f]{10})?\.js$/.test(pathname)) return reply;
      const source = reply.raw.toString('utf8').replace("title: 'Specs',", "title: 'Broken',");
      return { ...reply, raw: Buffer.from(source) };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.tokenLeaked, false);
  assert.deepEqual(result.pages.map(p => p.page), PAGES);
  const lines = formatResults(result).split('\n');
  assert.equal(lines.length, 5);
  assert.equal(result.pages.find(p => p.page === 'Specs').pass, false);
  assert.match(lines[1], /^FAIL Specs: .*Specs page/);
  for (const name of ['You', 'Agents', 'Canvas', 'Models']) {
    assert.equal(result.pages.find(p => p.page === name).pass, true, `${name} should still pass`);
  }
});

test('R2: live ask without needs-info label fails You when You omits live asks from Needs you', async () => {
  const { githubFetch } = makeFakeGitHub({ askHasNeedsInfo: false });
  const result = await runLiveCheck({
    repo: 'acme/factory',
    token: REAL_TOKEN,
    githubFetch,
  });

  assert.equal(result.ok, false);
  assert.equal(result.truth.needsYou, 3);
  const you = result.pages.find(p => p.page === 'You');
  const canvas = result.pages.find(p => p.page === 'Canvas');
  assert.equal(you.pass, false);
  assert.match(formatResults(result), /FAIL You:.*Needs you shows 2 \(GitHub expects 3\)/);
  assert.equal(canvas.pass, true);
});


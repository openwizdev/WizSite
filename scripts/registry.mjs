import { execFileSync } from 'node:child_process';

export const site = 'https://openwiz.dev/';
export const sections = Object.freeze(['pages', 'market', 'docs', 'answers']);

const root = new URL('../', import.meta.url);

function isPagePath(path) {
  return typeof path === 'string' && /^\/(?:[\w.-]+\/)*(?:[\w.-]+\.html)?$/.test(path)
    && !path.endsWith('/index.html') && new URL(path, site).href === site + path.slice(1);
}

function checkEntry({ path, title, description, breadcrumbs, section, lastmod, indexable }) {
  if (!isPagePath(path)) throw new Error(`Invalid page path: ${path}`);
  if (typeof title !== 'string' || !title.includes('OpenWiz') || title !== title.trim() || [...title].length > 60) {
    throw new Error(`${path}: title must include OpenWiz and have at most 60 characters`);
  }
  if (typeof description !== 'string' || !description || description !== description.trim() || [...description].length > 160) {
    throw new Error(`${path}: description must have 1 to 160 characters`);
  }
  if (!sections.includes(section)) throw new Error(`${path}: invalid section`);
  const date = new Date(lastmod + 'T00:00:00Z');
  if (typeof lastmod !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(lastmod) || lastmod.startsWith('0000')
      || !Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== lastmod) {
    throw new Error(`${path}: invalid lastmod`);
  }
  if (typeof indexable !== 'boolean') throw new Error(`${path}: indexable must be a boolean`);
  if (!Array.isArray(breadcrumbs) || breadcrumbs.length < (path === '/' ? 1 : 2)
      || !breadcrumbs.every(crumb => crumb && typeof crumb.name === 'string' && crumb.name.trim() && isPagePath(crumb.path))
      || breadcrumbs[0].path !== '/' || breadcrumbs.at(-1).path !== path
      || new Set(breadcrumbs.map(crumb => crumb.path)).size !== breadcrumbs.length) {
    throw new Error(`${path}: breadcrumbs must run from home to the page`);
  }
}

export function createRegistry() {
  const pages = new Map();
  const fields = ['path', 'title', 'description'];
  const claimed = new Map(fields.map(field => [field, new Set()]));
  return {
    register(entries) {
      const pending = new Map(fields.map(field => [field, new Set()]));
      const batch = Array.from(entries);
      for (const entry of batch) {
        checkEntry(entry);
        for (const field of fields) {
          if (claimed.get(field).has(entry[field]) || pending.get(field).has(entry[field])) {
            throw new Error(`${entry.path}: duplicate ${field}: ${entry[field]}`);
          }
          pending.get(field).add(entry[field]);
        }
      }
      for (const entry of batch) {
        const breadcrumbs = Object.freeze(entry.breadcrumbs.map(crumb => Object.freeze({ ...crumb })));
        pages.set(entry.path, Object.freeze({ ...entry, breadcrumbs }));
      }
      for (const field of fields) {
        for (const value of pending.get(field)) claimed.get(field).add(value);
      }
    },
    get: path => pages.get(path),
    values: () => pages.values(),
  };
}

export function pageFile(path) {
  return path.slice(1) + (path.endsWith('/') ? 'index.html' : '');
}

function committedDate(path, fallback) {
  try {
    return execFileSync('git', ['log', '-1', '--format=%cs', '--', pageFile(path)], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || fallback;
  } catch {
    return fallback;
  }
}

const home = { name: 'Home', path: '/' };
const staticPages = [
  ['/', 'Home', 'pages', '2026-11-27',
    'OpenWiz: the open source agent factory for coding agents',
    'OpenWiz is the open source kernel for agent factories. It runs fleets of coding agents like Claude Code and Codex on your own machines. Free, Apache-2.0.'],
  ['/what-is-openwiz/', 'What is OpenWiz?', 'pages', '2026-11-26',
    'What is OpenWiz?',
    'Learn how OpenWiz runs fleets of coding agents, where the agents run, how work is tracked on GitHub, and how to install it.'],
  ['/guides/run-many-coding-agents/', 'How to run many coding agents at once', 'pages', '2026-11-26',
    'How to run many coding agents at once: OpenWiz agent factory',
    'How to run a fleet of coding agents like Claude Code and Codex: what an agent factory does and how to run one with OpenWiz 0.01, step by step.'],
  ['/faq/', 'FAQ', 'pages', '2026-11-28',
    'FAQ — OpenWiz',
    'Questions about OpenWiz, the open source kernel for agent factories: what it is, what you need, where your agents run, what it costs.'],
  ['/drivers/', 'Drivers', 'pages', '2026-11-27',
    'Drivers — OpenWiz',
    'OpenWiz drivers use four commands and one test kit. See results for the shipped drivers: boat.dev, CloudRoom and your own computer or VPS.'],
  ['/changelog/', 'Changelog', 'pages', '2026-11-26',
    'Changelog — OpenWiz',
    'The OpenWiz changelog lists what each public release lets you do, newest first.'],
  ['/market/', 'Market', 'market', '2026-11-26',
    'Market — OpenWiz',
    'The OpenWiz market: drivers, harnesses, skills and anything else that plugs into OpenWiz, listed by anyone, verified when it passes its test.'],
  ['/team/', 'For your team', 'pages', '2026-11-26',
    'For your team — OpenWiz',
    'Book a 30-minute call to set up OpenWiz with your team and run a fleet on your own repository.'],
  ['/pricing/', 'Pricing', 'pages', '2026-11-26',
    'Pricing — OpenWiz',
    'OpenWiz stays free and open source. Supporter is $5 per month: priority support, and you support the project.'],
  ['/app/', 'The app', 'pages', '2026-11-28',
    'The app — OpenWiz', 'Sign in with GitHub to see your OpenWiz specs, tickets and agents.', false],
  ['/404.html', 'Page not found', 'pages', '2026-11-24',
    'Page not found — OpenWiz', 'Find the OpenWiz homepage, overview and frequently asked questions.', false],
];

export function siteRegistry() {
  const registry = createRegistry();
  registry.register(staticPages.map(([path, name, section, fallback, title, description, indexable = true]) => ({
    path, title, description, breadcrumbs: path === '/' ? [home] : [home, { name, path }],
    section, lastmod: committedDate(path, fallback), indexable,
  })));
  return registry;
}

export const pages = Object.fromEntries(
  staticPages.map(([path, , , , title, description, indexable = true]) => [
    pageFile(path), indexable ? [title, description] : [title, description, 'noindex'],
  ]),
);

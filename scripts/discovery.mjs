import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decode } from './ask-index.mjs';
import { mirrorPath } from './mirrors.mjs';

const site = 'https://openwiz.dev/';
const github = 'https://github.com/openwizdev';
const repo = github + '/OpenWiz';
const skillsRepo = github + '/WizSkills';
const skillsRef = 'maint/0.2';
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const sameAs = [github, repo, 'https://x.com/openwiz'];
const organization = site + '#organization';
const software = site + '#software';
const schema = 'https://schema.org';

export const aboutPage = 'what-is-openwiz/index.html';
export const faqPage = 'faq/index.html';
export const guidePage = 'guides/run-many-coding-agents/index.html';
export const pages = {
  'index.html': [
    'OpenWiz: the open source agent factory for coding agents',
    'OpenWiz is the open source kernel for agent factories. It runs fleets of coding agents like Claude Code and Codex on your own machines. Free, Apache-2.0.',
  ],
  [aboutPage]: [
    'What is OpenWiz?',
    'Learn how OpenWiz runs fleets of coding agents, where the agents run, how work is tracked on GitHub, and how to install it.',
  ],
  [guidePage]: [
    'How to run many coding agents at once: OpenWiz agent factory',
    'How to run a fleet of coding agents like Claude Code and Codex: what an agent factory does and how to run one with OpenWiz 0.01, step by step.',
  ],
  [faqPage]: [
    'FAQ — OpenWiz',
    'Questions about OpenWiz, the open source kernel for agent factories: what it is, what you need, where your agents run, what it costs.',
  ],
  'drivers/index.html': [
    'Drivers — OpenWiz',
    'OpenWiz drivers use four commands and one test kit. See results for the shipped drivers: boat.dev, CloudRoom and your own computer or VPS.',
  ],
  'changelog/index.html': [
    'Changelog — OpenWiz',
    'The OpenWiz changelog lists what each public release lets you do, newest first.',
  ],
  'market/index.html': [
    'Market — OpenWiz',
    'The OpenWiz market: drivers, harnesses, skills and anything else that plugs into OpenWiz, listed by anyone, verified when it passes its test.',
  ],
  'team/index.html': [
    'For your team — OpenWiz',
    'Book a 30-minute call to set up OpenWiz with your team and run a fleet on your own repository.',
  ],
  'pricing/index.html': [
    'Pricing — OpenWiz',
    'OpenWiz stays free and open source. Supporter is $5 per month: priority support, and you support the project.',
  ],
  'app/index.html': ['The app — OpenWiz', 'Sign in with GitHub to see your OpenWiz specs, tickets and agents.', 'noindex'],
  'counters/index.html': ['Site counters — OpenWiz', 'Totals for openwiz.dev: page views, docs views, install clicks and release downloads. No cookie, nothing per visitor.', 'noindex'],
  '404.html': ['Page not found — OpenWiz', 'Find the OpenWiz homepage, overview and frequently asked questions.', 'noindex'],
};

export const urlFor = page => site + page.replace(/index\.html$/, '');
const escape = text => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const plain = html => decode(html.replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/g, '').replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();

function faqEntries(html) {
  const entries = [...html.matchAll(/<div class="faq-row">\s*<h3[^>]*><button[^>]*>([\s\S]*?)<\/button><\/h3>\s*<div class="faq-a"[^>]*><div>([\s\S]*?)<\/div><\/div>\s*<\/div>/g)]
    .map(([, question, answer]) => [plain(question), plain(answer.replace(/<\/p>/g, ' '))]);
  if (entries.length === 0 || entries.length !== html.split('class="faq-row"').length - 1) {
    throw new Error('Every FAQ row needs a question and an answer');
  }
  return entries;
}

export function guideSteps(html) {
  const list = html.match(/<ol class="guide-steps">([\s\S]*?)<\/ol>/);
  if (!list) throw new Error('The guide needs its steps');
  const steps = [...list[1].matchAll(/<li><strong>([^<]+)\.<\/strong>([\s\S]*?)<\/li>/g)].map(([, name, text]) => [plain(name), plain(text)]);
  if (steps.length === 0 || steps.length !== list[1].split('<li>').length - 1) throw new Error('Every guide step needs a name and its text');
  return steps;
}

function structuredData(page, faq, html) {
  if (page === 'index.html') {
    return {
      '@context': schema,
      '@graph': [
        { '@type': 'Organization', '@id': organization, name: 'OpenWiz', url: site, logo: site + 'brand/openwiz-lockup.svg', sameAs },
        { '@type': 'WebSite', '@id': site + '#website', name: 'OpenWiz', url: site },
        {
          '@type': 'SoftwareApplication', '@id': software, name: 'OpenWiz', description: pages[page][1], url: site,
          applicationCategory: 'DeveloperApplication', operatingSystem: 'macOS, Linux',
          offers: [
            { '@type': 'Offer', price: 0, priceCurrency: 'USD', name: 'Free' },
            { '@type': 'Offer', price: 5, priceCurrency: 'USD', name: 'Supporter' },
          ],
          license: 'https://www.apache.org/licenses/LICENSE-2.0', downloadUrl: repo + '/releases',
          sameAs, publisher: { '@id': organization },
        },
      ],
    };
  }
  if (page === faqPage) {
    return {
      '@context': schema, '@type': 'FAQPage', url: urlFor(page),
      mainEntity: faqEntries(faq).map(([name, text]) => ({
        '@type': 'Question', name, acceptedAnswer: { '@type': 'Answer', text },
      })),
    };
  }
  if (page === guidePage) {
    return {
      '@context': schema, '@type': 'HowTo', url: urlFor(page), name: plain(html.match(/<h1>([\s\S]*?)<\/h1>/)[1]),
      description: pages[page][1], about: { '@id': software },
      step: guideSteps(html).map(([name, text], index) => ({ '@type': 'HowToStep', position: index + 1, name, text })),
    };
  }
  if (page === aboutPage) {
    return { '@context': schema, '@type': 'AboutPage', url: urlFor(page), about: { '@id': software } };
  }
}

export function withMetadata(page, html, faq) {
  const [title, description, robots] = pages[page];
  const url = urlFor(page);
  const tags = [`<title>${escape(title)}</title>`, `<meta name="description" content="${escape(description)}">`];
  if (page !== '404.html') tags.push(`<link rel="canonical" href="${url}">`);
  if (robots) tags.push(`<meta name="robots" content="${robots}">`);
  else {
    tags.push(`<link rel="alternate" type="text/markdown" href="/${escape(mirrorPath(page))}">`);
    for (const [key, value] of Object.entries({ type: 'website', site_name: 'OpenWiz', title, description, url })) {
      tags.push(`<meta property="og:${key}" content="${escape(value)}">`);
    }
    for (const [key, value] of Object.entries({ site: '@openwiz', title, description })) {
      tags.push(`<meta name="twitter:${key}" content="${escape(value)}">`);
    }
    const data = structuredData(page, faq, html);
    if (data) {
      tags.push(`<script type="application/ld+json">\n${JSON.stringify(data, null, 2).replaceAll('<', '\\u003c')}\n</script>`);
    }
  }
  const slot = '<template data-slot="page-metadata"></template>';
  if (html.split(slot).length !== 2) throw new Error(`${page} needs one metadata slot`);
  return html.replace(slot, () => `<!-- metadata:start -->\n${tags.join('\n')}\n<!-- metadata:end -->`);
}

const crawlers = [
  '*', 'GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User',
  'anthropic-ai', 'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'Googlebot', 'Bingbot',
  'Applebot', 'Applebot-Extended', 'DuckDuckBot', 'CCBot', 'meta-externalagent', 'Amazonbot', 'cohere-ai', 'YouBot',
];

export function crawlerFiles(about, guide, mirrors) {
  const indexable = Object.entries(pages).filter(([, [, , robots]]) => !robots);
  const main = about.match(/<main\b[^>]*>([\s\S]*?)<\/main>/)[1];
  const [intro, ...body] = [...main.matchAll(/<(h1|h2|p|li)\b[^>]*>([\s\S]*?)<\/\1>/g)];
  const link = /<a href="([^"]+)">([^<]+)<\/a>/g;
  const markdown = html => plain(html.replace(link, (_, url, label) => `[${label}](${new URL(url, site)})`));
  const links = body.filter(([, tag]) => tag === 'li').map(([, , html]) => '- ' + markdown(html).replace(') — ', '): '));
  const [, , summary] = body.find(([, tag]) => tag === 'p');
  const [, , whatItDoes] = body.filter(([, tag]) => tag === 'p')[1];
  const llms = [
    '# OpenWiz',
    `> ${plain(summary)}`,
    plain(whatItDoes),
    'To install, paste this one line into your coding agent (Claude Code, Codex or another): "Install OpenWiz from github.com/openwizdev/OpenWiz". It shows every change first and waits for your yes.',
    '## Install', [
      `- [SKILL.md](${site}SKILL.md): a short Agent Skill that installs OpenWiz from the one line`,
      `- [Install skill](${skillsRepo}/blob/${skillsRef}/skills/install/SKILL.md): the full install your agent follows (WizSkills ${skillsRef})`,
      `- [Install guide](${repo}/blob/main/docs/install.md#openwiz-010): every step and command, what it may change, and how to recover or remove it`,
      `- [Release 0.1.0](${repo}/releases/tag/v0.1.0): the verified prebuilt packages`,
    ].join('\n'),
    '## Docs', [
      `- [${plain(intro[2])}](${urlFor(aboutPage)}): What it does, where agents run, and how to install it.`,
      `- [${plain(guide.match(/<h1>([\s\S]*?)<\/h1>/)[1])}](${urlFor(guidePage)}): What an agent factory is, and how to run a fleet of coding agents with OpenWiz 0.01, step by step.`,
      links.find(line => line.startsWith('- [FAQ]')),
      `- [Full OpenWiz text](${site}llms-full.txt): Every indexable page in one file.`,
      `- [README](${repo}/blob/main/README.md): what OpenWiz is and how the kernel fits together`,
      `- [Your first hour](${repo}/blob/main/docs/first-hour.md): from install to your first merged pull request`,
      `- [Records v1](${repo}/blob/main/kernel/records.v1.md): the rules for specs, tickets and status notes on GitHub`,
      `- [AGENTS.md](${repo}/blob/main/AGENTS.md): where agents start when contributing to OpenWiz`,
    ].join('\n'),
    '## Drivers', [
      `- [Drivers](${site}drivers/): where your agents run: your computer or a VPS, CloudRoom and boat.dev`,
      `- [Driver v1](${repo}/blob/main/kernel/driver.v1.md): the four commands a driver answers: version, start, wake, stop`,
      `- [Driver template](${repo}/blob/main/adapters/template/README.md): copy it to plug in your own host`,
      `- [Driver kit](${repo}/blob/main/kernel/driver-kit/README.md): checks a driver on its real host`,
    ].join('\n'),
    '## Skills', [
      `- [WizSkills](${skillsRepo}): the skills OpenWiz puts into your agents, such as install, grill, to-spec, to-tickets, build-ticket and review-ticket`,
    ].join('\n'),
    '## Changelog', [
      links.find(line => line.startsWith('- [Changelog]')),
      `- [CHANGELOG.md](${repo}/blob/main/CHANGELOG.md): what each version adds, in full`,
    ].join('\n'),
    '## Feedback', [
      `- [Report a problem](${repo}/issues/new?template=feedback.yml): open a feedback issue on GitHub`,
      `- [Issues](${repo}/issues): for anything beyond a small fix, open an issue first`,
    ].join('\n'),
    '## Links', links.filter(line => !line.startsWith('- [FAQ]') && !line.startsWith('- [Changelog]')).join('\n'),
    '## Markdown copies', indexable
      .map(([page, [title, description]]) => `- [${title}](${site}${mirrorPath(page)}): ${description}`).join('\n'),
  ].join('\n\n') + '\n';
  const full = ['# OpenWiz', ...indexable.map(([page, [title]]) => {
    const copy = mirrors.get(page);
    if (!copy) throw new Error(`Missing Markdown copy for ${page}`);
    return `## ${title}\n\nURL: ${urlFor(page)}\n\n${copy.trimEnd()}`;
  })].join('\n\n') + '\n';

  const fallbackDate = new Date().toISOString().slice(0, 10);
  const lastModified = page => {
    try {
      const committed = execFileSync('git', ['log', '-1', '--format=%cs', '--', page], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(committed)) return committed;
    } catch {}
    return fallbackDate;
  };
  const urls = indexable.map(([page]) =>
    `  <url><loc>${urlFor(page)}</loc><lastmod>${lastModified(page)}</lastmod></url>`);
  return {
    'robots.txt': crawlers.map(agent => `User-agent: ${agent}\nAllow: /\nDisallow: /api/\n\n`).join('') + `Sitemap: ${site}sitemap.xml\n`,
    'sitemap.xml': ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', ...urls, '</urlset>', ''].join('\n'),
    'llms.txt': llms,
    'llms-full.txt': full,
  };
}

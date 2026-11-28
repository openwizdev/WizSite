from pathlib import Path
import json
import re
import shutil
import subprocess
import tempfile
import unittest

from check import ROOT, SITE_PAGES, check_site


def node(code):
    return subprocess.run(
        ['node', '--input-type=module', '-e', code],
        cwd=ROOT, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )


class Pricing(unittest.TestCase):
    def test_checkout_control_and_validation(self):
        code = r'''
import { parseCheckout, checkoutControl, readCheckout } from './scripts/pricing.mjs';
const problems = [];
const eq = (actual, expected) => { if (actual !== expected) problems.push(JSON.stringify(actual) + ' != ' + JSON.stringify(expected)); };
eq(parseCheckout(''), '');
eq(parseCheckout('  '), '');
eq(parseCheckout('https://pay.example/supporter'), 'https://pay.example/supporter');
const parsed = readCheckout('{"1":"","10":" https://pay.example/a?x=1&y=2 ","100":""}');
eq(parsed['1'], '');
eq(parsed['10'], 'https://pay.example/a?x=1&y=2');
eq(parsed['100'], '');
const soon = checkoutControl('', '1');
if (!soon.includes('disabled') || soon.includes('href=') || !soon.includes('>Coming with 0.2.0<')) problems.push(soon);
const live = checkoutControl('https://pay.example/a?x=1&y=2', '10');
if (!live.includes('href="https://pay.example/a?x=1&amp;y=2"') || !live.includes('rel="noreferrer"') || !live.includes('data-checkout') || live.includes('Coming with 0.2.0')) problems.push(live);
for (const bad of ['http://pay.example/x', 'https://user:pass@pay.example/x', 'javascript:alert(1)', 'not a url', '//pay.example/x']) {
  try { parseCheckout(bad); problems.push('accepted ' + bad); } catch {}
}
for (const bad of ['{"1":1,"10":"","100":""}', '[]', 'null', '"x"', '{"1":"http://insecure.example/a","10":"","100":""}']) {
  try { readCheckout(bad); problems.push('accepted ' + bad); } catch {}
}
if (problems.length) { console.log(problems.join('\n')); process.exit(1); }
'''
        run = node(code)
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)

    def test_tiers_from_file_and_invalid_tier_files_fail(self):
        code = r'''
import { readFileSync } from 'node:fs';
import { readTiers, readCheckout, withCheckout } from './scripts/pricing.mjs';

const template = readFileSync('./pricing/index.html', 'utf8');
const defaultTiers = readTiers();
const emptyCheckout = readCheckout('{"1":"","10":"","100":""}');
const htmlDefault = withCheckout(template, emptyCheckout, defaultTiers);
for (const expected of ['Free', '$0', 'Supporter', '$1', '$10', 'Business', '$100', 'Coming with 0.2.0']) {
  if (!htmlDefault.includes(expected)) {
    console.error('missing from default build:', expected);
    process.exit(1);
  }
}
if (htmlDefault.includes('<a class="price-subscribe"')) {
  console.error('empty checkout should not link paid tiers');
  process.exit(1);
}

const partialCheckout = readCheckout('{"1":"","10":"https://pay.example/ten","100":""}');
const htmlPartial = withCheckout(template, partialCheckout, defaultTiers);
if (!htmlPartial.includes('href="https://pay.example/ten"')) {
  console.error('fixture checkout URL missing from tier 10');
  process.exit(1);
}
if (htmlPartial.split('>Coming with 0.2.0<').length - 1 !== 2) {
  console.error('expected two remaining Coming with 0.2.0 buttons');
  process.exit(1);
}

const altTiers = readTiers(JSON.stringify([
  {
    id: 'free',
    name: 'Free',
    price: 0,
    period: null,
    checkoutKey: null,
    cta: { label: 'Start free', href: '/' },
    perks: ['All features included.']
  },
  {
    id: 'patron-50',
    name: 'Patron',
    price: 50,
    period: 'month',
    checkoutKey: '50',
    perks: ['Cosmetic only: gold badge.']
  }
]));
const altCheckout = readCheckout('{"50":"https://pay.example/patron"}', ['50']);
const htmlAlt = withCheckout(template, altCheckout, altTiers);
if (!htmlAlt.includes('Patron') || !htmlAlt.includes('$50') || !htmlAlt.includes('Cosmetic only: gold badge.') || !htmlAlt.includes('href="https://pay.example/patron"')) {
  console.error('alternate tier file did not render expected output');
  process.exit(1);
}
if (htmlAlt.includes('Business') || htmlAlt.includes('$100')) {
  console.error('alternate tier file still rendered hardcoded tiers');
  process.exit(1);
}

const badTiers = [
  '[]',
  '{}',
  '[{"id":"free"}]',
  '[{"id":"bad id","name":"Free","price":0,"period":null,"checkoutKey":null,"cta":{"label":"Go","href":"/"},"perks":["ok"]}]',
  '[{"id":"neg","name":"Neg","price":-1,"period":"month","checkoutKey":"1","perks":["ok"]}]',
  '[{"id":"dup","name":"A","price":0,"period":null,"checkoutKey":null,"cta":{"label":"Go","href":"/"},"perks":["ok"]},{"id":"dup","name":"B","price":1,"period":"month","checkoutKey":"1","perks":["ok"]}]',
  '[{"id":"paid","name":"Paid","price":1,"period":"month","checkoutKey":"1","perks":[]}]',
  '[{"id":"free","name":"Free","price":0,"period":null,"checkoutKey":null,"cta":{"label":"Go","href":"https://evil.example"},"perks":["ok"]}]',
];
for (const bad of badTiers) {
  let failed = false;
  try { readTiers(bad); } catch { failed = true; }
  if (!failed) {
    console.error('accepted invalid tier file:', bad);
    process.exit(1);
  }
}
'''
        run = node(code)
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)

    def test_pricing_page_lineup_and_cosmetic_copy(self):
        page = (ROOT / 'dist/pricing/index.html').read_text()
        self.assertIn('every tier gets the same software, features and support; paid tiers are cosmetic only.', page.lower())
        for token in ('Free', '$0', 'Supporter', '$1', '$10', 'Business', '$100'):
            self.assertIn(token, page)
        self.assertEqual(page.count('>Coming with 0.2.0<'), 3)
        self.assertNotIn('<a class="price-subscribe"', page)

    def test_no_site_page_mentions_old_five_dollar_or_priority_support(self):
        dist = ROOT / 'dist'
        targets = list(SITE_PAGES) + ['ask-index.json', 'llms.txt', 'llms-full.txt']
        for rel in targets:
            text = (dist / rel).read_text()
            self.assertNotRegex(text, r'\$5\b', f'old $5 tier still present in {rel}')
            self.assertNotRegex(text, r'priority support', f'priority support still present in {rel}')

    def test_built_control_matches_checkout_json(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / 'dist'
            shutil.copytree(ROOT / 'dist', root)
            page = root / 'pricing/index.html'
            original = page.read_text()
            self.assertIn('>Coming with 0.2.0<', original)
            self.assertNotIn('<a class="price-subscribe"', original)
            page.write_text(original.replace('Coming with 0.2.0', 'Subscribe', 1))
            with self.assertRaisesRegex(AssertionError, 'checkout control'):
                check_site(root)


if __name__ == '__main__':
    unittest.main()

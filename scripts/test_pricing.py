from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from check import ROOT, check_site


def node(code):
    return subprocess.run(
        ['node', '--input-type=module', '-e', code],
        cwd=ROOT, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )


class Pricing(unittest.TestCase):
    def test_checkout_control(self):
        code = r'''
import { parseCheckout, checkoutControl, readCheckout } from './scripts/pricing.mjs';
const problems = [];
const eq = (actual, expected) => { if (actual !== expected) problems.push(JSON.stringify(actual) + ' != ' + JSON.stringify(expected)); };
eq(parseCheckout(''), '');
eq(parseCheckout('  '), '');
eq(parseCheckout('https://pay.example/supporter'), 'https://pay.example/supporter');
eq(readCheckout('{"checkoutUrl":" https://pay.example/a?x=1&y=2 "}'), 'https://pay.example/a?x=1&y=2');
const soon = checkoutControl('');
if (!soon.includes('disabled') || soon.includes('href=') || !soon.includes('>Coming soon<') || !soon.includes('not open yet')) problems.push(soon);
const live = checkoutControl('https://pay.example/a?x=1&y=2');
if (!live.includes('href="https://pay.example/a?x=1&amp;y=2"') || !live.includes('rel="noreferrer"') || !live.includes('data-checkout') || !live.includes('>Subscribe<') || live.includes('Coming soon')) problems.push(live);
for (const bad of ['http://pay.example/x', 'https://user:pass@pay.example/x', 'javascript:alert(1)', 'not a url', '//pay.example/x']) {
  try { parseCheckout(bad); problems.push('accepted ' + bad); } catch {}
}
for (const bad of ['{"checkoutUrl":"","note":"x"}', '{"checkoutUrl":1}', '{}', '[]']) {
  try { readCheckout(bad); problems.push('accepted ' + bad); } catch {}
}
if (problems.length) { console.log(problems.join('\n')); process.exit(1); }
'''
        run = node(code)
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)

    def test_built_control_matches_checkout_json(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / 'dist'
            shutil.copytree(ROOT / 'dist', root)
            page = root / 'pricing/index.html'
            original = page.read_text()
            self.assertIn('>Coming soon<', original)
            self.assertNotIn('<a class="price-subscribe"', original)
            page.write_text(original.replace('Coming soon', 'Subscribe', 1))
            with self.assertRaisesRegex(AssertionError, 'checkout control comes from pricing/checkout.json'):
                check_site(root)


if __name__ == '__main__':
    unittest.main()

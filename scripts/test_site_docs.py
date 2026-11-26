import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
README = (ROOT / 'README.md').read_text()
REPOS = (ROOT / 'docs' / 'repos.md').read_text()
MAP = (ROOT / 'docs' / 'repo-map.svg').read_text()
MAINTAINING = (ROOT / 'docs' / 'maintaining.md').read_text()
FLEET = (ROOT / 'docs' / 'agents' / 'fleet.md').read_text()
WORKFLOW = (ROOT / '.github' / 'workflows' / 'site.yml').read_text()
PACKAGE = json.loads((ROOT / 'package.json').read_text())
FAQ = (ROOT / 'faq.html').read_text()
LANDING = (ROOT / 'index.html').read_text()

PAGES = (
    'https://openwiz.dev/',
    'https://openwiz.dev/what-is-openwiz/',
    'https://openwiz.dev/guides/run-many-coding-agents/',
    'https://openwiz.dev/faq/',
    'https://openwiz.dev/drivers/',
    'https://openwiz.dev/changelog/',
    'https://openwiz.dev/market/',
    'https://openwiz.dev/team/',
    'https://openwiz.dev/app/',
)
APP_PAGES = ('You', 'Queue', 'Specs', 'Agents', 'Canvas', 'Models')
FUNCTIONS = ('/api/sign-in/start', '/api/sign-in/token', '/api/sign-in/refresh', '/api/ask', '/api/count')
TOP_BAR_PAGES = (
    '/',
    '/what-is-openwiz/',
    '/guides/run-many-coding-agents/',
    '/drivers/',
    '/changelog/',
    '/market/',
    '/faq/',
    '/team/',
    '404',
)


def fleet_commands():
    rows = re.findall(r'^\| \d+ \| root \| `([^`]+)` \|', FLEET, re.M)
    if not rows:
        raise AssertionError('the fleet test-command table has no rows')
    return rows


class SiteDocsMatchTheSite(unittest.TestCase):
    def test_readme_names_the_release_every_page_and_every_function(self):
        self.assertIn('0.1.0', README)
        self.assertRegex(README, r'current release')
        self.assertNotIn('coming soon', README.lower())
        for page in PAGES:
            self.assertIn(page, README)
        for name in APP_PAGES:
            self.assertIn(name, README)
        for path in FUNCTIONS:
            self.assertIn(path, README)

    def test_repository_map_names_real_repos_skills_wizdeck_and_a_live_install(self):
        self.assertNotIn('coming soon', REPOS.lower())
        self.assertIn('WizMarket', REPOS)
        self.assertIn('WizDeck', REPOS)
        self.assertIn('22 skills', REPOS)
        self.assertIn('WizMarket', MAP)
        self.assertIn('WizDeck', MAP)
        label = re.search(r'aria-label="([^"]*)"', MAP).group(1)
        self.assertIn(label, REPOS)

    def test_maintaining_faq_top_bar_install_switch_and_ci_coverage(self):
        rows = FAQ.count('class="faq-row"')
        self.assertEqual(rows, 9)
        self.assertIn('nine flat rows', MAINTAINING)
        self.assertNotIn('seven flat rows', MAINTAINING)
        self.assertNotIn("above `/team`'s closing", MAINTAINING)
        self.assertNotIn('a later change', MAINTAINING)
        self.assertIn('site.js', MAINTAINING)
        switch = re.search(r'data-install="([^"]+)"', LANDING).group(1)
        self.assertEqual(switch, 'live')
        self.assertIn('reads `live`', MAINTAINING)
        self.assertNotIn('When RL2 flips', MAINTAINING)
        for page in TOP_BAR_PAGES:
            self.assertIn(page, MAINTAINING)
        self.assertIn('test:v2', MAINTAINING)
        self.assertIn('models-page', MAINTAINING)
        self.assertIn('comment-check', MAINTAINING)

    def test_every_fleet_test_command_has_a_package_script_and_runs_in_ci(self):
        scripts = PACKAGE['scripts']
        self.assertEqual(scripts['test:v2'], "node --test 'tests/v2/*.test.mjs'")
        self.assertEqual(scripts['test:models'], 'node --test tests/models-page.test.mjs')
        self.assertEqual(scripts['test:comments'], 'python3 -I tools/comment-check/check.py diff --base HEAD^1')
        commands = fleet_commands()
        self.assertIn('npm run test:v2', commands)
        self.assertIn('npm run test:v2', WORKFLOW)
        for command in (scripts['test:models'], scripts['test:comments']):
            self.assertIn(command, commands)
            self.assertIn(command, WORKFLOW)


if __name__ == '__main__':
    unittest.main()

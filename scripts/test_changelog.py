from pathlib import Path
import re
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / 'scripts/changelog-fixtures'
TWO = FIXTURES / 'two'
STATS = FIXTURES / 'stats.json'


def generate(*args):
    done = subprocess.run(['node', str(ROOT / 'scripts/changelog.mjs'), *map(str, args)], capture_output=True, text=True, timeout=60)
    assert done.returncode == 0, done.stderr
    return done.stdout


def fixture(state, *args):
    return generate('--releases', TWO, '--stats', STATS, '--switch', state, *args)


def headings(section):
    return re.findall(r'<span class="release-product">([^<]+)</span> <span class="release-number">([^<]+)</span>', section)


class Generator(unittest.TestCase):
    def test_live_shows_every_entry_newest_first_by_publish_time(self):
        out = fixture('live')
        self.assertEqual(headings(out), [('OpenWiz', '0.01'), ('WizSkills', '0.1.2'), ('OpenWiz', '0.02')])
        self.assertIn('<time datetime="2031-02-03T09:03:08Z">Feb 3, 2031 · 09:03 UTC</time> · v0.1.2', out)
        self.assertIn('Earlier OpenWiz pre-releases are on', out)
        self.assertEqual(out.count('Full notes on GitHub'), 3)

    def test_before_live_wizskills_still_shows(self):
        out = fixture('coming-soon')
        self.assertEqual(headings(out), [('WizSkills', '0.1.2')])
        self.assertIn('No public OpenWiz release yet.', out)
        self.assertNotIn('One thing.', out)

    def test_stats_have_signs_grouping_and_screen_reader_text(self):
        out = fixture('live')
        self.assertIn('<dt>Commits</dt><dd>1,716</dd>', out)
        self.assertIn('aria-hidden="true">+238,607</span>', out)
        self.assertIn('aria-hidden="true">−0</span>', out)
        self.assertIn('238,607 lines added, 0 removed', out)
        self.assertEqual(out.count('since the first commit'), 2)
        self.assertIn('data-stats-source="snapshot"', out)

    def test_data_is_escaped_not_treated_as_markup(self):
        out = fixture('live')
        self.assertNotIn('<script>', out)
        self.assertIn('Two &lt;em&gt;things&lt;/em&gt;.', out)
        self.assertIn('Lists &lt;script&gt;sample&lt;/script&gt; threads &amp; specs.', out)

    def test_defaults_read_shipped_releases_and_landing_switch(self):
        state = re.search(r'<div class="install-box" data-install="([^"]*)"', (ROOT / 'index.html').read_text())[1]
        self.assertEqual(generate(), generate('--releases', ROOT / 'changelog/releases', '--switch', state))
        live = headings(generate('--switch', 'live'))
        self.assertIn(('OpenWiz', '0.01'), live)
        self.assertIn(('WizSkills', '0.4.2'), live)
        self.assertNotIn(('WizSkills', '0.4.3'), live)
        self.assertNotIn(('WizSkills', '0.5.0'), live)

    def test_page_gets_the_section_once_at_the_end_of_main(self):
        source = (ROOT / 'changelog/index.html').read_text()
        page = fixture('live', ROOT / 'changelog/index.html')
        start, end = '<!-- releases:start -->', '<!-- releases:end -->'
        self.assertEqual((page.count(start), page.count(end)), (1, 1))
        before, rest = page.split(start)
        section, after = rest.split(end)
        self.assertEqual(before + after, source)
        self.assertTrue(after.startswith('</main>'))
        self.assertEqual(len(headings(section)), 3)
        self.assertIn('Costs $$ and keeps $&amp; and $1 as typed', page)


if __name__ == '__main__':
    unittest.main()

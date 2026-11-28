from html.parser import HTMLParser
from pathlib import Path
import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
TWO = ROOT / 'scripts/changelog-fixtures/two'
TWO_STATS = ROOT / 'scripts/changelog-fixtures/two-stats.json'
PRE = 'https://github.com/openwizdev/OpenWiz/releases'
NODE = shutil.which('node')


def generate(*args, env=None):
    done = subprocess.run([NODE, str(ROOT / 'scripts/changelog.mjs'), *map(str, args)], capture_output=True, text=True, timeout=60, env=env)
    assert done.returncode == 0, done.stderr
    return done.stdout


def failing(*args):
    done = subprocess.run([NODE, str(ROOT / 'scripts/changelog.mjs'), *map(str, args)], capture_output=True, text=True, timeout=60)
    assert done.returncode != 0, done.stdout
    return done.stderr


def module(expression):
    script = f"import * as c from {json.dumps((ROOT / 'scripts/changelog.mjs').as_uri())}; console.log(JSON.stringify(await ({expression})));"
    done = subprocess.run([NODE, '--input-type=module', '-e', script], capture_output=True, text=True, timeout=120)
    assert done.returncode == 0, done.stderr
    return json.loads(done.stdout)


class Entries(HTMLParser):
    PARTS = ('facts', 'headline', 'picked', 'security', 'notes')

    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.entries, self.tags, self.pre, self.at, self.text = [], [], None, None, ''
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        classes = (attrs.get('class') or '').split()
        self.tags.append(tag)
        if tag == 'article':
            self.entries.append({'labelledby': attrs.get('aria-labelledby'), 'id': None, 'h2': '', 'small': '', 'datetime': None,
                                 'order': [], 'bullets': [], 'links': [], **{part: None for part in self.PARTS}})
        elif tag == 'p' and 'pre' in classes:
            self.pre = {'text': '', 'links': []}
        if tag == 'h2':
            self.entries[-1]['id'] = attrs.get('id')
        if tag == 'time':
            self.entries[-1]['datetime'] = attrs.get('datetime')
        if tag == 'a':
            (self.pre or self.entries[-1])['links'].append(attrs['href'])
        if tag == 'li':
            self.entries[-1]['bullets'].append('')
        part = next((p for p in self.PARTS if p in classes), None) if tag == 'p' and self.pre is None else None
        if part:
            self.entries[-1][part] = ''
        if self.entries and self.pre is None and tag in ('h2', 'p', 'ul'):
            self.entries[-1]['order'].append(part or tag)
        self.at = {'h2': 'h2', 'small': 'small', 'li': 'li'}.get(tag) or part or self.at

    def handle_endtag(self, tag):
        if tag in ('h2', 'small', 'p', 'li'):
            self.at = 'h2' if tag == 'small' else None

    def handle_data(self, data):
        self.text += data
        if self.pre is not None:
            self.pre['text'] += data
        elif self.at == 'li':
            self.entries[-1]['bullets'][-1] += data
        elif self.at:
            self.entries[-1][self.at] += data


class Generator(unittest.TestCase):
    def test_live_shows_every_entry_newest_first(self):
        out = Entries(generate('--releases', TWO, '--switch', 'live'))
        self.assertEqual([(e['h2'].strip(), e['small']) for e in out.entries],
                         [('0.02', '· Feb 3, 2031 (0.1.10)'), ('0.01', '· Jan 2, 2031 (0.1.2)')])
        self.assertEqual(out.entries[1]['headline'], 'One thing.')
        self.assertEqual(out.entries[1]['bullets'], ['First line.', 'Second line.'])
        self.assertEqual([e['links'] for e in out.entries], [['https://github.com/openwizdev/OpenWiz/releases/tag/v0.1.10'],
                                                             ['https://github.com/openwizdev/OpenWiz/releases/tag/v0.1.2']])
        self.assertEqual([e['notes'] for e in out.entries], ['Full release on GitHub'] * 2)
        self.assertEqual(out.pre, {'text': 'Earlier pre-releases are on GitHub.', 'links': [PRE]})

    def test_every_entry_repeats_one_unit_in_one_order(self):
        out = Entries(generate('--releases', TWO, '--stats', TWO_STATS, '--switch', 'live'))
        self.assertEqual(out.entries[0]['order'], ['h2', 'facts', 'headline', 'picked', 'ul', 'security', 'notes'])
        self.assertEqual(out.entries[1]['order'], ['h2', 'facts', 'headline', 'ul', 'notes'])
        bare = Entries(generate('--releases', TWO, '--switch', 'live'))
        self.assertEqual([e['order'] for e in bare.entries], [['h2', 'headline', 'ul', 'notes']] * 2)
        self.assertNotIn('ol', out.tags + bare.tags)
        self.assertNotIn('details', out.tags + bare.tags)

    def test_stats_row_shows_only_what_was_computed(self):
        out = Entries(generate('--releases', TWO, '--stats', TWO_STATS, '--switch', 'live'))
        self.assertEqual(out.entries[0]['facts'], '17:05 UTC · 1 PR merged · 1,234 commits · +56,789 −0 lines')
        self.assertEqual(out.entries[1]['facts'], '7 commits')
        self.assertEqual(out.entries[0]['datetime'], '2031-02-03')

    def test_curation_line_only_for_a_selection(self):
        out = Entries(generate('--releases', TWO, '--stats', TWO_STATS, '--switch', 'live'))
        self.assertEqual(out.entries[0]['picked'], 'Top 3 of 9 changes')
        self.assertIsNone(out.entries[1]['picked'])

    def test_security_line_only_when_the_release_has_fixes(self):
        out = Entries(generate('--releases', TWO, '--stats', TWO_STATS, '--switch', 'live'))
        self.assertEqual(out.entries[0]['security'], 'Also includes security fixes.')
        self.assertIsNone(out.entries[1]['security'])
        self.assertEqual([len(e['links']) for e in out.entries], [1, 1])

    def test_each_version_has_its_own_anchor(self):
        out = Entries(generate('--releases', TWO, '--stats', TWO_STATS, '--switch', 'live'))
        self.assertEqual([e['id'] for e in out.entries], ['v0-02', 'v0-01'])
        self.assertEqual([e['labelledby'] for e in out.entries], ['v0-02', 'v0-01'])

    def test_before_live_no_version_is_claimed(self):
        for state in ('coming-soon', 'anything-else'):
            out = Entries(generate('--releases', TWO, '--stats', TWO_STATS, '--switch', state))
            self.assertEqual(out.entries, [])
            self.assertEqual(out.pre['links'], [PRE])
            self.assertNotRegex(out.text, r'\d')

    def test_text_is_text_never_markup(self):
        html = generate('--releases', TWO, '--switch', 'live')
        out = Entries(html)
        self.assertNotIn('script', out.tags)
        self.assertNotIn('em', out.tags)
        self.assertEqual(out.entries[0]['headline'], 'Two <em>things</em>.')
        self.assertEqual(out.entries[0]['bullets'][0], 'Lists <script>sample</script> threads & specs.')

    def test_defaults_read_the_shipped_data_and_the_landing_switch(self):
        state = re.search(r'<div class="install-box" data-install="([^"]*)"', (ROOT / 'index.html').read_text())[1]
        self.assertEqual(generate(), generate('--releases', ROOT / 'changelog/releases', '--switch', state))
        self.assertEqual(generate(), generate('--releases', ROOT / 'changelog/releases', '--stats', ROOT / 'changelog/stats.json', '--switch', state))
        live = Entries(generate('--switch', 'live'))
        self.assertEqual([e['h2'].strip() for e in live.entries][-1:], ['0.01'])
        source = (ROOT / 'scripts/changelog.mjs').read_text()
        self.assertNotRegex(source, r'\bfetch\(|https?\.request|api\.github\.com')

    def test_the_page_builds_without_the_network_or_any_program(self):
        self.assertEqual(generate('--switch', 'live', env={'PATH': ''}), generate('--switch', 'live'))

    def test_shipped_stats_match_their_releases(self):
        stats = json.loads((ROOT / 'changelog/stats.json').read_text())
        releases = {f'v{json.loads(p.read_text())["semver"]}': json.loads(p.read_text()) for p in (ROOT / 'changelog/releases').glob('*.json')}
        self.assertLessEqual(set(stats), set(releases))
        for key, row in stats.items():
            if 'published' in row:
                self.assertEqual(row['published'][:10], releases[key]['date'])
            if 'previous' in row and row['previous']:
                self.assertLess(tuple(map(int, row['previous'][1:].split('.'))), tuple(map(int, key[1:].split('.'))))

    def test_page_gets_the_section_once_at_the_end_of_main(self):
        source = (ROOT / 'changelog/index.html').read_text()
        page = generate('--releases', TWO, '--switch', 'live', ROOT / 'changelog/index.html')
        start, end = '<!-- releases:start -->', '<!-- releases:end -->'
        self.assertEqual((page.count(start), page.count(end)), (1, 1))
        before, rest = page.split(start)
        section, after = rest.split(end)
        self.assertEqual(before + after, source)
        self.assertTrue(after.startswith('</main>'))
        self.assertEqual(len(Entries(section).entries), 2)
        self.assertIn('Costs $$ and keeps $&amp; and $1 as typed', page)


class Stats(unittest.TestCase):
    def bad(self, stats, error):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'stats.json'
            path.write_text(json.dumps(stats))
            self.assertIn(error, failing('--releases', TWO, '--stats', path, '--switch', 'live'))

    def test_bad_stats_stop_the_build(self):
        good = json.loads(TWO_STATS.read_text())['v0.1.10']
        for stats, error in (
                ({'v0.2.0': {'commits': 1}}, 'no release data file has this tag'),
                ({'v0.1.10': {**good, 'stars': 3}}, 'unexpected fields stars'),
                ({'v0.1.10': {**good, 'commits': -1}}, 'commits is a whole number'),
                ({'v0.1.10': {**good, 'prs': 1.5}}, 'prs is a whole number'),
                ({'v0.1.10': {**good, 'published': '2031-02-04T01:00:00Z'}}, 'but the data file says 2031-02-03'),
                ({'v0.1.10': {**good, 'published': '2031-02-03 17:05'}}, 'published is a UTC time'),
                ({'v0.1.10': {**good, 'previous': 'main'}}, 'previous is a tag'),
                ({'v0.1.10': {'added': 4}}, 'added and removed come together'),
                ({'v0.1.10': [1]}, 'one object per tag'),
                (None, 'one object, keyed by release tag'),
                ([], 'one object, keyed by release tag')):
            with self.subTest(error=error):
                self.bad(stats, error)

    def test_stats_respect_the_release_switch_and_count_grouped_lines(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            releases = root / 'releases'
            shutil.copytree(TWO, releases)
            ship = root / 'release.json'
            page = ROOT / 'changelog/index.html'
            args = ('--releases', releases, '--stats', TWO_STATS, '--switch', 'live', '--ship', ship, page)
            ship.write_text('{"changelog": {"0.1.10": "off"}}')
            held = generate(*args).split('<!-- releases:start -->')[1].split('<!-- releases:end -->')[0]
            self.assertEqual([entry['id'] for entry in Entries(held).entries], ['v0-01'])
            self.assertNotIn('17:05 UTC', held)

            release_file = releases / '0.02.json'
            release = json.loads(release_file.read_text())
            first, second, third = release.pop('bullets')
            release['areas'] = [{'name': 'Sample tools', 'bullets': [first, second]},
                                {'name': 'Sample docs', 'bullets': [third]}]
            release_file.write_text(json.dumps(release))
            ship.write_text('{"changelog": {"0.1.10": "on"}}')
            shown = generate(*args).split('<!-- releases:start -->')[1].split('<!-- releases:end -->')[0]
            entry = Entries(shown).entries[0]
            self.assertEqual(entry['id'], 'v0-02')
            self.assertEqual(entry['picked'], 'Top 3 of 9 changes')
            self.assertEqual(entry['areas'], release['areas'])
            self.assertEqual(entry['security'], 'Also includes security fixes.')

    def test_a_missing_stats_file_shows_no_stats(self):
        with tempfile.TemporaryDirectory() as folder:
            out = Entries(generate('--releases', TWO, '--stats', Path(folder) / 'none.json', '--switch', 'live'))
        self.assertEqual([e['facts'] for e in out.entries], [None, None])


class Refresh(unittest.TestCase):
    def test_notes_count_their_changes_and_security_fixes(self):
        body = '\n'.join(['## 0.2.0 · 2031-02-03', '**What is new for you**', '- One.', '* Two.', '',
                          'A paragraph, not a change.', '### Security', '- Fixed a hole.', '1. Fixed another.',
                          '**Under the hood**', '- Three.', '  - A detail of three.', '[Full release on GitHub](https://example.com)'])
        self.assertEqual(module(f'c.noteCounts({json.dumps(body)})'), {'changes': 5, 'security': 2})
        self.assertEqual(module('c.noteCounts("**Security fixes**\\n- One.\\n## Next\\n- Two.")'), {'changes': 2, 'security': 1})
        self.assertEqual(module('c.noteCounts(null)'), {'changes': 0, 'security': 0})

    def test_shortstat_reads_both_counts_or_zero(self):
        cases = {' 3 files changed, 10 insertions(+), 2 deletions(-)': {'added': 10, 'removed': 2},
                 ' 1 file changed, 1 insertion(+)': {'added': 1, 'removed': 0},
                 ' 2 files changed, 5 deletions(-)': {'added': 0, 'removed': 5}, '': {'added': 0, 'removed': 0}}
        for text, want in cases.items():
            self.assertEqual(module(f'c.shortstat({json.dumps(text)})'), want)

    def test_previous_is_the_newest_older_published_release(self):
        releases = [{'tag': 'v0.1.0', 'draft': False}, {'tag': 'v0.0.12', 'draft': False}, {'tag': 'v0.0.9', 'draft': False},
                    {'tag': 'v0.0.13', 'draft': True}, {'tag': 'wizbar/v0.7.0', 'draft': False}, {'tag': 'v0.2.0', 'draft': False}]
        self.assertEqual(module(f'c.previousTag({json.dumps(releases)}, "v0.1.0")'), 'v0.0.12')
        self.assertEqual(module(f'c.previousTag({json.dumps(releases)}, "v0.0.9")'), None)

    def test_range_stats_from_a_real_repository(self):
        with tempfile.TemporaryDirectory() as folder:
            env = {**os.environ, 'GIT_AUTHOR_NAME': 'a', 'GIT_AUTHOR_EMAIL': 'a@example.com', 'GIT_COMMITTER_NAME': 'a',
                   'GIT_COMMITTER_EMAIL': 'a@example.com', 'GIT_CONFIG_GLOBAL': os.devnull, 'GIT_CONFIG_NOSYSTEM': '1'}
            git = lambda *args: subprocess.run(['git', '-C', folder, *args], check=True, capture_output=True, text=True, env=env).stdout.strip()
            write = lambda name, text: (Path(folder) / name).write_text(text)
            git('init', '-q', '-b', 'main')
            write('a.txt', 'one\ntwo\n')
            git('add', '.')
            git('commit', '-q', '-m', 'first')
            git('tag', 'v0.0.1')
            outside = git('rev-parse', 'HEAD')
            git('checkout', '-q', '-b', 'side')
            write('b.txt', 'b1\nb2\nb3\n')
            git('add', '.')
            git('commit', '-q', '-m', 'side work')
            git('checkout', '-q', 'main')
            write('a.txt', 'one\n')
            git('commit', '-q', '-am', 'trim (#4)')
            squash = git('rev-parse', 'HEAD')
            git('merge', '-q', '--no-ff', '-m', 'Merge pull request #5 from side', 'side')
            merge = git('rev-parse', 'HEAD')
            git('tag', 'v0.1.0')
            gitdir = str(Path(folder) / '.git')
            merged = [squash, merge, outside, 'f' * 40]
            self.assertEqual(module(f'c.rangeStats({json.dumps(gitdir)}, "v0.0.1", "v0.1.0", {json.dumps(merged)})'),
                             {'prs': 2, 'commits': 3, 'added': 3, 'removed': 1})
            self.assertEqual(module(f'c.rangeStats({json.dumps(gitdir)}, null, "v0.0.1", {json.dumps(merged)})'),
                             {'prs': 1, 'commits': 1, 'added': 2, 'removed': 0})


if __name__ == '__main__':
    unittest.main()

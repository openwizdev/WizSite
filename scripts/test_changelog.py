from html.parser import HTMLParser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import functools
import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import unittest

ROOT = Path(__file__).resolve().parents[1]
TWO = ROOT / 'scripts/changelog-fixtures/two'
SHIP = ROOT / 'scripts/changelog-fixtures/ship'
ON = ROOT / 'scripts/changelog-fixtures/ship-on.json'
OFF = ROOT / 'scripts/changelog-fixtures/ship-off.json'
NOTES = ROOT / 'scripts/changelog-fixtures/notes-0.2.0.md'
PRE = 'https://github.com/openwizdev/OpenWiz/releases'
FRAME = ('<!doctype html><body style="margin:0"><iframe src="/changelog/" width="%d" height="%d" style="border:0"></iframe>'
         '<script>document.querySelector("iframe").onload = e => { document.body.dataset.measure = e.target.contentDocument.body.dataset.measure; };</script>')
CHROME = next((p for p in (os.environ.get('CHROME'), '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
                           '/usr/bin/chromium-browser') if p and Path(p).exists()), None)
MEASURE = ('<script>const r = [...document.querySelectorAll(".release *, .releases .pre")].map(e => e.getBoundingClientRect());'
           'const li = [...document.querySelectorAll(".release li")].map(e => parseFloat(getComputedStyle(e).fontSize));'
           'document.body.dataset.measure = JSON.stringify({inner: innerWidth, scroll: document.documentElement.scrollWidth,'
           ' right: Math.max(...r.map(b => b.right)), left: Math.min(...r.map(b => b.left)), lines: li.length, font: Math.min(...li),'
           ' areas: document.querySelectorAll(".release h3").length});</script>')


def generate(*args):
    done = subprocess.run(['node', str(ROOT / 'scripts/changelog.mjs'), *map(str, args)], capture_output=True, text=True, timeout=60)
    assert done.returncode == 0, done.stderr
    return done.stdout


class Entries(HTMLParser):
    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.entries, self.tags, self.pre, self.at, self.text = [], [], None, None, ''
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        classes = (attrs.get('class') or '').split()
        self.tags.append(tag)
        if tag == 'article':
            self.entries.append({'h2': '', 'small': '', 'headline': '', 'bullets': [], 'areas': [], 'links': []})
        elif tag == 'h3':
            self.entries[-1]['areas'].append({'name': '', 'bullets': []})
        elif tag == 'p' and 'pre' in classes:
            self.pre = {'text': '', 'links': []}
        if tag == 'a':
            (self.pre or self.entries[-1])['links'].append(attrs['href'])
        if tag == 'li':
            self.lines().append('')
        self.at = {'h2': 'h2', 'h3': 'h3', 'small': 'small', 'li': 'li'}.get(tag) or ('headline' if 'headline' in classes else self.at)

    def lines(self):
        entry = self.entries[-1]
        return entry['areas'][-1]['bullets'] if entry['areas'] else entry['bullets']

    def handle_endtag(self, tag):
        if tag in ('h2', 'h3', 'small', 'p', 'li'):
            self.at = 'h2' if tag == 'small' else None

    def handle_data(self, data):
        self.text += data
        if self.pre is not None:
            self.pre['text'] += data
        elif self.at == 'li':
            self.lines()[-1] += data
        elif self.at == 'h3':
            self.entries[-1]['areas'][-1]['name'] += data
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
        self.assertEqual(out.pre, {'text': 'Earlier pre-releases are on GitHub.', 'links': [PRE]})

    def test_before_live_no_version_is_claimed(self):
        for state in ('coming-soon', 'anything-else'):
            out = Entries(generate('--releases', TWO, '--switch', state))
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
        live = Entries(generate('--switch', 'live'))
        self.assertEqual([e['h2'].strip() for e in live.entries][-1:], ['0.01'])
        source = (ROOT / 'scripts/changelog.mjs').read_text()
        self.assertNotRegex(source, r'\bfetch\(|https?\.request|api\.github\.com')

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


class Ship(unittest.TestCase):
    def test_a_long_entry_groups_its_lines_by_area(self):
        data = json.loads((SHIP / '0.02.json').read_text())
        self.assertEqual(sum(len(area['bullets']) for area in data['areas']), 60)
        html = generate('--releases', SHIP, '--switch', 'live', '--ship', ON)
        out = Entries(html)
        self.assertEqual([(e['h2'].strip(), e['small']) for e in out.entries],
                         [('0.02', '· Mar 4, 2031 (0.2.0)'), ('0.01', '· Jan 2, 2031 (0.1.2)')])
        new, old = out.entries
        self.assertEqual(new['headline'], data['headline'])
        self.assertEqual((new['areas'], new['bullets']), (data['areas'], []))
        self.assertEqual(new['links'], [data['notes']])
        self.assertEqual((old['areas'], old['bullets']), ([], ['First line.', 'Second line.']))
        self.assertEqual({tag for tag in out.tags}, {'section', 'article', 'h2', 'h3', 'small', 'time', 'p', 'ul', 'li', 'a'})
        self.assertIn('keeps <b>markup</b> & $& as typed', new['areas'][1]['bullets'][-1])
        ids = re.findall(r' id="([^"]*)"', html)
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(ids[:3], ['v0-02', 'v0-02-sample-chat', 'v0-02-sample-drivers'])

    def test_the_switch_off_holds_the_entry_and_changes_nothing_else(self):
        with tempfile.TemporaryDirectory() as temp:
            shutil.copy(SHIP / '0.01.json', temp)
            today = generate('--releases', temp, '--switch', 'live', '--ship', OFF)
        held = generate('--releases', SHIP, '--switch', 'live', '--ship', OFF)
        self.assertEqual(held, today)
        self.assertNotIn('Sample', held)
        self.assertNotEqual(generate('--releases', SHIP, '--switch', 'live', '--ship', ON), today)
        self.assertEqual(Entries(generate('--releases', SHIP, '--switch', 'coming-soon', '--ship', ON)).entries, [])

    def test_the_switch_file_is_read_strictly(self):
        self.assertEqual(generate(), generate('--ship', ROOT / 'release.json'))
        with tempfile.TemporaryDirectory() as temp:
            for text in ('{"changelog": {"0.2.0": "soon"}}', '{"changelog": {"0.2": "on"}}', '{"changelog": "off"}', '[]', '{'):
                switch = Path(temp) / 'release.json'
                switch.write_text(text)
                done = subprocess.run(['node', str(ROOT / 'scripts/changelog.mjs'), '--releases', str(SHIP), '--switch', 'live', '--ship', str(switch)],
                                      capture_output=True, text=True, timeout=60)
                with self.subTest(text=text):
                    self.assertNotEqual(done.returncode, 0)
                    self.assertIn('release.json', done.stderr)
                    self.assertEqual(done.stdout, '')

    def test_a_null_changelog_switch_cannot_show_the_unshipped_entry(self):
        with tempfile.TemporaryDirectory() as temp:
            switch = Path(temp) / 'release.json'
            switch.write_text('{"changelog": null}')
            done = subprocess.run(['node', str(ROOT / 'scripts/changelog.mjs'), '--releases', str(SHIP),
                                   '--switch', 'live', '--ship', str(switch)], capture_output=True, text=True, timeout=60)
            versions = [entry['h2'].strip() for entry in Entries(done.stdout).entries]
            self.assertNotIn('0.02', versions)
            self.assertNotEqual(done.returncode, 0)
            self.assertIn('changelog maps a semver to on or off', done.stderr)

    def test_the_entry_comes_from_the_release_notes(self):
        made = generate('--from-notes', NOTES, '--version', '0.2.0', '--name', '0.02')
        self.assertEqual(json.loads(made), json.loads((SHIP / '0.02.json').read_text()))
        self.assertEqual(made, (SHIP / '0.02.json').read_text())
        done = subprocess.run(['node', str(ROOT / 'scripts/changelog.mjs'), '--from-notes', str(NOTES), '--version', '0.3.0', '--name', '0.03'],
                              capture_output=True, text=True, timeout=60)
        self.assertNotEqual(done.returncode, 0)
        self.assertIn('0.3.0', done.stderr)

    def site(self, temp):
        root = Path(temp) / 'site'
        shutil.copytree(ROOT, root, ignore=shutil.ignore_patterns('.git', 'dist', 'node_modules', '__pycache__'))
        (root / 'node_modules').symlink_to(ROOT / 'node_modules', target_is_directory=True)
        subprocess.run(['git', 'init', '-q'], cwd=root, check=True, timeout=60)
        (root / '.git/info/exclude').write_text('/node_modules\n')
        return root

    def build(self, root, switch=None, check=True):
        if switch:
            (root / 'release.json').write_text(json.dumps({'changelog': {'0.2.0': switch}}))
        steps = [['node', 'build.mjs']] + ([['python3', '-B', 'scripts/check.py']] if check else [])
        for step in steps:
            done = subprocess.run(step, cwd=root, capture_output=True, text=True, timeout=300)
            self.assertEqual(done.returncode, 0, done.stdout[-2000:] + done.stderr[-4000:])
        return (root / 'dist/changelog/index.html').read_text()

    def test_a_fixture_entry_builds_and_passes_the_site_check_in_both_switch_states(self):
        with tempfile.TemporaryDirectory() as temp:
            root = self.site(temp)
            today = self.build(root)
            shutil.copy(SHIP / '0.02.json', root / 'changelog/releases/0.02.json')
            self.assertEqual(self.build(root, 'off'), today)
            shipped = self.build(root, 'on')
            entries = Entries(shipped.split('<!-- releases:start -->')[1].split('<!-- releases:end -->')[0]).entries
            self.assertEqual([e['h2'].strip() for e in entries], ['0.02', '0.01'])
            self.assertEqual(sum(len(area['bullets']) for area in entries[0]['areas']), 60)
            self.assertEqual(shipped.split('<!-- releases:start -->')[0], today.split('<!-- releases:start -->')[0])
            page = root / 'dist/changelog/index.html'
            page.write_text(shipped.replace('<h3 ', '<h4 ').replace('</h3>', '</h4>'))
            done = subprocess.run(['python3', '-B', 'scripts/check.py'], cwd=root, capture_output=True, text=True, timeout=300)
            self.assertNotEqual(done.returncode, 0)
            self.assertIn('unexpected element in the release entries: h4', done.stdout + done.stderr)
            page.write_text(shipped.replace('Sample market</h3>', 'Sample bazaar</h3>'))
            done = subprocess.run(['python3', '-B', 'scripts/check.py'], cwd=root, capture_output=True, text=True, timeout=300)
            self.assertNotEqual(done.returncode, 0)
            self.assertIn("the entry's areas", done.stdout + done.stderr)

    @unittest.skipUnless(CHROME, 'no Chrome or Chromium found; set CHROME')
    def test_sixty_lines_fit_a_phone_and_a_wide_screen(self):
        with tempfile.TemporaryDirectory() as temp:
            root = self.site(temp)
            shutil.copy(SHIP / '0.02.json', root / 'changelog/releases/0.02.json')
            built = self.build(root, 'on', check=False)
            (root / 'dist/changelog/index.html').write_text(built.replace('</body>', MEASURE + '</body>'))
            for width, height in ((390, 844), (1440, 900)):
                (root / f'dist/frame-{width}.html').write_text(FRAME % (width, height))
            handler = functools.partial(SimpleHTTPRequestHandler, directory=str(root / 'dist'))
            SimpleHTTPRequestHandler.log_message = lambda *args: None
            server = ThreadingHTTPServer(('127.0.0.1', 0), handler)
            threading.Thread(target=server.serve_forever, daemon=True).start()
            try:
                for width, height in ((390, 844), (1440, 900)):
                    with self.subTest(width=width):
                        done = subprocess.run([CHROME, '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', f'--user-data-dir={temp}/chrome-{width}',
                                               '--window-size=1600,1000', '--virtual-time-budget=4000', '--dump-dom',
                                               f'http://127.0.0.1:{server.server_address[1]}/frame-{width}.html'], capture_output=True, text=True, timeout=120)
                        found = re.search(r'data-measure="([^"]*)"', done.stdout)
                        self.assertTrue(found, done.stderr[-2000:])
                        seen = json.loads(found[1].replace('&quot;', '"'))
                        self.assertEqual(seen['inner'], width)
                        self.assertLessEqual(seen['scroll'], width)
                        self.assertLessEqual(seen['right'], width)
                        self.assertGreaterEqual(seen['left'], 0)
                        self.assertEqual((seen['lines'], seen['areas']), (63, 6))
                        self.assertGreaterEqual(seen['font'], 15)
            finally:
                server.shutdown()
                server.server_close()


if __name__ == '__main__':
    unittest.main()

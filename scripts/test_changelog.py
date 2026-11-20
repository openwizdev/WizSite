"""The changelog generator (#1364): fixture release notes become one part per versioned repository, newest first,
patches included, with each OpenWiz entry's shipped versions; a failed read shows as missing, never as no history."""
from html.parser import HTMLParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import re
import subprocess
import threading
import unittest

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / 'scripts/changelog-fixtures'
REPOS = ['OpenWiz', 'WizSkills', 'WizLoops']


def generate(*args):
    done = subprocess.run(['node', str(ROOT / 'scripts/changelog.mjs'), *map(str, args)], capture_output=True, text=True, timeout=60)
    assert done.returncode == 0, done.stderr
    return done.stdout


class Releases(HTMLParser):
    """The generated section read back as data: each part's repository, state, entries, shipped versions and notes."""
    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.parts, self.tags, self.stack, self.text = [], [], [], ''
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        classes = (attrs.get('class') or '').split()
        self.tags.append(tag)
        self.stack.append((tag, classes))
        if 'release-part' in classes:
            self.parts.append({'repo': attrs.get('data-repo'), 'state': None, 'entries': []})
        elif tag == 'article' and 'release' in classes:
            self.parts[-1]['entries'].append({'title': '', 'semver': None, 'ships': None, 'notes': ''})
        elif 'ships' in classes and 'missing' in classes:
            self.parts[-1]['entries'][-1]['ships'] = 'missing'
        elif 'ships' in classes:
            self.parts[-1]['entries'][-1]['ships'] = []
        elif 'no-release' in classes:
            self.parts[-1]['state'] = 'no release yet'
        elif 'missing' in classes and 'read' in classes:
            self.parts[-1]['state'] = 'missing'

    def handle_endtag(self, tag):
        while self.stack and self.stack.pop()[0] != tag:
            pass

    def inside(self, cls):
        return any(cls in classes for _, classes in self.stack)

    def handle_data(self, data):
        self.text += data
        if not self.parts or not self.parts[-1]['entries']:
            return
        entry = self.parts[-1]['entries'][-1]
        if self.stack and self.stack[-1][0] == 'h4':
            entry['title'] += data
        elif self.stack[-2:-1] and self.stack[-2][0] == 'h4' and self.stack[-1] == ('small', ['semver']):
            entry['semver'] = (entry['semver'] or '') + data
        elif self.inside('ships') and self.stack[-1][0] == 'li':
            entry['ships'].append(data.strip())
        elif self.inside('notes'):
            entry['notes'] += data


def titles(part):
    return [e['title'].strip() for e in part['entries']]


def headlines(part):
    """Each entry's headline and the semver shown small beside it (None when there is none)."""
    return [(e['title'].strip(), e['semver']) for e in part['entries']]


class Generator(unittest.TestCase):
    def test_full_notes_render_per_repository_newest_first_with_patches(self):
        # catches: parts in the wrong order or missing, string-sorted versions (0.1.2 above 0.1.10), a dropped patch,
        # drafts, pre-releases (0.3.0 here) or pre-0.1.0 releases on the page, and an empty repository rendered as nothing.
        out = Releases(generate('--fixtures', FIXTURES / 'full'))
        self.assertEqual([p['repo'] for p in out.parts], REPOS)
        openwiz, skills, loops = out.parts
        self.assertEqual(titles(openwiz), ['OpenWiz 0.1.1', 'OpenWiz 0.1.0'])
        self.assertEqual(titles(skills), ['WizSkills 0.1.10', 'WizSkills 0.1.2', 'WizSkills 0.1.0'])
        self.assertEqual((loops['state'], loops['entries']), ('no release yet', []))
        self.assertEqual([p['state'] for p in (openwiz, skills)], [None, None])
        self.assertEqual([e['ships'] for e in skills['entries']], [None] * 3)  # only OpenWiz ships other versions
        self.assertIn('the tenth patch', skills['entries'][0]['notes'])
        self.assertIn('a patch line', skills['entries'][1]['notes'])

    def test_openwiz_entry_lists_the_versions_it_ships_with(self):
        # catches: shipped versions not read from the notes, read from the wrong release, or duplicated in the notes;
        # and a cumulative release body repeating an older version's section under the newer entry.
        out = Releases(generate('--fixtures', FIXTURES / 'full'))
        self.assertEqual([p['repo'] for p in out.parts], REPOS)
        openwiz = out.parts[0]
        patch, first = openwiz['entries']
        self.assertEqual(patch['ships'], ['WizSkills 0.1.3', 'records.v1', 'sample-driver 2.0.1'])
        self.assertEqual(first['ships'], ['WizSkills 0.1.2', 'records.v1', 'sample-driver 2.0.0'])
        self.assertIn('Fixes the sample fleet reading.', re.sub(r'\s+', ' ', patch['notes']))
        self.assertNotIn('older section', patch['notes'])
        self.assertNotIn('sample-driver', patch['notes'] + first['notes'])

    def test_openwiz_entry_without_a_ships_with_list_says_so(self):
        # catches: an OpenWiz entry whose notes list no versions shown with an empty list, or silently without one;
        # and a published release with an unreadable tag silently left out of an otherwise complete history.
        out = Releases(generate('--fixtures', FIXTURES / 'sparse'))
        self.assertEqual([p['repo'] for p in out.parts], REPOS)
        self.assertEqual(titles(out.parts[0]), ['OpenWiz 0.1.0'])
        self.assertEqual(out.parts[0]['entries'][0]['ships'], 'missing')
        # A published release whose tag is no version fails its part closed, never dropped from the history.
        self.assertEqual([(p['state'], p['entries']) for p in out.parts[1:]], [('missing', []), ('no release yet', [])])

    def test_a_public_name_headlines_an_openwiz_release_with_its_semver_small(self):
        # catches (#1674, J264): an OpenWiz release named "OpenWiz 0.NN" still headlined by its semver, or shown
        # without its semver beside it; a name that only starts like one ("OpenWiz 0.03 beta") or an unnamed release
        # taking a public name; another repository's release headlined by a release name; and a name of the wrong
        # type read as no name instead of failing its part closed.
        out = Releases(generate('--fixtures', FIXTURES / 'named'))
        self.assertEqual([p['repo'] for p in out.parts], REPOS)
        openwiz, skills, loops = out.parts
        self.assertEqual(headlines(openwiz), [('OpenWiz 0.1.3', None), ('OpenWiz 0.1.2', None),
                                              ('OpenWiz 0.02', '0.1.1'), ('OpenWiz 0.01', '0.1.0')])
        self.assertEqual(headlines(skills), [('WizSkills 0.1.0', None)])
        self.assertEqual((loops['state'], loops['entries']), ('missing', []))
        # The full fixture's releases are named by their semver ("OpenWiz 0.1.0"): their headlines stay as they were.
        full = Releases(generate('--fixtures', FIXTURES / 'full'))
        self.assertEqual(headlines(full.parts[0]), [('OpenWiz 0.1.1', None), ('OpenWiz 0.1.0', None)])

    def test_failed_reads_show_as_missing_never_as_no_history(self):
        # catches: an API error object, an absent answer or a malformed release read as an empty history or as
        # "no release yet", and a bad release silently dropped from an otherwise rendered list.
        out = Releases(generate('--fixtures', FIXTURES / 'failed'))
        self.assertEqual([p['repo'] for p in out.parts], REPOS)
        self.assertEqual([(p['state'], p['entries']) for p in out.parts], [('missing', [])] * 3)
        self.assertNotIn('No release yet', out.text)

    def test_notes_are_text_never_markup(self):
        # catches: release notes injected into the page as HTML (a script tag in a note), and links carried out.
        html = generate('--fixtures', FIXTURES / 'full')
        out = Releases(html)
        self.assertNotIn('script', out.tags)
        self.assertNotIn('a', out.tags)
        self.assertIn('Lists <script>sample</script> threads & specs.', out.text)

    def test_reads_every_page_and_marks_an_http_failure_missing(self):
        # catches: only the first page of 100 releases read, a non-200 answer (even one whose body is a list) and a
        # 200 answer that isn't a list each treated as no releases.
        releases = [{'tag_name': f'v1.0.{n}', 'name': '', 'draft': False, 'prerelease': False,
                     'published_at': '2031-05-01T00:00:00Z', 'body': f'- Patch {n}.'} for n in range(101)]

        class GitHub(BaseHTTPRequestHandler):
            def do_GET(self):
                path, _, query = self.path.partition('?')
                page = int(re.search(r'(?:^|&)page=(\d+)', query)[1])
                if path == '/repos/openwizdev/WizSkills/releases':
                    body, status = json.dumps(releases[(page - 1) * 100:page * 100]), 200
                elif path == '/repos/openwizdev/WizLoops/releases':
                    body, status = '{"message": "Not a list"}', 200
                else:
                    body, status = '[]', 500
                self.send_response(status)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(body.encode())

            def log_message(self, *args):
                pass

        server = ThreadingHTTPServer(('127.0.0.1', 0), GitHub)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            out = Releases(generate('--api', f'http://127.0.0.1:{server.server_port}'))
        finally:
            server.shutdown()
            server.server_close()
        self.assertEqual([p['repo'] for p in out.parts], REPOS)
        openwiz, skills, loops = out.parts
        self.assertEqual(openwiz['state'], 'missing')
        self.assertEqual(titles(skills), [f'WizSkills 1.0.{n}' for n in range(100, -1, -1)])
        self.assertEqual((loops['state'], loops['entries']), ('missing', []))

    def test_page_keeps_what_exists_today_and_adds_releases_after_it(self):
        # catches: the merged What exists today section changed or moved, the parts placed outside the page's
        # main, before What exists today, or twice.
        source = (ROOT / 'changelog/index.html').read_text()
        page = generate('--fixtures', FIXTURES / 'full', ROOT / 'changelog/index.html')
        start, end = '<!-- releases:start -->', '<!-- releases:end -->'
        self.assertEqual((page.count(start), page.count(end)), (1, 1))
        before, rest = page.split(start)
        section, after = rest.split(end)
        self.assertEqual(before + after, source)
        self.assertTrue(after.startswith('</main>'))
        self.assertIn('What exists today', before)
        self.assertEqual([p['repo'] for p in Releases(section).parts], REPOS)


if __name__ == '__main__':
    unittest.main()

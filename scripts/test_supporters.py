from html.parser import HTMLParser
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from check import check_site, check_supporter_data, check_supporters, read_supporters, split_supporters

ROOT = Path(__file__).resolve().parents[1]
EMPTY = ROOT / 'scripts/supporters-fixtures/empty.json'
TWO = ROOT / 'scripts/supporters-fixtures/two.json'


def generate(*args):
    done = subprocess.run(['node', str(ROOT / 'scripts/supporters.mjs'), *map(str, args)], capture_output=True, text=True, timeout=60)
    assert done.returncode == 0, done.stderr
    return done.stdout


class SupportersList(HTMLParser):
    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.tags, self.items, self.empty, self.at = [], [], None, None
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        classes = (attrs.get('class') or '').split()
        self.tags.append(tag)
        if tag == 'li':
            self.items.append({'name': '', 'href': None, 'since': None, 'month': ''})
        elif tag == 'p' and 'supporters-empty' in classes:
            self.empty = {'text': '', 'links': []}
        if tag == 'a':
            if self.empty is not None:
                self.empty['links'].append(attrs['href'])
            elif self.items:
                self.items[-1]['href'] = attrs['href']
                self.at = 'name'
        elif tag == 'span' and self.items:
            self.at = 'name'
        elif tag == 'time' and self.items:
            self.items[-1]['since'] = attrs['datetime']
            self.at = 'month'

    def handle_endtag(self, tag):
        if tag in ('a', 'span', 'time'):
            self.at = None

    def handle_data(self, data):
        if self.empty is not None:
            self.empty['text'] += data
        elif self.at and self.items:
            self.items[-1][self.at] += data


class Supporters(unittest.TestCase):
    def test_empty_state_links_pro(self):
        out = SupportersList(generate('--supporters', EMPTY))
        self.assertEqual(out.items, [])
        self.assertEqual(out.empty, {'text': 'No supporters yet. Be the first.', 'links': ['/pro/']})

    def test_entries_render_in_order_and_escape_text(self):
        html = generate('--supporters', TWO)
        out = SupportersList(html)
        self.assertIsNone(out.empty)
        self.assertNotIn('script', out.tags)
        self.assertEqual(out.items, [
            {'name': 'Ada <script>Lovelace</script> & Co.', 'href': 'https://github.com/ada-lovelace', 'since': '2026-11', 'month': 'Nov 2026'},
            {'name': 'Grace $$ $& $1 Hopper', 'href': None, 'since': '2027-01', 'month': 'Jan 2027'},
        ])

    def test_page_gets_section_once_at_end_of_main(self):
        source = (ROOT / 'supporters/index.html').read_text()
        page = generate('--supporters', TWO, ROOT / 'supporters/index.html')
        fixed, section = split_supporters(page)
        self.assertEqual(fixed, source)
        self.assertIn('Grace $$ $&amp; $1 Hopper', section)
        check_supporters(fixed, section, read_supporters(TWO))

    def test_non_empty_supporters_pass_check_site(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / 'dist'
            shutil.copytree(ROOT / 'dist', root)
            built = (root / 'supporters/index.html').read_text()
            fixed, _ = split_supporters(built)
            section = generate('--supporters', TWO)
            (root / 'supporters/index.html').write_text(fixed.replace('</main>', f'<!-- supporters:start -->{section}<!-- supporters:end --></main>', 1))
            check_site(root, supporters_file=TWO)
            # An unapproved external link inside the generated section must be refused.
            (root / 'supporters/index.html').write_text(
                (root / 'supporters/index.html').read_text().replace('https://github.com/ada-lovelace', 'https://github.com/someone-else', 1)
            )
            with self.assertRaisesRegex(AssertionError, 'unexpected repository link|supporter entry mismatch'):
                check_site(root, supporters_file=TWO)

    def test_validation_refuses_bad_data_and_duplicates(self):
        valid = {'name': 'Ada Lovelace', 'github': 'ada', 'since': '2026-11'}
        check_supporter_data(valid)
        check_supporter_data({**valid, 'github': None})
        for change, error in (
                ({'name': ''}, 'non-empty trimmed'),
                ({'name': ' Ada'}, 'non-empty trimmed'),
                ({'name': 'x' * 81}, 'over 80 characters'),
                ({'name': 'Ada\nLovelace'}, 'multi-line'),
                ({'name': 'Ultra Backer'}, 'Ultra'),
                ({'github': ''}, 'invalid GitHub login'),
                ({'github': '-bad'}, 'invalid GitHub login'),
                ({'github': 'bad-'}, 'invalid GitHub login'),
                ({'github': 'bad--name'}, 'invalid GitHub login'),
                ({'github': 'a' * 40}, 'invalid GitHub login'),
                ({'github': 'bad/path'}, 'invalid GitHub login'),
                ({'since': '2026-13'}, 'YYYY-MM'),
                ({'since': '2026-00'}, 'YYYY-MM'),
                ({'since': '2026-11-01'}, 'YYYY-MM'),
                ({'extra': True}, 'unexpected supporter fields')):
            with self.subTest(change=change), self.assertRaisesRegex(AssertionError, error):
                check_supporter_data({**valid, **change})
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'supporters.json'
            path.write_text('{')
            with self.assertRaisesRegex(AssertionError, 'not JSON'):
                read_supporters(path)
            path.write_text('{}')
            with self.assertRaisesRegex(AssertionError, 'must be a JSON list'):
                read_supporters(path)
            path.write_text(json.dumps([valid, {**valid, 'name': 'Other'}]))
            with self.assertRaisesRegex(AssertionError, 'duplicate supporter GitHub login'):
                read_supporters(path)
            path.write_text(json.dumps([valid, {'name': 'ada lovelace', 'github': None, 'since': '2026-12'}]))
            with self.assertRaisesRegex(AssertionError, 'duplicate supporter name'):
                read_supporters(path)

    def test_defaults_read_shipped_data_without_network(self):
        self.assertEqual(generate(), generate('--supporters', ROOT / 'supporters/supporters.json'))
        source = (ROOT / 'scripts/supporters.mjs').read_text()
        self.assertNotRegex(source, r'\bfetch\(|https?\.request|api\.github\.com')


if __name__ == '__main__':
    unittest.main()

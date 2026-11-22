from html.parser import HTMLParser
from pathlib import Path
import re
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
TWO = ROOT / 'scripts/changelog-fixtures/two'
PRE = 'https://github.com/openwizdev/OpenWiz/releases'


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
            self.entries.append({'h2': '', 'small': '', 'headline': '', 'bullets': [], 'links': []})
        elif tag == 'p' and 'pre' in classes:
            self.pre = {'text': '', 'links': []}
        if tag == 'a':
            (self.pre or self.entries[-1])['links'].append(attrs['href'])
        if tag == 'li':
            self.entries[-1]['bullets'].append('')
        self.at = {'h2': 'h2', 'small': 'small', 'li': 'li'}.get(tag) or ('headline' if 'headline' in classes else self.at)

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


if __name__ == '__main__':
    unittest.main()

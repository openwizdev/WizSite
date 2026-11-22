from pathlib import Path
import json
import shutil
import subprocess
import tempfile
import unittest
from unittest import mock

import re

from check import CTA, FAQ, FAQ_WHERE, FOOTER, INSTALL_NOTE_HTML, FINGERPRINTS, HASHED, INSTALL_SWITCH, ROOT, Page, check_changelog, check_release_data, check_releases, read_releases, split_releases, check_motion, check_privacy, check_ref, check_site, check_vector, check_webp, fingerprint


def edit_built(root, name, change):
    old = next(p for p in root.glob(name.rsplit('.', 1)[0] + '.*.' + name.rsplit('.', 1)[1]))
    was = old.relative_to(root).as_posix()
    data = change(old.read_text()).encode()
    new = fingerprint(name, data)
    old.unlink()
    (root / new).write_bytes(data)
    for page in ('index.html', 'changelog/index.html', 'drivers/index.html', 'team/index.html', 'faq/index.html', 'app/index.html'):
        path = root / page
        path.write_text(path.read_text().replace(f'"/{was}"', f'"/{new}"'))


LANDING = ('<html><head><title>OpenWiz</title></head><body><header><nav><a href="/changelog/">Changelog</a></nav></header>'
           '<main><h1>Bring your own everything.</h1></main><footer><a href="/changelog/">Changelog</a></footer></body></html>')
CHANGELOG = ('<html><head><title>Changelog — OpenWiz</title><style>.release{color:red}</style></head><body><main id="main">'
             '<h1>Changelog</h1><p class="lead">What each public release lets you do.</p></main></body></html>')
DATA = {
    '0.01.json': {'name': '0.01', 'semver': '0.1.2', 'date': '2031-01-02', 'headline': 'One thing.',
                  'bullets': ['First line.', 'Second line.'], 'notes': 'https://github.com/openwizdev/OpenWiz/releases/tag/v0.1.2'},
    '0.02.json': {'name': '0.02', 'semver': '0.1.10', 'date': '2031-02-03', 'headline': 'Two things.',
                  'bullets': ['A <b> line & more.', 'Another.', 'Costs $$ and keeps $& as typed.'], 'notes': 'https://github.com/openwizdev/OpenWiz/releases/tag/v0.1.10'},
}
ENTRY = ('<article class="release" aria-labelledby="v{id}"><h2 id="v{id}">{name} <small>· <time datetime="{date}">{day}</time> ({semver})</small></h2>'
         '<p class="headline">{headline}</p><ul>{bullets}</ul><p class="notes"><a href="{notes}">Full notes on GitHub</a></p></article>')
PRE = 'https://github.com/openwizdev/OpenWiz/releases'
LIVE = ('<section class="releases" aria-label="Releases">'
        + ENTRY.format(id='0-02', name='0.02', date='2031-02-03', day='Feb 3, 2031', semver='0.1.10', headline='Two things.',
                       bullets='<li>A &lt;b&gt; line &amp; more.</li><li>Another.</li><li>Costs $$ and keeps $&amp; as typed.</li>', notes=DATA['0.02.json']['notes'])
        + ENTRY.format(id='0-01', name='0.01', date='2031-01-02', day='Jan 2, 2031', semver='0.1.2', headline='One thing.',
                       bullets='<li>First line.</li><li>Second line.</li>', notes=DATA['0.01.json']['notes'])
        + f'<p class="pre">Earlier pre-releases are on <a href="{PRE}">GitHub</a>.</p></section>')
SOON = f'<section class="releases" aria-label="Releases"><p class="pre">No public release yet. The pre-releases are on <a href="{PRE}">GitHub</a>.</p></section>'


def with_switch(state):
    built = (ROOT / 'dist/changelog/index.html').read_text()
    section = subprocess.run(['node', str(ROOT / 'scripts/changelog.mjs'), '--switch', state], capture_output=True, text=True, check=True).stdout
    before, rest = built.split('<!-- releases:start -->')
    return before + '<!-- releases:start -->' + section + '<!-- releases:end -->' + rest.split('<!-- releases:end -->')[1]


class Checks(unittest.TestCase):
    def test_valid_site(self):
        check_site(ROOT / 'dist')

    def test_broken_targets_fragments_and_schemes(self):
        root = ROOT / 'dist'
        page = root / 'index.html'
        pages = {page: Page(page.read_text())}
        for ref in ('/missing.css', '/#missing-id', '/fonts/missing.woff2',
                    'javascript:alert(1)', 'https://example.com/',
                    '//github.com/openwizdev/openwiz', '/../../outside'):
            with self.subTest(ref=ref), self.assertRaises(AssertionError):
                check_ref(root, page, ref, pages)
        for ref in ('/#main', '/', 'https://github.com/openwizdev/WizSkills'):
            check_ref(root, page, ref, pages)

    def test_missing_licence_and_bad_css_resource(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / 'dist'
            shutil.copytree(ROOT / 'dist', root)
            licence = root / 'fonts/OFL.txt'
            original = licence.read_bytes()
            licence.unlink()
            with self.assertRaises(AssertionError):
                check_site(root)
            licence.write_bytes(original)
            gsap_licence = root / 'vendor/GSAP-LICENSE.txt'
            gsap_licence.unlink()
            with self.assertRaisesRegex(AssertionError, 'missing build output'):
                check_site(root)
            gsap_licence.write_bytes((ROOT / 'vendor/GSAP-LICENSE.txt').read_bytes())
            edit_built(root, 'site.css', lambda t: t + '\np { background: url(/missing.png) }\n')
            with self.assertRaises(AssertionError):
                check_site(root)

    def test_privacy_in_text_paths_and_checker(self):
        for marker in ('Closed' + 'Wiz', '/' + 'Users' + '/example',
                       'private/' + 'evidence/', 'docs/' + 'grills/',
                       'thr' + '_synthetic', 'cr' + '_sub_synthetic'):
            with self.subTest(marker=marker):
                with self.assertRaises(AssertionError):
                    check_privacy('example.txt', marker.encode())
                with self.assertRaises(AssertionError):
                    check_privacy(marker + '.txt', b'safe text')
                with self.assertRaises(AssertionError):
                    check_privacy('scripts/check.py', marker.encode())
        check_privacy('index.html', b'<p>Building in public</p>')
        with self.assertRaises(AssertionError):
            check_privacy('fonts/unreviewed.woff2', b'wOF2')
        with self.assertRaises(AssertionError):
            check_privacy('fonts/Virgil.woff2', b'wOF2tampered')
        with self.assertRaises(UnicodeDecodeError):
            check_privacy('unknown.bin', b'\xff')


    def test_webp_metadata_and_inline_svg(self):
        def webp(*chunks):
            body = b'WEBP' + b''.join(k + len(v).to_bytes(4, 'little') + v + b'\0' * (len(v) & 1) for k, v in chunks)
            return b'RIFF' + len(body).to_bytes(4, 'little') + body
        check_webp(webp((b'VP8L', b'xyz')))
        for bad in (webp((b'VP8L', b'xyz'), (b'EXIF', b'name')), webp((b'XMP ', b'x')), b'GIF89a' + b'\0' * 8):
            with self.subTest(bad=bad[:16]), self.assertRaises(AssertionError):
                check_webp(bad)
        for path in ('elsewhere/x.webp', 'art/new.webp', 'art/seal.webp'):
            with self.subTest(path=path), self.assertRaises(AssertionError):
                check_privacy(path, webp((b'VP8L', ('cr' + '_sub_x').encode())))
        root = ROOT / 'dist'
        page = root / 'index.html'
        pages = {page: Page(page.read_text())}
        check_ref(root, page, "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'%3E%3Cpath d='m2.5 5 1.7 1.7' fill='none' stroke='%2316110a' stroke-width='1.5'/%3E%3C/svg%3E", pages)
        for bad in ("%3Csvg onload='x'%3E%3C/svg%3E", "%3Csvg onload ='x'%3E%3C/svg%3E",
                    "%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'%3E%3Cpath d='M0 0' fill='none' stroke='%23000000' stroke-width='1' onclick ='x'/%3E%3C/svg%3E",
                    "%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'%3E%3Cimage href='x'/%3E%3C/svg%3E"):
            with self.subTest(svg=bad), self.assertRaises(AssertionError):
                check_ref(root, page, 'data:image/svg+xml,' + bad, pages)

    def test_css_escapes_and_unreadable_urls(self):
        for bad in ('\np { background: url(https://exa\\\nmple.com/x.png) }\n',
                    '\np { background: u\\72l(https://example.com/x.png) }\n',
                    '\np { background: url( "https://example.com/x.png ) }\n'):
            with self.subTest(css=bad), tempfile.TemporaryDirectory() as temp:
                root = Path(temp) / 'dist'
                shutil.copytree(ROOT / 'dist', root)
                edit_built(root, 'site.css', lambda t: t + bad)
                with self.assertRaises(AssertionError):
                    check_site(root)

    def test_banned_word(self):
        word = 'play' + 'book'
        for text in (word, word.title() + 's', 'a ' + word.upper()):
            with self.subTest(text=text), self.assertRaises(AssertionError):
                check_privacy('index.html', f'<p>{text}</p>'.encode())
        with self.assertRaises(AssertionError):
            check_privacy('README.md', f'skills are {word}s'.encode())

    def test_encoded_landing_copy(self):
        headline = '<h1>Bring your own everything.</h1>'
        for old, new, error in (
                (headline, headline + '<p>play&#98;ook</p>', 'banned word'),
                (headline, headline + '<p>play<b>bo</b>ok</p>', 'banned word'),
                (headline, headline + '<p>Building in p&#117;blic</p>', 'cut copy'),
                (headline, headline + '<p>Building <em>in</em> public</p>', 'cut copy'),
                ('src="/art/hero-cave.webp" width="192" height="192" alt=""',
                 'src="/art/hero-cave.webp" width="192" height="192" alt="Pl&#97;ybook"', 'banned word'),
                ('src="/art/hero-cave.webp" width="192" height="192" alt=""',
                 'src="/art/hero-cave.webp" width="192" height="192" alt="Illustration, not l&#105;ve data"', 'cut copy'),
                (headline, '<h1>Bring your own anything.</h1>', 'headline changed'),
                ('<p class="sub">You make the decisions.<br>The agents run the factory.</p>',
                 '<p class="sub">You decide.<br>Agents build.</p>', 'subline changed'),
                ('<p class="sub">You make the decisions.<br>The agents run the factory.</p>', '', 'subline changed')):
            with self.subTest(new=new), tempfile.TemporaryDirectory() as temp:
                root = Path(temp) / 'dist'
                shutil.copytree(ROOT / 'dist', root)
                landing = root / 'index.html'
                text = landing.read_text()
                self.assertIn(old, text)
                landing.write_text(text.replace(old, new, 1))
                with self.assertRaisesRegex(AssertionError, error):
                    check_site(root)

    def test_product_first_landing(self):
        for change, error in (
                (lambda t: t.replace('Build a to-do app', 'Build an app'), 'missing landing story copy'),
                (lambda t: t.replace('<h3>Watch your spec</h3>', '<h3>Watch it ship</h3>'), 'three moments'),
                (lambda t: t.replace('<h3>Watch it ship</h3>', '<h3>Approve the plan</h3><h3>Watch it ship</h3>'), 'three moments'),
                (lambda t: t.replace('The real spec of an OpenWiz-built to-do app', 'A sample spec'), "to-do app's real spec"),
                (lambda t: t.replace('<p class="reply">Yes, greyed out.</p>', '<p class="reply">Yes.</p>'), 'Answer a few questions moment must show'),
                (lambda t: t.replace('<h4>Problem Statement</h4>', '<!-- <h4>Problem Statement</h4> -->'), 'Watch your spec moment must show'),
                (lambda t: t.replace('todo-demo.tasks.v1', 'tasks'), 'Watch your spec moment must show'),
                (lambda t: re.sub(r'(<li class="moment-step moment-grill">.*?</li>)', r'<!-- \1 -->', t, count=1, flags=re.S), 'Answer a few questions moment must show'),
                (lambda t: re.sub(r'(<li class="moment-step moment-ship">.*?</li>)', r'<!-- \1 -->', t, count=1, flags=re.S), 'Watch it ship moment must show|described capture'),
                (lambda t: re.sub(r'<img class="app-shot"[^>]*>', '', t), 'described capture of the live app'),
                (lambda t: t.replace('class="app-shot" src="/art/todo-app.webp" alt="The', 'class="app-shot" src="/art/todo-app.webp" alt=" " data-x="'), 'described capture of the live app'),
                (lambda t: t.replace('<summary>The spec</summary>', '<summary>The spec</summary><a href="https://github.com/openwizdev/openwiz">x</a>'), 'keep visitors on the site'),
                (lambda t: t.replace('<summary>The live app</summary>', '<summary><a href="https://openwizdev.github.io/todo-demo/">The live app</a></summary>'), 'keep visitors on the site|unexpected external URL'),
                (lambda t: t.replace('<summary>The spec</summary>', "<summary>The spec</summary><a href='https://github.com/openwizdev/openwiz'>x</a>"), 'keep visitors on the site'),
                (lambda t: t.replace('<summary>The spec</summary>', '<summary>The spec</summary><a href=//github.com/openwizdev/openwiz>x</a>'), 'keep visitors on the site|unexpected external URL'),
                (lambda t: t.replace('</span></p>\n              <p class="reply">Yes, greyed out.</p>', '</span></p>\n'), 'expanded grill must show each question with its answer: Keep'),
                (lambda t: t.replace('</span></p>\n              <p class="reply">One list for now.</p>', '</span></p>\n              <p class="reply">Several lists.</p>'), 'expanded grill must show each question with its answer: Where'),
                (lambda t: t.replace('<p class="ask">Where should tasks live?</p><p class="reply">One list for now.</p>', '<p class="ask">Where should tasks live?</p>'), 'grill bubbles must show each question with its answer: Where'),
                (lambda t: t.replace('</main>', '<p>Add a dark mode toggle</p></main>'), 'old example'),
                (lambda t: t.replace('Oil painting of Wiz scholars studying a to-do list', ''), 'painting without a description')):
            with self.subTest(error=error), tempfile.TemporaryDirectory() as temp:
                root = Path(temp) / 'dist'
                shutil.copytree(ROOT / 'dist', root)
                landing = root / 'index.html'
                text = landing.read_text()
                changed = change(text)
                self.assertNotEqual(changed, text)
                landing.write_text(changed)
                with self.assertRaisesRegex(AssertionError, error):
                    check_site(root)

    def test_hero_names_no_approval_step(self):
        for name, old, new in (
                ('index.html', 'Turn an idea into a spec and reviewed code.', 'Turn an idea into an approved plan and reviewed code.'),
                ('index.html', '<p class="demo-status">', '<p class="demo-status">Approve the plan · '),
                ('site.js', "label: 'Writing the spec'", "label: 'Approving the plan'")):
            with self.subTest(new=new), tempfile.TemporaryDirectory() as temp:
                root = Path(temp) / 'dist'
                shutil.copytree(ROOT / 'dist', root)
                if name == 'site.js':
                    edit_built(root, name, lambda t: t.replace(old, new, 1) if old in t else self.fail(old))
                else:
                    page = root / name
                    text = page.read_text()
                    self.assertIn(old, text)
                    page.write_text(text.replace(old, new, 1))
                with self.assertRaisesRegex(AssertionError, 'approval step'):
                    check_site(root)

    def test_changelog_named_everywhere(self):
        check_changelog(LANDING, CHANGELOG)
        for landing, error in (
                (LANDING.replace('>Changelog</a></nav>', '>Ship log</a></nav>'), 'nav and footer'),
                (LANDING.replace('>Changelog</a></footer>', '>Ship log</a></footer>'), 'nav and footer'),
                (LANDING.replace('</footer>', '<a href="/changelog">Changelog</a></footer>'), 'nav and footer'),
                (LANDING.replace('<a href="/changelog/">Changelog</a></nav>', '</nav>'), 'nav and footer'),
                (LANDING.replace('</title>', '</title><style>.part{color:red}</style>'), 'no inline styles'),
                (LANDING.replace('</h1>', '</h1><p>See the ship&#32;log.</p>'), 'never ship log')):
            with self.subTest(landing=landing[-90:]), self.assertRaisesRegex(AssertionError, error):
                check_changelog(landing, CHANGELOG)
        for changelog, error in (
                (CHANGELOG.replace('<h1>Changelog</h1>', '<h1>Ship log</h1>'), 'never ship log'),
                (CHANGELOG.replace('<title>Changelog — OpenWiz', '<title>Ship log — OpenWiz'), 'never ship log'),
                (CHANGELOG.replace('<h1>Changelog</h1>', '<h1>Releases</h1>'), 'heading must be Changelog'),
                (CHANGELOG.replace('<title>Changelog — OpenWiz', '<title>OpenWiz'), 'title must be Changelog')):
            with self.subTest(changelog=error), self.assertRaisesRegex(AssertionError, error):
                check_changelog(LANDING, changelog)

    def test_changelog_is_its_title_one_line_and_entries(self):
        for changelog, error in (
                (CHANGELOG.replace('</main>', '<figure class="repo-map"><svg role="img" aria-label="x"></svg></figure></main>'), 'nothing else'),
                (CHANGELOG.replace('</main>', '<h2>What exists today</h2></main>'), 'nothing else'),
                (CHANGELOG.replace('</main>', '<section class="part"><h3>OpenWiz</h3></section></main>'), 'nothing else'),
                (CHANGELOG.replace('</main>', '<p class="lead">Again.</p></main>'), 'nothing else'),
                (CHANGELOG.replace('</main>', '<ul><li>More.</li></ul></main>'), 'nothing else'),
                (CHANGELOG.replace('lets you do.', 'lets you do in WizVault.'), 'private repository is named'),
                (CHANGELOG.replace('lets you do.', 'lets you do in Wiz<b>Room</b>.'), 'private repository is named|nothing else'),
                (CHANGELOG.replace('lets you do.', 'lets you do, since 0.01.'), 'version number or date'),
                (CHANGELOG.replace('lets you do.', 'lets you do, since 2026.'), 'version number or date'),
                (CHANGELOG.replace('.release{color:red}', '.release{transition:opacity .2s}'), 'motion outside')):
            with self.subTest(error=error, at=changelog[-120:]), self.assertRaisesRegex(AssertionError, error):
                check_changelog(LANDING, changelog)

    def test_release_data(self):
        for name, data in DATA.items():
            check_release_data(name, data)
        one = DATA['0.01.json']
        for change, error in (
                ({'bullets': []}, 'missing bullets'),
                ({'bullets': ['Line.'] * 7}, '7 bullets'),
                ({'bullets': ['Line.', '']}, 'empty bullet'),
                ({'bullets': ['Line.', 'x' * 121]}, 'over 120 characters'),
                ({'bullets': ['Line.', 'Two\nlines.']}, 'one line per bullet'),
                ({'bullets': ['Line.', 'Runs on WizVault.']}, 'private repository is named'),
                ({'bullets': ['Line.', 'Runs on <WizVault>.']}, 'private repository is named'),
                ({'headline': 'Runs on <b>WizVault</b>.'}, 'private repository is named'),
                ({'notes': ''}, 'missing notes'),
                ({'notes': None}, 'missing notes'),
                ({'notes': 'https://example.com/v0.1.2'}, 'notes link'),
                ({'notes': 'https://github.com/openwizdev/OpenWiz/releases/tag/v0.1.3'}, 'notes link'),
                ({'headline': ''}, 'missing headline'),
                ({'headline': 'x' * 81}, 'one-line headline'),
                ({'name': '0.02'}, 'names the file'),
                ({'name': 'v1'}, 'names the file'),
                ({'semver': '0.0.17', 'notes': 'https://github.com/openwizdev/OpenWiz/releases/tag/v0.0.17'}, 'from 0.1.0'),
                ({'date': 'Nov 21'}, 'YYYY-MM-DD'),
                ({'bullets': 'One line.'}, 'bullets a list'),
                ({'extra': 'x'}, 'unexpected fields')):
            with self.subTest(error=error), self.assertRaisesRegex(AssertionError, error):
                check_release_data('0.01.json', {**one, **change})
        missing = dict(one)
        del missing['notes']
        with self.assertRaisesRegex(AssertionError, 'missing notes'):
            check_release_data('0.01.json', missing)
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            for name, data in DATA.items():
                (folder / name).write_text(json.dumps(data))
            self.assertEqual(read_releases(folder), DATA)
            (folder / '0.03.json').write_text(json.dumps({**one, 'name': '0.03'}))
            with self.assertRaisesRegex(AssertionError, 'each release once'):
                read_releases(folder)
            (folder / '0.03.json').write_text('{')
            with self.assertRaisesRegex(AssertionError, 'not JSON'):
                read_releases(folder)
            (folder / '0.03.json').unlink()
            (folder / 'notes.md').write_text('x')
            with self.assertRaisesRegex(AssertionError, 'only release data files'):
                read_releases(folder)
        read_releases()

    def test_generated_releases(self):
        page = CHANGELOG.replace('</main>', '<!-- releases:start -->' + LIVE + '<!-- releases:end --></main>')
        self.assertEqual(split_releases(page), (CHANGELOG, LIVE))
        check_releases(LIVE, DATA, True)
        check_releases(SOON, DATA, False)
        check_releases(SOON, {}, True)
        for built in (CHANGELOG, page.replace('</main>', '</main><!-- releases:start --><!-- releases:end -->'),
                      page.replace('<!-- releases:end --></main>', '<!-- releases:end --><p>after</p></main>')):
            with self.subTest(built=built[-80:]), self.assertRaises(AssertionError):
                split_releases(built)
        first, second = LIVE.removeprefix('<section class="releases" aria-label="Releases">').split('</article>')[:2]
        for section, live, error in (
                (LIVE, False, 'entries shown'),
                (SOON, True, 'entries shown'),
                (SOON.replace('No public release yet.', 'OpenWiz 0.01 is coming.'), False, 'no release version'),
                (SOON.replace('No public release yet.', 'Nov 21, 2026.'), False, 'no release version'),
                (LIVE.replace(first + '</article>', ''), True, 'entries shown'),
                (LIVE.replace(second + '</article>', second + '</article>' + second + '</article>'), True, 'entries shown'),
                (LIVE.replace(first + '</article>', '').replace(second + '</article>', second + '</article>' + first + '</article>'), True, 'newest first'),
                (LIVE.replace('(0.1.10)', '(0.1.11)'), True, 'newest first'),
                (LIVE.replace('Feb 3, 2031', 'Feb 4, 2031'), True, 'newest first'),
                (LIVE.replace('datetime="2031-02-03"', 'datetime="2031-02-04"'), True, "entry's date"),
                (LIVE.replace('Two things.', 'Two things!'), True, "entry's headline"),
                (LIVE.replace('<li>Another.</li>', ''), True, "entry's bullets"),
                (LIVE.replace('<li>Another.</li>', '<li>Another.</li><li>Extra.</li>'), True, "entry's bullets"),
                (LIVE.replace('Full notes on GitHub</a>', 'Full notes</a> <a href="/">here</a>'), True, 'one link'),
                (LIVE.replace(DATA['0.02.json']['notes'], PRE), True, 'one link'),
                (LIVE.replace('<p class="pre">Earlier pre-releases are on <a href="' + PRE + '">GitHub</a>.</p>', ''), True, 'pre-releases'),
                (LIVE.replace(f'<a href="{PRE}">', '<a href="https://github.com/openwizdev/OpenWiz">'), True, 'pre-releases'),
                (LIVE.replace('<li>Another.</li>', '<li><script>x</script></li>'), True, 'unexpected element'),
                (LIVE.replace('<li>Another.</li>', '<li><img src="/x.png"></li>'), True, 'unexpected element'),
                (LIVE.replace('<p class="headline">', '<p class="headline" onclick="x()">'), True, 'unexpected attribute'),
                (LIVE.replace('<section class="releases" aria-label="Releases">', '<section class="releases">'), True, 'one Releases section')):
            with self.subTest(error=error, live=live), self.assertRaisesRegex(AssertionError, error):
                check_releases(section, DATA, live)

    def test_landing_starts_in_still_mode(self):
        for change, error in (
                (lambda t: t.replace('</head>', '<script>document.body.dataset.x = 1</script></head>', 1),
                 'wait for both external scripts'),
                (lambda t: t.replace('aria-pressed="false" hidden', 'aria-pressed="false"', 1),
                 'motion controls must wait'),
                (lambda t: t.replace('preload="none"', 'preload="none" autoplay', 1),
                 'recording must be opt-in')):
            with self.subTest(error=error), tempfile.TemporaryDirectory() as temp:
                root = Path(temp) / 'dist'
                shutil.copytree(ROOT / 'dist', root)
                landing = root / 'index.html'
                text = landing.read_text()
                changed = change(text)
                self.assertNotEqual(changed, text)
                landing.write_text(changed)
                with self.assertRaisesRegex(AssertionError, error):
                    check_site(root)

    def test_spec_video_poster_captions_and_link(self):
        for change, error in (
                (lambda t: re.sub(r' poster="[^"]*"', '', t, count=1), 'spec video needs a pinned poster'),
                (lambda t: re.sub(r'<track [^>]*>', '', t, count=1), 'spec video needs default captions'),
                (lambda t: t.replace('class="spec-link"', 'class="spec-link" hidden', 1), 'plain link to the spec video'),
                (lambda t: t.replace(' muted', '', 1), 'spec video must start muted inline'),
                (lambda t: t.replace('preload="none"', 'preload="auto"', 1), 'recording must be opt-in')):
            with self.subTest(error=error), tempfile.TemporaryDirectory() as temp:
                root = Path(temp) / 'dist'
                shutil.copytree(ROOT / 'dist', root)
                landing = root / 'index.html'
                text = landing.read_text()
                changed = change(text)
                self.assertNotEqual(changed, text)
                landing.write_text(changed)
                with self.assertRaisesRegex(AssertionError, error):
                    check_site(root)

    def test_transition_duration_respects_reduced_motion(self):
        with self.assertRaisesRegex(AssertionError, 'motion outside'):
            check_motion('.x { transition-duration: .35s } .x:hover { opacity: .5 }')
        check_motion('.x { transition-duration: 0s, 0ms }')

    def test_motion_in_combined_phone_query(self):
        check_motion('@media (max-width: 700px) and (prefers-reduced-motion: no-preference)'
                     '{.x{transition:opacity .35s}}')
        with self.assertRaisesRegex(AssertionError, 'motion outside'):
            check_motion('@media (max-width: 700px), (prefers-reduced-motion: no-preference)'
                         '{.x{transition:opacity .35s}}')

    def test_motion_only_without_reduced_motion(self):
        check_motion('@media (prefers-reduced-motion: no-preference){.a{animation:x 1s}html{scroll-behavior:smooth}'
                     '.b:hover{transition:opacity .2s}}@keyframes x{to{opacity:0}}.c{animation:none !important}')
        for bad in ('.a{animation:x 1s}', 'html{scroll-behavior:smooth}', '.b{transition:transform .2s}',
                    '@media (prefers-reduced-motion:reduce){.a{animation:x 1s}}', '@media (min-width:1px){.a{animation-name:x}}',
                    '@media (prefers-reduced-motion:no-preference){.a{color:red}}.b{animation:y 2s infinite}'):
            with self.subTest(css=bad), self.assertRaises(AssertionError):
                check_motion(bad)
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / 'dist'
            shutil.copytree(ROOT / 'dist', root)
            edit_built(root, 'site.css', lambda t: t + '\n.l-rocket{animation:shake .4s infinite}\n')
            with self.assertRaises(AssertionError):
                check_site(root)

    def test_fingerprints(self):
        css = FINGERPRINTS['site.css']
        for change in ('stale-name', 'tampered', 'unhashed-ref'):
            with self.subTest(change=change), tempfile.TemporaryDirectory() as temp:
                root = Path(temp) / 'dist'
                shutil.copytree(ROOT / 'dist', root)
                if change == 'stale-name':
                    (root / css).rename(root / 'site.0000000000.css')
                elif change == 'tampered':
                    with (root / css).open('a') as f:
                        f.write('\n/* changed */\n')
                else:
                    page = root / 'index.html'
                    page.write_text(page.read_text().replace(f'"/{css}"', '"/site.css"'))
                    (root / 'site.css').write_bytes((root / css).read_bytes())
                with self.assertRaises(AssertionError):
                    check_site(root)

    def test_stylesheet_must_apply(self):
        css = FINGERPRINTS['site.css']
        for old, new in ((f'<link rel="stylesheet" href="/{css}">', f'<link rel="preload" as="style" href="/{css}">'),
                         (f'<link rel="stylesheet" href="/{css}">', f'<a href="/{css}">styles</a>'),
                         (f'<link rel="stylesheet" href="/{css}">', f'<link rel="stylesheet" href="/{css}" disabled>'),
                         (f'<link rel="stylesheet" href="/{css}">', f'<link rel="stylesheet" href="/{css}" media="print">'),
                         (f'<script src="/{FINGERPRINTS["site.js"]}" defer>', f'<script type="text/plain" src="/{FINGERPRINTS["site.js"]}" defer>'),
                         (f'<script src="/{FINGERPRINTS["site.js"]}" defer>', f'<script nomodule src="/{FINGERPRINTS["site.js"]}" defer>')):
            with self.subTest(new=new), tempfile.TemporaryDirectory() as temp:
                root = Path(temp) / 'dist'
                shutil.copytree(ROOT / 'dist', root)
                page = root / 'index.html'
                text = page.read_text()
                self.assertIn(old, text)
                page.write_text(text.replace(old, new))
                with self.assertRaises(AssertionError):
                    check_site(root)

    def test_headers_revalidate(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / 'dist'
            shutil.copytree(ROOT / 'dist', root)
            (root / '_headers').write_text('/*.css\n  Cache-Control: public, max-age=14400\n')
            with self.assertRaises(AssertionError):
                check_site(root)

    def test_install_wording_only_in_the_install_box(self):
        for extra in ('<a href="/">Copy · coming soon</a>', '<p>Install now</p>', '<p>Inst&#97;ll today</p>',
                      '<p>in<b>stall</b> now</p>', '<p>Ins<span>t</span>all</p>', '<img alt="Install now" src="/favicon.svg">'):
            with self.subTest(extra=extra), tempfile.TemporaryDirectory() as temp:
                root = Path(temp) / 'dist'
                shutil.copytree(ROOT / 'dist', root)
                page = root / 'index.html'
                page.write_text(page.read_text().replace('</main>', extra + '</main>', 1))
                with self.assertRaises(AssertionError):
                    check_site(root)

    def test_install_line_and_its_switch(self):
        line = '<code class="install-line">Install OpenWiz from github.com/openwizdev/OpenWiz</code>'
        hint = '<p class="install-hint">Paste this into your agent</p>'
        button = '<button class="btn install" type="button" disabled>Copy · coming soon</button>'
        text = (ROOT / 'dist/index.html').read_text()
        shipped = re.findall(r'data-install="([^"]*)"', text)
        self.assertEqual(len(shipped), 1, 'one install switch')
        self.assertIn(shipped[0], INSTALL_SWITCH)
        for part in (line, hint, button):
            self.assertEqual(text.count(part), 1, part)
        for state in INSTALL_SWITCH:
            switch = f'data-install="{state}"'
            variant = text.replace(f'data-install="{shipped[0]}"', switch)
            changelog = with_switch(state)
            with self.subTest(state=state), tempfile.TemporaryDirectory() as temp:
                root = Path(temp) / 'dist'
                shutil.copytree(ROOT / 'dist', root)
                (root / 'index.html').write_text(variant)
                (root / 'changelog/index.html').write_text(changelog)
                check_site(root)
            breaks = [
                (line, line.replace('github.com/openwizdev/OpenWiz', 'https://github.com/openwizdev/OpenWiz')),
                (line, line.replace('OpenWiz</code>', 'openwiz</code>')),
                (line, line.replace('</code>', '.</code>')),
                (line, line.replace('Install OpenWiz', 'Install  OpenWiz')),
                (line, line.replace('OpenWiz from', 'Open<b>Wiz</b> from')),
                (line, ''),
                (line, line + line),
                (hint, ''),
                (hint, hint.replace('your agent', 'your terminal')),
                (switch, ''),
                (switch, 'data-install="on"'),
                (button, button.replace(' disabled', '')),
                (button, button.replace(' disabled', ' aria-disabled="true"')),
                (button, button.replace(' disabled', ' title=" disabled "')),
                (button, button.replace(' disabled', ' disabled onclick="copy()"')),
                (button, button.replace(' disabled', ' disabled onclick ="copy()"')),
                (button, button.replace('Copy · coming soon', 'Copy')),
                (button, button + button),
            ]
            for good, bad in breaks:
                with self.subTest(state=state, bad=bad), tempfile.TemporaryDirectory() as temp:
                    root = Path(temp) / 'dist'
                    shutil.copytree(ROOT / 'dist', root)
                    (root / 'index.html').write_text(variant.replace(good, bad, 1))
                    (root / 'changelog/index.html').write_text(changelog)
                    with self.assertRaises(AssertionError):
                        check_site(root)

    def test_install_note_under_the_box(self):
        note = INSTALL_NOTE_HTML
        link = '<a href="https://cloudroom.dev" rel="noreferrer">CloudRoom</a>'
        text = (ROOT / 'dist/index.html').read_text()
        self.assertEqual(text.count(note), 1, note)
        check_site(ROOT / 'dist')
        breaks = [
            ('index.html', note, ''),
            ('index.html', note, note + note),
            ('index.html', note, note.replace('x86_64 Linux', 'Linux')),
            ('index.html', note, note.replace('Apple-silicon Mac', 'Mac')),
            ('index.html', note, note.replace('No CloudRoom needed to install. ', '')),
            ('index.html', note, note.replace(link, 'CloudRoom')),
            ('index.html', note, note.replace('https://cloudroom.dev', 'https://cloudroom.dev/x')),
            ('index.html', note, note.replace(' rel="noreferrer"', '')),
            ('index.html', note, ''),
            ('index.html', '</main>', f'<p>{link}</p></main>'),
            ('drivers/index.html', '</main>', f'<p>{link}</p></main>'),
        ]
        for i, (page, good, bad) in enumerate(breaks):
            with self.subTest(page=page, bad=bad), tempfile.TemporaryDirectory() as temp:
                root = Path(temp) / 'dist'
                shutil.copytree(ROOT / 'dist', root)
                changed = (root / page).read_text().replace(good, bad, 1)
                if i == 8:
                    changed = changed.replace('</main>', note + '</main>', 1)
                (root / page).write_text(changed)
                with self.assertRaises(AssertionError):
                    check_site(root)

    def test_install_version_label_is_the_only_version_on_the_landing(self):
        label = '<p class="install-version">OpenWiz 0.01 <small>0.1.0</small></p>'
        text = (ROOT / 'dist/index.html').read_text()
        self.assertEqual(text.count(label), 1, label)
        shipped = re.findall(r'data-install="[^"]*"', text)
        self.assertEqual(len(shipped), 1, 'one install switch')
        hint = '<p class="install-hint">'
        breaks = [
            (label, label.replace('0.1.0', '0.1.1')),
            (label, label.replace('0.01', '0.02')),
            (label, label.replace('OpenWiz 0.01', 'OpenWiz')),
            (label, ''),
            (label, label + label),
            (hint, '<p>0.1.0</p>' + hint),
            ('</main>', '<p>Now 0.1.0</p></main>'),
            ('</main>', '<p>OpenWiz 0.01 <small>0.1.0</small></p></main>'),
        ]
        moved = lambda variant, trace: variant.replace(label, trace, 1).replace('</main>', label + '</main>', 1)
        relocations = ['<!-- OpenWiz 0.01 <small>0.1.0</small>. -->', f'<!-- {label} -->', '']
        for state in ['live']:
            variant = text.replace(shipped[0], f'data-install="{state}"')
            with self.subTest(state=state), tempfile.TemporaryDirectory() as temp:
                root = Path(temp) / 'dist'
                shutil.copytree(ROOT / 'dist', root)
                (root / 'index.html').write_text(variant)
                check_site(root)
            for good, bad in breaks:
                with self.subTest(state=state, bad=bad), tempfile.TemporaryDirectory() as temp:
                    root = Path(temp) / 'dist'
                    shutil.copytree(ROOT / 'dist', root)
                    (root / 'index.html').write_text(variant.replace(good, bad, 1))
                    with self.assertRaises(AssertionError):
                        check_site(root)
            for trace in relocations:
                with self.subTest(state=state, moved=trace), tempfile.TemporaryDirectory() as temp:
                    root = Path(temp) / 'dist'
                    shutil.copytree(ROOT / 'dist', root)
                    (root / 'index.html').write_text(moved(variant, trace))
                    with self.assertRaises(AssertionError):
                        check_site(root)

    def test_app_page_policy_and_calm(self):
        cases = {
            'no CSP for /app/*': lambda root: (root / '_headers').write_text(
                (root / '_headers').read_text().replace("connect-src 'self' https://api.github.com", "connect-src *")),
            'an inline script': lambda root: (root / 'app/index.html').write_text(
                (root / 'app/index.html').read_text().replace('</body>', '<script>1</script></body>')),
            'a missing script': lambda root: (root / 'app/index.html').write_text(
                re.sub(r'<script src="/app/ui\.[0-9a-f]+\.js" defer></script>', '', (root / 'app/index.html').read_text())),
            'a transition': lambda root: edit_built(root, 'app/ember.css', lambda t: t + '\na { transition: color 1s }\n'),
        }
        for name, spoil in cases.items():
            with self.subTest(name), tempfile.TemporaryDirectory() as temp:
                root = Path(temp) / 'dist'
                shutil.copytree(ROOT / 'dist', root)
                check_site(root)
                spoil(root)
                with self.assertRaises(AssertionError):
                    check_site(root)

    def broken(self, name, old, new, error, css=None):
        with self.subTest(name=name, old=old[:60], error=error), tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / 'dist'
            shutil.copytree(ROOT / 'dist', root)
            if css:
                edit_built(root, 'site.css', lambda t: t + css)
            else:
                page = root / name
                text = page.read_text()
                self.assertIn(old, text)
                page.write_text(text.replace(old, new, 1))
            with self.assertRaisesRegex(AssertionError, error):
                check_site(root)

    def test_team_page_and_buy_button(self):
        def planted(page, change):
            temp = tempfile.TemporaryDirectory()
            root = Path(temp.name) / 'dist'
            shutil.copytree(ROOT / 'dist', root)
            path = root / page
            path.write_text(change(path.read_text()))
            return temp, root
        book = re.compile(r'data-book href="[^"]*"')
        refused = {
            'buy button': ('changelog/index.html', lambda t: t.replace(CTA, '', 1)),
            'buy button to /team/': ('team/index.html', lambda t: t.replace('<a class="nav-team" href="/team/">', '<a class="nav-team" href="/">', 1)),
            'two booking links': ('team/index.html', lambda t: t.replace('</main>', '<a data-book href="https://cal.com/x">Book</a></main>', 1)),
            'one booking value': ('team/index.html', lambda t: book.sub('data-book href="https://cal.com/x"', t, count=1)),
            'outside the team page': ('index.html', lambda t: t.replace('</main>', '<a data-book href="https://cal.com/x">Book</a></main>', 1)),
            'must be https': ('team/index.html', lambda t: book.sub('data-book href="http://cal.com/x"', t)),
            'must be https ': ('team/index.html', lambda t: book.sub('data-book href="mailto:someone"', t)),
            'outside the team page: the app': ('app/index.html', lambda t: t.replace('</body>', '<a data-book href="https://cal.com/x">Book</a></body>', 1)),
            'unexpected external URL': ('team/index.html', lambda t: t.replace('</main>', '<img src="https://cal.com/openwiz-jake/setup" alt=""></main>', 1)),
            'two booking links ': ('team/index.html', lambda t: t.replace('</main>', '<a data-book href="https://cal.com/openwiz-jake/setup">Again</a></main>', 1)),
            'two booking links  ': ('team/index.html', lambda t: re.sub(r'<a class="team-book" data-book[^>]*>Book a call</a>\n</section>', '</section>', t)),
            'two booking links   ': ('team/index.html', lambda t: re.sub(r'<a class="team-book" id="book" data-book[^>]*>Book a call</a>', '<span id="book"></span>', t)),
            'shows no price': ('team/index.html', lambda t: t.replace('Custom pricing.', 'Custom pricing. From $99 per month.', 1)),
            'team page copy': ('team/index.html', lambda t: t.replace('>Book a call</a>', '>Talk</a>')),
            'team page copy ': ('team/index.html', lambda t: t.replace('>Book a call</a>', '>Talk</a>', 1)),
            'missing team page copy': ('team/index.html', lambda t: t.replace(' No checkout.', '', 1)),
            'the team page headline': ('team/index.html', lambda t: t.replace('Leave with a shipped pull request.', 'Leave with a pull request.', 1)),
            'the terms': ('team/index.html', lambda t: re.sub(r'<ul class="team-terms"[^>]*>[\s\S]*?</ul>', '', t)),
            'the terms ': ('team/index.html', lambda t: t.replace('<li>A small, real change of your choice.</li>', '', 1)),
            'the terms: under the first Book a call': ('team/index.html', lambda t: re.sub(
                r'(<a class="team-book" id="book"[^>]*>Book a call</a>)\s*(<p class="team-label"[\s\S]*?</ul>)', r'\2\1', t)),
            'the ships line': ('team/index.html', lambda t: re.sub(r'<p class="team-ships">[\s\S]*?</p>', '', t)),
            'hides none of its copy': ('team/index.html', lambda t: t.replace('<ul class="team-terms" aria-labelledby="team-how">', '<ul class="team-terms" aria-labelledby="team-how" hidden>', 1)),
            'folds nothing away': ('team/index.html', lambda t: t.replace('<ol class="team-steps">', '<details><summary>Timeline</summary><ol class="team-steps">', 1).replace('</ol>', '</ol></details>', 1)),
            'embeds no video': ('team/index.html', lambda t: t.replace('</main>', '<video src="/art/spec-video.mp4" preload="none"></video></main>', 1)),
            'the boat poster': ('team/index.html', lambda t: t.replace(' loading="lazy"', '', 1)),
            'the boat poster|one X link per page': ('team/index.html', lambda t: t.replace('href="https://x.com/openwiz" class="team-poster"', 'href="/drivers/" class="team-poster"', 1)),
            'the boat poster: its label': ('team/index.html', lambda t: t.replace('Watch the fleet build it (49 s, on X)', 'Watch it', 1)),
            'no Wizes in the team hero': ('team/index.html', lambda t: t.replace('For solo builders and small teams</p>', 'For solo builders and small teams. Wizes!</p>', 1)),
            'never uses: install': ('team/index.html', lambda t: t.replace('No checkout.', 'No checkout. We install it.', 1)),
            'never uses: guarantee': ('team/index.html', lambda t: t.replace('No checkout.', 'No checkout. We guarantee it.', 1)),
            'the team page sections': ('team/index.html', lambda t: t.replace('<h2>Pricing</h2>', '<h2>Prices</h2>', 1)),
            'the team page sections ': ('team/index.html', lambda t: re.sub(r'<section class="team-when"[\s\S]*?</section>\n', '', t)),
            'four marks': ('team/index.html', lambda t: t.replace('<li class="team-end"><h3>Minute 30</h3><p>A pull request ships.</p></li>', '', 1)),
            'four marks ': ('team/index.html', lambda t: t.replace('<h3>Minute 10</h3>', '<h3>Minute 15</h3>', 1)),
            'the terms: under their label': ('team/index.html', lambda t: re.sub(r'<p class="team-label"[^>]*>How the call works</p>\s*', '', t, count=1)),
            'the terms: under their label ': ('team/index.html', lambda t: t.replace('>How the call works</p>', '>How it works</p>', 1)),
            'the timeline: in the hero': ('team/index.html', lambda t: re.sub(r'(\n  <section class="team-when"[\s\S]*?</section>)(\n</div>\n)', r'\2\1\n', t, count=1)),
            'the hero shows no poster': ('team/index.html', lambda t: t.replace('<p class="team-kicker">', '<img src="/art/team-boat-poster.webp" alt="" width="1280" height="720"><p class="team-kicker">', 1)),
            'Minute 30 is its one highlighted stop': ('team/index.html', lambda t: t.replace('<li class="team-end">', '<li>', 1)),
            'Minute 30 is its one highlighted stop ': ('team/index.html', lambda t: t.replace('<li><h3>Minute 0</h3>', '<li class="team-end"><h3>Minute 0</h3>', 1)),
            'curly apostrophes': ('team/index.html', lambda t: t.replace('No checkout.', "No checkout. It's quick.", 1)),
            'curly apostrophes ': ('team/index.html', lambda t: t.replace('aria-label="Who it\u2019s for and pricing"', 'aria-label="Who it\'s for and pricing"', 1)),
            'Proof: three cards': ('team/index.html', lambda t: re.sub(r'<li class="team-card">\s*<p>Our Drivers page[\s\S]*?</li>\n', '', t, count=1)),
            'Proof: the first card': ('team/index.html', lambda t: t.replace('<small>5 of 5</small>', '', 1)),
            'Proof: the first card   ': ('team/index.html', lambda t: t.replace('<h3>Three drivers passed all five checks</h3>', '<h3>Three drivers passed</h3>', 1)),
            'Proof: the first card    ': ('team/index.html', lambda t: t.replace('version, start, wake, stop and token.', 'version and start.', 1)),
            'the team page sections  ': ('team/index.html', lambda t: t.replace('<section class="team-part team-close', '<section class="team-part wrap"><h2>Where your agents run</h2></section>\n<section class="team-part team-close', 1)),
            'Proof: the first card ': ('team/index.html', lambda t: t.replace('Grok Bot: coming soon', 'Grok Bot', 1)),
            'Proof: the first card  ': ('team/index.html', lambda t: t.replace('<a href="/drivers/">See how drivers work</a>', '<a href="/">See how drivers work</a>', 1)),
            'Proof: the second card': ('team/index.html', lambda t: t.replace('>See the Drivers page</a>', '>Drivers</a>', 1)),
            'the boat poster: Proof': ('team/index.html', lambda t: re.sub(r'<li class="team-card"><a href="https://x\.com/openwiz"[\s\S]*?</li>\n', '<li class="team-card"><a href="https://x.com/openwiz" class="team-poster">Watch the fleet build it (49 s, on X)</a></li>\n', t, count=1)),
            'the one site footer|one X link per page': ('drivers/index.html', lambda t: t.replace(FOOTER, '', 1)),
            'the one site footer|one X link per page ': ('changelog/index.html', lambda t: t.replace('</main>', '</main>' + FOOTER, 1)),
            'the one site footer  ': ('index.html', lambda t: t.replace('X @openwiz', 'X', 1)),
        }
        for message, (page, change) in refused.items():
            temp, root = planted(page, change)
            with temp, self.subTest(message=message), self.assertRaisesRegex(AssertionError, message.strip()):
                check_site(root)
        temp, root = planted('team/index.html', lambda t: book.sub('data-book href="https://cal.com/someone/intro"', t))
        with temp:
            check_site(root)

    def test_footer_source(self):
        import check
        for message, change in {
            'the footer links': lambda f: f.replace('<li><a href="/app/">The app</a></li>', '', 1),
            'the footer links ': lambda f: f.replace('href="https://x.com/openwiz"', 'href="https://x.com/someone"', 1),
            'link groups': lambda f: f.replace('<h2>Company</h2>', '<h2>More</h2>', 1),
            'Owned by no one': lambda f: f.replace('Owned by no one.', '', 1),
            'wordmark': lambda f: f.replace('<p class="footer-wordmark">OpenWiz</p>', '', 1),
            'twelve Wizes': lambda f: f.replace('<span class="family-wiz">', '<span>', 1),
        }.items():
            broken = change(FOOTER)
            html = '<html><body><template data-slot="footer"></template>\n</body></html>'.replace('<template data-slot="footer"></template>\n', broken)
            with self.subTest(message=message), mock.patch.object(check, 'FOOTER', broken), self.assertRaisesRegex(AssertionError, message.strip()):
                check.check_footer({'index.html': html})
        for url in ('https://x.com/someone', 'https://x.com/openwiz'):
            with self.subTest(url=url), self.assertRaisesRegex(AssertionError, 'unexpected external URL'):
                check_ref(ROOT, ROOT / 'site.css', url, {})
        for message, (page, old, new) in {
            'unexpected external URL': ('team/index.html', '</main>', '<img src="https://x.com/openwiz" alt=""></main>'),
            'unexpected external URL ': ('index.html', '</head>', '<link rel="preload" href="https://x.com/openwiz" as="image"></head>'),
            'one X link per page': ('changelog/index.html', '</main>', '<a href="https://x.com/openwiz">X</a></main>'),
            'one X link per page, the footer\'s: team': ('team/index.html', '</main>', '<a href="https://x.com/openwiz">X</a></main>'),
            'one X link per page ': ('drivers/index.html', '<a href="https://x.com/openwiz">X @openwiz</a>', '<a href="/">X @openwiz</a>'),
            'one X link per page, the footer\'s: the app': ('app/index.html', '</body>', '<a href="https://x.com/openwiz">X</a></body>'),
        }.items():
            with tempfile.TemporaryDirectory() as temp, self.subTest(message=message):
                root = Path(temp) / 'dist'
                shutil.copytree(ROOT / 'dist', root)
                path = root / page
                text = path.read_text()
                assert old in text, old
                path.write_text(text.replace(old, new, 1))
                with self.assertRaisesRegex(AssertionError, message.strip()):
                    check_site(root)

    def test_report_a_problem_link(self):
        form = '<a href="https://github.com/openwizdev/openwiz/issues/new?template=feedback.yml" rel="noreferrer">Report a problem</a>'
        for page, count in {'index.html': 1, 'drivers/index.html': 1, 'team/index.html': 1, 'faq/index.html': 1, 'changelog/index.html': 1, 'app/index.html': 0}.items():
            with self.subTest(page=page):
                self.assertEqual((ROOT / 'dist' / page).read_text().count(form), count)
        href = 'https://github.com/openwizdev/openwiz/issues/new?template=feedback.yml'
        for message, (page, old, new) in {
            'Report a problem link': ('changelog/index.html', form, 'Report a problem'),
            'Report a problem link ': ('team/index.html', form, '<a href="/">Report a problem</a>'),
            'Report a problem link  ': ('drivers/index.html', '</main>', form + '</main>'),
            'Report a problem link, the footer\'s: the app': ('app/index.html', '</body>', form + '</body>'),
            'Report a problem link needs rel="noreferrer"': ('index.html', ' rel="noreferrer">Report', '>Report'),
            'Report a problem link needs rel="noreferrer" ': ('changelog/index.html', ' rel="noreferrer">Report', ' rel="noopener">Report'),
            'Report a problem link needs rel="noreferrer"  ': ('team/index.html', ' rel="noreferrer">Report', ' rel="noreferrer" referrerpolicy="unsafe-url">Report'),
            'unexpected external URL parts': ('index.html', href, href + '&amp;body=x'),
            'unexpected external URL parts ': ('changelog/index.html', href, href.replace('feedback.yml', 'bug.yml')),
            'unexpected repository link|unexpected external URL parts': ('index.html', href, href.replace('/openwiz/', '/WizSkills/')),
            'unexpected external URL parts  ': ('team/index.html', href, href.replace('/openwiz/', '/OpenWiz/')),
            'unexpected external URL parts   ': ('drivers/index.html', href, href.replace('?template=', '?labels=x&amp;template=')),
        }.items():
            with tempfile.TemporaryDirectory() as temp, self.subTest(message=message):
                root = Path(temp) / 'dist'
                shutil.copytree(ROOT / 'dist', root)
                path = root / page
                text = path.read_text()
                self.assertIn(old, text)
                path.write_text(text.replace(old, new, 1))
                with self.assertRaisesRegex(AssertionError, message.strip()):
                    check_site(root)

    def test_faq(self):
        import check
        def planted(page, change):
            temp = tempfile.TemporaryDirectory()
            root = Path(temp.name) / 'dist'
            shutil.copytree(ROOT / 'dist', root)
            path = root / page
            path.write_text(change(path.read_text()))
            return temp, root
        close = '<section class="team-part team-close'
        for message, (page, change) in {
            'the index.html page needs the one Questions': ('index.html', lambda t: t.replace(FAQ, '', 1)),
            'the faq/index.html page needs the one Questions': ('faq/index.html', lambda t: t.replace('What is a kernel?', 'What is a core?', 1)),
            'the team page sections': ('team/index.html', lambda t: t.replace(FAQ, '', 1).replace('</main>', FAQ + '</main>', 1)),
            'needs faq.js': ('team/index.html', lambda t: re.sub(r'<script src="/faq\.[0-9a-f]+\.js" defer></script>', '', t)),
        }.items():
            temp, root = planted(page, change)
            with temp, self.subTest(message=message), self.assertRaisesRegex(AssertionError, message):
                check_site(root)
        names = {'faq.js': 'faq.0123456789.js'}
        for message, change in {
            'the Questions rows': lambda f: f.replace('What is a kernel?', 'What is a core?', 1),
            'the Questions rows ': lambda f: re.sub(r'\s*<div class="faq-row">[\s\S]*?</div></div>\n    </div>', '', f, count=1),
            'a button that names its answer': lambda f: f.replace('type="button" ', '', 1),
            'open and disabled until faq.js runs': lambda f: f.replace(' disabled id=', ' id=', 1),
            'open and disabled until faq.js runs ': lambda f: f.replace('aria-expanded="true"', 'aria-expanded="false"', 1),
            'a button that names its answer ': lambda f: f.replace('aria-controls="faq-a2"', 'aria-controls="faq-a1"', 1),
            'links off the site': lambda f: f.replace('href="/team/#book"', 'href="https://example.com/"', 1),
            'answer to Where do my agents run': lambda f: f.replace(FAQ_WHERE, 'Wherever you choose: your own computer or a VPS, Cloudroom, or boat.dev. Each has a driver that passed the same five-check test.', 1),
            'answer to Where do my agents run ': lambda f: f.replace(' In OpenWiz 0.01, you start builders by hand on this computer or boat.dev, and the automatic fleet runs in CloudRoom.', '', 1),
            'answer to Where do my agents run  ': lambda f: f.replace(FAQ_WHERE, 'Anywhere.', 1).replace('OpenWiz is free and open source', FAQ_WHERE + ' OpenWiz is free and open source', 1),
            'last answer': lambda f: f.replace('Your first fleet ships on it.', 'Your first fleet runs in a day.', 1),
            'heading and its line': lambda f: f.replace('The short ones are here.', 'More.', 1),
            'no form or input': lambda f: f.replace('<p>The open source', '<input><p>The open source', 1),
        }.items():
            broken = change(FAQ)
            top = re.sub(r'<(/?)h3\b', r'<\1h2', re.sub(r'<(/?)h2\b', r'<\1h1', broken))
            htmls = {'index.html': '</section>\n' + broken + '</main>', check.TEAM_PAGE: broken + close, check.FAQ_PAGE: top + '</main>'}
            pages = {name: mock.Mock(scripts=['/faq.0123456789.js']) for name in htmls}
            with self.subTest(message=message), mock.patch.multiple(check, FAQ=broken, FAQ_TOP=top,
                    FAQ_ON={'index.html': broken, check.TEAM_PAGE: broken, check.FAQ_PAGE: top}), \
                    self.assertRaisesRegex(AssertionError, message.strip()):
                check.check_faq(htmls, pages, names)
        htmls = {'index.html': '</section>\n' + FAQ + '</main>', check.TEAM_PAGE: FAQ + close, check.FAQ_PAGE: check.FAQ_TOP + '</main>',
                 'drivers/index.html': '<main>' + FAQ + '</main>'}
        pages = {name: mock.Mock(scripts=['/faq.0123456789.js']) for name in htmls}
        with self.assertRaisesRegex(AssertionError, 'the drivers/index.html page shows no Questions'):
            check.check_faq(htmls, pages, names)
        del htmls['drivers/index.html']
        check.check_faq(htmls, pages, names)

    def test_drivers_page(self):
        boat = '<article class="driver hero" id="boat-dev"'
        for name, old, new, error in (
                ('drivers/index.html', 'id="cloudroom"', 'id="cloud"', 'four driver cards'),
                ('drivers/index.html', '<span>Grok Bot</span></h3>', '<span>Grok</span></h3>', 'four driver cards'),
                ('drivers/index.html', 'Passed the kit on a Linux PC', 'Passed the kit on a Mac', 'driver facts'),
                ('drivers/index.html', 'Passed the kit, run from a Cloudroom cloud thread', 'Passed the kit, run from a laptop', 'driver facts'),
                ('drivers/index.html', boat, boat.replace(' hero', ''), 'boat.dev is the hero|spotlight'),
                ('drivers/index.html', '<article class="driver" id="grok-bot"', '<article class="driver hero" id="grok-bot"', 'boat.dev is the hero'),
                ('drivers/index.html', 'href="https://github.com/openwizdev/OpenWiz/tree/main/adapters/template"', 'href="https://github.com/openwizdev/WizSkills"', 'only to the public OpenWiz'),
                ('drivers/index.html', '>Changelog</a>', '>Changes</a>', 'identical to the landing'),
                ('drivers/index.html', ' aria-current="page">Drivers', '>Drivers', 'aria-current'),
                ('drivers/index.html', '</main>', '<p>Used by 300 teams.</p></main>', 'invented number'),
                ('drivers/index.html', '</main>', '<p hidden>Later.</p></main>', 'without a script|waits for a script'),
                ('drivers/index.html', '</head>', '<script>1</script></head>', 'never its own'),
                ('drivers/index.html', '</head>', '<script src="/drivers/logos/bot.svg"></script></head>', 'never its own'),
                ('index.html', '<a class="nav-drivers" href="/drivers/">Drivers</a>', '', 'identical to the landing|landing top bar needs one Drivers'),
                ('changelog/index.html', '<a class="nav-drivers" href="/drivers/">Drivers</a>', '', 'Changelog top bar needs one Drivers')):
            self.broken(name, old, new, error)
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / 'dist'
            shutil.copytree(ROOT / 'dist', root)
            (root / 'drivers/index.html').unlink()
            with self.assertRaisesRegex(AssertionError, 'missing build output'):
                check_site(root)
        with mock.patch('check.DRIVER_ART_BUDGET', 1000), self.assertRaisesRegex(AssertionError, 'the drivers art'):
            check_site(ROOT / 'dist')

    def test_drivers_login_lines(self):
        import check
        main = re.search(r'<main\b[\s\S]*?</main>', (ROOT / 'dist' / check.DRIVERS_PAGE).read_text())[0]
        check.check_driver_logins(main)
        held, local = '<p class="driver-login">Login: held by Cloudroom</p>', '<p class="driver-login">Login: stays on your machine</p>'
        for old, new, error in (
                (held, '', 'Cloudroom: its login line'),
                (held, '<p class="driver-login">Login: stays on your machine</p>', 'Cloudroom: its login line'),
                ('<p class="driver-login">Login: held by boat.dev</p>', '<p class="driver-login">Login: held by Cloudroom</p>', 'boat.dev: its login line'),
                (local, '<p class="driver-login">Login: your machine</p>', 'Your own computer or VPS: its login line'),
                ('<span>Grok Bot</span></h3>', '<span>Grok Bot</span></h3>' + local, 'Grok Bot: its login line'),
                ('</ul>\n  </section>', '</ul>\n' + local + '  </section>', 'only on a driver card')):
            self.broken('drivers/index.html', old, new, error)
        line = '<p class="driver-line">Passed the kit, run from a Cloudroom cloud thread against real Cloudroom</p>'
        self.broken('drivers/index.html', held + '\n        ' + line, line + '\n        ' + held, 'right after its name')

    def test_drivers_building(self):
        import check
        main = re.search(r'<main\b[\s\S]*?</main>', (ROOT / 'dist' / check.DRIVERS_PAGE).read_text())[0]
        check.check_drivers_building(main)
        state = '<span>Not released: waits for its live check</span>'
        for old, new, error in (
                ('<h2 id="building-title">Being built now</h2>', '<h2 id="building-title">Coming soon</h2>', 'headed'),
                ('<h3 class="build-name" id="build-pane-name">Pane</h3>', '<h3 class="build-name" id="build-pane-name">Pane app</h3>', 'Pane: its name'),
                ('id="build-hermes"', 'id="build-devin"', 'lists, in order'),
                ('<article class="build" id="build-factory"', '<article class="driver build" id="build-factory"', 'four driver cards'),
                (state, '<span>Live check: passed</span>', 'links its open pull request'),
                ('pull/2021">', 'pull/2019">', 'links its open pull request'),
                ('<h3 class="build-name" id="build-hermes-name">Hermes</h3>', '<h3 class="build-name" id="build-hermes-name"><img src="/favicon.svg" alt="Hermes">Hermes</h3>', 'no logos'),
                ('Runs each build as one Cursor cloud agent.', 'Runs each build as one Cursor cloud agent, supported today.', 'released, live-checked or supported'),
                ('Runs each build as one Cursor cloud agent.', 'Passed on Cursor.', 'never shown as passed'),
                ('Login: held by Conductor', 'Login: stays on your machine', 'Conductor: its name, then its login line')):
            self.broken('drivers/index.html', old, new, error)

    def test_drivers_spotlight(self):
        page = 'drivers/index.html'
        for old, new, error in (
                ('class="spotlight', 'class="boat-other', 'one boat.dev spotlight'),
                ('class="proof-check" data-check="wake" data-state="passed"', 'class="proof-check" data-check="wake" data-state="in progress"', 'each passed'),
                ('class="proof-check" data-check="start"', 'class="proof-check" data-check="begin"', 'five checks in order|each passed'),
                ('<span class="proof-state">passed</span>', '<span class="proof-state"></span>', 'says passed in words'),
                ('that note was edited, never a second one.', 'it works.', 'explains what it proved'),
                ('<img class="proof-art" src="/art/drivers-c-boat.webp"', '<img class="proof-art-x" src="/art/drivers-c-boat.webp"', 'painting of the crew'),
                ('</main>', '<img src="/art/drivers-d-ship.webp" alt="The ship again"></main>', 'shown twice')):
            self.broken(page, old, new, error)
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / 'dist'
            shutil.copytree(ROOT / 'dist', root)
            path = root / page
            text = path.read_text()
            section = re.search(r'\s*<section class="spotlight[\s\S]*?</section>', text)[0]
            path.write_text(text.replace(section, '').replace('<section class="own-driver', section.strip() + '<section class="own-driver', 1))
            with self.assertRaisesRegex(AssertionError, 'boat.dev first|right after the hero'):
                check_site(root)
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / 'dist'
            shutil.copytree(ROOT / 'dist', root)
            (root / 'art/drivers-x-unused.webp').write_bytes((root / 'art/drivers-d-sea.webp').read_bytes())
            with mock.patch.dict('check.ART_HASHES', {'art/drivers-x-unused.webp': 'f2699bd8fe4763993a492dfac2bdbfc3eae46ec33bae0ab74127ad6ebc6a6285'}), \
                    mock.patch('check.ART', set(__import__('check').ART) | {'art/drivers-x-unused.webp'}), \
                    mock.patch('check.STATIC', set(__import__('check').STATIC) | {'art/drivers-x-unused.webp'}), \
                    self.assertRaisesRegex(AssertionError, 'unused drivers art'):
                check_site(root)
        for bad, error in (
                ('\n.drivers-page .driver-kit { font: 600 11px/1.3 monospace; }\n', 'under 12px'),
                ('\n.drivers-page .x { font-size: 10px; }\n', 'under 12px'),
                ('\n.drivers-page .x-label { font: 600 12px/1 monospace; letter-spacing: .02em; text-transform: uppercase; }\n', 'tracking'),
                ('\n.drivers-page .x-label { font: 600 12px/1 monospace; text-transform: uppercase; }\n', 'tracking')):
            self.broken(page, '', '', error, css=bad)

    def test_drivers_round_3h(self):
        page = 'drivers/index.html'
        explainer = '<div class="drivers-explainer">'
        row = '<li class="kit-check" data-check="token" data-state="not yet run">token not yet run</li>'
        grok = '<h3 class="driver-name" id="grok-bot-name">'
        for old, new, error in (
                (explainer, '<div class="drivers-intro">', 'one explainer of what a driver is'),
                ('five-check test on its real host.</p>', 'five-check test. It is free. It is fast.</p>', 'two sentences at most'),
                ('every driver answers the same four commands', 'every driver answers the same commands', 'explainer must name'),
                ('build software from tickets', 'build software', 'explainer must name'),
                ('every driver answers the same four commands', 'every driver answers the same four commands (<code>version</code>, <code>start</code>, <code>wake</code>, <code>stop</code>)', 'stays out of the hero'),
                ('five-check test on its real host.</p>', 'five-check test on its real host, token included.</p>', 'stays out of the hero'),
                ('must pass the same five-check test', 'passes the same five-check test', 'a requirement, never'),
                ('<span>Kit: not run yet</span></p>', '<span>Kit: not run yet</span></p><ul>' + row + '</ul>', 'no per-check rows'),
                ('<span>Kit: not run yet</span></p>', '<span>Kit: not run yet</span></p><ol><li class="proof-check" data-check="token">x</li></ol>', 'one kit line, never per-check rows'),
                ('<span>Kit: not run yet</span>', '<span>Kit: not run yet. Its kit run comes next.</span>', 'one kit line must read'),
                ('<span>Kit: passed, 5 of 5</span>', '<span>Kit: passed</span>', 'one kit line must read'),
                ('<p class="driver-kit passed" data-state="passed">', '<p class="driver-kit passed" data-state="not yet run">', 'one kit line must read'),
                ('<h2 id="more-title">More drivers</h2>', '<h2 id="more-title">More drivers</h2><p>4 words, 5 checks in the kit</p>', 'jargon count'),
                ('<h2 id="more-title">More drivers</h2>', '<h2 id="more-title">More drivers</h2><p>1 passed, 3 of 5</p>', 'jargon count'),
                ('Drivers answer the same four commands', 'Drivers answer 4 words', 'jargon count'),
                ('<h2 id="more-title">More drivers</h2>', '<h2 id="more-title">More drivers</h2><p>boat.dev passed all five checks.</p>', 'at most 2 times'),
                ('<div class="own-token"><dt><code>token</code></dt>', '<div class="own-token"><dt><code>tokens</code></dt>', 'fifth check, token'),
                ('alt="Cloudroom logo" width="256"', 'alt="" width="256"', 'alt text naming Cloudroom|names its host'),
                (grok, grok + '<img src="/drivers/logos/cloudroom.png" alt="Grok Bot logo">', 'no Grok logo'),
                (grok, grok + '<svg viewBox="0 0 8 8"><circle cx="4" cy="4" r="4"/></svg>', 'no Grok logo'),
                ('</main>', '<img src="/favicon.svg" alt="Grok"></main>', 'no Grok logo')):
            self.broken(page, old, new, error)
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / 'dist'
            shutil.copytree(ROOT / 'dist', root)
            path = root / page
            text = path.read_text()
            block = re.search(r'<div class="drivers-explainer">[\s\S]*?</div>', text)[0]
            path.write_text(text.replace(block, '').replace('</ul>\n  </section>\n  <section class="own-driver', '</ul>' + block + '\n  </section>\n  <section class="own-driver', 1))
            with self.assertRaisesRegex(AssertionError, 'sits in the hero|above the cards'):
                check_site(root)
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / 'dist'
            shutil.copytree(ROOT / 'dist', root)
            path = root / page
            text = path.read_text()
            spot = re.search(r'\s*<section class="spotlight[\s\S]*?</section>', text)[0]
            path.write_text(text.replace(spot, '').replace('<section class="own-driver', spot.strip() + '\n  <section class="own-driver', 1))
            with self.assertRaisesRegex(AssertionError, 'boat.dev first'):
                check_site(root)
        for logo in ('drivers/logos/boat-dev.svg', 'drivers/logos/cloudroom.png', 'drivers/logos/monitor.svg', 'drivers/logos/bot.svg'):
            with self.subTest(logo=logo), tempfile.TemporaryDirectory() as temp:
                root = Path(temp) / 'dist'
                shutil.copytree(ROOT / 'dist', root)
                (root / logo).write_bytes((root / logo).read_bytes() + b'\n')
                with self.assertRaisesRegex(AssertionError, 'logo changed bytes'):
                    check_site(root)
                with self.assertRaisesRegex(AssertionError, 'logo changed bytes|unreviewed picture'):
                    check_privacy(logo, (ROOT / logo).read_bytes().replace(b'</svg>', b'<!-- x --></svg>') if logo.endswith('.svg') else b'\x89PNG tampered')
        from check import check_driver_logos, DriverOutline
        html = (ROOT / 'dist' / page).read_text()
        main = re.search(r'<main\b[^>]*>[\s\S]*?</main>', html)[0]
        check_driver_logos(main, DriverOutline(main))
        for extra, error in (('drivers/logos/extra.svg', 'unused drivers logos'), ('drivers/logos/grok.svg', 'unused drivers logos|no Grok logo')):
            with self.subTest(extra=extra), mock.patch.dict('check.DRIVER_LOGOS', {extra: ('0' * 64, 'Extra')}), \
                    self.assertRaisesRegex(AssertionError, error):
                check_driver_logos(main, DriverOutline(main))

    def test_drivers_round_3_final(self):
        page = 'drivers/index.html'
        pill = '<li data-host="boat-dev" data-state="passed">'
        for old, new, error in (
                ('<span class="host-state">passed 5 of 5</span>', '', 'works today in words'),
                ('<span class="host-state">passed 5 of 5</span>', '<span class="host-state">works</span>', 'passed 5 of 5'),
                ('<span class="host-state">coming soon</span>', '<span class="host-state">soon</span>', 'coming soon'),
                ('<li data-host="vps" data-state="passed">', '<li data-host="computer" data-state="passed">', 'host pills, in order'),
                ('<span class="host-mark"><img class="host-lockup"', '<span class="host-mark"></span><img class="host-lockup"', 'fixed-height slot'),
                (pill, pill + '<span class="host-mark"><img src="/drivers/logos/boat-dev.svg" alt="boat.dev"></span>', 'fixed-height slot'),
                ('<span class="host-name">Grok Bot</span>', '<span class="host-name">Grok</span>', 'names its host'),
                ('<p class="driver-date">', '<p class="driver-meta">', 'own date line'),
                ('<p class="driver-line">Passed all five checks</p>', '<p class="driver-line">Passed all five checks on a real account, 2026-11-19</p>', 'driver facts|own date line'),
                ('On a real account, <time', 'Real account, <time', 'own date line'),
                ('src="/drivers/logos/bot.svg" alt="Generic bot icon"', 'src="/drivers/logos/monitor.svg" alt="Generic computer icon"', 'only the generic icon'),
                ('<img class="driver-logo host-icon" src="/drivers/logos/bot.svg" alt="Generic bot icon" width="24" height="24">', '', 'only the generic icon'),
                ('<span>Cloudroom</span></h3>', 'Cloudroom</h3>', 'one header structure'),
                ('No credential appeared in its output', 'No credential showed in its output', 'explains what it proved|token check inspected'),
                ('appeared in its output, command lines or environment, and it refused a token field</dd>', 'appeared in its output</dd>', 'token check inspected'),
                ('</main>', '<p>The token check proves no credential leaks.</p></main>', 'broader token claim')):
            self.broken(page, old, new, error)
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / 'dist'
            shutil.copytree(ROOT / 'dist', root)
            path = root / page
            text = path.read_text()
            scene = re.search(r'\s*<div class="proof-scene">[\s\S]*?</div>', text)[0]
            path.write_text(text.replace(scene, '').replace('<div class="proof-copy">', scene.strip() + '<div class="proof-copy">', 1))
            with self.assertRaisesRegex(AssertionError, 'come before its painting'):
                check_site(root)
        for bad, error in (
                ('\n.drivers-page .host-marks .host-lockup { height: 26px; }\n', 'sized apart from its slot'),
                ('\n.drivers-page .host-mark .host-tile { width: 30px; }\n', 'sized apart from its slot'),
                ('\n.drivers-page .host-mark .host-tile { border-radius: 4px; }\n', 'official marks show whole'),
                ('\n.drivers-page .driver-logo.host-tile { border-radius: 7px; }\n', 'official marks show whole'),
                ('\n.drivers-page .spot-logo { object-fit: cover; }\n', 'official marks show whole'),
                ('\n@media (max-width: 760px) { .drivers-page .proof-scene { aspect-ratio: 1 / 1; } }\n', 'shorter supporting image'),
                ('\n@media (max-width: 760px) { .drivers-page .proof-scene { order: -1; } }\n', 'keeps its reading order')):
            self.broken(page, '', '', error, css=bad)

    def test_drivers_kit_results(self):
        page = 'drivers/index.html'
        vps, cloud, boat, grok = (f'<li data-host="{k}" data-state="' for k in ('vps', 'cloudroom', 'boat-dev', 'grok-bot'))
        for old, new, error in (
                (vps + 'passed">', vps + 'being fixed">', "pill's state is 'passed'|shown as anything but passed"),
                (cloud + 'passed">', cloud + 'works today">', "pill's state is 'passed'|shown as anything but passed"),
                (boat + 'passed">', boat + 'coming soon">', "pill's state is 'passed'|shown as anything but passed"),
                (grok + 'coming soon">', grok + 'passed">', "pill's state is 'coming soon'|never shown as passed"),
                ('<span class="host-state">coming soon</span>', '<span class="host-state">passed 5 of 5</span>', 'coming soon'),
                ('<span>Kit: not run yet</span>', '<span>Kit: passed, 5 of 5</span>', 'one kit line must read|never shown as passed'),
                ('<p class="driver-kit unrun" data-state="not yet run">', '<p class="driver-kit passed" data-state="passed">', 'one kit line must read|never shown as passed'),
                ('<p class="driver-kit passed" data-state="passed">', '<p class="driver-kit unrun" data-state="passed">', 'shown as anything but passed in its kit line'),
                ('Coming soon: listed when its driver lands', 'Coming soon: passed the kit', 'driver facts|never shown as passed'),
                ('Kit run, <time datetime="2026-11-20">2026-11-20</time>', 'Kit run, <time datetime="2026-11-21">2026-11-21</time>', 'dates its kit run 2026-11-20|invented number'),
                ('<a href="https://github.com/openwizdev/OpenWiz/pull/1455#issuecomment-7034588211">', '<a href="https://github.com/openwizdev/OpenWiz/pull/1458#issuecomment-7034556153">', 'linked to its public evidence'),
                ('<a href="https://github.com/openwizdev/OpenWiz/pull/1444">', '<a href="https://github.com/openwizdev/OpenWiz">', 'spotlight date links to its public evidence'),
                ('</ol>\n        <p class="proof-also">', '</ol>\n        <p class="proof-other">', 'boat.dev is one of three'),
                ('passed the same five checks on <time', 'may pass the same five checks on <time', 'boat.dev is one of three'),
                ('<h2 id="more-title">More drivers</h2>', '<h2 id="more-title">More drivers</h2><p>Cloudroom is being fixed.</p>', 'stale driver state word'),
                ('<h2 id="more-title">More drivers</h2>', '<h2 id="more-title">More drivers</h2><p>Kit: in progress</p>', 'stale driver state word'),
                ('<h2 id="more-title">More drivers</h2>', '<h2 id="more-title">More drivers</h2><p>Its kit run is next; not run yet.</p>', 'stale driver state word'),
                ('Passed the kit on a Linux PC', 'Works today on a Linux PC', 'driver facts|status sentence says so'),
                ('<h2 id="more-title">More drivers</h2>', '<h2 id="more-title">More drivers</h2><p>Only boat.dev has passed.</p>', 'never the only one')):
            self.broken(page, old, new, error)

    def test_drivers_nav_and_description(self):
        for name in ('index.html', 'changelog/index.html', 'drivers/index.html'):
            with self.subTest(page=name), tempfile.TemporaryDirectory() as temp:
                root = Path(temp) / 'dist'
                shutil.copytree(ROOT / 'dist', root)
                page = root / name
                text = page.read_text()
                self.assertIn('<a class="nav-drivers" href="/drivers/"', text)
                page.write_text(text.replace('<a class="nav-drivers" href="/drivers/"', '<a class="nav-log" href="/drivers/"', 1))
                with mock.patch('check.check_drivers'), self.assertRaisesRegex(AssertionError, 'hidden on phones'):
                    check_site(root)
        self.broken('', '', '', 'hidden on phones', css='\n@media (max-width: 480px) { .landing-nav .nav-drivers { display: none; } }\n')
        for old, new, error in (
                ('boat.dev, Cloudroom and your own computer or VPS passed all five checks', 'boat.dev passed all five checks', 'must say boat.dev, Cloudroom and your own computer or VPS passed'),
                ('Grok Bot is coming soon', 'Grok Bot is coming soon, and Grok Bot passed too', 'Grok Bot has not passed'),
                ('A driver connects', 'Every driver passes the kit. A driver connects', 'must not say every driver passes'),
                ('Drivers answer the same four commands', 'Drivers answer 4 words', 'jargon count')):
            with self.subTest(error=error), tempfile.TemporaryDirectory() as temp:
                root = Path(temp) / 'dist'
                shutil.copytree(ROOT / 'dist', root)
                page = root / 'drivers/index.html'
                text = page.read_text()
                head = text[:text.index('</head>')]
                self.assertIn(old, head)
                page.write_text(text.replace(old, new, 1))
                with self.assertRaisesRegex(AssertionError, error):
                    check_site(root)

    def test_logo_pack(self):
        logo = (ROOT / 'brand/openwiz-lockup.svg').read_bytes()
        for name in ('favicon.svg', 'brand/openwiz-lockup.svg'):
            check_vector((ROOT / name).read_bytes())
        with self.assertRaisesRegex(AssertionError, 'new mark'):
            check_vector(logo.replace(b'#cfc6b8', b'#2b2bff'))
        for bad in (logo.replace(b'</svg>', b'<text x="0" y="0">OpenWiz</text></svg>'),
                    logo.replace(b'<path ', b'<path font-family="URW Gothic" ', 1),
                    logo.replace(b'</svg>', b'<style>@font-face{src:url(x.otf)}</style></svg>'),
                    logo.replace(b'<path ', b'<path onload ="x" ', 1)):
            with self.subTest(bad=bad[-60:]), self.assertRaises(AssertionError):
                check_vector(bad)
        check_privacy('docs/map.png', (ROOT / 'docs/map.png').read_bytes())
        for path in ('favicon.ico', 'brand/new.png', 'docs/map.png', 'docs/new.png'):
            with self.subTest(path=path), self.assertRaises(AssertionError):
                check_privacy(path, b'\x89PNG tampered')
        with self.assertRaises(AssertionError):
            check_privacy('dist/docs/map.png', (ROOT / 'docs/map.png').read_bytes())
        for new in ('https://example.com/brand/og.png', 'https://openwiz.dev/brand/missing.png'):
            with self.subTest(new=new), tempfile.TemporaryDirectory() as temp:
                root = Path(temp) / 'dist'
                shutil.copytree(ROOT / 'dist', root)
                landing = root / 'index.html'
                landing.write_text(landing.read_text().replace('content="https://openwiz.dev/brand/og.png?v=2"', f'content="{new}"', 1))
                with self.assertRaises(AssertionError):
                    check_site(root)
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / 'dist'
            shutil.copytree(ROOT / 'dist', root)
            (root / 'brand/openwiz-lockup.svg').write_bytes(logo.replace(b'</svg>', b'<text>OpenWiz</text></svg>'))
            with self.assertRaises(AssertionError):
                check_site(root)

if __name__ == '__main__':
    unittest.main()

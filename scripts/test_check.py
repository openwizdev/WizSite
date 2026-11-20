"""Synthetic negative cases for link/resource and privacy gates; no browser tools."""
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest import mock

import re

from check import FINGERPRINTS, HASHED, INSTALL_SWITCH, ROOT, Page, check_changelog, check_releases, split_releases, check_motion, check_privacy, check_ref, check_site, check_vector, check_webp, fingerprint


def edit_built(root, name, change):
    """Edit a fingerprinted file in a build copy and re-fingerprint it (renaming the file and the pages'
    references), so a test reaches the gate it targets instead of failing on the stale fingerprint."""
    old = next(p for p in root.glob(name.rsplit('.', 1)[0] + '.*.' + name.rsplit('.', 1)[1]))
    was = old.relative_to(root).as_posix()
    data = change(old.read_text()).encode()
    new = fingerprint(name, data)
    old.unlink()
    (root / new).write_bytes(data)
    for page in ('index.html', 'changelog/index.html', 'drivers/index.html', 'app/index.html'):
        path = root / page
        path.write_text(path.read_text().replace(f'"/{was}"', f'"/{new}"'))


# A synthetic landing and changelog, valid as they stand; each case below plants one break.
LANDING = ('<html><head><title>OpenWiz</title></head><body><header><nav><a href="/changelog/">Changelog</a></nav></header>'
           '<main><h1>Bring your own everything.</h1></main><footer><a href="/changelog/">Changelog</a></footer></body></html>')
PART = ('<section class="part" id="{id}"><h3>{name} <span>openwizdev/{name}</span></h3>'
        '<p class="intro">{name} is one part. It does one thing.</p><ul><li>One thing works.</li></ul></section>')
CHANGELOG = ('<html><head><title>Changelog — OpenWiz</title><style>.part{color:red}</style></head><body><main id="main">'
             '<h1>Changelog</h1><p class="lead">How the repositories fit together.</p>'
             '<figure class="repo-map"><svg role="img" aria-label="OpenWiz in the middle; private records and tools aside" viewBox="0 0 10 10"><text>OpenWiz</text></svg></figure>'
             '<section class="today"><h2>What exists today</h2>'
             + ''.join(PART.format(id=n.lower(), name=n) for n in ('OpenWiz', 'WizSkills', 'WizLoops', 'WizPlugins', 'WizSite'))
             + '</section></main></body></html>')

RELEASE = '<article class="release"><h4>{repo} {v}</h4><p class="released">Released <time datetime="2031-01-01">2031-01-01</time></p><div class="notes"><ul><li><code>x</code> <strong>y</strong></li></ul></div></article>'
RELEASES = ('<section class="releases" id="releases" aria-labelledby="releases-h"><h2 id="releases-h">Releases</h2><p class="note">Generated.</p>'
            '<section class="release-part" id="openwiz-releases" data-repo="OpenWiz"><h3>OpenWiz <span>openwizdev/OpenWiz</span></h3>'
            + RELEASE.format(repo='OpenWiz', v='0.1.10') + RELEASE.format(repo='OpenWiz', v='0.1.2') + '</section>'
            '<section class="release-part" id="wizskills-releases" data-repo="WizSkills"><h3>WizSkills</h3><p class="no-release">No release yet.</p></section>'
            '<section class="release-part" id="wizloops-releases" data-repo="WizLoops"><h3>WizLoops</h3><p class="missing read">Missing.</p></section></section>')


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
        # Construct generic markers so the test file itself stays clean.
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
        # Unpinned pictures, and pinned names with other bytes, are refused.
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
        # Catches: a missing to-do example, a wrong step order, the retired approval step, missing
        # steering or sample copy, a return to the old example, or a missing painting description.
        for change, error in (
                (lambda t: t.replace('Build a to-do app', 'Build an app'), 'missing landing story copy'),
                (lambda t: t.replace('<h3>Watch your spec</h3>', '<h3>Watch it ship</h3>'), 'three moments'),
                (lambda t: t.replace('<h3>Watch it ship</h3>', '<h3>Approve the plan</h3><h3>Watch it ship</h3>'), 'three moments'),
                (lambda t: t.replace('Steer the build from the narrated video.', 'Watch the video.'), 'steering copy'),
                (lambda t: t.replace("A real spec from OpenWiz's own factory", 'A sample spec'), "real spec from OpenWiz's own factory"),
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
        # Catches: an approval step back in the hero (J203: the road is three moments with no approval),
        # in its copy, its demo window or the demo's step labels.
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
        # Catches: a landing nav or footer label left as the old name, an extra or missing Changelog link on the
        # landing, inline styles leaking into the landing, and the old name on either page's heading, title or text.
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

    def test_changelog_picture_parts_and_no_history(self):
        # Catches: the picture missing, unlabelled or after What exists today; a second section of the same
        # kind; a repository part without its two or three opening sentences, missing, or doubled; a private
        # repository named; and a release entry, version number or date coming back.
        figure = CHANGELOG[CHANGELOG.index('<figure'):CHANGELOG.index('</figure>') + 9]
        no_figure = CHANGELOG.replace(figure, '')
        wizsite = PART.format(id='wizsite', name='WizSite')
        for changelog, error in (
                (no_figure, 'picture opens the page'),
                (no_figure.replace('</section></main>', figure + '</section></main>'), 'picture opens the page'),
                (CHANGELOG.replace(' aria-label="OpenWiz in the middle; private records and tools aside"', ''), 'labelled SVG'),
                (CHANGELOG.replace('</section></main>', '<h2>What exists today</h2></section></main>'), 'exactly one What exists today'),
                (CHANGELOG.replace('<h2>What exists today</h2>', '<h2>Coming soon</h2>'), 'exactly one What exists today'),
                (CHANGELOG.replace('WizSite is one part. It does one thing.', 'WizSite is one part.'), 'not two or three'),
                (CHANGELOG.replace('WizSite is one part. It does one thing.', 'One. Two. Three. Four.'), 'not two or three'),
                (CHANGELOG.replace('<p class="intro">WizSite', '<p>WizSite'), 'plain lines'),
                (CHANGELOG.replace(wizsite, ''), 'one part per public repository'),
                (CHANGELOG.replace(wizsite, wizsite + wizsite.replace('id="wizsite"', 'id="again"')), 'one part per public repository'),
                (CHANGELOG.replace(wizsite, PART.format(id='wizvault', name='WizVault')), 'not public'),
                (CHANGELOG.replace('One thing works.', 'WizVault keeps the scores.'), 'private repository is named'),
                (CHANGELOG.replace('One thing works.', 'Wiz<b>Room</b> keeps the scores.'), 'private repository is named'),
                (CHANGELOG.replace('One thing works.', 'WizSiteOps deploys it.'), 'private repository is named'),
                (CHANGELOG.replace('One thing works.', 'Released in 0.0.12.'), 'version number or date'),
                (CHANGELOG.replace('One thing works.', 'Shipped on Nov 16, 2026.'), 'version number or date'),
                (CHANGELOG.replace('One thing works.', '<time datetime="x">Last week</time>'), 'no release entry'),
                (CHANGELOG.replace('One thing works.', '<a href="https://github.com/openwizdev/OpenWiz/releases/tag/vX">Notes</a>'), 'no release entry'),
                (CHANGELOG.replace('.part{color:red}', '.part{transition:opacity .2s}'), 'motion outside')):
            with self.subTest(error=error, at=changelog[-120:]), self.assertRaisesRegex(AssertionError, error):
                check_changelog(LANDING, changelog)

    def test_generated_releases(self):
        # catches: a build without the generated section, or with it twice or outside main; a part missing, renamed
        # or out of order; releases out of version order or repeated; a part showing both releases and a state, or
        # nothing; and markup from release notes (a link, a script, an inline handler) reaching the page.
        page = CHANGELOG.replace('</main>', '<!-- releases:start -->' + RELEASES + '<!-- releases:end --></main>')
        self.assertEqual(split_releases(page), (CHANGELOG, RELEASES))
        check_releases(RELEASES)
        for built in (CHANGELOG, page.replace('</main>', '</main><!-- releases:start --><!-- releases:end -->'),
                      page.replace('<!-- releases:end --></main>', '<!-- releases:end --><p>after</p></main>')):
            with self.subTest(built=built[-80:]), self.assertRaises(AssertionError):
                split_releases(built)
        for section, error in (
                (RELEASES.replace('>Releases<', '>Ship<'), 'headed Releases'),
                (RELEASES.replace('data-repo="WizLoops"', 'data-repo="WizVault"'), 'per versioned repository'),
                (RELEASES.replace('data-repo="WizSkills"', 'data-repo="X"').replace('data-repo="OpenWiz"', 'data-repo="WizSkills"').replace('data-repo="X"', 'data-repo="OpenWiz"'), 'per versioned repository'),
                (RELEASES.replace('0.1.10', '0.1.1'), 'newest first'),
                (RELEASES.replace('0.1.10', '0.1.2'), 'newest first'),
                (RELEASES.replace('0.1.10', '0.0.9').replace('0.1.2', '0.0.8'), 'from 0.1.0'),
                (RELEASES.replace('<p class="no-release">No release yet.</p>', ''), 'one of no release yet and missing'),
                (RELEASES.replace('<p class="missing read">Missing.</p>', '<p class="missing read">Missing.</p><p class="no-release">No.</p>'), 'one of'),
                (RELEASES.replace('<p class="no-release">No release yet.</p>', RELEASE.format(repo='WizSkills', v='1.0.0') + '<p class="no-release">No.</p>'), 'one of'),
                (RELEASES.replace('<h4>OpenWiz 0.1.2</h4>', '<h4>WizSkills 0.1.2</h4>'), 'unexpected release title'),
                (RELEASES.replace('<strong>y</strong>', '<a href="https://example.com/">y</a>'), 'unexpected element'),
                (RELEASES.replace('<strong>y</strong>', '<script>y</script>'), 'unexpected element'),
                (RELEASES.replace('<strong>y</strong>', '<strong onclick="y()">y</strong>'), 'unexpected attribute')):
            with self.subTest(error=error), self.assertRaisesRegex(AssertionError, error):
                check_releases(section)

    def test_landing_starts_in_still_mode(self):
        # Catches: an early inline script, a visible broken motion control or an autoplaying clip.
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
        # Catches: the spec video losing its poster, captions, plain link or lazy, muted inline start (#1405).
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
        # Catches: an idle move, a transition or smooth scrolling that still runs for a visitor who asked for
        # reduced motion. Stopping motion (animation: none) is allowed anywhere.
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
        """#1357: the box shows exactly the line the install skill expects, the instruction and one copy button; the
        button ships natively disabled and labelled coming soon, and one switch (data-install) is the only change
        that turns it on. Both switch values are built from the shipped landing and checked, whichever value it
        ships (#1573); each case below plants one break in each of them."""
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
            with self.subTest(state=state), tempfile.TemporaryDirectory() as temp:
                root = Path(temp) / 'dist'
                shutil.copytree(ROOT / 'dist', root)
                (root / 'index.html').write_text(variant)
                check_site(root)  # either value keeps every other rule
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
                    with self.assertRaises(AssertionError):
                        check_site(root)

    def test_app_page_policy_and_calm(self):
        # catches: the app losing the browser-enforced limit to GitHub and this site, loading an unchecked
        # script, or gaining motion.
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

    def test_drivers_page(self):
        # Catches (#50): the drivers page dropped from the build or its checks; a card missing, reordered or with its
        # facts, words or kit result changed; a kit state shown by colour or icon alone; boat.dev losing the hero, or a
        # second hero; a link off the public OpenWiz repository; a top bar that drifts from the landing's or loses its
        # current page; a Drivers link missing on the landing or Changelog; a script, a hidden part, an invented number;
        # and variant D's art over its budget.
        boat = '<article class="driver hero" id="boat-dev"'
        for name, old, new, error in (
                ('drivers/index.html', 'id="cloudroom"', 'id="cloud"', 'four driver cards'),
                ('drivers/index.html', '>Grok Bot</h3>', '>Grok</h3>', 'four driver cards'),
                ('drivers/index.html', 'Being fixed: its kit run is in progress', 'Being fixed: almost done', 'driver facts'),
                ('drivers/index.html', 'on a real account (2026-11-19)', 'on a real account', 'driver facts'),
                ('drivers/index.html', '<code class="word">wake</code>', '<code class="word">ping</code>', 'four words'),
                ('drivers/index.html', 'data-check="token" data-state="in progress"', 'data-check="token" data-state="passed"', 'kit result'),
                ('drivers/index.html', '<span class="kit-state">in progress</span>', '<span class="kit-state"></span>', 'says its state in words'),
                ('drivers/index.html', boat, boat.replace(' hero', ''), 'boat.dev is the hero'),
                ('drivers/index.html', '<article class="driver" id="grok-bot"', '<article class="driver hero" id="grok-bot"', 'boat.dev is the hero'),
                ('drivers/index.html', 'href="https://github.com/openwizdev/OpenWiz/tree/main/adapters/template"', 'href="https://github.com/openwizdev/WizSkills"', 'only to the public OpenWiz'),
                ('drivers/index.html', '>Changelog</a>', '>Changes</a>', 'identical to the landing'),
                ('drivers/index.html', ' aria-current="page">Drivers', '>Drivers', 'aria-current'),
                ('drivers/index.html', '</main>', '<p>Used by 300 teams.</p></main>', 'invented number'),
                ('drivers/index.html', '</main>', '<p hidden>Later.</p></main>', 'without a script|waits for a script'),
                ('drivers/index.html', '</head>', '<script>1</script></head>', 'without scripts'),
                ('index.html', '<a class="nav-drivers" href="/drivers/">Drivers</a>', '', 'identical to the landing|landing top bar needs one Drivers'),
                ('changelog/index.html', '<a class="nav-drivers" href="/drivers/">Drivers</a>', '', 'Changelog top bar needs one Drivers')):
            with self.subTest(name=name, error=error), tempfile.TemporaryDirectory() as temp:
                root = Path(temp) / 'dist'
                shutil.copytree(ROOT / 'dist', root)
                page = root / name
                text = page.read_text()
                self.assertIn(old, text)
                page.write_text(text.replace(old, new, 1))
                with self.assertRaisesRegex(AssertionError, error):
                    check_site(root)
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / 'dist'
            shutil.copytree(ROOT / 'dist', root)
            (root / 'drivers/index.html').unlink()
            with self.assertRaisesRegex(AssertionError, 'missing build output'):
                check_site(root)
        with mock.patch('check.DRIVER_ART_BUDGET', 1000), self.assertRaisesRegex(AssertionError, 'the drivers art'):
            check_site(ROOT / 'dist')

    def test_drivers_round_2f(self):
        # Catches (#56): the evidence chips missing, moved below the cards or with a number changed; boat.dev's proof
        # section missing, before the cards, or with a check missing, reordered, not passed, without its state in words
        # or without its plain line; the crew painting dropped; a picture shown twice (the ship in the hero and again in
        # the card); Cloudroom's kit note gone; drivers art left unused; and drivers-page text under 12 px.
        chips = '<ul class="drivers-chips" aria-label="In numbers">'
        for name, old, new, error in (
                ('drivers/index.html', chips, '<ul class="other-chips">', 'evidence chips'),
                ('drivers/index.html', '<li><b>4</b> words</li>', '<li><b>3</b> words</li>', 'evidence chips must read'),
                ('drivers/index.html', 'class="boat-proof', 'class="boat-other', 'one boat.dev proof section'),
                ('drivers/index.html', '<h2 id="proof-title">boat.dev passed the kit, 5 of 5.</h2>', '<h2 id="proof-title">boat.dev passed.</h2>', 'titled'),
                ('drivers/index.html', 'class="proof-check" data-check="wake" data-state="passed"', 'class="proof-check" data-check="wake" data-state="in progress"', 'each passed'),
                ('drivers/index.html', 'class="proof-check" data-check="start"', 'class="proof-check" data-check="begin"', 'each passed'),
                ('drivers/index.html', '<span class="proof-state">passed</span>', '<span class="proof-state"></span>', 'says passed in words'),
                ('drivers/index.html', 'that note was edited, never a second one.', 'it works.', 'explains what it proved'),
                ('drivers/index.html', '<img class="proof-art" src="/art/drivers-c-boat.webp"', '<img class="proof-art-x" src="/art/drivers-c-boat.webp"', 'painting of the crew'),
                ('drivers/index.html', '</main>', '<img src="/art/drivers-d-ship.webp" alt="The ship again"></main>', 'shown twice'),
                ('drivers/index.html', '<p class="driver-kit-note">Kit: not run yet</p>', '', 'kit note'),
                ('drivers/index.html', '</main>', '<p class="driver-kit-note">x</p></main>', 'kit note|four driver cards')):
            with self.subTest(name=name, error=error), tempfile.TemporaryDirectory() as temp:
                root = Path(temp) / 'dist'
                shutil.copytree(ROOT / 'dist', root)
                page = root / name
                text = page.read_text()
                self.assertIn(old, text)
                page.write_text(text.replace(old, new, 1))
                with self.assertRaisesRegex(AssertionError, error):
                    check_site(root)
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / 'dist'
            shutil.copytree(ROOT / 'dist', root)
            page = root / 'drivers/index.html'
            text = page.read_text()
            section = re.search(r'\s*<section class="boat-proof[\s\S]*?</section>', text)[0]
            page.write_text(text.replace(section, '').replace('<section class="fleet', section.strip() + '<section class="fleet', 1))
            with self.assertRaisesRegex(AssertionError, 'follows the four cards'):
                check_site(root)
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / 'dist'
            shutil.copytree(ROOT / 'dist', root)
            (root / 'art/drivers-x-unused.webp').write_bytes((root / 'art/drivers-c-boat.webp').read_bytes())
            with mock.patch.dict('check.ART_HASHES', {'art/drivers-x-unused.webp': '39fd43d08aa36bce84e964699d493a03af090499a63dffbfaa43e61804b7e1ef'}), \
                    mock.patch('check.ART', set(__import__('check').ART) | {'art/drivers-x-unused.webp'}), \
                    mock.patch('check.STATIC', set(__import__('check').STATIC) | {'art/drivers-x-unused.webp'}), \
                    self.assertRaisesRegex(AssertionError, 'unused drivers art'):
                check_site(root)
        for bad in ('\n.drivers-page .kit h4 { font: 600 11px/1.3 monospace; }\n', '\n.drivers-page .x { font-size: 10px; }\n'):
            with self.subTest(css=bad), tempfile.TemporaryDirectory() as temp:
                root = Path(temp) / 'dist'
                shutil.copytree(ROOT / 'dist', root)
                edit_built(root, 'site.css', lambda t: t + bad)
                with self.assertRaisesRegex(AssertionError, 'under 12px'):
                    check_site(root)

    def test_drivers_final(self):
        # Catches (#59): boat.dev's card listing the kit's five checks again beside the proof section (a duplicate list),
        # or losing its one "Kit: passed, 5 of 5" line, its link to the proof section, its four words or its 5 of 5 mark;
        # and an uppercase drivers-page label under 12 px or tracked tighter than .06em.
        proof_line = '<a class="kit-proof" href="#boat-proof">'
        row = ('<li class="kit-check" data-check="token" data-state="passed"><svg class="kit-icon" viewBox="0 0 16 16" aria-hidden="true">'
               '<circle cx="8" cy="8" r="7"/></svg><span class="kit-name">token</span> <span class="kit-state">passed</span></li>')
        for old, new, error in (
                (proof_line, '<ul>' + row + '</ul>' + proof_line, 'five checks appear only in the proof'),
                (proof_line, proof_line.replace('#boat-proof', '#boat-dev'), 'links to the proof section'),
                ('<span>Kit: passed, 5 of 5</span>', '<span>Kit: passed</span>', 'Kit: passed, 5 of 5'),
                ('<p class="hero-score" aria-hidden="true"><b>5</b><span>of 5</span></p>', '', '5 of 5 mark')):
            with self.subTest(error=error), tempfile.TemporaryDirectory() as temp:
                root = Path(temp) / 'dist'
                shutil.copytree(ROOT / 'dist', root)
                page = root / 'drivers/index.html'
                text = page.read_text()
                self.assertIn(old, text)
                page.write_text(text.replace(old, new, 1))
                with self.assertRaisesRegex(AssertionError, error):
                    check_site(root)
        for bad, error in (
                ('\n.drivers-page .x-label { font: 600 12px/1 monospace; letter-spacing: .02em; text-transform: uppercase; }\n', 'tracking'),
                ('\n.drivers-page .x-label { font: 600 12px/1 monospace; text-transform: uppercase; }\n', 'tracking'),
                ('\n.drivers-page .kit h4 span { letter-spacing: .03em; }\n', 'tracking')):
            with self.subTest(css=bad), tempfile.TemporaryDirectory() as temp:
                root = Path(temp) / 'dist'
                shutil.copytree(ROOT / 'dist', root)
                edit_built(root, 'site.css', lambda t: t + bad)
                with self.assertRaisesRegex(AssertionError, error):
                    check_site(root)

    def test_drivers_nav_and_description(self):
        # Catches (#59 R1): a Drivers nav link the phone breakpoint hides (display: none, so not shown or focusable at
        # 390 px) on the landing, the Changelog or the drivers page. Catches (#59 R2): a description saying every driver
        # passes the kit, when only boat.dev passed 5 of 5.
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
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / 'dist'
            shutil.copytree(ROOT / 'dist', root)
            edit_built(root, 'site.css', lambda t: t + '\n@media (max-width: 480px) { .landing-nav .nav-drivers { display: none; } }\n')
            with self.assertRaisesRegex(AssertionError, 'hidden on phones'):
                check_site(root)
        for old, new, error in (
                ('boat.dev passed 5 of 5', 'boat.dev passed', 'must say boat.dev passed 5 of 5'),
                ('Drivers plug', 'Every driver passes the kit. Drivers plug', 'must not say every driver passes')):
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
        # Catches: a lockup that ships live text or a font reference (the wordmark font must never ship),
        # an unreviewed icon picture, and a social card URL that points off the site or at a missing file.
        # Catches too (#1350): a vector logo still in the earlier blue mark rather than the dark-cream one.
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
        with self.assertRaises(AssertionError):  # a README picture is never part of the build
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

"""Synthetic negative cases for link/resource and privacy gates; no browser tools."""
from pathlib import Path
import shutil
import tempfile
import unittest

import re

from check import FINGERPRINTS, HASHED, ROOT, Page, check_film_script, check_landing_text, check_motion, check_privacy, check_ref, check_site, check_vector, check_webp, fingerprint


def edit_built(root, name, change):
    """Edit a fingerprinted file in a build copy and re-fingerprint it (renaming the file and the pages'
    references), so a test reaches the gate it targets instead of failing on the stale fingerprint."""
    old = next(p for p in root.glob(name.rsplit('.', 1)[0] + '.*.' + name.rsplit('.', 1)[1]))
    data = change(old.read_text()).encode()
    new = fingerprint(name, data)
    old.unlink()
    (root / new).write_bytes(data)
    for page in ('index.html', 'changelog/index.html'):
        path = root / page
        path.write_text(path.read_text().replace(f'"/{old.name}"', f'"/{new}"'))


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

    def test_encoded_copy_and_versions(self):
        for old, new in (('<h2 id="act-1">One idea, through all of history.</h2>', '<h2 id="act-1">One idea, through all of history.</h2><p>play&#98;ook</p>'),
                         ('<h2 id="act-1">One idea, through all of history.</h2>', '<h2 id="act-1">One idea, through all of history.</h2><p>Building in p&#117;blic</p>'),
                         ('src="/art/layer-hammer.webp" alt=""', 'src="/art/layer-hammer.webp" alt="Pl&#97;ybook"'),
                         ('<h2 id="act-1">One idea, through all of history.</h2>', '<h2 id="act-1">One idea, through all of history.</h2><p>play<b>bo</b>ok</p>'),
                         ('src="/art/layer-hammer.webp" alt=""', 'src="/art/layer-hammer.webp" alt="Illustration, not l&#105;ve data"'),
                         ('<h2 id="act-1">One idea, through all of history.</h2>', '<h2 id="act-1">One idea, through all of history.</h2><p>Building <em>in</em> public</p>'),
                         ('<h1 id="hero-h">Bring your own everything.</h1>', '<h1 id="hero-h">Bring your own anything.</h1>'),
                         ('<h2 id="act-1">One idea, through all of history.</h2>', '<h2 id="act-1">One idea, through all of history.</h2><p>Shipped 0.0.12</p>')):
            with self.subTest(new=new), tempfile.TemporaryDirectory() as temp:
                root = Path(temp) / 'dist'
                shutil.copytree(ROOT / 'dist', root)
                landing = root / 'index.html'
                text = landing.read_text()
                self.assertIn(old, text)
                landing.write_text(text.replace(old, new, 1))
                with self.assertRaises(AssertionError):
                    check_site(root)

    def test_landing_story(self):
        # Catches: the film's "This is your factory." dropped, the old example idea back on the page (in text or a
        # description), and an era painting shipped without a description, which loses that scene for
        # screen-reader visitors.
        def no_alt(name):
            return lambda t: re.sub(rf'(<img[^>]*src="/art/{name}"[^>]*?alt=")[^"]*', r'\1', t, count=1)
        for change in (lambda t: t.replace('This is your factory.', 'This is a factory.'),
                       lambda t: t.replace('<h2 id="act-1">One idea, through all of history.</h2>', '<h2 id="act-1">One idea, through all of history.</h2><p>Add a dark mode toggle</p>'),
                       lambda t: re.sub(r'(src="/art/era-1-cave.webp"[^>]*alt=")', r'\1A dark-mode idea. ', t, count=1),
                       no_alt('era-3-forge.webp'), no_alt('era-7-rooms.webp'), no_alt('era-2-grill.webp')):
            with self.subTest(change=change), tempfile.TemporaryDirectory() as temp:
                root = Path(temp) / 'dist'
                shutil.copytree(ROOT / 'dist', root)
                landing = root / 'index.html'
                text = landing.read_text()
                changed = change(text)
                self.assertNotEqual(changed, text)
                landing.write_text(changed)
                with self.assertRaises(AssertionError):
                    check_site(root)

    def test_story_shows_if_site_js_fails(self):
        # Catches: an inline script that switches on the animated story (sticky zoom-out with its hand-off hidden
        # until scrolled, Pause motion) before site.js loads; if site.js then fails to download, the last painting
        # and "This is your factory." never show and Pause does nothing.
        for change in ((lambda t: t.replace('</head>', "<script>document.documentElement.classList.add('story-live')</script></head>", 1)),
                       (lambda t: t.replace('<body>', '<body><script type="module">document.body.dataset.x = 1</script>', 1))):
            with self.subTest(change=change), tempfile.TemporaryDirectory() as temp:
                root = Path(temp) / 'dist'
                shutil.copytree(ROOT / 'dist', root)
                landing = root / 'index.html'
                text = landing.read_text()
                changed = change(text)
                self.assertNotEqual(changed, text)
                landing.write_text(changed)
                with self.assertRaises(AssertionError):
                    check_site(root)
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / 'dist'
            shutil.copytree(ROOT / 'dist', root)
            edit_built(root, 'site.js', lambda t: t.replace("classList.add('story-live')", ''))
            with self.assertRaises(AssertionError):
                check_site(root)

    def test_landing_words_are_only_headline_buttons_and_captions(self):
        # Catches (#1308): words creeping back onto the landing beyond the headline, the two buttons and one short
        # caption per act (a paragraph, a label, an over-long caption), a dropped caption, and a film that no longer
        # ends on "This is your factory."
        landing = (ROOT / 'index.html').read_text()
        check_landing_text(landing)
        act1 = '<h2 id="act-1">One idea, through all of history.</h2>'
        cap = '<p class="cap">This is your factory.</p>'
        for old, new in ((act1, act1 + '<p>Idea in. Shipped work out.</p>'),
                         (act1, act1 + '<span class="when">The idea</span>'),
                         (act1, '<h2 id="act-1">One idea, carried through all of history.</h2>'),
                         (act1, '<h2 id="act-1"></h2>'),
                         (cap, ''),
                         (cap, '<p class="cap">This is a factory.</p>'),
                         ('<h1 id="hero-h">Bring your own everything.</h1>', '<h1 id="hero-h">Bring your own everything.</h1><p>Not ready yet.</p>')):
            with self.subTest(new=new):
                self.assertIn(old, landing)
                with self.assertRaises(AssertionError):
                    check_landing_text(landing.replace(old, new, 1))

    def test_film_starts_only_without_reduced_motion(self):
        # Catches (#1308): the GSAP film (which the CSS motion check cannot see) built or switched on outside
        # gsap.matchMedia's no-preference query, so it would play for a visitor who asked for reduced motion;
        # or GSAP used for some other motion outside that query.
        js = (ROOT / 'site.js').read_text()
        check_film_script(js)
        entry = "gsap.matchMedia().add('(prefers-reduced-motion: no-preference)', () => {"
        for change in (lambda t: t.replace(entry, "gsap.matchMedia().add('(min-width: 0px)', () => {"),
                       lambda t: t.replace("  root.classList.add('story-live');", "  root.classList.add('story-live');\n  buildFilm(window.gsap);"),
                       lambda t: t.replace("  root.classList.add('story-live');", "  root.classList.add('story-live', 'film-live');\n  root.classList.add('film-live');"),
                       lambda t: t.replace("  root.classList.add('story-live');", "  root.classList.add('story-live');\n  window.gsap?.to('.l-rocket', { y: -40, repeat: -1 });")):
            with self.subTest(change=change):
                changed = change(js)
                self.assertNotEqual(changed, js)
                with self.assertRaises(AssertionError):
                    check_film_script(changed)

    def test_vendored_gsap_is_pinned(self):
        # Catches (#1308, J187): a changed or swapped vendored GSAP (or its licence notice) shipping unreviewed,
        # in source or in the build.
        data = (ROOT / 'vendor/gsap-3.15.1.min.js').read_bytes()
        check_privacy('vendor/gsap-3.15.1.min.js', data)
        for path in ('vendor/gsap-3.15.1.min.js', 'dist/vendor/gsap-3.15.1.min.js', 'vendor/other.js'):
            with self.subTest(path=path), self.assertRaises(AssertionError):
                check_privacy(path, data + b'\n;fetch("/x")')
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / 'dist'
            shutil.copytree(ROOT / 'dist', root)
            (root / 'vendor/GSAP-NOTICE.txt').write_text('removed')
            with self.assertRaises(AssertionError):
                check_site(root)

    def test_motion_only_without_reduced_motion(self):
        # Catches: an idle move, a transition or smooth scrolling that still runs for a visitor who asked for
        # reduced motion. Stopping motion (animation: none) is allowed anywhere.
        check_motion('@media (prefers-reduced-motion: no-preference){.film-live .a{animation:x 1s}html{scroll-behavior:smooth}'
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

    def test_animations_wait_for_gsap(self):
        # Catches (#1308 R1): a CSS loop or small move that starts while GSAP is blocked (gated on site.js alone, or
        # on nothing), so the page animates although the film has fallen back to stills.
        check_motion('@media (prefers-reduced-motion:no-preference){.film-live .a,.film-live .b{animation:x 1s}'
                     '.c{animation:none}.b:hover{transition:opacity .2s}}')
        for bad in ('@media (prefers-reduced-motion:no-preference){.story-live .a{animation:x 1s}}',
                    '@media (prefers-reduced-motion:no-preference){.a{animation-name:x}}',
                    '@media (prefers-reduced-motion:no-preference){.film-live .a,.b{animation:x 1s}}'):
            with self.subTest(css=bad), self.assertRaises(AssertionError):
                check_motion(bad)

    def test_motion_combined_phone_query(self):
        # Catches (#1298): the combined phone and no-preference query refused although it only narrows the safe
        # one; a zero transition-duration is no motion.
        check_motion('@media (max-width:960px) and (prefers-reduced-motion: no-preference){.film-live .a{animation:x 1s}'
                     '.b{transition-duration:.3s}}.c{transition-duration:0s}.d{transition-duration:0s, 0ms}')

    def test_motion_transition_duration(self):
        # Catches (#1298): a positive transition-duration outside the query animates every property (the default
        # transition-property is all) for a visitor who asked for reduced motion; and a query that only
        # mentions no-preference beside an "or" (a comma) or under "not" does not keep motion away from them.
        for bad in ('.x{transition-duration:.35s}.x:hover{opacity:.5}', '.x{transition-duration:0s, 200ms}',
                    '.x{transition-duration:var(--slow)}',
                    '@media (min-width:1px){.x{transition-duration:1s}}',
                    '@media (max-width:960px), (prefers-reduced-motion:no-preference){.a{animation:x 1s}}',
                    '@media not all and (prefers-reduced-motion:no-preference){.a{animation:x 1s}}',
                    '@media (max-width:960px) or (prefers-reduced-motion:no-preference){.a{animation:x 1s}}'):
            with self.subTest(css=bad), self.assertRaises(AssertionError):
                check_motion(bad)

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

    def test_install_wording_only_on_the_button(self):
        for extra in ('<a href="/">Install · coming soon</a>', '<p>Install now</p>', '<p>Inst&#97;ll today</p>',
                      '<p>in<b>stall</b> now</p>', '<p>Ins<span>t</span>all</p>', '<img alt="Install now" src="/favicon.svg">'):
            with self.subTest(extra=extra), tempfile.TemporaryDirectory() as temp:
                root = Path(temp) / 'dist'
                shutil.copytree(ROOT / 'dist', root)
                page = root / 'index.html'
                page.write_text(page.read_text().replace('<h2 id="act-1">One idea, through all of history.</h2>', '<h2 id="act-1">One idea, through all of history.</h2>' + extra, 1))
                with self.assertRaises(AssertionError):
                    check_site(root)

    def test_install_stays_disabled(self):
        good = '<button class="btn install" type="button" disabled>'
        for bad in ('<button class="btn install" type="button" aria-disabled="true">',
                    '<button class="btn install" type="button" disabled onclick="copy()">',
                    '<button class="btn install" type="button" disabled onclick ="copy()">',
                    '<button class="btn install" type="button" title=" disabled ">'):
            with self.subTest(bad=bad), tempfile.TemporaryDirectory() as temp:
                root = Path(temp) / 'dist'
                shutil.copytree(ROOT / 'dist', root)
                landing = root / 'index.html'
                landing.write_text(landing.read_text().replace(good, bad))
                with self.assertRaises(AssertionError):
                    check_site(root)
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / 'dist'
            shutil.copytree(ROOT / 'dist', root)
            edit_built(root, 'site.js', lambda t: t + "\nnavigator.clipboard.writeText('x');\n")
            with self.assertRaises(AssertionError):
                check_site(root)

    def test_logo_pack(self):
        # Catches: a lockup that ships live text or a font reference (the wordmark font must never ship),
        # an unreviewed icon picture, and a social card URL that points off the site or at a missing file.
        logo = (ROOT / 'brand/openwiz-lockup.svg').read_bytes()
        check_vector(logo)
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
                landing.write_text(landing.read_text().replace('content="https://openwiz.dev/brand/og.png"', f'content="{new}"', 1))
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

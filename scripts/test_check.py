"""Synthetic negative cases for link/resource and privacy gates; no browser tools."""
from pathlib import Path
import shutil
import tempfile
import unittest

from check import FINGERPRINTS, HASHED, ROOT, Page, check_privacy, check_ref, check_site, check_vector, check_webp, fingerprint


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

    def test_encoded_copy_and_teaser_pairs(self):
        for old, new in (('<h2 id="ship-h">Ship log</h2>', '<h2 id="ship-h">Ship log</h2><p>play&#98;ook</p>'),
                         ('<h2 id="ship-h">Ship log</h2>', '<h2 id="ship-h">Ship log</h2><p>Building in p&#117;blic</p>'),
                         ('alt="" width="400"', 'alt="Pl&#97;ybook" width="400"'),
                         ('<h2 id="ship-h">Ship log</h2>', '<h2 id="ship-h">Ship log</h2><p>play<b>bo</b>ok</p>'),
                         ('alt="" width="400"', 'alt="Illustration, not l&#105;ve data" width="400"'),
                         ('<h2 id="ship-h">Ship log</h2>', '<h2 id="ship-h">Ship log</h2><p>Building <em>in</em> public</p>'),
                         ('<p class="sub">You make the decisions.<br>The agents run the factory.</p>', '<p class="sub">You decide.<br>Agents build.</p>'),
                         ('<p class="sub">You make the decisions.<br>The agents run the factory.</p>', ''),
                         ('<h1>Build at the<br>speed of<br>ideas.</h1>', '<h1>Build at the<br>speed of<br>thought.</h1>'),
                         ('<span class="v">0.0.5</span><span>Fleets of agents build for you</span>', '<span class="v">0.0.5</span><span>Message your threads</span>')):
            with self.subTest(new=new), tempfile.TemporaryDirectory() as temp:
                root = Path(temp) / 'dist'
                shutil.copytree(ROOT / 'dist', root)
                landing = root / 'index.html'
                text = landing.read_text()
                self.assertIn(old, text)
                landing.write_text(text.replace(old, new, 1))
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

    def test_install_stays_disabled(self):
        good = '<button class="btn install" type="button" disabled aria-describedby="install-note">'
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
        for path in ('favicon.ico', 'brand/new.png'):
            with self.subTest(path=path), self.assertRaises(AssertionError):
                check_privacy(path, b'\x89PNG tampered')
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

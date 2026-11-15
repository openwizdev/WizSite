"""Dependency-free checks for this site's literal HTML/CSS and public source."""
from hashlib import sha256
from html.parser import HTMLParser
from pathlib import Path
import re
import subprocess
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
# Layered art: generated WebP pictures, reviewed and listed by the build from art/.
ART = {p.relative_to(ROOT).as_posix() for p in (ROOT / 'art').glob('*.webp')}
ART_BUDGET = 2_000_000  # bytes, all art together
RUNTIME = {
    'index.html', 'changelog/index.html', 'style.css', 'tokens.css', 'script.js',
    'landing.css', 'landing.js',
    'fonts/Geist-var.woff2', 'fonts/GeistMono-var.woff2', 'fonts/OFL.txt',
    'fonts/Virgil.woff2', 'fonts/Virgil-OFL.txt',
} | ART
# Generic private-context markers only; never copy personal literal lists here.
DENYLIST = ('closedwiz', '/users/', '/home/', 'private/evidence/',
            'docs/grills/', 'thr_', 'cr_sub_')
FONT_HASHES = {
    'fonts/Geist-var.woff2': '206f01ed08e05c98a51daa7472331c3c71bbb8c1f9d55ea8c70074f3c528a706',
    'fonts/GeistMono-var.woff2': '55419aa06f58adcd7f145c6c920e56936416f17e528f60efc6032ffa4269972b',
    'fonts/OFL.txt': 'c683bfbcc7e087f5d37a54ef628f10387c451a83ddc459b151403a164ac46c90',
    'fonts/Virgil-OFL.txt': 'a3ac9cdc65ef304ffb095d8cc877ee93bf1bffa88269693cd42ddf001650ffd0',
    'fonts/Virgil.woff2': '9976295bfe709bdea64839a4d4e9a1d436dd6eb67538399a5a0e8b8fadbcf1cf',
}
PAGES = ('index.html', 'changelog/index.html')
# Release-note text is intentionally retained while navigation follows the new landing.
CHANGELOG_MAIN = 'c852e0d7a442c1f65b7c663625d38258d23203070b4de80858d226f962b23d1e'


class Page(HTMLParser):
    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.ids = set()
        self.refs = []
        self.favicons = set()
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if 'id' in attrs:
            assert attrs['id'] not in self.ids, 'duplicate HTML id'
            self.ids.add(attrs['id'])
        for key in ('href', 'src', 'poster'):
            if attrs.get(key):
                self.refs.append(attrs[key])
        if tag == 'link' and attrs.get('rel') == 'icon':
            self.favicons.add(attrs.get('href'))


def check_webp(data):
    # A plain WebP image: no EXIF or XMP metadata chunks, which could carry private details.
    assert data[:4] == b'RIFF' and data[8:12] == b'WEBP', 'invalid WebP signature'
    at = 12
    while at + 8 <= len(data):
        kind, size = data[at:at + 4], int.from_bytes(data[at + 4:at + 8], 'little')
        assert kind in (b'VP8 ', b'VP8L', b'VP8X', b'ALPH'), f'unexpected WebP chunk {kind!r}'
        at += 8 + size + (size & 1)
    assert at == len(data), 'truncated WebP'


def check_ref(root, source, ref, pages, favicons=()):
    if ref.startswith('data:image/svg+xml,') and not favicons:
        # Inert inline CSS icons only: no script, links or nested resources.
        svg = unquote(ref.split(',', 1)[1]).lower()
        assert not re.search(r'script|href|url\(|foreignobject|on\w+=', svg), 'unexpected inline SVG'
        return
    if ref in favicons:
        # Only the existing inert inline SVG favicon, with no script or links.
        assert ref.startswith('data:image/svg+xml,'), 'unexpected favicon'
        svg = unquote(ref.split(',', 1)[1])
        assert re.fullmatch(r"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><path fill='#[0-9a-f]+' d='[A-Za-z0-9 .-]+'/></svg>", svg), 'unexpected favicon SVG'
        return
    url = urlsplit(ref)
    if url.scheme or url.netloc:
        assert url.scheme == 'https' and url.netloc == 'github.com', 'unexpected external URL'
        assert re.match(r'^/openwizdev/(?:openwiz|WizSkills|WizPlugins)(?:/|$)', url.path), 'unexpected repository link'
        assert not url.username and not url.password and not url.query, 'unexpected external URL parts'
        return
    assert not url.query, 'unexpected local query'
    path = unquote(url.path)
    target = (root / path.lstrip('/') if path.startswith('/') else source.parent / path) if path else source
    target = target.resolve()
    assert target.is_relative_to(root.resolve()), 'link escapes site root'
    if target.is_dir():
        target /= 'index.html'
    assert target.is_file(), f'missing local target: {ref}'
    if url.fragment:
        assert target in pages and unquote(url.fragment) in pages[target].ids, f'missing fragment: {ref}'


def check_site(root):
    files = {p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file()}
    assert files == RUNTIME, 'unexpected or missing build output'
    pages = {root / f: Page((root / f).read_text()) for f in PAGES}
    for path, page in pages.items():
        for ref in page.refs:
            check_ref(root, path, ref, pages, page.favicons)
        for ref in re.findall(r'url\(\s*[\'\"]?([^\s)\'\"]+)', path.read_text()):
            check_ref(root, path, ref, pages)
    for path in root.glob('*.css'):
        for ref in re.findall(r'url\(\s*[\'\"]?([^\s)\'\"]+)', path.read_text()):
            check_ref(root, path, ref, pages)
    # JavaScript-created resource: document.fonts.load() uses this CSS face.
    assert 'fonts/Virgil.woff2' in (root / 'style.css').read_text()
    for name in FONT_HASHES:
        data = (root / name).read_bytes()
        assert sha256(data).hexdigest() == FONT_HASHES[name], 'font or licence changed; review before updating its hash'
        if name.endswith('.woff2'):
            assert data[:4] == b'wOF2', 'invalid WOFF2 signature'
        else:
            assert b'SIL OPEN FONT LICENSE' in data, 'missing OFL licence'
    landing = (root / 'index.html').read_text()
    words = re.sub(r'<[^>]*>', '', landing)
    headline = re.sub(r'<[^>]*>', '', re.search(r'<h1>([\s\S]*?)</h1>', landing)[1].replace('<br>', ' '))
    assert headline == 'Build at the speed of ideas.', 'hero headline changed'
    flat = re.sub(r'\s+', ' ', re.sub(r'<br>', ' ', landing))
    flat = re.sub(r'\s+', ' ', re.sub(r'<[^>]*>', '', flat))
    assert 'You make the decisions. The agents run the factory.' in flat, 'hero subline changed'
    for text in ('Building in public', 'Star on GitHub', 'OpenWiz has no published release yet.',
                 'Illustration, not live data.', 'Idea in. Shipped work out.'):
        assert text in flat, f'missing landing copy: {text}'
    # Install stays "coming soon" until a stranger can install (AN8); only these mentions are allowed.
    assert 'Install · coming soon' in flat
    rest = flat
    for allowed in ('Install · coming soon', 'Install copies this prompt', 'Install OpenWiz from github.com/openwizdev/openwiz'):
        rest = rest.replace(allowed, '')
    assert not re.search(r'install|paid plans|works today', rest, re.I), 'unsettled landing claim or live install CTA'
    assert re.search(r'<button class="btn install"[^>]*aria-disabled="true"', landing), 'Install must stay disabled'
    assert not re.search(r'\b\d{4}-\d{2}-\d{2}\b', words), 'dated landing promise'
    changelog = (root / 'changelog/index.html').read_text()
    # The teaser shows only versions the changelog publishes.
    teaser = re.findall(r'<span class="v">(\d+\.\d+\.\d+)</span>', landing)
    assert teaser and all(f'>{v}<' in changelog for v in teaser), 'changelog teaser version not in the changelog'
    assert len(re.findall(r'(?<![\d.])\d+\.\d+\.\d+(?![\d.])', flat)) == len(teaser), 'version mentioned outside the changelog teaser'
    total = 0
    for name in ART:
        data = (root / name).read_bytes()
        check_webp(data)
        total += len(data)
    assert total <= ART_BUDGET, f'art is {total} bytes, over the {ART_BUDGET} budget'
    main = re.search(r'<main\b[^>]*>[\s\S]*?</main>', changelog)
    assert main and sha256(main[0].encode()).hexdigest() == CHANGELOG_MAIN, 'changelog content changed; review explicitly before updating its snapshot'


def check_privacy(path, data):
    # Font binaries contain author metadata; the fonts and legal attributions need review.
    # Every other tracked file must be UTF-8. Scan paths too; do not follow symlinks.
    font = path.removeprefix('dist/')
    if font in FONT_HASHES:
        assert sha256(data).hexdigest() == FONT_HASHES[font], 'unreviewed font or licence'
    if path.endswith('.woff2'):
        assert font in FONT_HASHES, 'unreviewed binary font'
    if path.endswith('.webp'):
        assert font.startswith('art/'), 'pictures belong in art/'
        check_webp(data)
    binary = path.endswith('.webp') or (font in FONT_HASHES and font.endswith('.woff2'))
    text = path + '\n' + ('' if binary else data.decode('utf-8'))
    # The documented rule definition must name its own markers. No other exemption.
    if path == 'scripts/check.py':
        text = re.sub(r'DENYLIST = \([^)]*\)', '', text)
    assert not any(marker in text.lower() for marker in DENYLIST), f'private marker in {path}'


def main():
    output = ROOT / 'dist'
    check_site(output)
    for name in RUNTIME:
        assert (ROOT / name).read_bytes() == (output / name).read_bytes(), f'export differs: {name}'
    paths = subprocess.check_output(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], cwd=ROOT).decode().split('\0')
    for name in set(paths) - {''}:
        path = ROOT / name
        assert not path.is_symlink(), f'symlink requires review: {name}'
        check_privacy(name, path.read_bytes())
    for name in RUNTIME:
        check_privacy('dist/' + name, (output / name).read_bytes())
    print('PASS: art is plain WebP with no metadata chunks, within budget')
    print('PASS: exact export, local links/fragments, CSS resources, fonts/licences, copy and privacy')
    print('GAP: automated browser tests (layout, keyboard, accessibility and animation) are not installed')
    print('LIMIT: external URL destinations are constrained; remote availability is not checked')


if __name__ == '__main__':
    main()

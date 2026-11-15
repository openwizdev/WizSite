"""Dependency-free checks for this site's literal HTML/CSS and public source."""
from hashlib import sha256
from html import unescape
from html.parser import HTMLParser
from pathlib import Path
import re
import subprocess
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
# Layered art: generated WebP pictures, pinned by hash like the fonts. A changed or new picture
# needs review (including its raw bytes for private markers) before its hash is updated here.
ART_HASHES = {
    'art/app.webp': 'ef856bb38e5b28e5128b991c0856b1b70ab387237a05b5673e473a76e888372f',
    'art/bay.webp': 'b27f9226e583591961b57409dcb8502139405e2aade4a2208bc705840a2ec075',
    'art/builder-carry.webp': '40ca2b80232d32fdbc5bc2167e3c0be94cdf9043e12b4d7fc9d3e9ea40be114e',
    'art/builder-hammer-down.webp': 'e96666e101dc52d9baa9b0e5191db74d2f88f8e63ced688c6420cb5866c71640',
    'art/builder-hammer-up.webp': '6418007e902d7715fcd6058d6dfce69953e1411adfbf9cbe7d446d195cb3cfd9',
    'art/builder-stand.webp': '8cb63b839e929b1e140ccbff6b540490e105be46b2e1952d9529ed8d2534772c',
    'art/citadel-dark.webp': '30b6739867202b7a7fcc7127831b37089f6fccc5ebf4ea9eef84c1e153510ccf',
    'art/citadel-lights.webp': '0536adc3168d80c859df1d68ee50fd79d3f3e04df34abf95a6e6d15fd44ced33',
    'art/decider.webp': 'c5fe96e1ac1fe73ba6533840a499eda28c49d102993f18b3d8fd0a3a73b2560e',
    'art/hall.webp': '81d0c27f1978ed88dd2901d8f03697cf7efb424d891ee38924b8676c6b85c495',
    'art/idea-card.webp': '695e9aefb47bdb69e320f59021d07c7bd1a290737f3fdafa66a088cb1001ca45',
    'art/item-1.webp': 'bb5c98a3f1bd87c5e5fbd8d0ea660b1b1a074d48e675fa88507c068cc5ea7f0c',
    'art/item-2.webp': '6adb85a0a5dcf50a47e2746e1cda49b07e5ea5261070147896c9eda5c47b8563',
    'art/item-3.webp': '3ee213fa10249c9f913690ee0532b0590cdde467c1b4d1d8c2adb28677cce41f',
    'art/moon.webp': '28d7a2d9b469025c138d4aec6d88a032969d928697013e1afa0e95fc68889c60',
    'art/reviewer-look.webp': '8ab45fd69d663c530ddc075db2b3a7e027535b85896702dc953e1de4d26b0a6a',
    'art/reviewer-stamp-down.webp': '5ae4a95e243ab6bc6585ccf9d17772b268aea19786375ac180747ff159dec94c',
    'art/reviewer-stamp-up.webp': 'e554ceb93b9f166a4894b02b292af40e8ff3da758f0089d43517e166eab24065',
    'art/seal.webp': '55ec8648490c5d72a592d7aa1271e80b9f954142cffb32f6e9b8fa0e03b60814',
}
ART = set(ART_HASHES)
ART_BUDGET = 2_000_000  # bytes, all art together
RUNTIME = {
    'index.html', 'changelog/index.html', 'tokens.css', 'landing.css', 'landing.js',
    'fonts/Geist-var.woff2', 'fonts/GeistMono-var.woff2', 'fonts/OFL.txt',
} | ART
# Owner copy rule (round 8): this word never appears anywhere on the site or in its source.
# Built from parts so this rule's own text does not contain it.
BANNED_COPY = ('play' 'book',)
# Generic private-context markers only; never copy personal literal lists here.
DENYLIST = ('closedwiz', '/users/', '/home/', 'private/evidence/',
            'docs/grills/', 'thr_', 'cr_sub_')
FONT_HASHES = {
    'fonts/Geist-var.woff2': '206f01ed08e05c98a51daa7472331c3c71bbb8c1f9d55ea8c70074f3c528a706',
    'fonts/GeistMono-var.woff2': '55419aa06f58adcd7f145c6c920e56936416f17e528f60efc6032ffa4269972b',
    'fonts/OFL.txt': 'c683bfbcc7e087f5d37a54ef628f10387c451a83ddc459b151403a164ac46c90',
}
PAGES = ('index.html', 'changelog/index.html')
# The ship log (RD5): release notes kept verbatim, regrouped as main line + Also changed, plus Being built.
CHANGELOG_MAIN = 'eeb7b4e3bf54baed31fd13a49e30aa31e568404a98d52e45f388fe5bc55f2107'


class Page(HTMLParser):
    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.ids = set()
        self.refs = []
        self.favicons = set()
        self.buttons = []
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if 'id' in attrs:
            assert attrs['id'] not in self.ids, 'duplicate HTML id'
            self.ids.add(attrs['id'])
        for key in ('href', 'src', 'poster'):
            if attrs.get(key):
                self.refs.append(attrs[key])
        if tag == 'button':
            self.buttons.append(attrs)
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


class Text(HTMLParser):
    """Decoded page text (outside script/style) and every attribute value."""
    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.parts, self.attrs, self.skip = [], [], 0
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self.skip += 1
        self.attrs += [v for _, v in attrs if v]

    def handle_endtag(self, tag):
        if tag in ('script', 'style') and self.skip:
            self.skip -= 1

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)

    def joined(self):
        return ''.join(self.parts)

    def spaced(self):
        return ' '.join(self.parts)


def check_ref(root, source, ref, pages, favicons=()):
    if ref.startswith('data:image/svg+xml,') and not favicons:
        # Inert inline CSS icons only: one stroked path, no other elements or attributes.
        svg = unquote(ref.split(',', 1)[1])
        assert re.fullmatch(r"<svg xmlns='http://www.w3.org/2000/svg' viewBox='[0-9 ]+'><path d='[A-Za-z0-9 .-]+' fill='none' stroke='#[0-9a-f]{6}' stroke-width='[0-9.]+'/></svg>", svg), 'unexpected inline SVG'
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
    def css_refs(text):
        # CSS escapes could hide or split a url(); none are used, so refuse them all, then require
        # that every url( is read whole.
        assert '\\' not in text, 'CSS escapes are not allowed'
        found = re.findall(r'url\(\s*([\'\"]?)(.*?)\1\s*\)', text, re.I | re.S)
        assert len(found) == len(re.findall(r'url\(', text, re.I)), 'unreadable url()'
        return [ref for _, ref in found]
    for path, page in pages.items():
        for ref in page.refs:
            check_ref(root, path, ref, pages, page.favicons)
        for ref in css_refs(path.read_text()):
            check_ref(root, path, ref, pages)
    for path in root.glob('*.css'):
        for ref in css_refs(path.read_text()):
            check_ref(root, path, ref, pages)
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
    flat = re.sub(r'\s+', ' ', unescape(re.sub(r'<[^>]*>', '', flat)))
    sub = re.search(r'<p class="sub">([\s\S]*?)</p>', landing)
    assert sub and re.sub(r'\s+', ' ', unescape(re.sub(r'<[^>]*>', ' ', sub[1]))).strip() == 'You make the decisions. The agents run the factory.', 'hero subline changed'
    assert 'You make the decisions. The agents run the factory.' in flat, 'hero subline changed'
    # Rendered text and attribute values (alt, title, meta), decoded, on both pages. Text is read both
    # joined (inline tags can split a word) and spaced; every attribute value is read on its own.
    for path in pages:
        reader = Text(path.read_text())
        readings = [reader.joined(), reader.spaced()] + reader.attrs
        for reading in readings:
            low = re.sub(r'\s+', ' ', reading).lower()
            assert not any(word in low for word in BANNED_COPY), f'banned word rendered in {path.name}'
            for text in ('illustration, not live data', 'building in public'):
                assert text not in low, f'cut copy is back in {path.name}: {text}'
    for text in ('Star on GitHub', 'Not ready for everyone yet.', 'Idea in. Shipped work out.', 'How it works',
                 'OpenWiz runs your factory.', 'WizSkills are the skills your agents follow.',
                 'WizPlugins put the controls in Cloudroom.',
                 'You decide what gets built. WizSkills tell the agents how. OpenWiz runs the line and shows you every step.',
                 'Ship log', 'Shipped', 'Being built'):
        assert text in flat, f'missing landing copy: {text}'
    # Owner cuts (round 6): obvious notes stay off the page.
    for text in ('Illustration, not live data', 'Building in public'):
        assert text.lower() not in flat.lower(), f'cut copy is back: {text}'
    # Install stays "coming soon" until a stranger can install (AN8); only these mentions are allowed.
    assert 'Install · coming soon' in flat
    rest = flat
    for allowed in ('Install · coming soon', 'Install will copy one prompt'):
        rest = rest.replace(allowed, '')
    assert not re.search(r'install|paid plans|works today', rest, re.I), 'unsettled landing claim or live install CTA'
    installs = [b for b in pages[root / 'index.html'].buttons if 'install' in (b.get('class') or '').split()]
    assert len(installs) == 1, 'exactly one Install button'
    assert 'disabled' in installs[0], 'Install must stay natively disabled'
    assert not any(k.startswith('on') or k in ('form', 'formaction') for k in installs[0]), 'Install must have no activation handler'
    scripts = (root / 'landing.js').read_text()
    assert not re.search(r'install|clipboard', scripts, re.I), 'no script may activate Install or copy the prompt yet'
    assert not re.search(r'\b\d{4}-\d{2}-\d{2}\b', words), 'dated landing promise'
    changelog = (root / 'changelog/index.html').read_text()
    # The teaser shows only versions the changelog publishes.
    teaser = re.findall(r'<span class="v">(\d+\.\d+\.\d+)</span><span>([^<]+)</span>', landing)
    # Each teaser line must match its own release in the ship log (version and headline together).
    releases = dict(re.findall(r'<article class="rel" id="v[\d.]+"><p class="when"><span class="v">([\d.]+)</span>[\s\S]*?<h3>([\s\S]*?)</h3>', changelog))
    assert teaser and all(releases.get(v) == h for v, h in teaser), 'ship log teaser line does not match its release'
    teaser = [v for v, _ in teaser]
    # "Being built" names bundles, never versions.
    being = re.search(r'<ul class="bundle-list">([\s\S]*?)</ul>', changelog)
    assert being and not re.search(r'\d+\.\d+', re.sub(r'<[^>]*>', '', being[1])), 'Being built must not name versions'
    assert len(re.findall(r'(?<![\d.])\d+\.\d+\.\d+(?![\d.])', flat)) == len(teaser), 'version mentioned outside the changelog teaser'
    total = 0
    for name in ART:
        data = (root / name).read_bytes()
        assert sha256(data).hexdigest() == ART_HASHES[name], f'unreviewed picture {name}; review before updating its hash'
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
        assert font in ART_HASHES and sha256(data).hexdigest() == ART_HASHES[font], 'unreviewed picture'
        check_webp(data)
        # Pictures are binary, but scan their raw bytes for the same markers (e.g. in metadata).
        assert not any(marker.encode() in data.lower() for marker in DENYLIST), f'private marker in {path}'
    binary = path.endswith('.webp') or (font in FONT_HASHES and font.endswith('.woff2'))
    text = path + '\n' + ('' if binary else data.decode('utf-8'))
    # The owner's copy rule covers every text file, this checker included (it builds the word from parts).
    assert not any(word in text.lower() for word in BANNED_COPY), f'banned word in {path}'
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

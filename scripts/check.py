"""Dependency-free checks for this site's literal HTML/CSS and public source."""
from hashlib import sha256
from html import unescape
from html.parser import HTMLParser
from pathlib import Path
import re
import subprocess
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
# The landing film's art: the approved round-3 era paintings, web-sized WebP, plus the cut-out layers for the
# small moves (hammer, stamp, rocket). Pinned by hash like the fonts. A changed or new picture
# needs review (including its raw bytes for private markers) before its hash is updated here.
ART_HASHES = {
    'art/era-1-cave.webp': 'd9c6bf6697489c0970b1aaf0897b4be0cb1c4c1208d8d6ffc0c421c74203d390',
    'art/era-2-grill.webp': 'efaf213c3f389c8feb2f9d0436e94b1f9241d0ecf3cc3e793385d34f11cd11dd',
    'art/era-3-forge.webp': 'ec01ffe4207f7b7ca25a56cbca91af898222647f64fd9b60e08654f732136b42',
    'art/era-4-mill.webp': 'd9974ea70daf8b7864097595ffd137bad22aafc5f6d2be57c6b5398cb6415b4d',
    'art/era-5-launch.webp': '62e17450559df808a658f6f3320e6da8914dd74974f77e7bbd08f6480dce61cb',
    'art/era-6-lanes.webp': 'c1534e99ffd4023132c4c331113f87bf61550b5eaabd82909618f9f850debb91',
    'art/era-7-rooms.webp': '71c2dba4da362472a9f1d07bbf1f206f08078c3222ddb87efce685f062d90476',
    'art/layer-hammer.webp': '963b036ae6ecb931b646134b2bf1b147778028100c5bafccd0d2f9e696f12c51',
    'art/layer-rocket.webp': '04297046455e108974d4a152b07dd77c39ab9d28a1fa9b8fef87d2c521dbef1f',
    'art/layer-stamp.webp': '306522a6cd5952f16e1fe34a2daec89e4861b20f3cc335f0ed6ad8790451d658',
}
ART = set(ART_HASHES)
# Logo pack. Raster icons and the social card are pinned by hash like the art; a new picture needs review.
ICON_HASHES = {
    'favicon.ico': '5dc6f058d467f927617e28c10c2764a01e4f1b6e8c1017111920153a9fdf7020',
    'apple-touch-icon.png': 'ff6e52cd499610049bbb6bf6289c77c99fe45ec667114ebcccab99266a9a09df',
    'brand/og.png': '8ff8e60f4653d4ed0eb7bf47b81a87810d9a25b002ff796a6268f3f655caf582',
}
# README pictures: kept in the source for GitHub only, never built or served. Pinned like the icons.
DOC_HASHES = {
    'docs/map.png': '19fc57ff3f588b36e2ca412f5656483eaf873718d0d19a39aceb83e007333e6b',
    'docs/map-phone.png': 'cdd21a74a880d3adab68ce794de1b18060d916d6df5d00ceb54eb06736cf3fd2',
}
# Vector logos: the wordmark is outlined (paths), so no font ships and nothing can fall back to another font.
VECTORS = ('favicon.svg', 'brand/openwiz-lockup.svg')
SITE_URL = 'https://openwiz.dev/'
ART_BUDGET = 2_000_000  # bytes, all art together
# Styles and scripts ship fingerprinted (name.<first 10 hex of sha256>.ext); the pages use only those names.
HASHED = ('tokens.css', 'site.css', 'site.js')


def fingerprint(name, data):
    return re.sub(r'\.(css|js)$', rf'.{sha256(data).hexdigest()[:10]}.\1', name)


def fingerprinted_page(html):
    for name, hashed in FINGERPRINTS.items():
        html = html.replace(f'"/{name}"', f'"/{hashed}"')
    return html


FINGERPRINTS = {name: fingerprint(name, (ROOT / name).read_bytes()) for name in HASHED}
STATIC = {
    'index.html', 'changelog/index.html', '_headers',
    'fonts/Geist-var.woff2', 'fonts/GeistMono-var.woff2', 'fonts/OFL.txt',
} | ART | set(ICON_HASHES) | set(VECTORS)
RUNTIME = STATIC | set(FINGERPRINTS.values())


def built_fingerprints(root):
    """The fingerprinted names actually in a build: exactly one per source file, each matching its content."""
    names = {}
    for name in HASHED:
        stem, ext = name.rsplit('.', 1)
        found = [p.name for p in root.glob(f'{stem}.*.{ext}') if re.fullmatch(rf'{re.escape(stem)}\.[0-9a-f]{{10}}\.{ext}', p.name)]
        assert len(found) == 1, f'expected one fingerprinted {name}, found {found}'
        assert fingerprint(name, (root / found[0]).read_bytes()) == found[0], f'fingerprint does not match content: {found[0]}'
        names[name] = found[0]
    return names
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
# The landing film (#1308, J185): the only words on the landing are the headline, the two buttons and one caption
# of six words or fewer per act; the film ends on the last act's caption. The old example idea must not come back.
HEADLINE = 'Bring your own everything.'
BUTTONS = ('Install · coming soon', 'Star on GitHub')
CAPTIONS = ('One idea, through all of history.', 'Your whole factory, across time.', 'This is your factory.')
CAPTION_WORDS = 6
OLD_EXAMPLE = ('dark mode', 'dark-mode')
# Motion runs only when the visitor has not asked for less: every animation, transition and smooth scroll
# sits inside this media query, so reduced motion shows the same story as still paintings.
MOTION_OK = '@media (prefers-reduced-motion:no-preference)'
# The animated layout (sticky zoom-out, hidden-until-scrolled hand-off, Pause motion) is switched on only by
# site.js itself, once its handlers are in place: no inline script may set it first, so a failed site.js
# download leaves the still story fully visible.
LIVE_CLASS = 'story-live'
# The ship log: the approved VS9 changelog text (What's new for you, tested line, Under the hood), plus Being built.
CHANGELOG_MAIN = '17830d3f9a837a3ec24f2382829093cc941e0d1f5fd873e45e4d3a44c6e897c2'


class Page(HTMLParser):
    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.ids = set()
        self.refs = []
        self.favicons = set()
        self.social = []
        self.buttons = []
        self.images = []
        self.inline_scripts = 0
        self.stylesheets, self.scripts = [], []
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
        if tag == 'img':
            self.images.append(attrs)
        if tag == 'script' and not attrs.get('src'):
            self.inline_scripts += 1
        # Only references the browser applies: an enabled stylesheet for all media, a script of a runnable type.
        if (tag == 'link' and attrs.get('rel') == 'stylesheet' and attrs.get('href') and 'disabled' not in attrs
                and attrs.get('media', 'all') in ('all', 'screen')):
            self.stylesheets.append(attrs['href'])
        if (tag == 'script' and attrs.get('src') and attrs.get('type', 'text/javascript') in ('text/javascript', 'module')
                and 'nomodule' not in attrs):
            self.scripts.append(attrs['src'])
        if tag == 'link' and attrs.get('rel') == 'icon':
            self.favicons.add(attrs.get('href'))
        if tag == 'meta' and (attrs.get('property') == 'og:image' or attrs.get('name') == 'twitter:image'):
            self.social.append(attrs.get('content') or '')


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
        self.parts, self.attrs, self.shown, self.skip = [], [], [], 0
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self.skip += 1
        self.attrs += [v for _, v in attrs if v]
        # Attribute values a person reads or hears (not ids, classes or URLs).
        self.shown += [v for k, v in attrs if v and k in ('alt', 'title', 'aria-label', 'placeholder', 'value', 'content')]

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


def motion_ok(prelude):
    """A media query that holds only for visitors who have not asked for less motion: MOTION_OK itself, or the
    same feature joined to others with "and" (#1298: the phone query). A comma ("or"), "or" or "not" fails."""
    if not prelude.startswith('@media '):
        return False
    query = prelude.removeprefix('@media ').lower()
    parts = [p.strip() for p in query.split(' and ')]
    return ('(prefers-reduced-motion:no-preference)' in parts and ',' not in query
            and not re.search(r'\b(not|or|only)\b', query))


def positive_time(value):
    """True unless every comma-separated time in a duration list is a literal zero ('0s, .2s' and var() count)."""
    return not all(re.fullmatch(r'[+-]?(0*\.?0+|0+\.0*)m?s', part.strip()) for part in value.split(','))


def check_motion(css):
    """Every animation, transition and smooth scroll is inside a motion_ok query (stopping one is always allowed).
    A positive transition-duration counts as a transition: the default transition-property is all (#1298)."""
    stack, at, found = [], 0, []
    for m in re.finditer(r'[{};]', css):
        chunk = css[at:m.start()]
        if m[0] == '{':
            stack.append(re.sub(r'\s+', ' ', re.sub(r'/\*[\s\S]*?\*/', '', chunk)).strip().replace(': ', ':'))
        else:
            decl = re.sub(r'/\*[\s\S]*?\*/', '', chunk).strip().lower()
            name, _, value = decl.partition(':')
            name, value = name.strip(), value.strip().removesuffix('!important').strip()
            moving = ((name in ('animation', 'animation-name', 'transition', 'transition-property') and value != 'none')
                      or (name == 'transition-duration' and positive_time(value))
                      or (name == 'scroll-behavior' and value == 'smooth'))
            if moving and not any(p.startswith('@keyframes') for p in stack) and not any(map(motion_ok, stack)):
                found.append(f'{" > ".join(stack)} {{{decl}}}')
            if m[0] == '}' and stack:
                stack.pop()
        at = m.end()
    assert not found, f'motion outside {MOTION_OK}: {found[:3]}'


class Words(HTMLParser):
    """Each run of rendered text (outside script/style), whitespace-collapsed; tags split runs."""
    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.runs, self.skip = [], 0
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        self.skip += tag in ('script', 'style')

    def handle_endtag(self, tag):
        if tag in ('script', 'style') and self.skip:
            self.skip -= 1

    def handle_data(self, data):
        run = re.sub(r'\s+', ' ', data).strip()
        if run and not self.skip:
            self.runs.append(run)


def check_landing_text(landing):
    """The landing's rendered words (inside <main>) are only the headline, the buttons and the act captions."""
    main = re.search(r'<main\b[^>]*>([\s\S]*)</main>', landing)
    assert main, 'landing has no <main>'
    runs = Words(main[1]).runs
    allowed = {HEADLINE, *BUTTONS, *CAPTIONS}
    extra = [run for run in runs if run not in allowed]
    assert not extra, f'words on the landing beyond the headline, buttons and captions: {extra[:3]}'
    for text in (HEADLINE, *BUTTONS):
        assert runs.count(text) == 1, f'missing or repeated landing text: {text}'
    for caption in CAPTIONS:
        assert len(caption.split()) <= CAPTION_WORDS, f'caption over {CAPTION_WORDS} words: {caption}'
        assert re.search(rf'<h2 id="act-\d">{re.escape(caption)}</h2>', main[1]), f'missing act caption: {caption}'
    # The film ends on the last act's caption, inside the hero.
    hero = re.search(r'<section class="hero[\s\S]*?</section>', main[1])
    assert hero and f'<p class="cap">{CAPTIONS[-1]}</p>' in hero[0], f'the film must end on "{CAPTIONS[-1]}"'


def check_vector(data):
    # A plain vector logo: shapes only. No live text or font (the wordmark font must never ship),
    # no script, no links or embedded images.
    svg = data.decode('utf-8').lower()
    assert svg.startswith('<svg xmlns="http://www.w3.org/2000/svg"'), 'unexpected logo SVG'
    for bad in ('<text', '<tspan', 'font', '@import', '<script', '<style', 'href', '<image', '<foreignobject'):
        assert bad not in svg, f'logo SVG must be outlined shapes only: {bad}'
    assert not re.search(r'\son[a-z]+\s*=', svg), 'logo SVG must have no event handlers'


def check_ref(root, source, ref, pages, favicons=()):
    if ref.startswith('data:image/svg+xml,') and not favicons:
        # Inert inline CSS icons only: one stroked path, no other elements or attributes.
        svg = unquote(ref.split(',', 1)[1])
        assert re.fullmatch(r"<svg xmlns='http://www.w3.org/2000/svg' viewBox='[0-9 ]+'><path d='[A-Za-z0-9 .-]+' fill='none' stroke='#[0-9a-f]{6}' stroke-width='[0-9.]+'/></svg>", svg), 'unexpected inline SVG'
        return
    if ref in favicons:
        # Only the reviewed logo-pack favicons (checked as local files below).
        assert ref in ('/favicon.ico', '/favicon.svg'), 'unexpected favicon'
    url = urlsplit(ref)
    if url.scheme or url.netloc:
        assert url.scheme == 'https' and url.netloc == 'github.com', 'unexpected external URL'
        assert re.match(r'^/openwizdev/(?:openwiz|OpenWiz|WizSkills|WizPlugins)(?:/|$)', url.path), 'unexpected repository link'
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
    names = built_fingerprints(root)
    assert files == STATIC | set(names.values()), 'unexpected or missing build output'
    pages = {root / f: Page((root / f).read_text()) for f in PAGES}
    for page in pages.values():
        # The pages never use an unfingerprinted name, and apply the fingerprinted styles as stylesheets.
        assert not set(page.refs) & {f'/{name}' for name in HASHED}, 'a page uses an unfingerprinted style or script'
        assert page.stylesheets == [f'/{names["tokens.css"]}', f'/{names["site.css"]}'], 'a page must apply exactly tokens.css then site.css'
    assert pages[root / 'index.html'].scripts == [f'/{names["site.js"]}'], 'the landing page must load the fingerprinted site.js'
    def css_refs(text):
        # CSS escapes could hide or split a url(); none are used, so refuse them all, then require
        # that every url( is read whole.
        assert '\\' not in text, 'CSS escapes are not allowed'
        found = re.findall(r'url\(\s*([\'\"]?)(.*?)\1\s*\)', text, re.I | re.S)
        assert len(found) == len(re.findall(r'url\(', text, re.I)), 'unreadable url()'
        return [ref for _, ref in found]
    for path, page in pages.items():
        # The social card: an absolute URL on the site that resolves to a built file.
        assert page.social and all(s.startswith(SITE_URL) and s.removeprefix(SITE_URL) in STATIC for s in page.social), 'social image must be a built file on the site'
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
    # Styles and scripts must revalidate like the HTML (Cloudflare Pages caches them 4 h by default).
    headers = (root / '_headers').read_text()
    for kind in ('css', 'js'):
        assert re.search(rf'^/\*\.{kind}\n  Cache-Control: public, max-age=0, must-revalidate$', headers, re.M), f'_headers must revalidate .{kind}'
    landing = (root / 'index.html').read_text()
    words = re.sub(r'<[^>]*>', '', landing)
    headline = re.sub(r'<[^>]*>', '', re.search(r'<h1\b[^>]*>([\s\S]*?)</h1>', landing)[1].replace('<br>', ' '))
    assert headline == 'Bring your own everything.', 'hero headline changed'
    flat = re.sub(r'\s+', ' ', re.sub(r'<br>', ' ', landing))
    flat = re.sub(r'\s+', ' ', unescape(re.sub(r'<[^>]*>', '', flat)))
    check_landing_text(landing)
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
    # Owner cuts (round 6): obvious notes stay off the page.
    for text in ('Illustration, not live data', 'Building in public'):
        assert text.lower() not in flat.lower(), f'cut copy is back: {text}'
    for reading in [Text(landing).spaced()] + Text(landing).shown:
        assert not any(old in reading.lower() for old in OLD_EXAMPLE), 'the old example idea is back on the landing'
    # Every era painting says what it shows; only the small-move layers and the board's thumbnails are decorative.
    for attrs in pages[root / 'index.html'].images:
        if re.match(r'/art/era-', attrs.get('src') or '') and 'card' not in (attrs.get('class') or '').split():
            assert (attrs.get('alt') or '').strip(), f'painting without a description: {attrs.get("src")}'
    check_motion((root / names['site.css']).read_text())
    assert not pages[root / 'index.html'].inline_scripts, 'an inline script runs before site.js; only site.js may enable the animated story'
    assert f"classList.add('{LIVE_CLASS}')" in (root / names['site.js']).read_text(), f'site.js must enable the animated story ({LIVE_CLASS})'
    # Install stays "coming soon" until a stranger can install (AN8); only these mentions are allowed.
    # The one allowed mention is the disabled Install button's own label; any other "install" anywhere in the
    # rendered page (an extra link with the same words included) fails.
    button = re.findall(r'<button class="btn install"[^>]*>([\s\S]*?)</button>', landing)
    assert len(button) == 1 and re.sub(r'\s+', ' ', unescape(re.sub(r'<[^>]*>', '', button[0]))).strip() == 'Install · coming soon', 'Install button must read Install · coming soon'
    rest = re.sub(r'<button class="btn install"[^>]*>[\s\S]*?</button>', ' ', landing, count=1)
    reader = Text(rest)
    for reading in [reader.joined(), reader.spaced()] + reader.shown:
        assert not re.search(r'install|paid plans|works today', re.sub(r'\s+', ' ', reading), re.I), 'unsettled landing claim or live install CTA'
    installs = [b for b in pages[root / 'index.html'].buttons if 'install' in (b.get('class') or '').split()]
    assert len(installs) == 1, 'exactly one Install button'
    assert 'disabled' in installs[0], 'Install must stay natively disabled'
    assert not any(k.startswith('on') or k in ('form', 'formaction') for k in installs[0]), 'Install must have no activation handler'
    scripts = (root / names['site.js']).read_text()
    assert not re.search(r'install|clipboard', scripts, re.I), 'no script may activate Install or copy the prompt yet'
    assert not re.search(r'\b\d{4}-\d{2}-\d{2}\b', words), 'dated landing promise'
    changelog = (root / 'changelog/index.html').read_text()
    # "Being built" names bundles, never versions.
    being = re.search(r'<ul class="bundle-list">([\s\S]*?)</ul>', changelog)
    assert being and not re.search(r'\d+\.\d+', re.sub(r'<[^>]*>', '', being[1])), 'Being built must not name versions'
    assert not re.search(r'(?<![\d.])\d+\.\d+\.\d+(?![\d.])', flat), 'version mentioned on the landing'
    for name in VECTORS:
        check_vector((root / name).read_bytes())
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
    if path.endswith(('.png', '.ico')):
        pinned = DOC_HASHES.get(path) or ICON_HASHES.get(font)
        assert pinned and sha256(data).hexdigest() == pinned, 'unreviewed picture'
        assert not any(marker.encode() in data.lower() for marker in DENYLIST), f'private marker in {path}'
    if font in VECTORS:
        check_vector(data)
    binary = path.endswith(('.webp', '.png', '.ico')) or (font in FONT_HASHES and font.endswith('.woff2'))
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
    for name in RUNTIME - set(FINGERPRINTS.values()) - set(PAGES):
        assert (ROOT / name).read_bytes() == (output / name).read_bytes(), f'export differs: {name}'
    assert built_fingerprints(output) == FINGERPRINTS, 'build is stale: rebuild the site'
    for name, hashed in FINGERPRINTS.items():
        assert (ROOT / name).read_bytes() == (output / hashed).read_bytes(), f'export differs: {name}'
    for name in PAGES:
        assert fingerprinted_page((ROOT / name).read_text()) == (output / name).read_text(), f'export differs: {name}'
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

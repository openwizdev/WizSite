"""Dependency-free checks for this site's literal HTML/CSS and public source."""
from hashlib import sha256
from html import unescape
from html.parser import HTMLParser
from pathlib import Path
import json
import re
import subprocess
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
# Reviewed artwork and the spec video. Pin them after checking the visual content and metadata.
ART_HASHES = {
    'art/era-2-grill.webp': 'efaf213c3f389c8feb2f9d0436e94b1f9241d0ecf3cc3e793385d34f11cd11dd',
    'art/family-01.webp': '14532efb522eb7129ced9e1093f4b0321b1f00459301f059f2d9b5a8c2a7161f',
    'art/family-02.webp': '0c64fa6a32853b694b7c2b09c2f8a2d296ca878c464b57ba9d0aae101aed81d2',
    'art/family-03.webp': 'f7aa428b6d3961c0e6530898cb1bfaf1c74c81d6f4b3f23a1eb888dca5c1b40c',
    'art/family-04.webp': '38eaba2fc285d05ae6c530724c63934b0c661a0912f8cf20e351d71db706bab4',
    'art/family-05.webp': '534d0b861f5f3407b4989b9f24b9a37cce1dac94531873068d7ef81f4a855224',
    'art/family-06.webp': '25fd341648787216c64f9f5052400a170cb351654a2f1f77ad614ff6e6cb48fd',
    'art/family-07.webp': '273be7e2be6dc67e7913967e6381451dd839d273855b778b2bc2b82177ff0a71',
    'art/family-08.webp': '89ec3bea0d430424239d5aefd52f94762e4d4e589e5a3bddd14f01e04d40522f',
    'art/family-09.webp': 'd65ee1ff0844408b4dec17ed96e6d5e631d874828406000d364f7a088b8b4f75',
    'art/family-10.webp': '9ae6ba5adc0cef5b7abd9007d99261a4e65cf130df5f175376f79fa53342e34f',
    'art/family-11.webp': '3a37702058088886b72330737dce7c45724eeb29ff15300cf682f1ac686b9327',
    'art/family-12.webp': '509d80e2a4f529771deaafb8e7524f55a4fa2086016559e76803054f6102aa18',
    'art/fleet-frames.webp': 'b83fc71f7a51651c91095802a655cd77fcda686285e3eabb6109644b16121fb8',
    'art/hero-astronaut-frames.webp': '41813d81fa385406cd022bbc76a483bcd565a2392ef9a3d4e74c50c607e8aeb1',
    'art/hero-cave-frames.webp': 'dde349b01d974b3101f2838b31d63a712b98483d3a050ce4494886fc1e483437',
    'art/hero-cave.webp': 'ec65d3561e29f0b12a54117023ea39371fb7aa1a975a05bf6b8480e65302e28e',
    'art/hero-renaissance-frames.webp': '04192a312129777ab9b4ee43ea632d04c6b725938b6feb7d134db4fcfdfd4cec',
    'art/hero-samurai-frames.webp': '3a6eef42bfd2fc6f7b8e847d4355d75c283425a274b5fb9c95c3404f580725c5',
    'art/hero-steam-frames.webp': '20f057c963be16ebc3cabbf1d2ab849e2e8144d29a3e419344a867eef2c41f3c',
    # The spec video (#1405): OpenWiz's own model config spec (#1802), narrated with captions; local voice, no paid service.
    'art/spec-video.mp4': 'feb357b9a80453d676123a31285a36c34b5873e102ed58c95728bfd6315bfe16',
    # The spec video's poster frame and captions (#1405), pinned with the video they belong to.
    'art/spec-poster.webp': '4922f6d265ed8c0c57dead86a62288c94d97159dda34f95969db0ee42b72fdc4',
    'art/spec-video.vtt': '570f5621ff3d84152587612d1be5d78ba5e0fbf6a7da306088a5897c755dc09d',
    # The drivers page, variant D (#50): the night sea and the Wiz family's ship, painted layers of its hero.
    'art/drivers-d-sea.webp': 'f2699bd8fe4763993a492dfac2bdbfc3eae46ec33bae0ab74127ad6ebc6a6285',
    'art/drivers-d-ship.webp': '885dd800aae2e75d45f2b88e1e69232bbf987df44beec9fa8070d4354b64cd04',
    # Round 2F (#56): variant C's painted cutaway of the Wiz crew's ship (#49), beside boat.dev's five checks.
    'art/drivers-c-boat.webp': '39fd43d08aa36bce84e964699d493a03af090499a63dffbfaa43e61804b7e1ef',
}
ART = set(ART_HASHES)
# Logo pack (#1350: the dark-cream mark). Raster icons and the social card are pinned by hash like the art; a new picture needs review.
ICON_HASHES = {
    'favicon.ico': '7b1652147d449f4003ce051d157fc9db68ae69d596b3b38f426be71efcca04b4',
    'apple-touch-icon.png': '86ba37a310f7640af172e1b64b5ac71c1f427f8a941f7c020c5040c19e4cc208',
    'brand/og.png': '4e976988aed9f9d5a37e4254165f6267aeb376d8749e05c0a280520c10df0c5a',
    # The app's own icons: the new mark, cream on charcoal (J194, #1326).
    'app/icon.ico': '33a21c61aa051f91475b46678bc0c4f537ab507273c088c4ed016d5ddce2b9cd',
    'app/icon-180.png': 'deb93ec39812c224c1470e2f1730f7f4ead7be3d27428a20a2a83284b77fbc2f',
}
# README pictures: kept in the source for GitHub only, never built or served. Pinned like the icons.
DOC_HASHES = {
    'docs/map.png': '19fc57ff3f588b36e2ca412f5656483eaf873718d0d19a39aceb83e007333e6b',
    'docs/map-phone.png': 'cdd21a74a880d3adab68ce794de1b18060d916d6df5d00ceb54eb06736cf3fd2',
}
# Vector logos: the wordmark is outlined (paths), so no font ships and nothing can fall back to another font.
VECTORS = ('favicon.svg', 'brand/openwiz-lockup.svg', 'app/mark.svg', 'app/icon.svg', 'app/wiz-reviewer.svg')
MARK, OLD_MARK = '#cfc6b8', '#2b2bff'  # the new mark's dark cream, and the earlier blue it replaced
SITE_URL = 'https://openwiz.dev/'
ART_BUDGET = 2_000_000  # bytes, all art together
# Styles and scripts ship fingerprinted (name.<first 10 hex of sha256>.ext); the pages use only those names.
GSAP = 'vendor/gsap-3.15.1.min.js'
VENDOR_HASHES = {
    'vendor/GSAP-LICENSE.txt': '791e7d34e6718aad2bd3e20fa5240a4c0e47d73ee3ca31424652cca52fe9acf0',
    'vendor/LOBE-ICONS-LICENSE.txt': 'add9d7531d1b21646317a8958e38fc727506fa39d24bdecb44154d943c82753a',
    'vendor/gsap-3.15.1.min.js': '3d1bea374ab1b703cc5c4105358eec63c4465efdc573931dc116e34a0a190c1b',
}

HASHED = ('tokens.css', 'site.css', GSAP, 'site.js')
# The app (openwiz.dev/app, #1258): its page, design system (Ember), data layer, page modules and shell.
# The page applies only ember.css and loads exactly these scripts, in this order, all fingerprinted.
APP_PAGE = 'app/index.html'
APP_STYLE = 'app/ember.css'
APP_SCRIPTS = ('app/data.js', 'app/ui.js', 'app/pages/you.js', 'app/pages/specs.js', 'app/pages/spec.js', 'app/pages/agents.js', 'app/palette.js', 'app/shell.js')
# Pinned npm files (package.json, exact versions): export name -> (its source after npm ci, the app script it loads before).
APP_VENDOR = {'app/vendor/dagre-3.1.3.min.js': ('node_modules/@dagrejs/dagre/dist/dagre.min.js', 'app/pages/spec.js'),
              'app/vendor/dagre-LICENSE.txt': ('node_modules/@dagrejs/dagre/LICENSE', None)}
HASHED += (APP_STYLE,) + APP_SCRIPTS
# The app may reach only this site and GitHub's API, with no inline script or style (P3).
APP_CSP = ("default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; "
           "connect-src 'self' https://api.github.com; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")


def fingerprint(name, data):
    return re.sub(r'\.(css|js)$', rf'.{sha256(data).hexdigest()[:10]}.\1', name)


def fingerprinted_page(html, cta=False):
    for name, hashed in FINGERPRINTS.items():
        html = html.replace(f'"/{name}"', f'"/{hashed}"')
    return with_cta(html) if cta else html


# The header's one buy button (#63): one snippet, which the build adds to every site page's top bar (not the app's).
CTA = (ROOT / 'header-cta.html').read_text()
CTA_LINK = '<a class="nav-team" href="/team/">'
TOP_BAR_END = '  </nav>\n</header>'
# The team page (openwiz.dev/team, #63) and its one booking link: the href of its one data-book link is the link's
# only value. Until the real link is set it is this in-page placeholder; otherwise it must be an https URL.
TEAM_PAGE = 'team/index.html'
BOOK_PLACEHOLDER = '#book'
TEAM_COPY = ('We set up your agent factory with you.', 'Your repos, your models, your machines. First fleet running in a day.',
             'Solo builders and small teams.', 'Custom pricing.', 'Book a call')


def with_cta(html):
    assert html.count(TOP_BAR_END) == 1, 'a site page needs exactly one top bar'
    return html.replace(TOP_BAR_END, CTA + TOP_BAR_END)


FINGERPRINTS = {name: fingerprint(name, (ROOT / name).read_bytes()) for name in HASHED}
STATIC = {
    'index.html', 'changelog/index.html', 'drivers/index.html', 'team/index.html', '_headers', APP_PAGE, 'app/manifest.webmanifest',
    'fonts/Geist-var.woff2', 'fonts/GeistMono-var.woff2', 'fonts/OFL.txt',
} | ART | set(ICON_HASHES) | set(VECTORS) | (set(VENDOR_HASHES) - {GSAP}) | set(APP_VENDOR)
RUNTIME = STATIC | set(FINGERPRINTS.values())


def built_fingerprints(root):
    """The fingerprinted names actually in a build: exactly one per source file, each matching its content."""
    names = {}
    for name in HASHED:
        stem, ext = name.rsplit('.', 1)
        found = [p.relative_to(root).as_posix() for p in root.glob(f'{stem}.*.{ext}')
                 if re.fullmatch(rf'{re.escape(stem)}\.[0-9a-f]{{10}}\.{ext}', p.relative_to(root).as_posix())]
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
PAGES = ('index.html', 'changelog/index.html', 'drivers/index.html', TEAM_PAGE)
ALL_PAGES = PAGES + (APP_PAGE,)
# The to-do example and both app entry points stay visible in the static landing page.
STORY_COPY = ('Build a to-do app', 'Bring any agent', 'Sign in with GitHub', 'Put the app on your phone')
OLD_EXAMPLE = ('dark mode', 'dark-mode')
MOTION_OK = '@media (prefers-reduced-motion:no-preference)'
PHONE_QUERY = re.compile(r'\(max-width:[0-9]+px\)')
# The Changelog (#1363): named Changelog everywhere; a small picture of how the repositories fit together opens
# the page, then one "What exists today" section with one part per public repository, each opening with two or
# three plain sentences. Private repositories appear at most as "private records and tools". No release entry,
# version number or date: the old release list stays on GitHub's releases. Its reviewed text is pinned below.
CHANGELOG_MAIN = 'a41401f686dd700c766358c47d89375a89f1faad74b668574d35cf5c0ac45567'
CHANGELOG_LINKS = ('/changelog/', '/changelog')
PUBLIC_REPOS = ('OpenWiz', 'WizSkills', 'WizLoops', 'WizPlugins', 'WizSite')
PUBLIC_WIZ_NAMES = set(PUBLIC_REPOS) | {'WizBar'}  # WizBar is WizPlugins' plugin, not a repository
TODAY = 'What exists today'
# The generated Releases section (#1364): build.mjs adds it last in the Changelog's main, between these markers, from
# each versioned repository's published release notes. The page's reviewed rules and pin apply without it; the
# section has its own rules (check_releases), one part per versioned repository, in this order.
RELEASES = ('<!-- releases:start -->', '<!-- releases:end -->')
RELEASE_REPOS = ('OpenWiz', 'WizSkills', 'WizLoops')
# The drivers page (openwiz.dev/drivers, #50): one card per driver, in this order, each with its status line (the
# ticket's facts, word for word), the driver's four words and its test-kit result on the kit's five checks.
DRIVERS_PAGE = 'drivers/index.html'
DRIVERS_LINKS = ('/drivers/', '/drivers')
DRIVERS = (
    ('vps', 'Your own computer or VPS', 'Being fixed: its kit run is in progress', 'in progress'),
    ('cloudroom', 'Cloudroom', 'Works today: built real pull requests for OpenWiz', 'not yet run'),
    ('boat-dev', 'boat.dev', 'Passed the kit, 5 of 5, on a real account (2026-11-19)', 'passed'),
    ('grok-bot', 'Grok Bot', 'Coming soon: listed when its driver lands', 'not yet run'),
)
DRIVER_HERO = 'boat-dev'
DRIVER_WORDS = ('version', 'start', 'wake', 'stop')
KIT_CHECKS = ('version', 'start', 'wake', 'stop', 'token')
KIT_STATES = ('passed', 'in progress', 'not yet run')
# Every number the page shows comes from these facts: four drivers and four words, boat.dev's 5 of 5 and its date,
# the one driver that passed, and the contract's v1.
DRIVER_NUMBERS = {'4', '5', '2026', '11', '19', '1'}
# Round 2F (#56): the evidence chips under the headline, and boat.dev's proof section after the cards: the kit's five
# checks, each with what passing it proved, in plain words from kernel/driver.v1.md section 3.
DRIVER_CHIPS = ('4 drivers', '4 words', '5 checks in the kit', '1 passed, 5 of 5')
PROOF_TITLE = 'boat.dev passed the kit, 5 of 5.'
PROOF_LINES = (
    ('version', 'It names the kernel\'s records version, and prints its schema unchanged.'),
    ('start', 'It answered a run id, and the agent\'s status note appeared on a throwaway ticket.'),
    ('wake', 'It reached the same run again: that note was edited, never a second one.'),
    ('stop', 'It ended the run: a wake after it was refused, and nothing the run started still runs.'),
    ('token', 'No credential showed in its output, command lines or environment, and it refused a token field.'),
)
# A driver that works but whose kit has not run says so plainly, so "works" and "not yet run" never read as a conflict.
DRIVER_KIT_NOTES = {'cloudroom': 'Kit: not run yet'}
# Final (#59): boat.dev's card keeps one kit line linking to its proof section, which alone lists the five checks.
DRIVER_KIT_PROOF = {'boat-dev': ('#boat-proof', 'Kit: passed, 5 of 5')}
DRIVER_HERO_MARK = '<p class="hero-score" aria-hidden="true"><b>5</b><span>of 5</span></p>'
DRIVER_LABEL_TRACKING = 0.06  # em: the least tracking on an uppercase drivers-page label
DRIVER_MIN_FONT = 12  # px: no drivers-page text smaller
OWN_DRIVER = 'Write your own driver'
OPENWIZ_REPO = 'https://github.com/openwizdev/OpenWiz'
DRIVER_DESCRIPTION = 'boat.dev passed 5 of 5'  # the page's meta description names the one driver that passed (#59 R2)
DRIVER_ART_BUDGET = 400_000  # bytes: the drivers page's own art (art/drivers-*.webp)


class Page(HTMLParser):
    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.ids = set()
        self.refs = []
        self.favicons = set()
        self.social = []
        self.buttons = []
        self.images = []
        self.videos = []
        self.tracks = []
        self.links = []
        self.inline_scripts = 0
        self.books = []
        self.stylesheets, self.scripts = [], []
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if 'id' in attrs:
            assert attrs['id'] not in self.ids, 'duplicate HTML id'
            self.ids.add(attrs['id'])
        if tag == 'a' and 'data-book' in attrs:
            # The booking link may leave the site: check_team checks it, on the team page only, instead of check_ref.
            # Only this element's href is exempt; check_site refuses a booking link on any other page.
            self.books.append(attrs.get('href') or '')
            attrs = {key: value for key, value in attrs.items() if key != 'href'}
        for key in ('href', 'src', 'poster'):
            if attrs.get(key):
                self.refs.append(attrs[key])
        if tag == 'button':
            self.buttons.append(attrs)
        if tag == 'img':
            self.images.append(attrs)
        if tag == 'video':
            self.videos.append(attrs)
        if tag == 'track':
            self.tracks.append(attrs)
        if tag == 'a':
            self.links.append(attrs)
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


def guards_motion(rule):
    if not rule.lower().startswith('@media '):
        return False
    conditions = re.split(r'\s+and\s+', rule[7:].lower())
    preference = MOTION_OK.removeprefix('@media ')
    return preference in conditions and all(
        condition == preference or PHONE_QUERY.fullmatch(condition) for condition in conditions)


def check_motion(css):
    """Every animation, transition and smooth scroll is inside MOTION_OK (stopping one is always allowed)."""
    stack, at, found = [], 0, []
    for m in re.finditer(r'[{};]', css):
        chunk = css[at:m.start()]
        if m[0] == '{':
            stack.append(re.sub(r'\s*:\s*', ':', re.sub(r'\s+', ' ', re.sub(r'/\*[\s\S]*?\*/', '', chunk)).strip()))
        else:
            decl = re.sub(r'/\*[\s\S]*?\*/', '', chunk).strip().lower()
            name, _, value = decl.partition(':')
            name, value = name.strip(), value.strip().removesuffix('!important').strip()
            moving = ((name in ('animation', 'animation-name', 'transition', 'transition-property') and value != 'none')
                      or (name == 'scroll-behavior' and value == 'smooth'))
            if name == 'transition-duration':
                moving = not all(re.fullmatch(r'[+-]?(?:0+(?:\.0+)?|\.0+)(?:ms|s)', item.strip())
                                 for item in value.split(','))
            if moving and not any(p.startswith('@keyframes') or guards_motion(p) for p in stack):
                found.append(f'{" > ".join(stack)} {{{decl}}}')
            if m[0] == '}' and stack:
                stack.pop()
        at = m.end()
    assert not found, f'motion outside {MOTION_OK}: {found[:3]}'


def check_vector(data):
    # A plain vector logo: shapes only. No live text or font (the wordmark font must never ship),
    # no script, no links or embedded images.
    svg = data.decode('utf-8').lower()
    assert svg.startswith('<svg xmlns="http://www.w3.org/2000/svg"'), 'unexpected logo SVG'
    for bad in ('<text', '<tspan', 'font', '@import', '<script', '<style', 'href', '<image', '<foreignobject'):
        assert bad not in svg, f'logo SVG must be outlined shapes only: {bad}'
    assert not re.search(r'\son[a-z]+\s*=', svg), 'logo SVG must have no event handlers'
    # #1350: the logo pack carries the new mark in dark cream, never the earlier blue one.
    assert MARK in svg and OLD_MARK not in svg, 'logo SVG must use the new mark (dark cream)'


def check_ref(root, source, ref, pages, favicons=()):
    if ref.startswith('data:image/svg+xml,') and not favicons:
        # Inert inline CSS icons only: one stroked path, no other elements or attributes.
        svg = unquote(ref.split(',', 1)[1])
        assert re.fullmatch(r"<svg xmlns='http://www.w3.org/2000/svg' viewBox='[0-9 ]+'><path d='[A-Za-z0-9 .-]+' fill='none' stroke='#[0-9a-f]{6}' stroke-width='[0-9.]+'/></svg>", svg), 'unexpected inline SVG'
        return
    if ref in favicons:
        # Only the reviewed logo-pack favicons (checked as local files below).
        assert ref in ('/favicon.ico', '/favicon.svg', '/app/icon.ico', '/app/icon.svg'), 'unexpected favicon'
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
    page = pages[root / 'index.html']
    assert page.scripts == [f'/{names[GSAP]}', f'/{names["site.js"]}'], 'load the pinned GSAP before site.js'
    assert not page.inline_scripts, 'landing motion must wait for both external scripts'
    assert len(page.videos) == 1, 'expected one spec recording'
    clip = page.videos[0]
    # The spec video (#1405) loads only when it first plays, and site.js starts it muted inline, never with sound;
    # its poster, default captions and a plain link to the video show without any script.
    assert clip.get('preload') == 'none' and 'autoplay' not in clip, 'spec recording must be opt-in'
    assert 'muted' in clip and 'playsinline' in clip, 'spec video must start muted inline'
    assert clip.get('poster', '').removeprefix('/') in ART, 'spec video needs a pinned poster'
    assert any(t.get('kind') == 'captions' and 'default' in t and t.get('src', '').removeprefix('/') in ART for t in page.tracks), 'spec video needs default captions'
    assert any(a.get('href') == clip.get('src') and 'hidden' not in a for a in page.links), 'needs a plain link to the spec video'
    for attrs in page.buttons:
        if attrs.get('class') in ('demo-pause', 'spec-play'):
            assert 'hidden' in attrs, 'motion controls must wait for both scripts'
    for name, digest in VENDOR_HASHES.items():
        data = (root / names.get(name, name)).read_bytes()
        assert sha256(data).hexdigest() == digest, f'unreviewed vendor file: {name}'
    def css_refs(text):
        # CSS escapes could hide or split a url(); none are used, so refuse them all, then require
        # that every url( is read whole.
        assert '\\' not in text, 'CSS escapes are not allowed'
        found = re.findall(r'url\(\s*([\'\"]?)(.*?)\1\s*\)', text, re.I | re.S)
        assert len(found) == len(re.findall(r'url\(', text, re.I)), 'unreadable url()'
        return [ref for _, ref in found]
    for path, page in pages.items():
        # The social card: an absolute URL on the site that resolves to a built file.
        assert page.social and all(s.startswith(SITE_URL) and s.removeprefix(SITE_URL).split('?')[0] in STATIC for s in page.social), 'social image must be a built file on the site'
        assert path == root / TEAM_PAGE or not page.books, f'a booking link outside the team page: {path.name}'
        for ref in page.refs:
            check_ref(root, path, ref, pages, page.favicons)
        for ref in css_refs(path.read_text()):
            check_ref(root, path, ref, pages)
    for path in root.glob('*.css'):
        for ref in css_refs(path.read_text()):
            check_ref(root, path, ref, pages)
    check_app(root, names, pages)
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
    headline = re.sub(r'<[^>]*>', '', re.search(r'<h1>([\s\S]*?)</h1>', landing)[1].replace('<br>', ' '))
    assert headline == 'Bring your own everything.', 'hero headline changed'
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
    # J203: the road is three moments with no approval; neither the hero nor its demo's steps name one.
    hero = re.search(r'<section class="product-hero[\s\S]*?(?=<section class="agent-row)', landing)
    assert hero, 'missing hero'
    hero_text = Text(hero[0])
    labels = re.findall(r"label: '([^']*)'", (root / names['site.js']).read_text())
    for reading in [hero_text.spaced()] + hero_text.shown + labels:
        assert not re.search(r'approv', reading, re.I), 'the hero names an approval step'
    moments = ('Answer a few questions', 'Watch your spec', 'Watch it ship')
    captions = re.findall(r'<h3>([^<]+)</h3>', landing)
    assert tuple(captions) == moments, 'the three moments must appear in order'
    assert 'Steer the build from the narrated video.' in flat, 'spec video steering copy is missing'
    assert "A real spec from OpenWiz's own factory" in flat, "the spec video must say it is a real spec from OpenWiz's own factory"
    # Owner cuts (round 6): obvious notes stay off the page.
    for text in ('Illustration, not live data', 'Building in public'):
        assert text.lower() not in flat.lower(), f'cut copy is back: {text}'
    for text in STORY_COPY:
        assert text in flat, f'missing landing story copy: {text}'
    for reading in [Text(landing).spaced()] + Text(landing).shown:
        assert not any(old in reading.lower() for old in OLD_EXAMPLE), 'the old example idea is back on the landing'
    # The hero painting has a description. The sprite cut-outs are decorative.
    for attrs in pages[root / 'index.html'].images:
        if attrs.get('src') == '/art/era-2-grill.webp':
            assert (attrs.get('alt') or '').strip(), f'painting without a description: {attrs.get("src")}'
    check_motion((root / names['site.css']).read_text())
    check_driver_css((root / names['site.css']).read_text())
    check_install(landing, pages[root / 'index.html'])
    assert not re.search(r'\b\d{4}-\d{2}-\d{2}\b', words), 'dated landing promise'
    changelog, releases = split_releases((root / 'changelog/index.html').read_text())
    assert not re.search(r'(?<![\d.])\d+\.\d+\.\d+(?![\d.])', flat), 'release version mentioned on the landing'
    for name in VECTORS:
        check_vector((root / name).read_bytes())
    total = 0
    for name in ART:
        data = (root / name).read_bytes()
        check_art(name, data)
        total += len(data)
    assert total <= ART_BUDGET, f'art is {total} bytes, over the {ART_BUDGET} budget'
    variant = sum(len((root / name).read_bytes()) for name in ART if name.startswith('art/drivers-'))
    assert variant <= DRIVER_ART_BUDGET, f'the drivers art is {variant} bytes, over its {DRIVER_ART_BUDGET} budget'
    drivers_art = {name for name in ART if name.startswith('art/drivers-')}
    unused = sorted(name for name in drivers_art if f'/{name}' not in (root / DRIVERS_PAGE).read_text())
    assert not unused, f'unused drivers art: {unused}'
    check_drivers(landing, changelog, (root / DRIVERS_PAGE).read_text(), pages[root / DRIVERS_PAGE])
    check_drivers_nav((root / names['site.css']).read_text(), {name: (root / name).read_text() for name in PAGES})
    check_changelog(landing, changelog)
    check_releases(releases)
    check_team({name: (root / name).read_text() for name in PAGES}, {name: pages[root / name] for name in PAGES})
    main = re.search(r'<main\b[^>]*>[\s\S]*?</main>', changelog)
    assert main and sha256(main[0].encode()).hexdigest() == CHANGELOG_MAIN, 'changelog content changed; review explicitly before updating its snapshot'


class Outline(HTMLParser):
    """A page's links with their text, its title, its inline styles, and the outline of its main: the headings,
    the picture, the parts and each part's opening paragraph, in order."""
    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.links, self.items, self.styles, self.title = [], [], [], None
        self.open = []  # [kind, attrs, text] being read
        self.in_main = False
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        classes = (attrs.get('class') or '').split()
        if tag == 'main':
            self.in_main = True
        kind = None
        if tag == 'a' and attrs.get('href'):
            kind = 'a'
        elif tag in ('title', 'style'):
            kind = tag
        elif self.in_main and tag in ('h1', 'h2', 'h3'):
            kind = tag
        elif self.in_main and tag == 'p' and 'intro' in classes:
            kind = 'intro'
        elif self.in_main and tag == 'figure':
            self.items.append(('figure', attrs, ''))
        elif self.in_main and tag == 'svg':
            self.items.append(('svg', attrs, ''))
        elif self.in_main and tag == 'section' and 'part' in classes:
            self.items.append(('part', attrs, ''))
        if kind:
            self.open.append([kind, attrs, ''])

    def handle_data(self, data):
        for item in self.open:
            item[2] += data

    def handle_endtag(self, tag):
        if tag == 'main':
            self.in_main = False
        want = {'a': 'a', 'title': 'title', 'style': 'style', 'h1': 'h1', 'h2': 'h2', 'h3': 'h3', 'p': 'intro'}.get(tag)
        if want and self.open and self.open[-1][0] == want:
            kind, attrs, text = self.open.pop()
            text = re.sub(r'\s+', ' ', text).strip()
            if kind == 'a':
                self.links.append((attrs['href'], text))
            elif kind == 'title':
                self.title = text
            elif kind == 'style':
                self.styles.append(text)
            else:
                self.items.append((kind, attrs, text))


def sentences(text):
    return [s for s in re.split(r'(?<=[.!?])\s+', text.strip()) if s]


# The install box (#1357, under AN8). The line is the install skill's own, word for word (WizSkills' install skill,
# "The user pasted one line into their agent"). Until OpenWiz 0.1.0 is released the box's switch reads coming-soon;
# the release changes only that switch to live. Either way the button ships natively disabled, labelled coming soon,
# with no handler: site.js enables it only when the switch reads live (npm run test:app checks both in a browser).
INSTALL_LINE = 'Install OpenWiz from github.com/openwizdev/OpenWiz'
INSTALL_HINT = 'Paste this into your agent'
INSTALL_BUTTON = 'Copy · coming soon'
INSTALL_SWITCH = ('coming-soon', 'live')


def check_install(landing, page):
    flat = lambda html: re.sub(r'\s+', ' ', unescape(re.sub(r'<[^>]*>', '', html))).strip()
    boxes = re.findall(r'<div class="install-box"([^>]*)>([\s\S]*?)</div>\s*</div>', landing)
    assert len(boxes) == 1, 'exactly one install box'
    attrs, box = boxes[0]
    switch = re.fullmatch(r'\s*data-install="([^"]*)"\s*', attrs)
    assert switch and switch[1] in INSTALL_SWITCH, f'the install box needs its one switch, data-install = {" or ".join(INSTALL_SWITCH)}'
    lines = re.findall(r'<code class="install-line">([^<]*)</code>', box)
    assert lines == [INSTALL_LINE], f'the install line must read exactly: {INSTALL_LINE}'
    hints = re.findall(r'<p class="install-hint">([\s\S]*?)</p>', box)
    assert [flat(h) for h in hints] == [INSTALL_HINT], f'the install box must say: {INSTALL_HINT}'
    labels = re.findall(r'<button class="btn install"[^>]*>([\s\S]*?)</button>', landing)
    assert len(labels) == 1 and flat(labels[0]) == INSTALL_BUTTON, f'the install button must read {INSTALL_BUTTON}'
    installs = [b for b in page.buttons if 'install' in (b.get('class') or '').split()]
    assert len(installs) == 1, 'exactly one install button'
    assert 'disabled' in installs[0], 'the install button must ship natively disabled'
    assert not any(k.startswith('on') or k in ('form', 'formaction') for k in installs[0]), 'the install button must have no activation handler'
    # Outside the box, no install wording or unsettled claim, in any reading of the page.
    rest = landing.replace(box, ' ', 1)
    reader = Text(rest)
    for reading in [reader.joined(), reader.spaced()] + reader.shown:
        assert not re.search(r'install|coming soon|paid plans|works today', re.sub(r'\s+', ' ', reading), re.I), 'unsettled landing claim or a second install mention'


def check_changelog(landing, changelog):
    """The Changelog's name, its picture first, one What exists today with a part per public repository, and no
    release history. `landing` and `changelog` are the two pages' HTML."""
    home = Outline(landing)
    labels = [text for href, text in home.links if href in CHANGELOG_LINKS]
    assert labels == ['Changelog', 'Changelog'], f'the landing nav and footer must each link the Changelog: {labels}'
    assert not home.styles, 'the landing page gets no inline styles; the changelog keeps its own'
    for page in (landing, changelog):
        reader = Text(page)
        for reading in [reader.joined(), reader.spaced()] + reader.attrs:
            assert not re.search(r'ship\s*log', reading, re.I), 'the page is called Changelog, never ship log'
    page = Outline(changelog)
    assert page.title == 'Changelog — OpenWiz', 'the changelog page title must be Changelog'
    items = page.items
    kinds = [kind for kind, _, _ in items]
    assert kinds[:1] == ['h1'] and items[0][2] == 'Changelog', 'the changelog heading must be Changelog'
    today = [i for i, (kind, _, text) in enumerate(items) if kind == 'h2' and text == TODAY]
    assert len(today) == 1 and kinds.count('h2') == 1, f'exactly one {TODAY} section'
    figures = [i for i, kind in enumerate(kinds) if kind == 'figure']
    # Right after the heading (and its lead, which the outline doesn't list), before anything else.
    assert figures == [1] and today[0] > 1 and 'repo-map' in (items[1][1].get('class') or '').split(), 'the repository picture opens the page, before What exists today'
    svg = [attrs for kind, attrs, _ in items if kind == 'svg']
    assert len(svg) == 1 and svg[0].get('role') == 'img' and (svg[0].get('aria-label') or '').strip(), 'the picture is one labelled SVG'
    parts = [i for i, kind in enumerate(kinds) if kind == 'part']
    assert parts and parts[0] > today[0], 'the repository parts sit inside What exists today'
    names = []
    for at, end in zip(parts, parts[1:] + [len(items)]):
        body = items[at + 1:end]
        assert [k for k, _, _ in body[:2]] == ['h3', 'intro'], 'each part opens with its repository heading, then its plain lines'
        name = body[0][2].split()[0] if body[0][2] else ''
        assert name in PUBLIC_REPOS, f'a part names a repository that is not public: {name!r}'
        count = len(sentences(body[1][2]))
        assert 2 <= count <= 3, f'{name} opens with {count} sentences, not two or three'
        names.append(name)
    assert sorted(names) == sorted(PUBLIC_REPOS), f'one part per public repository: {names}'
    main = re.search(r'<main\b[^>]*>([\s\S]*?)</main>', changelog)[1]
    reader = Text(main)
    readings = [reader.joined(), reader.spaced()] + reader.attrs
    for reading in readings:
        # Fail closed: every Wiz name is a public one. Text read joined can run a name into the next name or
        # into a lowercase word, never into a capital: "WizSkillsthe" passes, "WizVault" and "WizSiteOps" fail.
        public = '(?:' + '|'.join(sorted(PUBLIC_WIZ_NAMES)) + ')+(?:[a-z][A-Za-z]*)?'
        for name in re.findall(r'\bWiz[A-Z][A-Za-z]*', reading):
            assert re.fullmatch(public, name), f'a private repository is named; say "private records and tools": {name}'
        assert not re.search(r'\d+\.\d+|\b(?:19|20)\d\d\b', reading), 'no version number or date on the changelog'
    assert not re.search(r'<time\b|releases/tag/|class="rel"', main), 'no release entry on the changelog'
    for style in page.styles:
        check_motion(style)


class DriverOutline(HTMLParser):
    """The drivers page's cards: each card's id, classes, name, status line, words and kit checks with their states,
    and every link inside the Write your own driver section."""
    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.cards, self.own_links, self.own_heading = [], [], None
        self.field, self.depth, self.own_depth = None, 0, None
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        classes = (attrs.get('class') or '').split()
        if tag not in ('br', 'img', 'meta', 'link', 'path', 'circle', 'rect', 'input'):
            self.depth += 1
        if tag == 'section' and 'own-driver' in classes:
            self.own_depth = self.depth
        if self.own_depth and tag == 'a':
            self.own_links.append(attrs.get('href'))
        if self.own_depth and tag == 'h2':
            self.field = ['own-heading', '']
        if tag == 'article' and 'driver' in classes:
            self.cards.append({'id': attrs.get('id'), 'classes': classes, 'name': '', 'line': '', 'note': None, 'words': [], 'checks': [], 'proof': None})
        elif self.cards and tag == 'a' and 'kit-proof' in classes:
            self.cards[-1]['proof'] = [attrs.get('href'), '']
            self.field = ['proof', '']
        elif self.cards and tag == 'h3' and 'driver-name' in classes:
            self.field = ['name', '']
        elif self.cards and tag == 'p' and 'driver-line' in classes:
            self.field = ['line', '']
        elif self.cards and tag == 'p' and 'driver-kit-note' in classes:
            self.field = ['note', '']
        elif self.cards and tag == 'code' and 'word' in classes:
            self.field = ['word', '']
        elif self.cards and tag == 'li' and 'kit-check' in classes:
            self.cards[-1]['checks'].append([attrs.get('data-check'), attrs.get('data-state'), ''])
            self.field = ['check', '']

    def handle_data(self, data):
        if self.field:
            self.field[1] += data

    def handle_endtag(self, tag):
        if self.field and tag in ('h2', 'h3', 'p', 'code', 'li', 'a'):
            kind, text = self.field
            text = re.sub(r'\s+', ' ', text).strip()
            if kind == 'own-heading':
                self.own_heading = text
            elif kind == 'word':
                self.cards[-1]['words'].append(text)
            elif kind == 'check':
                self.cards[-1]['checks'][-1][2] = text
            elif kind == 'proof':
                self.cards[-1]['proof'][1] = text
            else:
                self.cards[-1][kind] = text
            self.field = None
        if tag == 'section' and self.own_depth == self.depth:
            self.own_depth = None
        self.depth -= 1


def top_bar(html):
    found = re.findall(r'<header class="landing-nav wrap">[\s\S]*?</header>', html)
    assert len(found) == 1, 'a page needs exactly one landing top bar'
    return found[0]


def check_drivers(landing, changelog, drivers, page):
    """The drivers page (#50): the landing's exact top bar with Drivers current, the four driver cards in order with
    their exact facts, words and kit results, boat.dev the hero, the Write your own driver section linking only the
    public OpenWiz repository, no script, and no number beyond its facts. A Drivers nav link on the other pages."""
    bar = top_bar(drivers)
    current = re.findall(r'<a [^>]*aria-current="page"[^>]*>([^<]*)</a>', bar)
    assert current == ['Drivers'] and re.search(r'<a class="nav-drivers" href="/drivers/" aria-current="page">Drivers</a>', bar), \
        'the drivers top bar must mark its Drivers link aria-current="page"'
    assert bar.replace(' aria-current="page"', '') == top_bar(landing), 'the drivers top bar must be identical to the landing\'s'
    for name, html in (('landing', landing), ('Changelog', changelog)):
        links = [text for href, text in Outline(top_bar(html)).links if href in DRIVERS_LINKS]
        assert links == ['Drivers'], f'the {name} top bar needs one Drivers nav link: {links}'
    assert re.search(r'<body class="[^"]*\bdrivers-page\b', drivers), 'the drivers page body is scoped .drivers-page'
    description = re.findall(r'<meta name="description" content="([^"]*)"', drivers)
    assert len(description) == 1 and DRIVER_DESCRIPTION in description[0], \
        f'the drivers description must say {DRIVER_DESCRIPTION}: {description}'
    assert not re.search(r'\b(each|every|all)\b[^.]*\bpass', description[0], re.I), \
        f'the drivers description must not say every driver passes: {description[0]}'
    assert not page.scripts and not page.inline_scripts, 'the drivers page reads completely without scripts'
    main = re.search(r'<main\b[^>]*>[\s\S]*?</main>', drivers)
    assert main, 'the drivers page needs its main'
    assert not re.search(r'\shidden\b', main[0]), 'nothing on the drivers page waits for a script to show'
    outline = DriverOutline(main[0])
    assert [(c['id'], c['name']) for c in outline.cards] == [(d[0], d[1]) for d in DRIVERS], \
        f'four driver cards, in order: {[(c["id"], c["name"]) for c in outline.cards]}'
    for card, (key, name, line, state) in zip(outline.cards, DRIVERS):
        assert card['line'] == line, f'{name}: the driver facts must read exactly: {line}'
        assert card['words'] == list(DRIVER_WORDS), f'{name}: the four words, in order: {card["words"]}'
        checks = [(c, s) for c, s, _ in card['checks']]
        if key in DRIVER_KIT_PROOF:
            href, said = DRIVER_KIT_PROOF[key]
            assert not checks, f'{name}: its five checks appear only in the proof section, never again on its card: {checks}'
            assert card['proof'] and card['proof'][0] == href, f'{name}: its kit line links to the proof section {href}: {card["proof"]}'
            assert card['proof'][1] == said, f'{name}: its one kit line reads {said!r}: {card["proof"][1]!r}'
        else:
            assert card['proof'] is None, f'{name}: only boat.dev links to a proof section'
            assert checks == [(check, state) for check in KIT_CHECKS], f'{name}: kit result must be {state} on the five checks: {checks}'
        for check, state_, text in card['checks']:
            assert text == f'{check} {state_}', f'{name}: each kit check says its state in words: {text!r}'
        hero = 'hero' in card['classes']
        assert hero == (key == DRIVER_HERO), f'boat.dev is the hero card, and only it: {name}'
        assert card['note'] == DRIVER_KIT_NOTES.get(key), f'{name}: its kit note must read {DRIVER_KIT_NOTES.get(key)!r}: {card["note"]!r}'
    hero_card = re.search(r'<article class="driver hero"[\s\S]*?</article>', main[0])
    assert hero_card and DRIVER_HERO_MARK in hero_card[0], 'boat.dev keeps its 5 of 5 mark on its card'
    check_driver_proof(main[0])
    reader = Text(main[0])
    for reading in [reader.joined(), reader.spaced()] + reader.shown:
        for number in re.findall(r'\d+', reading):
            assert number in DRIVER_NUMBERS, f'invented number on the drivers page: {number}'
    assert outline.own_heading == OWN_DRIVER, f'the drivers page needs its {OWN_DRIVER} section'
    assert outline.own_links and OPENWIZ_REPO in outline.own_links and all(
        href == OPENWIZ_REPO or href.startswith(OPENWIZ_REPO + '/') for href in outline.own_links), \
        f'{OWN_DRIVER} links only to the public OpenWiz repository: {outline.own_links}'
    assert not Outline(drivers).styles, 'the drivers page keeps its styles in site.css'


def plain(html):
    return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', html)).strip()


def check_driver_proof(main):
    """Round 2F (#56): the evidence chips under the headline; after the four cards, boat.dev's full-width proof section
    with the kit's five checks in order, each passed with its plain line; and no picture shown twice."""
    chips = re.findall(r'<ul class="drivers-chips"[^>]*>([\s\S]*?)</ul>', main)
    assert len(chips) == 1 and main.index('drivers-chips') < main.index('class="fleet'), \
        'the drivers page needs its evidence chips under the headline'
    found = tuple(plain(li) for li in re.findall(r'<li\b[^>]*>([\s\S]*?)</li>', chips[0]))
    assert found == DRIVER_CHIPS, f'the evidence chips must read {DRIVER_CHIPS}: {found}'
    proof = re.findall(r'<section class="boat-proof[^"]*"[\s\S]*?</section>', main)
    assert len(proof) == 1, 'the drivers page needs one boat.dev proof section'
    proof = proof[0]
    assert main.index('class="boat-proof') > main.rindex('<article class="driver'), 'the boat.dev proof section follows the four cards'
    assert main.index('class="boat-proof') < main.index('class="own-driver'), 'the boat.dev proof section comes before Write your own driver'
    title = re.findall(r'<h2\b[^>]*>([\s\S]*?)</h2>', proof)
    assert [plain(t) for t in title] == [PROOF_TITLE], f'the proof section is titled {PROOF_TITLE!r}: {title}'
    rows = re.findall(r'<li class="proof-check" data-check="([^"]*)" data-state="([^"]*)">([\s\S]*?)</li>', proof)
    assert [(c, s) for c, s, _ in rows] == [(c, 'passed') for c, _ in PROOF_LINES], \
        f'the proof lists the kit\'s five checks in order, each passed: {[(c, s) for c, s, _ in rows]}'
    for (check, _, body), (_, line) in zip(rows, PROOF_LINES):
        name = re.findall(r'<code class="proof-name">([^<]*)</code>', body)
        said = re.findall(r'<span class="proof-line">([\s\S]*?)</span>', body)
        state = re.findall(r'<span class="proof-state">([^<]*)</span>', body)
        assert name == [check] and [plain(s) for s in said] == [line] and state == ['passed'], \
            f'{check}: the proof row names the check, says passed in words and explains what it proved: {line!r}'
    assert re.search(r'<img class="proof-art" src="/art/drivers-[^"]+" alt="[^"]+"', proof), 'the proof section shows a painting of the crew'
    images = re.findall(r'<img\b[^>]*\bsrc="([^"]+)"', main)
    twice = sorted({src for src in images if images.count(src) > 1})
    assert not twice, f'a picture shown twice on the drivers page: {twice}'


def check_team(htmls, pages):
    """#63: every site page's top bar has the one buy button to /team/; the team page has its copy, no price, and the
    site's one booking link: the placeholder (an id on the page) or an https URL with no credentials."""
    for name, html in htmls.items():
        bar = top_bar(html)
        assert bar.count('class="nav-team"') == 1 and bar.count(CTA_LINK) == 1, f'the {name} top bar needs its one buy button to /team/'
        assert html.count('class="nav-team"') == 1, f'the {name} page needs exactly one buy button'
    books = [(name, href) for name, page in pages.items() for href in page.books]
    assert len(books) == 1 and books[0][0] == TEAM_PAGE, f'the site needs exactly one booking link, on the team page: {books}'
    href = books[0][1]
    if href == BOOK_PLACEHOLDER:
        assert 'book' in pages[TEAM_PAGE].ids, 'the booking placeholder needs its id on the team page'
    else:
        url = urlsplit(href)
        assert url.scheme == 'https' and url.netloc and not url.username and not url.password, f'the booking link must be https: {href}'
    flat = re.sub(r'\s+', ' ', unescape(re.sub(r'<[^>]*>', ' ', htmls[TEAM_PAGE])))
    for text in TEAM_COPY:
        assert text in flat, f'missing team page copy: {text}'
    assert not re.search(r'[$€£]\s*\d|\bper (?:month|seat|user)\b', flat, re.I), 'the team page shows no price'


def check_drivers_nav(css, pages):
    """#59 R1: every page's one Drivers nav link stays shown at every width: none of its classes is hidden by a
    display: none rule inside a media query, so the phone header keeps it visible and focusable."""
    hidden = set()
    for block in re.findall(r'@media[^{]*\{((?:[^{}]*\{[^{}]*\})*)[^{}]*\}', css):
        for selectors, body in re.findall(r'([^{}]+)\{([^{}]*)\}', block):
            if re.search(r'display\s*:\s*none', body):
                for selector in selectors.split(','):
                    hidden.update(re.findall(r'\.([\w-]+)', selector.strip().split()[-1]))
    for name, html in pages.items():
        found = re.findall(r'<a ([^>]*)href="/drivers/"[^>]*>Drivers</a>', top_bar(html))
        assert len(found) == 1, f'the {name} top bar needs one Drivers nav link'
        classes = set((re.search(r'class="([^"]*)"', found[0]) or [None, ''])[1].split())
        assert not classes & hidden, f'the {name} Drivers nav link is hidden on phones by {sorted(classes & hidden)}'


def check_driver_css(css):
    """Round 2F (#56): no drivers-page text under DRIVER_MIN_FONT px."""
    for rule in re.findall(r'[^{}]*\.drivers-page[^{}]*\{[^{}]*\}', css):
        for size in re.findall(r'font(?:-size)?\s*:[^;}]*?(\d+(?:\.\d+)?)px', rule):
            assert float(size) >= DRIVER_MIN_FONT, f'drivers-page text under {DRIVER_MIN_FONT}px: {rule.strip()[:120]}'
        # Final (#59): an uppercase label (its own rule, or a heading's that inherits it) is tracked at least .06em.
        selector = rule.split('{')[0]
        if re.search(r'text-transform\s*:\s*uppercase', rule) or re.search(r'\bh4\b', selector):
            tracking = re.findall(r'letter-spacing\s*:\s*(-?\d*\.?\d+)em', rule)
            if re.search(r'text-transform\s*:\s*uppercase', rule):
                assert tracking, f'an uppercase drivers-page label needs its tracking: {rule.strip()[:120]}'
            for value in tracking:
                assert float(value) >= DRIVER_LABEL_TRACKING, f'an uppercase drivers-page label needs tracking of {DRIVER_LABEL_TRACKING}em or more: {rule.strip()[:120]}'


def split_releases(built):
    """A built Changelog as (the page without its generated section, the section): exactly one, last in main."""
    start, end = RELEASES
    assert built.count(start) == 1 and built.count(end) == 1, 'the built Changelog has one generated Releases section'
    before, rest = built.split(start)
    section, after = rest.split(end)
    assert after.startswith('</main>'), 'the generated Releases section closes the Changelog\'s main'
    return before + after, section


class ReleaseOutline(HTMLParser):
    """The generated section's tags, heading, and each part's repository, entry titles and state."""
    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.tags, self.h2, self.parts, self.reading = [], [], [], None
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        classes = (attrs.get('class') or '').split()
        self.tags.append((tag, attrs))
        if 'release-part' in classes:
            self.parts.append({'repo': attrs.get('data-repo'), 'titles': [], 'states': []})
        elif self.parts and tag == 'p' and ({'no-release', 'read'} & set(classes)):
            self.parts[-1]['states'].append('no-release' if 'no-release' in classes else 'missing')
        if tag in ('h2', 'h4'):
            self.reading = [tag, '']

    def handle_data(self, data):
        if self.reading:
            self.reading[1] += data

    def handle_endtag(self, tag):
        if self.reading and self.reading[0] == tag:
            text = re.sub(r'\s+', ' ', self.reading[1]).strip()
            (self.h2 if tag == 'h2' else self.parts[-1]['titles'] if self.parts else self.h2).append(text)
            self.reading = None


def check_releases(section):
    """The generated Releases section: one part per versioned repository in order, each with its releases newest
    first or exactly one of "no release yet" and missing; release notes are text only."""
    outline = ReleaseOutline(section)
    assert outline.h2 == ['Releases'], 'the generated section is headed Releases'
    assert [p['repo'] for p in outline.parts] == list(RELEASE_REPOS), f'one release part per versioned repository: {[p["repo"] for p in outline.parts]}'
    allowed = {'section', 'h2', 'h3', 'h4', 'span', 'p', 'article', 'time', 'div', 'ul', 'li', 'code', 'strong'}
    for tag, attrs in outline.tags:
        assert tag in allowed, f'unexpected element in the generated releases: {tag}'
        assert set(attrs) <= {'class', 'id', 'data-repo', 'aria-labelledby', 'datetime'}, f'unexpected attribute in the generated releases: {sorted(attrs)}'
    for part in outline.parts:
        repo, titles, states = part['repo'], part['titles'], part['states']
        assert bool(titles) != bool(states) and len(states) <= 1, f'{repo}: releases, or one of no release yet and missing'
        versions = []
        for title in titles:
            found = re.fullmatch(rf'{repo} (\d+)\.(\d+)\.(\d+)', title)
            assert found, f'{repo}: unexpected release title {title!r}'
            versions.append(tuple(map(int, found.groups())))
        assert versions == sorted(versions, reverse=True) and len(set(versions)) == len(versions), f'{repo}: releases newest first, each once'
        assert all(v >= (0, 1, 0) for v in versions), f'{repo}: releases from 0.1.0 on'


def check_app(root, names, pages):
    """The app's page: fingerprinted Ember and scripts only, no inline script, local links, its manifest, its CSP."""
    page = Page((root / APP_PAGE).read_text())
    assert not page.books, 'a booking link outside the team page: the app'
    assert not set(page.refs) & {f'/{name}' for name in HASHED}, 'the app uses an unfingerprinted style or script'
    assert page.stylesheets == [f'/{names[APP_STYLE]}'], 'the app must apply exactly the fingerprinted ember.css'
    assert page.scripts == [ref for name in APP_SCRIPTS for ref in [f'/{v}' for v, (_, before) in APP_VENDOR.items() if before == name] + [f'/{names[name]}']], \
        'the app must load its fingerprinted scripts (and each pinned file before its user) in order'
    assert not page.inline_scripts, 'the app allows no inline script'
    for ref in page.refs:
        check_ref(root, root / APP_PAGE, ref, pages, page.favicons)
    assert '/app/manifest.webmanifest' in page.refs, 'the app must link its manifest'
    manifest = json.loads((root / 'app/manifest.webmanifest').read_text())
    assert manifest['start_url'] == manifest['scope'] == '/app/' and manifest['display'] == 'standalone', 'the app manifest must open /app/ standalone'
    for icon in manifest['icons']:
        assert icon['src'].lstrip('/') in STATIC, f'manifest icon is not a built file: {icon["src"]}'
    # Calm to read all day: Ember has no animation or transition at all.
    style = (root / names[APP_STYLE]).read_text()
    assert not re.search(r'\b(animation|transition)\s*:', style), 'Ember allows no motion'
    headers = (root / '_headers').read_text()
    for path in ('/app/*',):  # on Pages this rule also covers /app/ itself (one header, not two)
        rule = re.search(rf'^{re.escape(path)}\n((?:  .*\n?)*)', headers, re.M)
        assert rule and f'  Content-Security-Policy: {APP_CSP}' in rule[1].splitlines(), f'_headers must give {path} the app CSP'
        assert '  Referrer-Policy: no-referrer' in rule[1].splitlines(), f'_headers must give {path} no-referrer'


def check_art(name, data):
    assert name in ART_HASHES and sha256(data).hexdigest() == ART_HASHES[name], 'unreviewed art or recording'
    if name.endswith('.webp'):
        check_webp(data)
    elif name.endswith('.vtt'):
        assert data.startswith(b'WEBVTT') and data.decode('utf-8'), 'invalid WebVTT captions'
    else:
        assert data[4:8] == b'ftyp' and data[8:12] in (b'isom', b'mp42'), 'invalid MP4 header'
    assert not any(marker.encode() in data.lower() for marker in DENYLIST), f'private marker in {name}'


def check_privacy(path, data):
    # Font binaries contain author metadata; the fonts and legal attributions need review.
    # Every other tracked file must be UTF-8. Scan paths too; do not follow symlinks.
    font = path.removeprefix('dist/')
    if font in FONT_HASHES:
        assert sha256(data).hexdigest() == FONT_HASHES[font], 'unreviewed font or licence'
    if path.endswith('.woff2'):
        assert font in FONT_HASHES, 'unreviewed binary font'
    if path.endswith(('.webp', '.mp4', '.vtt')):
        check_art(font, data)
    if path.endswith(('.png', '.ico')):
        pinned = DOC_HASHES.get(path) or ICON_HASHES.get(font)
        assert pinned and sha256(data).hexdigest() == pinned, 'unreviewed picture'
        assert not any(marker.encode() in data.lower() for marker in DENYLIST), f'private marker in {path}'
    if font in VECTORS:
        check_vector(data)
    binary = path.endswith(('.webp', '.mp4', '.png', '.ico')) or (font in FONT_HASHES and font.endswith('.woff2'))
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
    for name in RUNTIME - set(FINGERPRINTS.values()) - set(ALL_PAGES):
        source = APP_VENDOR[name][0] if name in APP_VENDOR else name
        assert (ROOT / source).read_bytes() == (output / name).read_bytes(), f'export differs: {name}'
    assert built_fingerprints(output) == FINGERPRINTS, 'build is stale: rebuild the site'
    for name, hashed in FINGERPRINTS.items():
        assert (ROOT / name).read_bytes() == (output / hashed).read_bytes(), f'export differs: {name}'
    for name in ALL_PAGES:
        built = (output / name).read_text()
        if name == 'changelog/index.html':
            built = split_releases(built)[0]
        assert fingerprinted_page((ROOT / name).read_text(), cta=name != APP_PAGE) == built, f'export differs: {name}'
    paths = subprocess.check_output(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], cwd=ROOT).decode().split('\0')
    for name in set(paths) - {''}:
        path = ROOT / name
        assert not path.is_symlink(), f'symlink requires review: {name}'
        check_privacy(name, path.read_bytes())
    for name in RUNTIME:
        check_privacy('dist/' + name, (output / name).read_bytes())
    print('PASS: pinned WebP artwork and spec recording within budget')
    print('PASS: exact export, local links/fragments, CSS resources, fonts/licences, copy and privacy')
    print('GAP: the landing page has no automated browser test (layout, keyboard, accessibility, animation); the app has npm run test:app')
    print('LIMIT: external URL destinations are constrained; remote availability is not checked')


if __name__ == '__main__':
    main()

from hashlib import sha256
from html import escape, unescape
from html.parser import HTMLParser
from pathlib import Path
import json
import re
import subprocess
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
TODO_RUN = (
    ('Where should tasks live?', 'One list for now.', 'Keep completed tasks visible?', 'Yes, greyed out.'),
    ('Problem Statement', 'As a user, I want an empty task to be refused', 'todo-demo.tasks.v1', 'Out of Scope'),
    ('openwizdev.github.io/todo-demo',),
)
TODO_APP = '/art/todo-app.webp'
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
    'art/todo-spec.mp4': '52bb1fa94a154e17270f7512db19efcedae921e4769a28742bc8a36093d1c732',
    'art/todo-spec-poster.webp': '94a69b2033a98e4ae6663b61bf9f0af0ba06d5a4d4d28aa4b46247570cac5b72',
    'art/todo-spec.vtt': '47e9ffb41081dd72f541110c43312521a8dd92f1c8e58c11092ecd0daa74eee2',
    'art/todo-app.webp': 'ccc5be87687b1d4ac387cfb623033c0f567890cfe73570f8e4d4bb4b8a81de54',
    'art/spec-video.mp4': 'feb357b9a80453d676123a31285a36c34b5873e102ed58c95728bfd6315bfe16',
    'art/spec-poster.webp': '4922f6d265ed8c0c57dead86a62288c94d97159dda34f95969db0ee42b72fdc4',
    'art/spec-video.vtt': '570f5621ff3d84152587612d1be5d78ba5e0fbf6a7da306088a5897c755dc09d',
    'art/drivers-d-sea.webp': 'f2699bd8fe4763993a492dfac2bdbfc3eae46ec33bae0ab74127ad6ebc6a6285',
    'art/drivers-d-ship.webp': '885dd800aae2e75d45f2b88e1e69232bbf987df44beec9fa8070d4354b64cd04',
    'art/drivers-c-boat.webp': '39fd43d08aa36bce84e964699d493a03af090499a63dffbfaa43e61804b7e1ef',
    'art/moments-sea.webp': '903adfdf5e77c61d49bbbfba6b5aa7942a45a12293dbce40cf04175949d1fbb7',
    'art/team-boat-poster.webp': '656c0c75f92a17390beda0d8afb45be3f9164330357635295998406dad3a69d4',
    'art/launch-video.mp4': '1e775d875b23a946346748cb62bd7853abc9dcf278f76addf0cf60136f8662dc',
    'art/launch-poster.webp': '2d27919d8cf70b2e4746b23eee605468f8308243452021e0418d021d8e2bfb3a',
    'art/launch-video.vtt': '591e52c30fb91d0afba1da4228e0240d08929c01e8291fe494102a1d76bfb4e4',
}
ART = set(ART_HASHES)
ICON_HASHES = {
    'favicon.ico': '7b1652147d449f4003ce051d157fc9db68ae69d596b3b38f426be71efcca04b4',
    'apple-touch-icon.png': '86ba37a310f7640af172e1b64b5ac71c1f427f8a941f7c020c5040c19e4cc208',
    'brand/og.png': '4e976988aed9f9d5a37e4254165f6267aeb376d8749e05c0a280520c10df0c5a',
    'app/icon.ico': '33a21c61aa051f91475b46678bc0c4f537ab507273c088c4ed016d5ddce2b9cd',
    'app/icon-180.png': 'deb93ec39812c224c1470e2f1730f7f4ead7be3d27428a20a2a83284b77fbc2f',
}
DOC_HASHES = {
    'docs/map.png': '19fc57ff3f588b36e2ca412f5656483eaf873718d0d19a39aceb83e007333e6b',
    'docs/map-phone.png': 'cdd21a74a880d3adab68ce794de1b18060d916d6df5d00ceb54eb06736cf3fd2',
}
VECTORS = ('favicon.svg', 'brand/openwiz-lockup.svg', 'app/mark.svg', 'app/icon.svg', 'app/wiz-reviewer.svg')
MARK, OLD_MARK = '#cfc6b8', '#2b2bff'
SITE_URL = 'https://openwiz.dev/'
ART_BUDGET = 2_000_000
# External: Cloudflare Pages refuses any single site file over 25 MiB, https://developers.cloudflare.com/pages/platform/limits/
LAUNCH_VIDEO = 'art/launch-video.mp4'
LAUNCH_POSTER = 'art/launch-poster.webp'
LAUNCH_CAPTIONS = 'art/launch-video.vtt'
LAUNCH = (LAUNCH_VIDEO, LAUNCH_POSTER, LAUNCH_CAPTIONS)
LAUNCH_BUDGET = 24_000_000
LAUNCH_LABEL = 'Watch OpenWiz in two minutes'
LAUNCH_POST = 'https://x.com/openwiz/status/2124709517665657224'
LAUNCH_POST_TEXT = 'See the launch post'
GSAP = 'vendor/gsap-3.15.1.min.js'
VENDOR_HASHES = {
    'vendor/GSAP-LICENSE.txt': '791e7d34e6718aad2bd3e20fa5240a4c0e47d73ee3ca31424652cca52fe9acf0',
    'vendor/LOBE-ICONS-LICENSE.txt': 'add9d7531d1b21646317a8958e38fc727506fa39d24bdecb44154d943c82753a',
    'vendor/LUCIDE-LICENSE.txt': 'b495047bd93a9b06913511076f504daba17d5bbeb3e0650f3bb53a4220329c57',
    'vendor/gsap-3.15.1.min.js': '3d1bea374ab1b703cc5c4105358eec63c4465efdc573931dc116e34a0a190c1b',
}

DRIVER_LOGOS = {
    'drivers/logos/boat-dev.svg': ('9a103b949a566589486527567cda9051c9e2c81aa32e723b332df63067fca533', 'boat.dev'),
    'drivers/logos/cloudroom.png': ('357d4b00935ff9b9ebf676e9dbe35ddd22af82b3e62a0fcafd59341b6b702592', 'Cloudroom'),
    'drivers/logos/monitor.svg': ('9ef659c8515c6afe223a2d60407e7472b086593516f892963569692342ef2189', 'computer'),
    'drivers/logos/amp.svg': ('40c79d8c7baa04c2fee214cc1c66a9797eb6aa96bec6c5b20c7d12cd66490696', 'Amp'),
    'drivers/logos/antigravity.svg': ('d775965ea1f8060538c15f758a3e22487317211fcb6051333b5e023f35aa726f', 'Antigravity'),
    'drivers/logos/augment.svg': ('209fbc88f3118621e8d5996c65c00d0836920fc88ff91e49ec33bf5889b1fbbd', 'Augment'),
    'drivers/logos/capy.svg': ('578d3d133df15597ea8ffad90982f8b6b8acb6307c973b363c46672ae906bfd5', 'Capy'),
    'drivers/logos/cline.svg': ('4aeab2461289ccda34c6f4fe4624127ed37f69e2cab06e8e4bab3a333991bed9', 'Cline'),
    'drivers/logos/conductor.svg': ('f62a1ac6dee70ce4c996cbfa63b9fe2bd426b70cdca6ccbf9ad1a692593b9a8e', 'Conductor'),
    'drivers/logos/crush.png': ('d91bbd007a6c3048a3b3d18203063c71f0489159cf0c3e115e5ee5b98b39fed0', 'Crush'),
    'drivers/logos/cursor.svg': ('878309a7f82021e76cdf211188dd052fe6aaf2f435c24887a731d8a19582d260', 'Cursor'),
    'drivers/logos/devin.svg': ('91aa298be0c31e2c6d889a78728852f345e7abf996349333abacd91f1f769463', 'Devin'),
    'drivers/logos/factory.svg': ('416ea4962d7b0b8be8bec7f7190c13c22d5f20fdcac401aa72886fd5c81d2fb2', 'Factory'),
    'drivers/logos/gemini-cli.svg': ('d2b511e4d9a97bb849526646cf1e7705ffa028a52eb53d847c6c3de1e9a40a73', 'Gemini CLI'),
    'drivers/logos/goose.png': ('9c81dc5407d48372013cf8145d8fc62234ba81749d4d6e454f377d4048a084f2', 'goose'),
    'drivers/logos/hermes.png': ('5fbced606189c9bfc2925a16f8903333041cabbf1f8699fe9fe9b3e24504048f', 'Hermes'),
    'drivers/logos/kilo-code.svg': ('729bf088d9a114d567f133acf36f613cabd83662e4616afcea5ea403e87be8d2', 'Kilo Code'),
    'drivers/logos/kimi-code.svg': ('065fcf81c1920fe9c20edc847392d6b6bb419804975e97076d0e3524fe72930c', 'Kimi Code'),
    'drivers/logos/kiro.svg': ('774cbc1c7ecec8c935a6091595583d7a92fc8289d6f1db3f071c0f50c61c369f', 'Kiro'),
    'drivers/logos/ona.svg': ('84264c2037f0cdec433400e6e0b57f7bfd6609b1e5fa71b11e0fff97ef0a3eca', 'Ona'),
    'drivers/logos/openclaw.svg': ('87d87ee7bb4e6fb868bf5ac1a873fb3669dc5c14cdf71ec8ded97f1869a12ce3', 'OpenClaw'),
    'drivers/logos/opencode.svg': ('6a5e91d7e8f306280a4f4f6acd32e8761fae698e56165602c7f0714ef1a315b3', 'OpenCode'),
    'drivers/logos/openhands.svg': ('c932042b36a7a18c8585dc41e0e03fbff86096ec78718243ccac9fe1c4e110b7', 'OpenHands'),
    'drivers/logos/pane.svg': ('f3b4955a5eb5cc737179620b24de1fe0dd52510eac9b1305d594a9faf71f5a6d', 'Pane'),
    'drivers/logos/pi.svg': ('abd66e7868b2d24f0f0895f9237ee8a6dcb22337583b0dc54aeb595acecb4d6b', 'Pi'),
    'drivers/logos/qwen-code.svg': ('24156c849c9124505e13b38c6583a9d5d85a1f57d996c324d967f480a4d88696', 'Qwen Code'),
    'drivers/logos/sculptor.svg': ('2eb7928468190733a86a029629a87b5a042278343267c09df4bbcc35e47787ca', 'Sculptor'),
    'drivers/logos/tembo.svg': ('3d104abb6157e8cf59d2b6d047d74aac76dddc4b461657bb2472b80c8cd9b016', 'Tembo'),
    'drivers/logos/warp.svg': ('66dca2f684bb2250d5294e7f60b190afb7690c79a03bd6e6d4507f0da6a0d7aa', 'Warp'),
}

PAGE_STYLES = {'changelog/index.html': 'changelog/changelog.css', 'market/index.html': 'market/market.css'}
HASHED = ('tokens.css', 'site.css', *PAGE_STYLES.values(), GSAP, 'site.js', 'faq.js')
APP_PAGE = 'app/index.html'
APP_STYLE = 'app/ember.css'
APP_FOUND = {(folder, ext): tuple(sorted(p.relative_to(ROOT).as_posix() for p in (ROOT / folder).glob(f'*.{ext}')))
             for folder in ('app/pages', 'app/cards') for ext in ('js', 'css')}
APP_PARTS = APP_FOUND['app/pages', 'js'] + APP_FOUND['app/cards', 'js']
APP_PART_STYLES = APP_FOUND['app/pages', 'css'] + APP_FOUND['app/cards', 'css']
APP_LEGACY_ORDER = ('app/pages/you.js', 'app/pages/specs.js', 'app/pages/spec.js', 'app/pages/agents.js')
APP_NEEDED = set(APP_FOUND['app/pages', 'js'] + APP_FOUND['app/pages', 'css'])
APP_SCRIPTS = ('app/data.js', 'app/records.js', 'app/ui.js') + APP_PARTS + ('app/palette.js', 'app/shell.js')
APP_VENDOR = {'app/vendor/dagre-3.1.3.min.js': ('node_modules/@dagrejs/dagre/dist/dagre.min.js', 'app/pages/spec.js'),
              'app/vendor/dagre-LICENSE.txt': ('node_modules/@dagrejs/dagre/LICENSE', None)}
HASHED += (APP_STYLE,) + APP_PART_STYLES + APP_SCRIPTS
SITE_CSP = ("default-src 'self'; script-src 'self' https://static.cloudflareinsights.com; style-src 'self'; "
            "img-src 'self' data:; media-src 'self'; font-src 'self'; "
            "connect-src 'self' https://api.github.com https://cloudflareinsights.com; frame-src 'none'; object-src 'none'; "
            "base-uri 'none'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests")
SITE_HEADERS = (
    'Strict-Transport-Security: max-age=31536000',
    f'Content-Security-Policy: {SITE_CSP}',
    'X-Frame-Options: DENY',
    'Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
    'Cross-Origin-Opener-Policy: same-origin',
    'X-Content-Type-Options: nosniff',
    'Referrer-Policy: strict-origin-when-cross-origin',
)
TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com'
ASK_CSP = SITE_CSP.replace("script-src 'self';", f"script-src 'self' {TURNSTILE_ORIGIN};").replace("frame-src 'none';", f"frame-src {TURNSTILE_ORIGIN};")
ASK_PATHS = ('/', '/faq/*')
APP_CSP = ("default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; media-src 'self'; font-src 'self'; "
           "connect-src 'self' https://api.github.com; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
SECURITY_TXT = '.well-known/security.txt'
ROBOTS_TXT = 'robots.txt'


def fingerprint(name, data):
    return re.sub(r'\.(css|js)$', rf'.{sha256(data).hexdigest()[:10]}.\1', name)


def fingerprinted_page(html, cta=False):
    for name, hashed in FINGERPRINTS.items():
        html = html.replace(f'"/{name}"', f'"/{hashed}"')
    return with_faq(with_footer(with_cta(html))) if cta else html


CTA = (ROOT / 'header-cta.html').read_text()
CTA_LINK = '<a class="nav-team" href="/team/">'
TOP_BAR_END = '  </nav>\n</header>'
TEAM_PAGE = 'team/index.html'
BOOK_PLACEHOLDER = '#book'
TEAM_KICKER = 'For teams who use Claude Code or Codex'
TEAM_HEADLINE = 'Leave the call with a reviewed pull request.'
TEAM_LEAD = ('Jake, who built OpenWiz, sets up an agent factory with your team on your own repository. '
             'Pick one small, real change: your agents build and review it. Merging stays your call.')
TEAM_NEEDS = '30 minutes. Bring a repository with working CI and a signed-in Claude Code or Codex.'
TEAM_STEPS = (('Connect', 'We connect OpenWiz to your repository and the coding agents you already use.'),
              ('Decide', 'You pick one small, real change and answer a few questions about it.'),
              ('Ship', 'Your agents build it, a second agent reviews it, and the pull request opens on your repository. '
                       'Merging is your call.'))
TEAM_PARTS = ('On the call', 'What you’re setting up', 'One small change. One call.')
TEAM_FACTS = ('OpenWiz 0.01 is out: open source, Apache-2.0.',
              'It never touches a login and runs no server of ours.',
              'Which drivers passed their live check: the Drivers page.',
              'One person built it, with fleets of agents.')
TEAM_DESCRIPTION = ('A 30-minute call with Jake, who built OpenWiz. Bring your repository; leave with a pull request '
                    'your agents built and reviewed.')
TEAM_NEVER = re.compile(r'\binstall|\bguarantee|\bpric(?:e|es|ing)\b|\bcost|\bfree\b|\bcheckout|[$€£]\s*\d|\bper (?:month|seat|user)\b'
                        r'|\bcustomers?\b|\btrusted\b|\btestimonial|\bresults?\b|\bcloudroom\b|\bships on\b|\bminute \d'
                        r'|\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten) (?:drivers|hosts)\b|\b\d+ of \d+\b', re.I)
REPORT_LINK = 'https://github.com/openwizdev/openwiz/issues/new?template=feedback.yml'
FOOTER = (ROOT / 'footer.html').read_text()
FOOTER_SLOT = '<template data-slot="footer"></template>\n'
FOOTER_LINKS = (('/drivers/', 'Drivers'), ('/market/', 'Market'), ('/changelog/', 'Changelog'), ('https://github.com/openwizdev/openwiz#readme', 'Docs'),
                ('/faq/', 'FAQ'), ('/app/', 'The app'), (REPORT_LINK, 'Report a problem'), ('/team/', 'For teams'),
                ('https://github.com/openwizdev/openwiz', 'GitHub'), ('https://x.com/openwiz', 'X @openwiz'))
FOOTER_LINE = 'Apache-2.0. Owned by no one.'
COUNT_NOTICE = ('openwiz.dev counts visits with Cloudflare Web Analytics and selected clicks with Cloudflare Analytics Engine, '
                'without cookies or personal data.')
X_ACCOUNT = 'https://x.com/openwiz'
CLOUDROOM_LINK = 'https://cloudroom.dev'
INSTALL_NOTE = ("No CloudRoom needed to install. In OpenWiz 0.01, you start builders by hand on this computer, with the Claude Code "
                "or Codex you're signed in to, or on boat.dev; the automatic fleet runs in CloudRoom. "
                'For an Apple-silicon Mac or x86_64 Linux.')
INSTALL_NOTE_HTML = ('<p class="install-note">No CloudRoom needed to install. In OpenWiz 0.01, you start builders by hand on this '
                     "computer, with the Claude Code or Codex you're signed in to, or on boat.dev; the automatic fleet runs in "
                     '<a href="https://cloudroom.dev" rel="noreferrer">CloudRoom</a>. For an Apple-silicon Mac or x86_64 Linux.</p>')
FAQ = (ROOT / 'faq.html').read_text()
FAQ_TOP = re.sub(r'<(/?)h3\b', r'<\1h2', re.sub(r'<(/?)h2\b', r'<\1h1', FAQ))
FAQ_SLOTS = {'<template data-slot="faq"></template>\n': FAQ, '<template data-slot="faq-h1"></template>\n': FAQ_TOP}
FAQ_PAGE = 'faq/index.html'
FAQ_ON = {'index.html': FAQ, FAQ_PAGE: FAQ_TOP}
FAQ_TITLE = ('Questions', 'The short ones are here.')
FAQ_QUESTIONS = ('What is OpenWiz?', 'What is a kernel?', 'What do I need to run it?', 'Where do my agents run?',
                 'Does OpenWiz see my code or my logins?', 'What does it cost?', 'Can you set it up for my team?',
                 'How does openwiz.dev count visits and clicks?')
FAQ_TEAM = 'Yes. Book a 30-minute call. Your first fleet ships on it.'
FAQ_WHERE = ("Builders run where you choose: this computer, with the Claude Code or Codex you're signed in to, boat.dev, "
             'or CloudRoom. Each is a driver that passed the same five-check test. In OpenWiz 0.01, you start builders by '
             'hand on this computer or boat.dev, and the automatic fleet runs in CloudRoom.')


def with_footer(html):
    assert html.count(FOOTER_SLOT) == 1, 'a site page needs exactly one footer slot'
    return html.replace(FOOTER_SLOT, FOOTER)


def with_faq(html):
    for slot, faq in FAQ_SLOTS.items():
        html = html.replace(slot, faq)
    return html


def with_cta(html):
    assert html.count(TOP_BAR_END) == 1, 'a site page needs exactly one top bar'
    return html.replace(TOP_BAR_END, CTA + TOP_BAR_END)


FINGERPRINTS = {name: fingerprint(name, (ROOT / name).read_bytes()) for name in HASHED}
ASK_INDEX = 'ask-index.json'
STATIC = {
    'index.html', 'changelog/index.html', 'drivers/index.html', 'team/index.html', 'faq/index.html', 'market/index.html', '_headers', SECURITY_TXT, ROBOTS_TXT, APP_PAGE, 'app/manifest.webmanifest',
    'fonts/Geist-var.woff2', 'fonts/GeistMono-var.woff2', 'fonts/OFL.txt',
} | ART | set(ICON_HASHES) | set(VECTORS) | (set(VENDOR_HASHES) - {GSAP}) | set(APP_VENDOR) | set(DRIVER_LOGOS) | {ASK_INDEX}
RUNTIME = STATIC | set(FINGERPRINTS.values())


def built_fingerprints(root):
    names = {}
    for name in HASHED:
        stem, ext = name.rsplit('.', 1)
        found = [p.relative_to(root).as_posix() for p in root.glob(f'{stem}.*.{ext}')
                 if re.fullmatch(rf'{re.escape(stem)}\.[0-9a-f]{{10}}\.{ext}', p.relative_to(root).as_posix())]
        assert len(found) == 1, f'expected one fingerprinted {name}, found {found}'
        assert fingerprint(name, (root / found[0]).read_bytes()) == found[0], f'fingerprint does not match content: {found[0]}'
        names[name] = found[0]
    return names
BANNED_COPY = ('play' 'book',)
# PRIVACY: generic private-context markers only; never copy personal literal lists here.
DENYLIST = ('closedwiz', '/users/', '/home/', 'private/evidence/',
            'docs/grills/', 'thr_', 'cr_sub_')
FONT_HASHES = {
    'fonts/Geist-var.woff2': '206f01ed08e05c98a51daa7472331c3c71bbb8c1f9d55ea8c70074f3c528a706',
    'fonts/GeistMono-var.woff2': '55419aa06f58adcd7f145c6c920e56936416f17e528f60efc6032ffa4269972b',
    'fonts/OFL.txt': 'c683bfbcc7e087f5d37a54ef628f10387c451a83ddc459b151403a164ac46c90',
}
PAGES = ('index.html', 'changelog/index.html', 'drivers/index.html', TEAM_PAGE, FAQ_PAGE, 'market/index.html')
ALL_PAGES = PAGES + (APP_PAGE,)
STORY_COPY = ('Build a to-do app', 'Bring any agent', 'Sign in with GitHub', 'Put the app on your phone')
OLD_EXAMPLE = ('dark mode', 'dark-mode')
MOTION_OK = '@media (prefers-reduced-motion:no-preference)'
PHONE_QUERY = re.compile(r'\(max-width:[0-9]+px\)')
CHANGELOG_MAIN = '53ec7d0b87a84daf1ad319c06ed75ea810e35bd269496612631b7d4f5750d1dc'
CHANGELOG_LINKS = ('/changelog/', '/changelog')
PUBLIC_REPOS = ('OpenWiz', 'WizSkills', 'WizLoops', 'WizPlugins', 'WizSite')
PUBLIC_WIZ_NAMES = set(PUBLIC_REPOS) | {'WizBar'}
RELEASES = ('<!-- releases:start -->', '<!-- releases:end -->')
RELEASE_DIR = ROOT / 'changelog/releases'
RELEASE_FIELDS = ('name', 'semver', 'date', 'headline', 'bullets', 'notes')
RELEASE_BULLETS = (1, 6)
RELEASE_BULLET_MAX = 120
RELEASE_HEADLINE_MAX = 80
PRE_RELEASES = 'https://github.com/openwizdev/OpenWiz/releases'
MONTHS = ('Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec')
DRIVERS_PAGE = 'drivers/index.html'
MARKET_PAGE = 'market/index.html'
MARKET = ('<!-- market:start -->', '<!-- market:end -->')
MARKET_SLOT = '<template data-slot="market"></template>'
MARKET_REPO = 'https://github.com/openwizdev/WizMarket'
DRIVERS_LINKS = ('/drivers/', '/drivers')
DRIVERS = (
    ('boat-dev', 'boat.dev', 'Passed all five checks', 'passed'),
    ('vps', 'Your own computer or VPS', 'Passed the kit on a Linux PC', 'passed'),
    ('cloudroom', 'Cloudroom', 'Passed the kit, run from a Cloudroom cloud thread against real Cloudroom', 'passed'),
)
DRIVER_HERO = 'boat-dev'
DRIVER_DATE = 'On a real account, 2026-11-19'
DRIVER_PASSED = {
    'boat-dev': ('2026-11-19', 'https://github.com/openwizdev/OpenWiz/pull/1444'),
    'cloudroom': ('2026-11-20', 'https://github.com/openwizdev/OpenWiz/pull/1458#issuecomment-7034556153'),
    'vps': ('2026-11-20', 'https://github.com/openwizdev/OpenWiz/pull/1455#issuecomment-7034588211'),
}
DRIVER_LOGINS = {
    'boat-dev': 'Login: held by boat.dev',
    'vps': 'Login: stays on your machine',
    'cloudroom': 'Login: held by Cloudroom',
}
DRIVER_ALSO = 'Cloudroom and your own computer or VPS passed the same five checks on 2026-11-20.'
DRIVER_CARD_DATE = 'Kit run, {}'
DRIVER_STALE = re.compile(r'being fixed|works today|kit run next|in progress|not (?:yet )?run(?: yet)?|kit run (?:comes )?next', re.I)
DRIVER_WORDS = ('version', 'start', 'wake', 'stop')
KIT_CHECKS = ('version', 'start', 'wake', 'stop', 'token')
KIT_STATES = ('passed', 'in progress', 'not yet run')
DRIVER_KIT_LINES = {
    'vps': 'Kit: passed, 5 of 5',
    'cloudroom': 'Kit: passed, 5 of 5',
}
HOST_PILLS = (
    ('vps', 'Your computer or VPS', 'passed 5 of 5', 'passed'),
    ('cloudroom', 'Cloudroom', 'passed 5 of 5', 'passed'),
    ('boat-dev', 'boat.dev', 'passed 5 of 5', 'passed'),
)
DRIVER_NUMBERS = {'2026', '11', '19', '20', '22', '1', '2', '3', '5', '6', '7', '9', '14'}
DRIVER_JARGON = re.compile(r'\b\d+\s+(?:drivers?|words?|checks?|commands?|passed)\b|\b(?!5 of 5\b)\d+\s+of\s+\d+\b', re.I)
DRIVER_RESULT = re.compile(r'\ball five checks\b|\bfive passed checks\b|\bfive of five\b', re.I)
DRIVER_RESULT_MAX = 2
DRIVER_EXPLAINER_WORDS = ('driver', 'agents', 'tickets', 'four commands, plus its schema', 'five-check test')
DRIVER_COMMANDS = 'answers four commands, plus its schema.'
DRIVER_DESCRIPTION_COMMANDS = 'Drivers answer the same four commands, plus their schema,'
PROOF_LINES = (
    ('version', 'It names the kernel\'s records version, and prints its schema unchanged.'),
    ('start', 'It answered a run id, and the agent\'s status note appeared on a throwaway ticket.'),
    ('wake', 'It reached the same run again: that note was edited, never a second one.'),
    ('stop', 'It ended the run: a wake after it was refused, and nothing the run started still runs.'),
    ('token', 'No credential appeared in its output, command lines or environment, and it refused a token field.'),
)
TOKEN_CLAIM = 'no credential appeared in its output, command lines or environment, and it refused a token field'
TOKEN_BROAD = re.compile(r'credentials? leaks?|leaks? no credential|never leaks?|proves? no credential|no credential (?:can|will|ever)', re.I)
DRIVER_LOGO_MAX = 30_000
DRIVER_MIN_FONT = 12
DRIVER_LABEL_TRACKING = 0.06
OWN_DRIVER = 'Write your own driver'
OPENWIZ_REPO = 'https://github.com/openwizdev/OpenWiz'
DRIVER_DESCRIPTION = 'boat.dev, Cloudroom and your own computer or VPS passed all five checks and ship today; every other host and harness shows its true state'
DRIVER_ART_BUDGET = 400_000
PR, ISSUE = OPENWIZ_REPO + '/pull/', OPENWIZ_REPO + '/issues/'
DRIVER_WALL = (
    ('openclaw', 'OpenClaw', 'hosts', 'live', ISSUE + '1991#issuecomment-7087326408', 'openclaw.svg'),
    ('hermes', 'Hermes', 'hosts', 'waiting', PR + '2017', 'hermes.png'),
    ('conductor', 'Conductor', 'hosts', 'waiting', PR + '2020', 'conductor.svg'),
    ('cursor', 'Cursor cloud agents', 'hosts', 'waiting', PR + '2021', 'cursor.svg'),
    ('factory', 'Factory', 'hosts', 'waiting', PR + '2022', 'factory.svg'),
    ('pane', 'Pane', 'hosts', 'waiting', PR + '2029', 'pane.svg'),
    ('codespaces', 'GitHub Codespaces', 'hosts', 'waiting', PR + '2559', None),
    ('devin', 'Devin', 'hosts', 'waiting', PR + '2490', 'devin.svg'),
    ('sprites', 'Fly Sprites', 'hosts', 'review', PR + '2720', None),
    ('openhands', 'OpenHands Cloud', 'hosts', 'review', PR + '2567', 'openhands.svg'),
    ('warp-oz', 'Warp Oz', 'hosts', 'review', PR + '2555', 'warp.svg'),
    ('tembo', 'Tembo', 'hosts', 'review', PR + '2662', 'tembo.svg'),
    ('capy', 'Capy', 'hosts', 'review', PR + '2652', 'capy.svg'),
    ('ona', 'Ona', 'hosts', 'review', PR + '2699', 'ona.svg'),
    ('opencomputer', 'OpenComputer', 'hosts', 'held', ISSUE + '2587', None),
    ('grok-bot', 'Grok Bot', 'hosts', 'parked', ISSUE + '2318', None),
    ('amp', 'Amp', 'harnesses', 'waiting', PR + '2767', 'amp.svg'),
    ('antigravity', 'Antigravity CLI', 'harnesses', 'waiting', PR + '2773', 'antigravity.svg'),
    ('warp-local', 'Warp local agent', 'harnesses', 'waiting', PR + '2766', 'warp.svg'),
    ('auggie', 'Augment Auggie', 'harnesses', 'waiting', PR + '2639', 'augment.svg'),
    ('junie', 'JetBrains Junie', 'harnesses', 'waiting', PR + '2638', None),
    ('copilot', 'GitHub Copilot CLI', 'harnesses', 'review', PR + '2782', None),
    ('cursor-cli', 'Cursor CLI', 'harnesses', 'review', PR + '2778', 'cursor.svg'),
    ('gemini', 'Gemini CLI', 'harnesses', 'review', PR + '2776', 'gemini-cli.svg'),
    ('goose', 'Goose', 'harnesses', 'review', PR + '2779', 'goose.png'),
    ('kimi', 'Kimi Code', 'harnesses', 'review', PR + '2785', 'kimi-code.svg'),
    ('pi', 'Pi', 'harnesses', 'review', PR + '2774', 'pi.svg'),
    ('qwen', 'Qwen Code', 'harnesses', 'review', PR + '2794', 'qwen-code.svg'),
    ('kiro', 'Kiro', 'harnesses', 'review', PR + '2631', 'kiro.svg'),
    ('crush', 'Crush', 'harnesses', 'review', PR + '2649', 'crush.png'),
    ('kilo', 'Kilo Code', 'harnesses', 'review', PR + '2640', 'kilo-code.svg'),
    ('vibe', 'Mistral Vibe', 'harnesses', 'review', PR + '2643', None),
    ('opencode', 'OpenCode', 'harnesses', 'planned', ISSUE + '2462', 'opencode.svg'),
    ('sculptor', 'Sculptor', 'harnesses', 'planned', ISSUE + '2540', 'sculptor.svg'),
    ('cline', 'Cline', 'harnesses', 'held', ISSUE + '2530', 'cline.svg'),
)
DRIVER_LADDER = {
    'live': ('Passed live, not in a release yet', 'Live check receipt'),
    'waiting': ('Built, waiting on its live check', 'Pull request'),
    'review': ('In review', 'Pull request'),
    'building': ('Being built', 'Draft pull request'),
    'planned': ('Planned', 'Ticket'),
    'held': ('Held', 'Ticket'),
    'parked': ('Parked', 'Ticket'),
}
DRIVER_REASONS = {
    'opencomputer': 'Held: its key header is unsupported',
    'cline': 'Held: no headless wake by session',
    'grok-bot': 'Parked: the host has no programmatic wake or stop',
}
DRIVER_WALL_LOGINS = {
    'openclaw': 'Login: stays on your machine', 'hermes': 'Login: stays on your machine', 'conductor': 'Login: held by Conductor',
    'cursor': 'Login: held by Cursor', 'factory': 'Login: held by Factory', 'pane': 'Login: stays on your machine',
    'codespaces': 'Login: held by GitHub', 'devin': 'Login: held by Devin',
}
DRIVER_WALLS = (('hosts', 'Where your agents run', 'Hosts'), ('harnesses', 'Which agent you already use', 'Harnesses'))
DRIVER_WALL_HIDDEN = re.compile(r'\s(?:style|hidden|aria-hidden|inert)\b|\bclass="[^"]*\b(?:hidden|sr-only|visually-hidden)\b', re.I)
DRIVER_WALL_LEADS = {
    'hosts': 'Each host gets its own driver. It ships only after it passes the same five-check test on its real host and lands in a release.',
    'harnesses': 'Harnesses run as rows on the local driver, on your computer or a VPS. Today that driver runs Claude Code and Codex; every row below is still on its way.',
}
DRIVER_RECEIPT = ('openclaw', '2026-11-22')
DRIVER_TALLY = (('shipped', 'shipped'), ('live', 'passed live, not in a release yet'), ('waiting', 'waiting on live checks'),
                ('review', 'in review'), ('building', 'being built'), ('planned', 'planned'), ('held', 'held'), ('parked', 'parked'))
DRIVER_LOGO_NOTE = ('Logos belong to their owners. They name the products these drivers and harnesses are for, '
                    'not a partnership, and not what runs today: each tile says its state.')
DRIVER_UNSHIPPED_CLAIM = re.compile(r'\b(?:supported|supports?|released|passed|passes|available|ready|works|ships?|shipped|soon|today|live)\b', re.I)


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
        self.video_tracks = []
        self.open_video = None
        self.links = []
        self.inline_scripts = 0
        self.books = []
        self.x_links = 0
        self.launch_posts = 0
        self.report_links = 0
        self.cloudroom_links = 0
        self.stylesheets, self.scripts = [], []
        self.feed(text)

    def tracks_of(self, video):
        return next((tracks for clip, tracks in zip(self.videos, self.video_tracks) if clip is video), [])

    def handle_endtag(self, tag):
        if tag == 'video':
            self.open_video = None

    def handle_starttag(self, tag, attrs):
        names = [name for name, _ in attrs]
        duplicates = sorted({name for name in names if names.count(name) > 1})
        assert not duplicates, f'duplicate HTML attribute on <{tag}>: {", ".join(duplicates)}'
        attrs = dict(attrs)
        if 'id' in attrs:
            assert attrs['id'] not in self.ids, 'duplicate HTML id'
            self.ids.add(attrs['id'])
        if tag == 'a' and 'data-book' in attrs:
            self.books.append(attrs.get('href') or '')
            attrs = {key: value for key, value in attrs.items() if key != 'href'}
        elif tag == 'a' and attrs.get('href') == X_ACCOUNT:
            self.x_links += 1
            attrs = {key: value for key, value in attrs.items() if key != 'href'}
        elif tag == 'a' and attrs.get('href') == LAUNCH_POST:
            self.launch_posts += 1
            attrs = {key: value for key, value in attrs.items() if key != 'href'}
        elif tag == 'a' and attrs.get('href') == CLOUDROOM_LINK:
            self.cloudroom_links += 1
            attrs = {key: value for key, value in attrs.items() if key != 'href'}
        elif tag == 'a' and attrs.get('href') == REPORT_LINK:
            assert 'noreferrer' in (attrs.get('rel') or '').lower().split() and 'referrerpolicy' not in attrs, \
                'Report a problem link needs rel="noreferrer"'
            self.report_links += 1
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
            self.video_tracks.append([])
            self.open_video = len(self.videos) - 1
        if tag == 'track':
            self.tracks.append(attrs)
            if self.open_video is not None:
                self.video_tracks[self.open_video].append(attrs)
        if tag == 'a':
            self.links.append(attrs)
        if tag == 'script' and not attrs.get('src'):
            self.inline_scripts += 1
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


def check_launch(landing, page):
    flat = lambda html: re.sub(r'\s+', ' ', unescape(re.sub(r'<[^>]*>', ' ', html))).strip()
    clip = next((v for v in page.videos if 'launch-video' in (v.get('class') or '').split()), None)
    assert clip, 'the landing lost its launch video'
    assert clip.get('src') == f'/{LAUNCH_VIDEO}' and clip.get('poster') == f'/{LAUNCH_POSTER}', 'the launch video must play the pinned file over its pinned poster'
    assert clip.get('preload') == 'none' and 'autoplay' not in clip and 'loop' not in clip, 'the launch recording must be opt-in: preload="none", never autoplay'
    assert 'muted' not in clip and 'playsinline' in clip and 'controls' in clip, 'the launch video plays inline with sound, and keeps native controls without scripts'
    about = re.search(r'<p class="sr-only" id="([^"]+)">([^<]+)</p>', landing)
    assert about and clip.get('aria-describedby') == about[1] and len(re.findall(r'[.!?](?:\s|$)', about[2])) == 2, \
        'the launch video needs a two-sentence text alternative it is described by'
    assert any(t.get('kind') == 'captions' and t.get('src') == f'/{LAUNCH_CAPTIONS}' and t.get('srclang') == 'en' for t in page.tracks_of(clip)), \
        'the launch video needs its own English captions'
    play = re.search(r'<button class="launch-play" type="button" hidden>([\s\S]*?)</button>', landing)
    assert play and flat(play[1]) == LAUNCH_LABEL, f'the launch video needs one play button, hidden until the scripts run: {LAUNCH_LABEL}'
    post = re.search(r'<a class="launch-post" href="([^"]*)" data-count="x">([^<]*)</a>', landing)
    assert post and post[1] == LAUNCH_POST and post[2] == LAUNCH_POST_TEXT, f'a "{LAUNCH_POST_TEXT}" link under the player'
    hero = re.search(r'<section class="product-hero[\s\S]*?</section>\n  <section class="agent-row', landing)
    hero = hero[0] if hero else ''
    order = [hero.find(mark) for mark in ('<h1>', 'class="install-box"', 'class="product-stage"', '<figure class="launch">', 'class="app-entry"')]
    assert -1 not in order and order == sorted(order), 'the launch video sits in the hero, under its headline, install line and demo, above everything else'
    assert landing.count('<figure class="launch">') == 1 and landing.count(LAUNCH_POST) == 1, 'one launch video, one launch post link'


def check_webp(data):
    # PRIVACY: a plain WebP image only: EXIF or XMP metadata chunks could carry private details.
    assert data[:4] == b'RIFF' and data[8:12] == b'WEBP', 'invalid WebP signature'
    at = 12
    while at + 8 <= len(data):
        kind, size = data[at:at + 4], int.from_bytes(data[at + 4:at + 8], 'little')
        assert kind in (b'VP8 ', b'VP8L', b'VP8X', b'ALPH'), f'unexpected WebP chunk {kind!r}'
        at += 8 + size + (size & 1)
    assert at == len(data), 'truncated WebP'


class Text(HTMLParser):
    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.parts, self.attrs, self.shown, self.skip = [], [], [], 0
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self.skip += 1
        self.attrs += [v for _, v in attrs if v]
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
    svg = data.decode('utf-8').lower()
    assert svg.startswith('<svg xmlns="http://www.w3.org/2000/svg"'), 'unexpected logo SVG'
    for bad in ('<text', '<tspan', 'font', '@import', '<script', '<style', 'href', '<image', '<foreignobject'):
        assert bad not in svg, f'logo SVG must be outlined shapes only: {bad}'
    assert not re.search(r'\son[a-z]+\s*=', svg), 'logo SVG must have no event handlers'
    assert MARK in svg and OLD_MARK not in svg, 'logo SVG must use the new mark (dark cream)'


def market_urls(path):
    found = set()
    for listing in json.loads(path.read_text())['listings']:
        found.add(listing['url'])
        found.update(link['url'] for link in listing.get('links', ()))
        found.update(proof['url'] for proof in listing.get('proof', {}).values())
    return frozenset(url for url in found if isinstance(url, str) and url.startswith('https://'))


def check_market_refs(root, path, page, pages, market):
    resources = list(page.refs)
    for href in (a['href'] for a in page.links if a.get('href')):
        resources.remove(href)
        check_ref(root, path, href, pages, page.favicons, market)
    for ref in resources:
        check_ref(root, path, ref, pages, page.favicons)


MARKET_TAGS = {'section', 'nav', 'h2', 'h3', 'p', 'code', 'ul', 'li', 'div', 'article', 'dl', 'dt', 'dd', 'span', 'a'}
MARKET_ATTRS = {'class', 'id', 'aria-label', 'aria-labelledby', 'data-listing', 'data-status', 'data-stage'}


class MarketMarkup(HTMLParser):
    def handle_starttag(self, tag, attrs):
        allowed = MARKET_ATTRS | ({'href', 'rel', 'data-count'} if tag == 'a' else set())
        assert tag in MARKET_TAGS and all(name in allowed for name, _ in attrs), 'unexpected markup in the generated Market section'
        fields = dict(attrs)
        assert fields.get('rel', 'noreferrer') == 'noreferrer', 'unexpected markup in the generated Market section'
        assert 'data-count' not in fields or fields['data-count'] in ('github', 'x'), 'unexpected markup in the generated Market section'


def check_market_markup(section):
    MarketMarkup(convert_charrefs=True).feed(section)


def split_market(built):
    start, end = MARKET
    assert built.count(start) == 1 and built.count(end) == 1, 'the built Market page has one generated section'
    before, rest = built.split(start)
    section, after = rest.split(end)
    return before + MARKET_SLOT + after, section


def check_ref(root, source, ref, pages, favicons=(), market=None):
    if ref.startswith('data:image/svg+xml,') and not favicons:
        svg = unquote(ref.split(',', 1)[1])
        assert re.fullmatch(r"<svg xmlns='http://www.w3.org/2000/svg' viewBox='[0-9 ]+'><path d='[A-Za-z0-9 .-]+' fill='none' stroke='#[0-9a-f]{6}' stroke-width='[0-9.]+'/></svg>", svg), 'unexpected inline SVG'
        return
    if ref in favicons:
        assert ref in ('/favicon.ico', '/favicon.svg', '/app/icon.ico', '/app/icon.svg'), 'unexpected favicon'
    url = urlsplit(ref)
    if url.scheme or url.netloc:
        if market is not None and ref in market:
            assert url.scheme == 'https' and not url.username and not url.password, 'unexpected market URL parts'
            return
        if market is not None and (ref == MARKET_REPO or ref.startswith(MARKET_REPO + '/')):
            path = unquote(url.path)
            assert re.fullmatch(r'[\x21-\x7e]+', ref) and '\\' not in path and not {'.', '..'} & set(path.split('/')), 'unexpected repository link'
            assert not url.username and not url.password and not url.query, 'unexpected external URL parts'
            return
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


DRIVER_SLOTS = ('marks', 'tally', 'spotlight', 'shipped', 'hosts', 'harnesses')
DRIVER_SLOT = re.compile(
    r'(<template data-slot="drivers-([a-z]+)-start"></template>)([\s\S]*?)(<template data-slot="drivers-\2-end"></template>)')


def drivers_fallback(built, source):
    slots = {match[2]: match[3] for match in DRIVER_SLOT.finditer(source)}
    assert tuple(slots) == DRIVER_SLOTS, 'the Drivers source has its six build slots'
    changed = []

    def restore(match):
        opening, name, body, closing = match.groups()
        if body != slots[name]:
            changed.append(body)
        return opening + slots[name] + closing

    assert tuple(match[2] for match in DRIVER_SLOT.finditer(built)) == DRIVER_SLOTS, 'the Drivers export has its six build slots'
    fallback = DRIVER_SLOT.sub(restore, built)
    fixed = DRIVER_SLOT.sub(lambda match: match[0] if match[3] == slots[match[2]] else match[1] + match[4], built)
    return fallback, fixed, changed


def driver_listing_urls(registry):
    urls = {}
    for listing in json.loads(registry.read_text())['listings']:
        if not {'driver', 'harness'}.intersection(listing['tags']):
            continue
        allowed = {listing['url'], *(entry['url'] for entry in listing.get('links', ()))}
        receipt = listing.get('proof', {}).get('receipt')
        if receipt:
            allowed.add(receipt['url'])
        urls[listing['id']] = allowed
    return urls


class DriverSlot(Page):
    def __init__(self, markup, listing_urls):
        self.listing_urls = listing_urls
        self.listing = self.listing_tag = None
        super().__init__(markup)

    def handle_starttag(self, tag, attrs):
        fields = dict(attrs)
        assert not {'srcset', 'imagesrcset', 'ping'} & fields.keys(), 'unexpected Drivers resource attributes'
        if 'data-listing' in fields:
            assert tag in ('article', 'li') and self.listing is None, 'unexpected Drivers listing markup'
            self.listing, self.listing_tag = fields['data-listing'], tag
            assert self.listing in self.listing_urls, 'unexpected Drivers listing'
        if tag == 'a' and self.listing is not None:
            href = fields.get('href') or ''
            url = urlsplit(href)
            assert href in self.listing_urls[self.listing] and url.scheme == 'https' and url.netloc \
                and url.username is None and url.password is None, 'unexpected Drivers registry URL'
            assert sum(key == 'href' for key, _ in attrs) == 1, 'duplicate Drivers anchor href'
            assert 'data-book' not in fields, 'a booking link outside the team page'
            attrs = [(key, value) for key, value in attrs if key != 'href']
        super().handle_starttag(tag, attrs)

    def handle_endtag(self, tag):
        if tag == self.listing_tag:
            self.listing = self.listing_tag = None
        super().handle_endtag(tag)


def check_drivers_export(built):
    source = fingerprinted_page((ROOT / DRIVERS_PAGE).read_text(), cta=True)
    expected = subprocess.run(['node', '--input-type=module', '-e', """
        import { readFileSync } from 'node:fs';
        import { withDrivers } from './scripts/drivers.mjs';
        import { readRegistry } from './scripts/market.mjs';
        process.stdout.write(withDrivers(readFileSync(0, 'utf8'), await readRegistry()));
    """], cwd=ROOT, input=source, text=True, stdout=subprocess.PIPE, check=True).stdout
    assert expected == built, f'export differs: {DRIVERS_PAGE}'


def check_site(root, registry=ROOT / 'market/registry.json'):
    files = {p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file()}
    names = built_fingerprints(root)
    assert files == STATIC | set(names.values()), 'unexpected or missing build output'
    pages = {root / f: Page((root / f).read_text()) for f in PAGES}
    drivers_html = (root / DRIVERS_PAGE).read_text()
    for path, page in pages.items():
        rel = path.relative_to(root).as_posix()
        assert not set(page.refs) & {f'/{name}' for name in HASHED}, 'a page uses an unfingerprinted style or script'
        expected = [f'/{names["tokens.css"]}', f'/{names["site.css"]}'] + ([f'/{names[PAGE_STYLES[rel]]}'] if rel in PAGE_STYLES else [])
        assert page.stylesheets == expected, f'{rel} must apply exactly {expected}, got {page.stylesheets}'
        assert not Outline(path.read_text()).styles, f'{rel} must not use inline <style> blocks'
    page = pages[root / 'index.html']
    assert page.scripts == [f'/{names[GSAP]}', f'/{names["site.js"]}', f'/{names["faq.js"]}'], 'load the pinned GSAP before site.js, then faq.js'
    assert not page.inline_scripts, 'landing motion must wait for both external scripts'
    assert len(page.videos) == 2, 'expected the launch video and one spec recording'
    check_launch((root / 'index.html').read_text(), page)
    clip = next((v for v in page.videos if 'spec-video' in (v.get('class') or '').split()), {})
    assert clip.get('preload') == 'none' and 'autoplay' not in clip and 'loop' not in clip, 'spec recording must be opt-in'
    assert 'muted' in clip and 'playsinline' in clip, 'spec video must start muted inline'
    assert clip.get('poster', '').removeprefix('/') in ART, 'spec video needs a pinned poster'
    assert any(t.get('kind') == 'captions' and 'default' in t and t.get('src', '').removeprefix('/') in ART for t in page.tracks_of(clip)), 'spec video needs default captions'
    assert any(a.get('href') == clip.get('src') and 'hidden' not in a for a in page.links), 'needs a plain link to the spec video'
    for attrs in page.buttons:
        if attrs.get('class') in ('demo-pause', 'spec-play', 'launch-play'):
            assert 'hidden' in attrs, 'motion controls must wait for both scripts'
    for name, digest in VENDOR_HASHES.items():
        data = (root / names.get(name, name)).read_bytes()
        assert sha256(data).hexdigest() == digest, f'unreviewed vendor file: {name}'
    def css_refs(text):
        assert '\\' not in text, 'CSS escapes are not allowed'
        found = re.findall(r'url\(\s*([\'\"]?)(.*?)\1\s*\)', text, re.I | re.S)
        assert len(found) == len(re.findall(r'url\(', text, re.I)), 'unreadable url()'
        return [ref for _, ref in found]
    for path, page in pages.items():
        if path == root / MARKET_PAGE:
            fixed, section = (Page(part) for part in split_market(path.read_text()))
            market = market_urls(registry)
            assert not section.books, f'a booking link outside the team page: {path.name}'
            for count, href in ((section.x_links, X_ACCOUNT), (section.cloudroom_links, CLOUDROOM_LINK), (section.report_links, REPORT_LINK)):
                assert not count or href in market, 'unexpected external URL'
            check_market_refs(root, path, section, pages, market)
            check_market_markup(split_market(path.read_text())[1])
            page = fixed
        if path == root / DRIVERS_PAGE:
            listing_urls = driver_listing_urls(registry)
            if listing_urls:
                drivers_html, fixed, slots = drivers_fallback(drivers_html, (ROOT / DRIVERS_PAGE).read_text())
                for markup in slots:
                    slot = DriverSlot(markup, listing_urls)
                    assert not slot.books, 'a booking link outside the team page'
                    assert not (slot.x_links or slot.cloudroom_links or slot.report_links or slot.launch_posts), \
                        'unexpected external URL'
                    for ref in slot.refs:
                        check_ref(root, path, ref, pages, slot.favicons)
                page = Page(fixed)
        assert page.social and all(s.startswith(SITE_URL) and s.removeprefix(SITE_URL).split('?')[0] in STATIC for s in page.social), 'social image must be a built file on the site'
        assert path == root / TEAM_PAGE or not page.books, f'a booking link outside the team page: {path.name}'
        assert page.x_links == 1, f'one X link per page, the footer\'s: {path.relative_to(root)} has {page.x_links}'
        if path == root / MARKET_PAGE:
            check_market_refs(root, path, page, pages, frozenset())
        else:
            for ref in page.refs:
                check_ref(root, path, ref, pages, page.favicons)
        assert page.cloudroom_links == (1 if path == root / 'index.html' else 0), \
            f'CloudRoom link, the landing install box\'s only: {path.relative_to(root)} has {page.cloudroom_links}'
        assert page.report_links == 1, f'Report a problem link: {path.relative_to(root)} has {page.report_links}, not 1'
        assert page.launch_posts == (1 if path == root / 'index.html' else 0), \
            f'the launch post link, the landing launch video\'s only: {path.relative_to(root)} has {page.launch_posts}'
        for ref in css_refs(path.read_text()):
            check_ref(root, path, ref, pages)
    for path in (root / names[name] for name in ('tokens.css', 'site.css', *PAGE_STYLES.values())):
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
    headers = (root / '_headers').read_text()
    site_rule = re.search(r'^/\*\n((?:  .*\n?)*)', headers, re.M)
    assert site_rule, '_headers must define site-wide /* rules'
    site_lines = site_rule[1].splitlines()
    for header in SITE_HEADERS:
        assert f'  {header}' in site_lines, f'_headers /* must include {header}'
    for path in ASK_PATHS:
        rule = re.search(rf'^{re.escape(path)}\n((?:  .*\n?)*)', headers, re.M)
        lines = rule[1].splitlines() if rule else []
        assert lines == ['  ! Content-Security-Policy', f'  Content-Security-Policy: {ASK_CSP}'], \
            f'_headers must detach the site CSP for {path} and allow only Turnstile on top of it'
    assert headers.count(TURNSTILE_ORIGIN) == 2 * len(ASK_PATHS), 'only the Ask a Wiz pages may allow Turnstile'
    sec_rule = re.search(r'^/\.well-known/security\.txt\n((?:  .*\n?)*)', headers, re.M)
    assert sec_rule and '  Content-Type: text/plain; charset=utf-8' in sec_rule[1].splitlines(), \
        '_headers must serve /.well-known/security.txt as text/plain; charset=utf-8'
    for kind in ('css', 'js'):
        assert re.search(rf'^/\*\.{kind}\n  Cache-Control: public, max-age=0, must-revalidate$', headers, re.M), f'_headers must revalidate .{kind}'
    sec_txt = (root / SECURITY_TXT).read_text()
    for line in (
        'Contact: https://github.com/openwizdev/OpenWiz/security/advisories/new',
        'Preferred-Languages: en',
        'Canonical: https://openwiz.dev/.well-known/security.txt',
        'Policy: https://github.com/openwizdev/OpenWiz/security/policy',
    ):
        assert line in sec_txt.splitlines(), f'{SECURITY_TXT} missing required line: {line}'
    assert re.search(r'^Expires: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$', sec_txt, re.M), f'{SECURITY_TXT} missing RFC 3339 Expires'
    robots = (root / ROBOTS_TXT).read_text()
    for line in ('User-agent: *', 'Allow: /', 'Disallow: /api/'):
        assert line in robots.splitlines(), f'{ROBOTS_TXT} missing required line: {line}'
    landing = (root / 'index.html').read_text()
    words = re.sub(r'<[^>]*>', '', landing)
    headline = re.sub(r'<[^>]*>', '', re.search(r'<h1>([\s\S]*?)</h1>', landing)[1].replace('<br>', ' '))
    assert headline == 'Bring your own everything.', 'hero headline changed'
    flat = re.sub(r'\s+', ' ', re.sub(r'<br>', ' ', landing))
    flat = re.sub(r'\s+', ' ', unescape(re.sub(r'<[^>]*>', '', flat)))
    sub = re.search(r'<p class="sub">([\s\S]*?)</p>', landing)
    assert sub and re.sub(r'\s+', ' ', unescape(re.sub(r'<[^>]*>', ' ', sub[1]))).strip() == 'You make the decisions. The agents run the factory.', 'hero subline changed'
    assert 'You make the decisions. The agents run the factory.' in flat, 'hero subline changed'
    for path in pages:
        reader = Text(path.read_text())
        readings = [reader.joined(), reader.spaced()] + reader.attrs
        for reading in readings:
            low = re.sub(r'\s+', ' ', reading).lower()
            assert not any(word in low for word in BANNED_COPY), f'banned word rendered in {path.name}'
            for text in ('illustration, not live data', 'building in public'):
                assert text not in low, f'cut copy is back in {path.name}: {text}'
    hero = re.search(r'<section class="product-hero[\s\S]*?(?=<section class="agent-row)', landing)
    assert hero, 'missing hero'
    hero_text = Text(hero[0])
    labels = re.findall(r"label: '([^']*)'", (root / names['site.js']).read_text())
    for reading in [hero_text.spaced()] + hero_text.shown + labels:
        assert not re.search(r'approv', reading, re.I), 'the hero names an approval step'
    moments = ('Answer a few questions', 'Watch your spec', 'Watch it ship')
    captions = re.findall(r'<h3>([^<]+)</h3>', landing)
    assert tuple(captions) == moments, 'the three moments must appear in order'
    assert 'The real spec of an OpenWiz-built to-do app' in flat, 'the spec video must say it is the to-do app\'s real spec'
    section = re.search(r'<section class="moments[\s\S]*?</section>', re.sub(r'<!--.*?-->', '', landing, flags=re.S))
    section = section[0] if section else ''
    links = Page(section)
    assert not links.books and not links.x_links and all(ref.startswith('/') and not ref.startswith('//') for ref in links.refs), \
        'the moments must keep visitors on the site: no link out'
    blocks = {}
    for block in re.findall(r'<li class="(?:moment-step|spec-moment)[^"]*">.*?</(?:details|div)>\s*</li>', section, re.S):
        blocks[re.search(r'<h3>([^<]+)</h3>', block)[1]] = Text(block).spaced()
    for card, texts in zip(moments, TODO_RUN):
        for text in texts:
            assert text in blocks.get(card, ''), f'the {card} moment must show the real to-do run in place: {text}'
    grill = TODO_RUN[0]
    chat = re.search(r'<div class="moment-chat"[^>]*>(.*?)</div>', section, re.S)
    panel = re.search(r'<div class="moment-panel grill-panel">(.*?)</div>', section, re.S)
    for question, answer in zip(grill[::2], grill[1::2]):
        q, a = re.escape(escape(question, quote=False)), re.escape(escape(answer, quote=False))
        assert chat and re.search(rf'<p class="ask">{q}</p>\s*<p class="reply">{a}</p>', chat[1]), \
            f'the grill bubbles must show each question with its answer: {question}'
        assert panel and re.search(rf'<p class="ask"><strong>{q}</strong>[^<]*<span>[^<]*</span></p>\s*<p class="reply">{a}</p>', panel[1]), \
            f'the expanded grill must show each question with its answer: {question}'
    ship = re.search(r'<li class="moment-step moment-ship">.*?</li>', section, re.S)
    shot = next((i for i in Page(ship[0]).images if i.get('src') == TODO_APP and (i.get('alt') or '').strip()), None) if ship else None
    assert shot, f'the Watch it ship moment lost its described capture of the live app: {TODO_APP}'
    for text in ('Illustration, not live data', 'Building in public'):
        assert text.lower() not in flat.lower(), f'cut copy is back: {text}'
    for text in STORY_COPY:
        assert text in flat, f'missing landing story copy: {text}'
    for reading in [Text(landing).spaced()] + Text(landing).shown:
        assert not any(old in reading.lower() for old in OLD_EXAMPLE), 'the old example idea is back on the landing'
    for attrs in pages[root / 'index.html'].images:
        if attrs.get('src') == '/art/era-2-grill.webp':
            assert (attrs.get('alt') or '').strip(), f'painting without a description: {attrs.get("src")}'
    for style_name in ('site.css', *PAGE_STYLES.values()):
        check_motion((root / names[style_name]).read_text())
    check_driver_css((root / names['site.css']).read_text())
    unlabelled = check_install(landing, pages[root / 'index.html'])
    assert not re.search(r'\b\d{4}-\d{2}-\d{2}\b', words), 'dated landing promise'
    changelog, releases = split_releases((root / 'changelog/index.html').read_text())
    unlabelled = re.sub(r'\s+', ' ', unescape(re.sub(r'<[^>]*>', '', re.sub(r'<br>', ' ', unlabelled))))
    assert not re.search(r'(?<![\d.])\d+\.\d+\.\d+(?![\d.])', unlabelled), 'release version mentioned on the landing'
    for name in VECTORS:
        check_vector((root / name).read_bytes())
    total = 0
    for name in ART:
        data = (root / name).read_bytes()
        check_art(name, data)
        total += len(data) if name not in LAUNCH else 0
    launch = sum(len((root / name).read_bytes()) for name in LAUNCH)
    assert launch <= LAUNCH_BUDGET, f'the launch video, poster and captions are {launch} bytes, over their {LAUNCH_BUDGET} budget (Cloudflare Pages refuses files over 25 MiB)'
    assert total <= ART_BUDGET, f'art is {total} bytes, over the {ART_BUDGET} budget'
    variant = sum(len((root / name).read_bytes()) for name in ART if name.startswith('art/drivers-'))
    assert variant <= DRIVER_ART_BUDGET, f'the drivers art is {variant} bytes, over its {DRIVER_ART_BUDGET} budget'
    drivers_art = {name for name in ART if name.startswith('art/drivers-')}
    unused = sorted(name for name in drivers_art if f'/{name}' not in (root / DRIVERS_PAGE).read_text())
    assert not unused, f'unused drivers art: {unused}'
    check_driver_logo_files(root)
    check_drivers(landing, changelog, drivers_html, pages[root / DRIVERS_PAGE])
    check_drivers_nav((root / names['site.css']).read_text(), {name: (root / name).read_text() for name in PAGES})
    check_changelog(landing, changelog)
    check_releases(releases, read_releases(), install_switch(landing) == 'live')
    check_team({name: (root / name).read_text() for name in PAGES}, {name: pages[root / name] for name in PAGES})
    check_footer({name: (root / name).read_text() for name in PAGES})
    check_faq({name: (root / name).read_text() for name in PAGES}, {name: pages[root / name] for name in PAGES}, names)
    main = re.search(r'<main\b[^>]*>[\s\S]*?</main>', changelog)
    assert main and sha256(main[0].encode()).hexdigest() == CHANGELOG_MAIN, 'changelog content changed; review explicitly before updating its snapshot'


class Outline(HTMLParser):
    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.links, self.items, self.styles, self.title = [], [], [], None
        self.open = []
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


INSTALL_LINE = 'Install OpenWiz from github.com/openwizdev/OpenWiz'
INSTALL_HINT = 'Paste this into your agent'
INSTALL_BUTTON = 'Copy · coming soon'
INSTALL_SWITCH = ('coming-soon', 'live')
INSTALL_VERSION = 'OpenWiz 0.01 0.1.0'


def check_install(landing, page):
    flat = lambda html: re.sub(r'\s+', ' ', unescape(re.sub(r'<[^>]*>', '', html))).strip()
    boxes = re.findall(r'<div class="install-box"([^>]*)>([\s\S]*?)</div>\s*</div>', landing)
    assert len(boxes) == 1, 'exactly one install box'
    attrs, box = boxes[0]
    switch = re.fullmatch(r'\s*data-install="([^"]*)"\s*', attrs)
    assert switch and switch[1] in INSTALL_SWITCH, f'the install box needs its one switch, data-install = {" or ".join(INSTALL_SWITCH)}'
    lines = re.findall(r'<code class="install-line">([^<]*)</code>', box)
    assert lines == [INSTALL_LINE], f'the install line must read exactly: {INSTALL_LINE}'
    label = re.search(r'<div class="install-box"[^>]*>\s*(<p class="install-version">([^<]*<small>[^<]*</small>)</p>)', landing)
    assert label and landing.count('install-version') == 1 and flat(label[2]) == INSTALL_VERSION, f'the install box must show {INSTALL_VERSION}'
    assert re.search(re.escape(INSTALL_NOTE_HTML) + r'\s*$', box) and landing.count('install-note') == 1 \
        and flat(INSTALL_NOTE_HTML) == INSTALL_NOTE, f'the install box must end with: {INSTALL_NOTE}'
    hints = re.findall(r'<p class="install-hint">([\s\S]*?)</p>', box)
    assert [flat(h) for h in hints] == [INSTALL_HINT], f'the install box must say: {INSTALL_HINT}'
    labels = re.findall(r'<button class="btn install"[^>]*>([\s\S]*?)</button>', landing)
    assert len(labels) == 1 and flat(labels[0]) == INSTALL_BUTTON, f'the install button must read {INSTALL_BUTTON}'
    installs = [b for b in page.buttons if 'install' in (b.get('class') or '').split()]
    assert len(installs) == 1, 'exactly one install button'
    assert 'disabled' in installs[0], 'the install button must ship natively disabled'
    assert not any(k.startswith('on') or k in ('form', 'formaction') for k in installs[0]), 'the install button must have no activation handler'
    rest = landing.replace(box, ' ', 1)
    reader = Text(rest)
    for reading in [reader.joined(), reader.spaced()] + reader.shown:
        assert not re.search(r'install|coming soon|paid plans|works today', re.sub(r'\s+', ' ', reading), re.I), 'unsettled landing claim or a second install mention'
    return landing[:label.start(1)] + landing[label.end(1):]


def check_changelog(landing, changelog):
    home = Outline(landing)
    labels = [text for href, text in home.links if href in CHANGELOG_LINKS]
    assert labels == ['Changelog', 'Changelog'], f'the landing nav and footer must each link the Changelog: {labels}'
    assert not home.styles, 'the landing page gets no inline styles'
    for page in (landing, changelog):
        reader = Text(page)
        for reading in [reader.joined(), reader.spaced()] + reader.attrs:
            assert not re.search(r'ship\s*log', reading, re.I), 'the page is called Changelog, never ship log'
    page = Outline(changelog)
    assert page.title == 'Changelog — OpenWiz', 'the changelog page title must be Changelog'
    kinds = [kind for kind, _, _ in page.items]
    assert kinds[:1] == ['h1'] and page.items[0][2] == 'Changelog', 'the changelog heading must be Changelog'
    assert kinds == ['h1'], f'the changelog is its title, one line and the release entries, nothing else: {kinds}'
    main = re.search(r'<main\b[^>]*>([\s\S]*?)</main>', changelog)[1]
    assert len(re.findall(r'<p class="lead">', main)) == 1 and re.fullmatch(r'<h1>Changelog</h1><p class="lead">[^<]*</p>', main), \
        'the changelog is its title, one line and the release entries, nothing else'
    check_public_names(main)
    reader = Text(main)
    for reading in [reader.joined(), reader.spaced()] + reader.attrs:
        assert not re.search(r'\d+\.\d+|\b(?:19|20)\d\d\b', reading), 'no version number or date outside the release entries'
    assert not page.styles, 'the changelog keeps its styles in an external stylesheet, never inline'


def check_public_names(html):
    reader = Text(html)
    public = '(?:' + '|'.join(sorted(PUBLIC_WIZ_NAMES)) + ')+(?:[a-z][A-Za-z]*)?'
    for reading in [reader.joined(), reader.spaced()] + reader.attrs:
        for name in re.findall(r'\bWiz[A-Z][A-Za-z]*', reading):
            assert re.fullmatch(public, name), f'a private repository is named; say "private records and tools": {name}'


class DriverOutline(HTMLParser):
    VOID = ('area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr')

    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.cards, self.own_links, self.own_heading = [], [], None
        self.field, self.depth, self.own_depth, self.card_depth = None, 0, None, None
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        classes = (attrs.get('class') or '').split()
        if tag not in self.VOID:
            self.depth += 1
        if tag == 'section' and 'own-driver' in classes:
            self.own_depth = self.depth
        if self.own_depth and tag == 'a':
            self.own_links.append(attrs.get('href'))
        if self.own_depth and tag == 'h2':
            self.field = ['own-heading', '']
        if tag == 'article' and 'driver' in classes:
            self.card_depth = self.depth
            self.cards.append({'id': attrs.get('id'), 'classes': classes, 'name': '', 'line': '', 'kit': None,
                               'kit_state': None, 'checks': [], 'proofs': [], 'images': [], 'svgs': 0})
            return
        card = self.cards[-1] if self.cards and self.card_depth else None
        if not card:
            return
        if tag == 'img':
            card['images'].append((attrs.get('src') or '', attrs.get('alt') or ''))
            if self.field and self.field[0] == 'name':
                self.field.append(attrs.get('alt') or '')
        elif tag == 'svg' and 'kit-icon' not in classes:
            card['svgs'] += 1
        elif tag in ('h2', 'h3') and 'driver-name' in classes:
            self.field = ['name', '']
        elif tag == 'p' and 'driver-line' in classes:
            self.field = ['line', '']
        elif tag == 'p' and 'driver-kit' in classes:
            card['kit_state'] = attrs.get('data-state')
            self.field = ['kit', '']
        elif tag == 'li' and 'kit-check' in classes:
            card['checks'].append(attrs.get('data-check'))
        elif tag == 'li' and 'proof-check' in classes:
            card['proofs'].append(attrs.get('data-check'))

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in self.VOID:
            self.handle_endtag(tag)

    def handle_data(self, data):
        if self.field:
            self.field[1] += data

    def handle_endtag(self, tag):
        if tag in self.VOID:
            return
        if self.field and tag in ('h2', 'h3', 'p'):
            kind, text, *alts = self.field
            text = re.sub(r'\s+', ' ', text).strip()
            if kind == 'own-heading':
                self.own_heading = text
            elif kind == 'name':
                self.cards[-1]['name'] = text or ' '.join(a for a in alts if a).strip()
            else:
                self.cards[-1][kind] = text
            self.field = None
        if tag == 'section' and self.own_depth == self.depth:
            self.own_depth = None
        if tag == 'article' and self.card_depth == self.depth:
            self.card_depth = None
        self.depth -= 1


def top_bar(html):
    found = re.findall(r'<header class="landing-nav wrap">[\s\S]*?</header>', html)
    assert len(found) == 1, 'a page needs exactly one landing top bar'
    return found[0]


def check_drivers(landing, changelog, drivers, page):
    bar = top_bar(drivers)
    current = re.findall(r'<a [^>]*aria-current="page"[^>]*>([^<]*)</a>', bar)
    assert current == ['Drivers'] and re.search(r'<a class="nav-drivers" href="/drivers/" aria-current="page" data-count="drivers">Drivers</a>', bar), \
        'the drivers top bar must mark its Drivers link aria-current="page"'
    assert bar.replace(' aria-current="page"', '') == top_bar(landing), 'the drivers top bar must be identical to the landing\'s'
    for name, html in (('landing', landing), ('Changelog', changelog)):
        links = [text for href, text in Outline(top_bar(html)).links if href in DRIVERS_LINKS]
        assert links == ['Drivers'], f'the {name} top bar needs one Drivers nav link: {links}'
    assert re.search(r'<body class="[^"]*\bdrivers-page\b', drivers), 'the drivers page body is scoped .drivers-page'
    description = re.findall(r'<meta name="description" content="([^"]*)"', drivers)
    assert len(description) == 1 and DRIVER_DESCRIPTION in description[0], \
        f'the drivers description must say {DRIVER_DESCRIPTION}: {description}'
    assert not re.search(r'\b(each|every)\b[^.]*\bpass', description[0], re.I), \
        f'the drivers description must not say every driver passes: {description[0]}'
    assert not DRIVER_JARGON.search(description[0]), f'a jargon count in the drivers description: {description[0]}'
    assert not re.search(r'grok bot[^.;]*\bpass', description[0], re.I), f'Grok Bot has not passed: {description[0]}'
    assert DRIVER_DESCRIPTION_COMMANDS in description[0], f'the drivers description says {DRIVER_DESCRIPTION_COMMANDS!r}: {description[0]}'
    assert page.scripts == [s for s in Page(landing).scripts if not s.startswith('/faq.')] and not page.inline_scripts, \
        'the drivers page loads only the site\'s footer scripts (GSAP, site.js), never its own'
    main = re.search(r'<main\b[^>]*>[\s\S]*?</main>', drivers)
    assert main, 'the drivers page needs its main'
    main = main[0]
    assert not re.search(r'\shidden\b', main), 'nothing on the drivers page waits for a script to show'
    check_driver_explainer(main)
    outline = DriverOutline(main)
    assert [(c['id'], c['name']) for c in outline.cards] == [(d[0], d[1]) for d in DRIVERS], \
        f'the shipped driver cards, boat.dev first: {[(c["id"], c["name"]) for c in outline.cards]}'
    for card, (key, name, line, state) in zip(outline.cards, DRIVERS):
        assert card['line'] == line, f'{name}: the driver facts must read exactly: {line}'
        hero = 'hero' in card['classes']
        assert hero == (key == DRIVER_HERO), f'boat.dev is the hero card, and only it: {name}'
        assert not card['checks'], f'{name}: no per-check rows on a card: {card["checks"]}'
        if key == DRIVER_HERO:
            assert card['proofs'] == list(KIT_CHECKS), f'{name}: its spotlight lists the five checks in order: {card["proofs"]}'
        else:
            assert not card['proofs'], f'{name}: a pending card shows one kit line, never per-check rows: {card["proofs"]}'
            assert (card['kit'], card['kit_state']) == (DRIVER_KIT_LINES[key], state), \
                f'{name}: its one kit line must read {DRIVER_KIT_LINES[key]!r} ({state}): {card["kit"]!r} ({card["kit_state"]})'
    check_driver_logos(main, outline)
    for key, name, _, _ in DRIVERS[1:]:
        heading = re.search(rf'<h3 class="driver-name" id="{key}-name">([\s\S]*?)</h3>', main)
        assert heading and re.fullmatch(rf'<img class="driver-logo[^"]*" src="/drivers/logos/[^"]+" alt="[^"]+"[^>]*><span>{re.escape(name)}</span>', heading[1].strip()), \
            f'{name}: the compact cards share one header structure (icon or logo, then the name): {heading[1] if heading else None!r}'
    check_driver_proof(main)
    check_host_pills(main)
    check_driver_results(drivers, main, outline)
    reader = Text(re.sub(r'<ul class="tally"[\s\S]*?</ul>|<nav class="wall-jump"[\s\S]*?</nav>', '', main))
    readings = [reader.joined(), reader.spaced()] + reader.shown
    for reading in readings:
        found = DRIVER_JARGON.search(re.sub(r'\b5 of 5\b', 'the kit result', re.sub(r'\s+', ' ', reading)))
        assert not found, f'a jargon count on the drivers page: {found[0]!r}'
        for number in re.findall(r'\d+', reading):
            assert number in DRIVER_NUMBERS, f'invented number on the drivers page: {number}'
    said = len(DRIVER_RESULT.findall(re.sub(r'\s+', ' ', reader.spaced())))
    assert 1 <= said <= DRIVER_RESULT_MAX, f'say boat.dev\'s five-of-five result at most {DRIVER_RESULT_MAX} times on the page: {said}'
    assert outline.own_heading == OWN_DRIVER, f'the drivers page needs its {OWN_DRIVER} section'
    assert outline.own_links and OPENWIZ_REPO in outline.own_links and all(
        href == OPENWIZ_REPO or href.startswith(OPENWIZ_REPO + '/') for href in outline.own_links), \
        f'{OWN_DRIVER} links only to the public OpenWiz repository: {outline.own_links}'
    own = re.search(r'<dl class="own-words">([\s\S]*?)</dl>', main)
    rows = re.findall(r'<dt><code>([^<]*)</code></dt><dd>([\s\S]*?)</dd>', own[1]) if own else []
    assert [r[0] for r in rows] == list(KIT_CHECKS) and 'credential' in plain(rows[-1][1]), \
        f'{OWN_DRIVER} lists the four commands and the fifth check, token, with the credential it checks for: {rows}'
    own_copy = re.search(r'<div class="own-copy">\s*<h2[^>]*>[^<]*</h2>\s*<p>([^<]*)</p>', main)
    assert own_copy and DRIVER_COMMANDS in own_copy[1], f'{OWN_DRIVER} says a driver {DRIVER_COMMANDS!r}'
    assert not Outline(drivers).styles, 'the drivers page keeps its styles in site.css'
    check_driver_logins(main)
    check_driver_wall(main)
    check_driver_token(drivers, main)


def plain(html):
    return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', html)).strip()


def check_driver_explainer(main):
    found = re.findall(r'<div class="drivers-explainer">([\s\S]*?)</div>', main)
    assert len(found) == 1, 'the drivers page needs one explainer of what a driver is'
    hero = re.search(r'<section class="voyage"[\s\S]*?</section>', main)
    assert hero and 'class="drivers-explainer"' in hero[0], 'the driver explainer sits in the hero'
    assert main.index('class="drivers-explainer"') < main.index('<article class="driver'), 'the driver explainer comes above the cards'
    text = re.sub(r'<[^>]+>', ' ', found[0])
    text = re.sub(r'\s+', ' ', unescape(text)).strip()
    sentences = [part for part in re.split(r'(?<=[.!?])\s+', text) if part]
    assert 1 <= len(sentences) <= 2, f'the driver explainer is two sentences at most: {sentences}'
    missing = [word for word in DRIVER_EXPLAINER_WORDS if not re.search(rf'\b{word}', text, re.I)]
    assert not missing, f'the driver explainer must name {missing}'
    agents, commands = text.lower().find('agents', text.find('.') + 1), text.lower().find('four commands')
    assert 0 <= agents < commands, 'under the headline, the driver explainer first says what OpenWiz\'s agents do, then the four commands'
    assert re.search(r'\bmust pass the same five-check test on its real host\b', text) and not re.search(r'\bevery\b[^.]*\bpasses\b', text), \
        'the driver explainer states the test as a requirement, never as every driver\'s result'
    listed = [word for word in KIT_CHECKS if re.search(rf'\b{word}\b', text)] + re.findall(r'<code\b', found[0])
    assert not listed, f'the command-by-command detail stays out of the hero\'s explainer: {listed}'


def check_driver_logos(main, outline):
    used = set()
    for attrs in re.findall(r'<img\b([^>]*)>', main):
        src = (re.search(r'\bsrc="([^"]*)"', attrs) or [None, ''])[1]
        alt = (re.search(r'\balt="([^"]*)"', attrs) or [None, ''])[1]
        assert 'grok' not in (src + alt).lower(), f'no Grok logo: xAI\'s brand terms require permission: {src}'
        if src.startswith('/drivers/'):
            name = src.lstrip('/')
            assert name in DRIVER_LOGOS, f'an unpinned logo on the drivers page: {src}'
            host = DRIVER_LOGOS[name][1]
            assert host.lower() in alt.lower(), f'the logo {src} needs alt text naming {host}: {alt!r}'
            used.add(name)
    grok = re.search(r'<li class="tile[^"]*" id="grok-bot"[\s\S]*?</li>', main)
    assert grok and not re.search(r'<(?:img|svg)\b', grok[0]), 'no Grok logo: Grok Bot shows its name only'
    assert used == set(DRIVER_LOGOS), f'unused drivers logos: {sorted(set(DRIVER_LOGOS) - used)}'
    assert not any('grok' in name.lower() for name in DRIVER_LOGOS), 'no Grok logo file'


def check_driver_logo_files(root):
    for name, (digest, _) in DRIVER_LOGOS.items():
        data = (root / name).read_bytes()
        assert sha256(data).hexdigest() == digest, f'a drivers logo changed bytes: {name}'
        assert len(data) <= DRIVER_LOGO_MAX, f'the drivers logo {name} is over {DRIVER_LOGO_MAX} bytes'


def check_driver_proof(main):
    spot = re.findall(r'<section class="spotlight[^"]*"[\s\S]*?</section>', main)
    assert len(spot) == 1, 'the drivers page needs one boat.dev spotlight'
    spot = spot[0]
    assert 'id="boat-dev"' in spot, 'the spotlight is boat.dev\'s card'
    assert main.index('class="spotlight') > main.index('class="voyage"') and \
        main.index('class="spotlight') < main.index('<article class="driver" '), 'the spotlight comes right after the hero, before the other drivers'
    assert main.index('class="spotlight') < main.index('class="own-driver'), 'the spotlight comes before Write your own driver'
    rows = re.findall(r'<li class="proof-check" data-check="([^"]*)" data-state="([^"]*)">([\s\S]*?)</li>', spot)
    assert [(c, s) for c, s, _ in rows] == [(c, 'passed') for c, _ in PROOF_LINES], \
        f'the spotlight lists the kit\'s five checks in order, each passed: {[(c, s) for c, s, _ in rows]}'
    for (check, _, body), (_, line) in zip(rows, PROOF_LINES):
        name = re.findall(r'<code class="proof-name">([^<]*)</code>', body)
        said = re.findall(r'<span class="proof-line">([\s\S]*?)</span>', body)
        state = re.findall(r'<span class="proof-state">([^<]*)</span>', body)
        assert name == [check] and [plain(s) for s in said] == [line] and state == ['passed'], \
            f'{check}: the proof row names the check, says passed in words and explains what it proved: {line!r}'
    assert re.search(r'<img class="proof-art" src="/art/drivers-[^"]+" alt="[^"]+"', spot), 'the spotlight shows a painting of the crew'
    assert spot.index('class="proof-copy"') < spot.index('class="proof-scene"'), \
        'the spotlight\'s mark, result and five checks come before its painting (phone order)'
    head = re.search(r'<p class="driver-line">([^<]*)</p>\s*<p class="driver-date">([\s\S]*?)</p>', spot)
    assert head and head[1] == DRIVERS[0][2] and plain(head[2]) == DRIVER_DATE, \
        f'the spotlight\'s headline reads {DRIVERS[0][2]!r}, then its own date line {DRIVER_DATE!r}: {head.groups() if head else None}'
    images = [src for src in re.findall(r'<img\b[^>]*\bsrc="([^"]+)"', main) if src.startswith('/art/')]
    twice = sorted({src for src in images if images.count(src) > 1})
    assert not twice, f'a painting shown twice on the drivers page: {twice}'


def check_host_pills(main):
    marks = re.search(r'<ul class="host-marks"[^>]*>([\s\S]*?)</ul>', main)
    assert marks, 'the hero needs its host pills'
    pills = re.findall(r'<li data-host="([^"]*)" data-state="([^"]*)">([\s\S]*?)</li>', marks[1])
    assert [p[0] for p in pills] == [p[0] for p in HOST_PILLS] and len(pills) == marks[1].count('<li'), \
        f'the host pills, in order: {[p[0] for p in pills]}'
    for (key, kind, body), (_, name, state, want) in zip(pills, HOST_PILLS):
        states = re.findall(r'<span class="host-state">([^<]*)</span>', body)
        assert states == [state], f'the {name} pill says what works today in words, {state!r}: {states}'
        assert kind == want, f'the {name} pill\'s state is {want!r}: {kind!r}'
        slots = re.findall(r'<span class="host-mark">(<img\b[^>]*>)</span>', body)
        assert len(re.findall(r'<img\b', body)) == len(slots) == 1, \
            f'the {name} pill\'s mark sits alone in its fixed-height slot: {body.strip()[:120]!r}'
        shown = plain(re.sub(r'<span class="host-state">[^<]*</span>', '', body)) or \
            ' '.join(re.findall(r'\balt="([^"]*)"', body))
        assert shown == name, f'the {name} pill names its host: {shown!r}'


def check_driver_results(drivers, main, outline):
    pills = dict((k, (s, b)) for k, s, b in re.findall(r'<li data-host="([^"]*)" data-state="([^"]*)">([\s\S]*?)</li>', main))
    cards = {c['id']: c for c in outline.cards}
    for key, (date, evidence) in DRIVER_PASSED.items():
        name = cards[key]['name'] if key in cards else key
        assert pills.get(key, ('',))[0] == 'passed', f'{name} passed the kit: shown as anything but passed in its pill: {pills.get(key)}'
        card = re.search(rf'<article class="driver[^"]*" id="{key}"[\s\S]*?</article>', main)
        assert card, f'{name} needs its card'
        card = card[0]
        assert re.search(r'^(?:Passed\b)', cards[key]['line']), f'{name} passed the kit: its status sentence says so: {cards[key]["line"]!r}'
        if key != DRIVER_HERO:
            assert cards[key]['kit_state'] == 'passed' and re.search(r'<p class="driver-kit passed"', card), \
                f'{name} passed the kit: shown as anything but passed in its kit line: {cards[key]["kit_state"]!r}'
            dated = re.findall(r'<p class="driver-date"><a href="([^"]+)" data-count="github">([\s\S]*?)</a></p>', card)
            assert [(href, plain(text)) for href, text in dated] == [(evidence, DRIVER_CARD_DATE.format(date))], \
                f'{name}: its card dates its kit run {date}, linked to its public evidence: {dated}'
        else:
            assert re.search(rf'<p class="driver-date"><a href="{re.escape(evidence)}" data-count="github">', card), \
                f'{name}: its spotlight date links to its public evidence {evidence}'
        assert f'datetime="{date}"' in card, f'{name}: its kit run is dated {date}'
        stale = DRIVER_STALE.search(plain(card) + ' ' + plain(pills.get(key, ('', ''))[1]))
        assert not stale, f'{name} passed the kit: no stale state word: {stale[0]!r}'
    assert set(pills) == {key for key, *_ in HOST_PILLS}, f'a host pill only for a shipped driver: {sorted(pills)}'
    spot = re.search(r'<section class="spotlight[\s\S]*?</section>', main)[0]
    also = re.findall(r'</ol>\s*<p class="proof-also">([\s\S]*?)</p>', spot)
    assert [plain(a) for a in also] == [DRIVER_ALSO], \
        f'boat.dev is one of three: under its five checks, the spotlight says {DRIVER_ALSO!r}: {also}'
    rest = main
    stale = DRIVER_STALE.search(re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', rest)) + ' ' + ' '.join(re.findall(r'content="([^"]*)"', drivers)))
    assert not stale, f'a stale driver state word on the drivers page: {stale[0]!r}'
    only = re.search(r'\bonly (?:boat\.dev|one)\b[^.]*\bpass|\bboat\.dev is the only\b', re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', unescape(drivers))), re.I)
    assert not only, f'boat.dev is never the only one that passed: {only[0]!r}'


def check_driver_logins(main):
    cards = {key: re.search(rf'<article class="driver[^"]*" id="{key}"[\s\S]*?</article>', main) for key, *_ in DRIVERS}
    for key, name, _, _ in DRIVERS:
        card = cards[key][0] if cards[key] else ''
        want = [DRIVER_LOGINS[key]] if key in DRIVER_LOGINS else []
        lines = [plain(line) for line in re.findall(r'<p class="driver-login">([\s\S]*?)</p>', card)]
        assert lines == want, f'{name}: its login line must read exactly {want}: {lines}'
        if want:
            assert re.search(r'</h[23]>\s*<p class="driver-login">', card), f'{name}: its login line sits right after its name'
    found = len(re.findall(r'class="driver-login"', main))
    assert found == len(DRIVER_LOGINS) + len(DRIVER_WALL_LOGINS), f'a login line only on a driver card or its tile: {found} on the page'


class WallTiles(HTMLParser):
    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.tiles, self.field, self.depth = [], None, 0
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        classes = (attrs.get('class') or '').split()
        if tag == 'li' and 'tile' in classes:
            self.tiles.append({'id': attrs.get('id'), 'state': attrs.get('data-state'), 'name': '', 'said': '', 'login': [],
                               'links': [], 'images': [], 'svgs': 0, 'times': []})
            self.depth = 1
            return
        if not self.depth:
            return
        tile = self.tiles[-1]
        if tag == 'li':
            self.depth += 1
        if tag == 'img':
            tile['images'].append((attrs.get('src') or '', attrs.get('alt') or ''))
        elif tag == 'svg':
            tile['svgs'] += 1
        elif tag == 'time':
            tile['times'].append(attrs.get('datetime'))
        elif tag == 'a':
            tile['links'].append([attrs.get('href'), ''])
            self.field = 'link'
        elif tag == 'h4' and 'tile-name' in classes:
            self.field = 'name'
        elif tag == 'p' and 'tile-state' in classes:
            self.field = 'said'
        elif tag == 'p' and 'driver-login' in classes:
            tile['login'].append('')
            self.field = 'login'

    def handle_data(self, data):
        if not (self.depth and self.field):
            return
        tile = self.tiles[-1]
        if self.field == 'link':
            tile['links'][-1][1] += data
        elif self.field == 'login':
            tile['login'][-1] += data
        else:
            tile[self.field] += data

    def handle_endtag(self, tag):
        if not self.depth:
            return
        if tag in ('a', 'h4', 'p'):
            self.field = None
        if tag == 'li':
            self.depth -= 1


def tidy(text):
    return re.sub(r'\s+', ' ', unescape(text)).strip()


def check_driver_wall(main):
    sections = re.findall(r'<section class="wall wrap" id="([^"]+)"[^>]*>([\s\S]*?)</section>', main)
    assert [s[0] for s in sections] == [w for w, *_ in DRIVER_WALLS], \
        f'two walls, hosts then harnesses: where your agents run, then which agent you already use: {[s[0] for s in sections]}'
    assert main.index('class="more-drivers') < main.index('class="wall wrap"') < main.index('class="own-driver'), \
        'the walls sit after the shipped drivers, before Write your own driver'
    states = list(DRIVER_LADDER)
    for (wall, body), (_, title, kicker) in zip(sections, DRIVER_WALLS):
        hidden = DRIVER_WALL_HIDDEN.search(body)
        assert not hidden, f'the {wall} wall hides nothing: every word and link in it is shown: {hidden[0]!r}'
        assert re.findall(rf'<h2 id="{wall}-title">([^<]*)</h2>', body) == [title], f'the {wall} wall is headed {title!r}'
        want = [row for row in DRIVER_WALL if row[2] == wall]
        want.sort(key=lambda row: states.index(row[3]))
        tiles = WallTiles(body).tiles
        assert [x['id'] for x in tiles] == [row[0] for row in want], \
            f'the {wall} wall lists every entry once, grouped by state in ladder order: {[x["id"] for x in tiles]}'
        assert body.count('<li') == len(tiles), f'the {wall} wall holds only tiles'
        groups = re.findall(r'<div class="wall-group" id="[^"]+" data-state="([^"]+)">\s*<h3 class="group-title">([^<]*)<span class="group-count">(\d+)</span></h3>([\s\S]*?)</ul>', body)
        assert [g[0] for g in groups] == list(dict.fromkeys(row[3] for row in want)) and len(groups) == body.count('class="wall-group"'), \
            f'the {wall} wall has one group per state, in ladder order: {[g[0] for g in groups]}'
        jump = re.findall(r'<a href="#([^"]+)" data-state="([^"]+)">([^<]*)<span>(\d+)</span></a>', body)
        assert [(h, s, tidy(w), int(n)) for h, s, w, n in jump] == [(f'{wall}-{g[0]}', g[0], DRIVER_LADDER[g[0]][0], int(g[2])) for g in groups] \
            and all(f'id="{wall}-{g[0]}"' in body for g in groups), f'the {wall} wall\'s jump row names each group, its true count and its anchor: {jump}'
        for state, label, count, inner in groups:
            members = [x['id'] for x in WallTiles(inner).tiles]
            assert tidy(label) == DRIVER_LADDER[state][0] and int(count) == len(members) == sum(1 for r in want if r[3] == state), \
                f'the {wall} group {state!r} is headed {DRIVER_LADDER[state][0]!r} with its true count: {tidy(label)!r} {count}'
            assert all(x['state'] == state for x in WallTiles(inner).tiles), f'the {state!r} group holds only {state!r} tiles'
        for tile, (key, name, _, state, link, logo) in zip(tiles, want):
            words, link_words = DRIVER_LADDER[state]
            said = DRIVER_REASONS.get(key, words)
            assert tile['state'] == state and tidy(tile['name']) == name, f'{name}: its tile names it and carries its state {state!r}'
            assert tidy(tile['said']) == said, f'{name}: its state reads exactly {said!r}, from the ladder: {tidy(tile["said"])!r}'
            if state in ('held', 'parked'):
                assert said.startswith(words + ': '), f'{name}: a {words.lower()} entry gives its reason'
                if state == 'held':
                    assert len(said.split(': ', 1)[1].split()) == 5, f'{name}: a hold gives its reason in five words: {said!r}'
            dated = f', {DRIVER_RECEIPT[1]}' if key == DRIVER_RECEIPT[0] else ''
            assert [(h, tidy(w)) for h, w in tile['links']] == [(link, link_words + dated)], \
                f'{name}: one link, to its ticket or pull request {link}, reading {link_words + dated!r}: {tile["links"]}'
            assert link.startswith(OPENWIZ_REPO + '/'), f'{name}: its link goes to the public OpenWiz repository'
            assert tile['times'] == ([DRIVER_RECEIPT[1]] if dated else []), f'{name}: only the live-check receipt carries a date'
            assert [tidy(x) for x in tile['login']] == ([DRIVER_WALL_LOGINS[key]] if key in DRIVER_WALL_LOGINS else []), \
                f'{name}: its login line, only once its driver is built: {tile["login"]}'
            if logo:
                pinned = f'drivers/logos/{logo}'
                assert [src for src, _ in tile['images']] == [f'/{pinned}'] and not tile['svgs'] and pinned in DRIVER_LOGOS, \
                    f'{name}: its one official logo, {pinned}: {tile["images"]}'
            else:
                assert not tile['images'] and not tile['svgs'], f'{name}: no official mark to show, so its name only: {tile["images"]}'
            block = re.search(rf'<li class="tile[^"]*" id="{re.escape(key)}"[\s\S]*?</li>', body)[0]
            visible = [name, said] + ([DRIVER_WALL_LOGINS[key]] if key in DRIVER_WALL_LOGINS else []) + [link_words + dated]
            assert tidy(re.sub(r'<[^>]+>', ' ', block)).replace(' ,', ',') == ' '.join(visible), \
                f'{name}: its tile shows exactly its name, state, login and link, nothing more: {tidy(re.sub(r"<[^>]+>", " ", block))!r}'
            assert len(re.findall(r'<a\b', block)) == 1, f'{name}: one link in its tile'
            shown = tidy(' '.join([tile['said']] + [w for _, w in tile['links']] + tile['login']))
            if state == 'live':
                shown = shown.replace(DRIVER_LADDER['live'][0], '').replace('Live check receipt', '')
            found = DRIVER_UNSHIPPED_CLAIM.search(shown.replace('live check', ''))
            assert not found, f'{name} is not in a release: never say or imply it is: {found[0]!r}'
        rest = tidy(re.sub(r'<[^>]+>', ' ', re.sub(r'<li class="tile[\s\S]*?</li>', ' ', body)))
        want_rest = ' '.join([kicker, title, DRIVER_WALL_LEADS[wall]] + [f'{DRIVER_LADDER[g[0]][0]} {g[2]}' for g in groups] * 2)
        assert rest == want_rest, f'the {wall} wall shows only its kicker, heading, lead, jump row and group headings around its tiles: {rest!r}'
        assert len(re.findall(r'<a\b', body)) == len(tiles) + len(groups), f'the {wall} wall links only its tiles and its jump row'
        leads = [plain(x) for x in re.findall(r'<p class="wall-lead">([\s\S]*?)</p>', body)]
        assert leads == [DRIVER_WALL_LEADS[wall]], f'the {wall} wall\'s lead reads exactly {DRIVER_WALL_LEADS[wall]!r}: {leads}'
    tally = re.findall(r'<ul class="tally"[^>]*>([\s\S]*?)</ul>', main)
    assert len(tally) == 1 and main.index('class="tally"') < main.index('class="spotlight'), 'one count line, at the top'
    items = re.findall(r'<li data-state="([^"]+)"><b>(\d+)</b> ([^<]*)</li>', tally[0])
    counts = {'shipped': len(DRIVERS)} | {s: sum(1 for row in DRIVER_WALL if row[3] == s) for s in DRIVER_LADDER}
    assert [(k, int(n), w) for k, n, w in items] == [(k, counts[k], w) for k, w in DRIVER_TALLY] and len(items) == tally[0].count('<li'), \
        f'the count line states the true numbers: {items}'
    notes = [plain(n) for n in re.findall(r'<p class="logo-note[^"]*">([\s\S]*?)</p>', main)]
    assert notes == [DRIVER_LOGO_NOTE], f'say once that logos show what OpenWiz runs on, not a partnership: {notes}'
    assert main.index('class="wall wrap"') < main.index('class="logo-note'), 'the logo line follows the logos'


def check_driver_token(drivers, main):
    rows = re.findall(r'data-check="token"[^>]*>([\s\S]*?)</li>', main) + \
        re.findall(r'<dt><code>token</code></dt><dd>([\s\S]*?)</dd>', main)
    assert len(rows) == 2, f'token is explained in the spotlight and in Write your own driver: {len(rows)}'
    for row in rows:
        assert TOKEN_CLAIM in plain(row).lower(), f'say what the token check inspected: {TOKEN_CLAIM!r}: {plain(row)!r}'
    broad = TOKEN_BROAD.search(re.sub(r'\s+', ' ', plain(drivers)) + ' ' + ' '.join(re.findall(r'content="([^"]*)"', drivers)))
    assert not broad, f'a broader token claim than the run inspected: {broad[0]!r}'


def check_team(htmls, pages):
    for name, html in htmls.items():
        bar = top_bar(html)
        assert bar.count('class="nav-team"') == 1 and bar.count(CTA_LINK) == 1, f'the {name} top bar needs its one buy button to /team/'
        assert html.count('class="nav-team"') == 1, f'the {name} page needs exactly one buy button'
    books = [(name, href) for name, page in pages.items() for href in page.books]
    assert len(books) == 2 and all(name == TEAM_PAGE for name, _ in books), f'the site needs its two booking links, both on the team page: {books}'
    assert books[0][1] == books[1][1], f'both booking links share the one booking value: {books}'
    href = books[0][1]
    if href == BOOK_PLACEHOLDER:
        assert 'book' in pages[TEAM_PAGE].ids, 'the booking placeholder needs its id on the team page'
    else:
        url = urlsplit(href)
        assert url.scheme == 'https' and url.netloc and not url.username and not url.password, f'the booking link must be https: {href}'
    team = htmls[TEAM_PAGE]
    flat = re.sub(r'\s+', ' ', unescape(re.sub(r'<[^>]*>', ' ', team)))
    assert not re.search(r'[$€£]\s*\d|\bper (?:month|seat|user)\b|\bpricing\b', flat, re.I), 'the team page shows no price'
    labels = re.findall(r'<a [^>]*data-book[^>]*>([^<]*)</a>', team)
    assert labels == ['Book a call', 'Book a call'], f'team page copy: both booking links read Book a call: {labels}'
    assert re.search(r'<a class="team-book" id="book" data-book href="[^"]*" data-count="book-call">', team), 'the first Book a call is #book, where the Questions link'
    description = re.search(r'<meta name="description" content="([^"]*)">', team)
    assert description and unescape(description[1]) == TEAM_DESCRIPTION, f'the team page description: {TEAM_DESCRIPTION}'
    assert not re.search(r'<(?:iframe|embed|object|form|details)\b', team) and team.count('<script') == 2, \
        'the team page adds no embed, form or script beyond GSAP and site.js, and folds nothing away'
    main = team.split('<main', 1)[1].split('</main>', 1)[0]
    shown = re.sub(r'\s+', ' ', unescape(re.sub(r'<[^>]*>', ' ', main)))
    assert not TEAM_NEVER.search(shown), f'a word the team page never uses: {TEAM_NEVER.search(shown)[0]}'
    assert "'" not in shown and "'" not in ' '.join(re.findall(r'aria-label="([^"]*)"', main)), \
        'the team page uses curly apostrophes'
    assert not re.search(r'\bhidden\b|aria-hidden', re.sub(r'<button class="launch-play" type="button" hidden><span aria-hidden="true">', '', main)), 'the team page hides none of its copy'
    parts = [plain(h) for h in re.findall(r'<h2\b[^>]*>([\s\S]*?)</h2>', main)]
    assert parts == list(TEAM_PARTS), f'the team page sections, in order: {parts}'
    h1 = re.findall(r'<h1\b[^>]*>([\s\S]*?)</h1>', main)
    assert [plain(h) for h in h1] == [TEAM_HEADLINE], f'the team page headline: {h1}'
    hero = re.search(r'<div class="team wrap">([\s\S]*?)\n</div>\n', main)
    assert hero, 'the team page needs its hero'
    hero = hero[1]
    copy = re.search(r'<div class="team-copy">\s*<p class="team-kicker">([^<]*)</p>\s*<h1>[^<]*</h1>\s*<p class="team-lead">([^<]*)</p>\s*'
                     r'<a class="team-book" id="book" data-book [^>]*>Book a call</a>\s*<p class="team-needs">([^<]*)</p>\s*</div>', hero)
    assert copy and tuple(map(unescape, copy.groups())) == (TEAM_KICKER, TEAM_LEAD, TEAM_NEEDS), \
        f'the hero, in order: who it is for, the headline, what happens on the call, Book a call, what to bring: {TEAM_KICKER} / {TEAM_LEAD} / {TEAM_NEEDS}'
    page = Page(main)
    assert len(page.videos) == 1, 'the team page has one video: the launch film'
    clip = page.videos[0]
    assert hero.index('class="team-copy"') < hero.index('<figure class="launch team-film">'), 'the launch film sits in the hero, after Book a call'
    assert clip.get('class') == 'launch-video' and clip.get('src') == f'/{LAUNCH_VIDEO}' and clip.get('poster') == f'/{LAUNCH_POSTER}', \
        'the team film is the launch video over its pinned poster'
    assert clip.get('preload') == 'none' and not {'autoplay', 'loop', 'muted'} & set(clip) and 'playsinline' in clip and 'controls' in clip, \
        'the team film loads nothing until clicked, never autoplays, and plays with sound and native controls'
    assert clip.get('aria-label') == 'OpenWiz in two minutes', 'the team film needs its accessible name'
    about = re.search(r'<p class="sr-only" id="([^"]+)">([^<]+)</p>', hero)
    assert about and clip.get('aria-describedby') == about[1] and len(re.findall(r'[.!?](?:\s|$)', about[2])) == 2, \
        'the team film needs its two-sentence text alternative'
    assert [(t.get('kind'), t.get('src'), t.get('srclang')) for t in page.tracks_of(clip)] == [('captions', f'/{LAUNCH_CAPTIONS}', 'en')], \
        'the team film needs its English captions'
    play = re.search(r'<button class="launch-play" type="button" hidden>([\s\S]*?)</button>', hero)
    assert play and plain(play[1]) == LAUNCH_LABEL, f'the team film needs its one play button, hidden until site.js runs: {LAUNCH_LABEL}'
    steps = re.search(r'<section class="team-part team-call wrap" aria-labelledby="team-how">\s*'
                      r'<h2 id="team-how">[^<]*</h2>\s*<ol class="team-steps">([\s\S]*?)</ol>\s*</section>', main)
    found = re.findall(r'<li><h3>([\s\S]*?)</h3><p>([\s\S]*?)</p></li>', steps[1]) if steps else []
    assert tuple((plain(title), plain(text)) for title, text in found) == TEAM_STEPS and steps[1].count('<li') == len(TEAM_STEPS), \
        f'On the call: its three steps, in order: {TEAM_STEPS}'
    facts = re.search(r'<section class="team-part wrap" aria-labelledby="team-what">\s*<h2 id="team-what">[^<]*</h2>\s*<ul class="team-facts">([\s\S]*?)</ul>\s*</section>', main)
    items = re.findall(r'<li>([\s\S]*?)</li>', facts[1]) if facts else []
    assert tuple(plain(i) for i in items) == TEAM_FACTS, f'What you\u2019re setting up: its four true lines, in order: {TEAM_FACTS}'
    assert re.findall(r'href="([^"]*)" data-count="drivers"', facts[1]) == ['/drivers/'], 'the drivers line links to the live Drivers page, and restates no count'
    close = re.search(r'<section class="team-part team-close wrap" aria-labelledby="team-call">\s*<h2 id="team-call">[^<]*</h2>\s*'
                      r'<a class="team-book" data-book href="[^"]*" data-count="book-call">Book a call</a>\s*</section>\s*$', main)
    assert close, 'the page closes on its second Book a call'
    assert main.count('<a ') == 3 and main.count('<button') == 1, 'the team page offers Book a call twice, the Drivers link and the play button; nothing else'



def check_footer(htmls):
    for name, html in htmls.items():
        assert html.count('<footer') == 1 and html.count(FOOTER) == 1, f'the {name} page needs the one site footer'
        assert html.rstrip().endswith(FOOTER + '</body></html>'), f'the {name} page ends with the site footer'
    links = [(href, plain(text)) for href, text in re.findall(r'<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)</a>', FOOTER)]
    assert tuple(links) == FOOTER_LINKS, f'the footer links, in order: {links}'
    groups = [plain(h) for h in re.findall(r'<h2>([\s\S]*?)</h2>', FOOTER)]
    assert groups == ['Product', 'Company'], f'the footer link groups: {groups}'
    assert FOOTER_LINE in plain(FOOTER), f'the footer says {FOOTER_LINE}'
    assert plain(FOOTER).count(COUNT_NOTICE) == 1, 'the footer has one visit and click notice'
    assert '<p class="footer-wordmark">OpenWiz</p>' in FOOTER, 'the footer shows the wordmark'
    assert FOOTER.count('class="family-wiz"') == 12, 'the footer has the twelve Wizes'


def check_faq(htmls, pages, names):
    for name, html in htmls.items():
        want = FAQ_ON.get(name)
        assert html.count('class="faq ') == (1 if want else 0) and (not want or html.count(want) == 1), \
            f'the {name} page needs the one Questions section from faq.html' if want else f'the {name} page shows no Questions'
        assert (f'/{names["faq.js"]}' in pages[name].scripts) == bool(want), \
            f'the {name} page needs faq.js for its Questions' if want else f'the {name} page loads faq.js without Questions'
    assert re.search(r'</section>\n' + re.escape(FAQ) + '</main>', htmls['index.html']), 'the landing Questions close its main'
    assert (FAQ_TOP + '</main>') in htmls[FAQ_PAGE], 'the /faq page is its Questions'
    Page(FAQ)
    title = [plain(h) for h in re.findall(r'<h2\b[^>]*>([\s\S]*?)</h2>', FAQ)] + [plain(p) for p in re.findall(r'<p class="faq-lead">([\s\S]*?)</p>', FAQ)]
    assert tuple(title) == FAQ_TITLE, f'the Questions heading and its line: {title}'
    rows = re.findall(r'<div class="faq-row">\s*<h3 class="faq-q"><button ([^>]*)>([\s\S]*?)</button></h3>\s*<div class="faq-a" id="([^"]*)"><div>([\s\S]*?)</div></div>\s*</div>', FAQ)
    assert tuple(plain(q) for _, q, _, _ in rows) == FAQ_QUESTIONS and FAQ.count('class="faq-row"') == len(FAQ_QUESTIONS), \
        f'the Questions rows, in order: {[plain(q) for _, q, _, _ in rows]}'
    for attrs, question, answer_id, answer in rows:
        assert 'type="button"' in attrs and f'aria-controls="{answer_id}"' in attrs, \
            f'each question is a button that names its answer: {plain(question)}'
        assert re.search(r'(?:^|\s)disabled(?:\s|$)', attrs) and 'aria-expanded="true"' in attrs, \
            f'each question ships open and disabled until faq.js runs: {plain(question)}'
        assert plain(answer), f'a question without its answer: {plain(question)}'
        for href in re.findall(r'href="([^"]*)"', answer):
            assert href.startswith('/'), f'an answer links off the site: {href}'
    where = [plain(a) for _, q, _, a in rows if plain(q) == 'Where do my agents run?']
    assert where == [FAQ_WHERE], f'the Questions\u2019 answer to Where do my agents run?: {FAQ_WHERE}'
    assert plain(rows[-2][3]) == FAQ_TEAM, f'the Questions’ team answer: {FAQ_TEAM}'
    assert plain(rows[-1][3]) == COUNT_NOTICE, 'the Questions use the same visit and click notice as the footer'
    assert not re.search(r'<(?:form|input|textarea)\b', FAQ), 'part 1 asks nothing: no form or input in the Questions'


def check_drivers_nav(css, pages):
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


def css_rules(css, selector):
    return [body for sel, body in re.findall(r'([^{}]+)\{([^{}]*)\}', css) if selector in [s.strip() for s in sel.split(',')]]


def check_driver_css(css):
    slot = [re.search(r'(?<![-\w])height\s*:\s*(\d+)px', body) for body in css_rules(css, '.drivers-page .host-mark')]
    assert any(slot), 'the host pills need one fixed-height mark slot (.drivers-page .host-mark { height: …px })'
    fill = css_rules(css, '.drivers-page .host-mark img')
    assert any(re.search(r'(?<![-\w])height\s*:\s*100%', body) for body in fill), 'each host mark scales to its slot\'s height'
    for sel, body in re.findall(r'([^{}]+)\{([^{}]*)\}', css):
        for one in sel.split(','):
            one = one.strip()
            if 'host-mark' in one and one != '.drivers-page .host-mark img' and re.search(r'img|host-(?:icon|tile|lockup)\b', one):
                assert not re.search(r'(?<![-\w])(?:height|max-height|width)\s*:\s*\d', body), \
                    f'a host mark sized apart from its slot, so the pills are uneven: {one}'
    for sel, body in re.findall(r'([^{}]+)\{([^{}]*)\}', css):
        if re.search(r'\.(?:wall|tile|tally|group|logo-note)', sel):
            assert not re.search(r'display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?![.\d])|font-size\s*:\s*0', body), \
                f'nothing on the walls is hidden by a style: {sel.strip()}'
    for sel, body in re.findall(r'([^{}]+)\{([^{}]*)\}', css):
        if re.search(r'host-(?:tile|lockup|icon)\b|spot-logo|driver-logo|host-mark img|tile-mark img', sel):
            assert not re.search(r'(?<![-\w])(?:border-radius|clip-path|overflow|object-fit|mask)\s*:', body), \
                f'a logo clipped or cropped; official marks show whole: {sel.strip()}'
    phone = [b for q, b in re.findall(r'@media\s*\(max-width:\s*(\d+)px\)\s*\{((?:[^{}]*\{[^{}]*\})*)[^{}]*\}', css) if int(q) <= 760]
    ratios = [r for block in phone for body in css_rules(block, '.drivers-page .proof-scene')
              for r in re.findall(r'aspect-ratio\s*:\s*(\d+(?:\.\d+)?)\s*/\s*(\d+(?:\.\d+)?)', body)]
    assert ratios and float(ratios[-1][0]) / float(ratios[-1][1]) > 1672 / 941, \
        f'on a phone the spotlight\'s painting follows as a shorter supporting image: {ratios}'
    for sel, body in re.findall(r'([^{}]+)\{([^{}]*)\}', css):
        if re.search(r'\.proof-(?:scene|copy)\b', sel):
            assert not re.search(r'(?<![-\w])order\s*:', body), f'the spotlight keeps its reading order on a phone: {sel.strip()}'
    for rule in re.findall(r'[^{}]*\.drivers-page[^{}]*\{[^{}]*\}', css):
        for size in re.findall(r'font(?:-size)?\s*:[^;}]*?(\d+(?:\.\d+)?)px', rule):
            assert float(size) >= DRIVER_MIN_FONT, f'drivers-page text under {DRIVER_MIN_FONT}px: {rule.strip()[:120]}'
        selector = rule.split('{')[0]
        if re.search(r'text-transform\s*:\s*uppercase', rule) or re.search(r'\bh4\b', selector):
            tracking = re.findall(r'letter-spacing\s*:\s*(-?\d*\.?\d+)em', rule)
            if re.search(r'text-transform\s*:\s*uppercase', rule):
                assert tracking, f'an uppercase drivers-page label needs its tracking: {rule.strip()[:120]}'
            for value in tracking:
                assert float(value) >= DRIVER_LABEL_TRACKING, f'an uppercase drivers-page label needs tracking of {DRIVER_LABEL_TRACKING}em or more: {rule.strip()[:120]}'


def split_releases(built):
    start, end = RELEASES
    assert built.count(start) == 1 and built.count(end) == 1, 'the built Changelog has one generated Releases section'
    before, rest = built.split(start)
    section, after = rest.split(end)
    assert after.startswith('</main>'), 'the generated Releases section closes the Changelog\'s main'
    return before + after, section


def install_switch(landing):
    found = re.findall(r'<div class="install-box" data-install="([^"]*)"', landing)
    assert len(found) == 1, 'the landing needs exactly one install box switch'
    return found[0]


def read_releases(folder=RELEASE_DIR):
    files = sorted(folder.glob('*.json'))
    assert sorted(p.name for p in folder.iterdir()) == [p.name for p in files], f'only release data files in {folder.name}/'
    out = {}
    for path in files:
        try:
            data = json.loads(path.read_text())
        except ValueError as error:
            raise AssertionError(f'{path.name}: not JSON: {error}') from None
        check_release_data(path.name, data)
        out[path.name] = data
    names = [d['name'] for d in out.values()]
    versions = [d['semver'] for d in out.values()]
    assert len(set(names)) == len(names) and len(set(versions)) == len(versions), 'each release once'
    return out


def semver(text):
    return tuple(map(int, text.split('.')))


def check_release_data(file, data):
    assert isinstance(data, dict), f'{file}: one release object'
    missing = [k for k in RELEASE_FIELDS if k not in data or data[k] in (None, '', [])]
    assert not missing, f'{file}: missing {", ".join(missing)}'
    assert sorted(data) == sorted(RELEASE_FIELDS), f'{file}: unexpected fields {sorted(set(data) - set(RELEASE_FIELDS))}'
    text = [data[k] for k in RELEASE_FIELDS if k != 'bullets']
    assert all(isinstance(v, str) for v in text) and isinstance(data['bullets'], list), f'{file}: fields are text, bullets a list'
    assert re.fullmatch(r'0\.\d\d|[1-9]\d*\.\d\d', data['name']) and file == f'{data["name"]}.json', \
        f'{file}: the public name is like 0.01 and names the file'
    assert re.fullmatch(r'\d+\.\d+\.\d+', data['semver']) and semver(data['semver']) >= (0, 1, 0), f'{file}: semver from 0.1.0 on'
    assert re.fullmatch(r'20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])', data['date']), f'{file}: date as YYYY-MM-DD'
    assert len(data['headline']) <= RELEASE_HEADLINE_MAX and '\n' not in data['headline'], f'{file}: a one-line headline'
    bullets = data['bullets']
    low, high = RELEASE_BULLETS
    assert low <= len(bullets) <= high, f'{file}: {len(bullets)} bullets; a short list of {low} to {high}'
    for bullet in bullets:
        assert isinstance(bullet, str) and bullet.strip(), f'{file}: an empty bullet'
        assert len(bullet) <= RELEASE_BULLET_MAX, f'{file}: a bullet over {RELEASE_BULLET_MAX} characters: {bullet[:40]}...'
        assert '\n' not in bullet, f'{file}: one line per bullet'
    assert data['notes'] == f'https://github.com/openwizdev/OpenWiz/releases/tag/v{data["semver"]}', \
        f'{file}: the notes link is the release on GitHub, https://github.com/openwizdev/OpenWiz/releases/tag/v{data["semver"]}'
    check_public_names(escape(' '.join(text + bullets)))


class ReleaseOutline(HTMLParser):
    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.tags, self.entries, self.pre, self.at = [], [], None, None
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        classes = (attrs.get('class') or '').split()
        self.tags.append((tag, attrs))
        if tag == 'article':
            self.entries.append({'name': '', 'small': '', 'date': None, 'headline': '', 'bullets': [], 'links': []})
        elif tag == 'p' and 'pre' in classes:
            self.pre = {'text': '', 'links': []}
        if tag == 'time' and self.entries:
            self.entries[-1]['date'] = attrs.get('datetime')
        if tag == 'a':
            (self.pre or self.entries[-1])['links'].append(attrs.get('href'))
        if tag == 'li':
            self.entries[-1]['bullets'].append('')
        self.at = 'small' if tag == 'small' else 'name' if tag == 'h2' else 'headline' if 'headline' in classes else 'li' if tag == 'li' else self.at

    def handle_endtag(self, tag):
        if tag in ('h2', 'small', 'p', 'li'):
            self.at = 'name' if tag == 'small' else None

    def handle_data(self, data):
        if self.pre is not None:
            self.pre['text'] += data
        elif self.at == 'li':
            self.entries[-1]['bullets'][-1] += data
        elif self.at:
            self.entries[-1][self.at] += data


def check_releases(section, releases, live):
    outline = ReleaseOutline(section)
    allowed = {'section': {'class', 'aria-label'}, 'article': {'class', 'aria-labelledby'}, 'h2': {'id'}, 'small': set(),
               'time': {'datetime'}, 'p': {'class'}, 'ul': set(), 'li': set(), 'a': {'href', 'data-count'}}
    for tag, attrs in outline.tags:
        assert tag in allowed, f'unexpected element in the release entries: {tag}'
        assert set(attrs) <= allowed[tag], f'unexpected attribute in the release entries: {tag} {sorted(attrs)}'
    assert outline.tags[:1] == [('section', {'class': 'releases', 'aria-label': 'Releases'})], 'the entries sit in one Releases section'
    want = sorted(releases.values(), key=lambda d: semver(d['semver']), reverse=True) if live else []
    assert len(outline.entries) == len(want), f'{len(outline.entries)} entries shown; the data and the install switch say {len(want)}'
    for got, data in zip(outline.entries, want):
        flat = lambda t: re.sub(r'\s+', ' ', t).strip()
        y, m, d = map(int, data['date'].split('-'))
        assert (flat(got['name']), flat(got['small'])) == (data['name'], f'· {MONTHS[m - 1]} {d}, {y} ({data["semver"]})'), \
            f'{data["name"]}: the entry is headed by its public name, its date and semver small beside it, newest first'
        assert got['date'] == data['date'], f'{data["name"]}: the entry\'s date'
        assert flat(got['headline']) == data['headline'], f'{data["name"]}: the entry\'s headline'
        assert [flat(b) for b in got['bullets']] == data['bullets'], f'{data["name"]}: the entry\'s bullets'
        assert got['links'] == [data['notes']], f'{data["name"]}: one link, to the full notes on GitHub'
    assert outline.pre and outline.pre['links'] == [PRE_RELEASES], 'the entries end with one line linking the pre-releases on GitHub'
    if not want:
        assert not re.search(r'\d+\.\d+|\b(?:19|20)\d\d\b', Text(section).joined()), 'no release version shows before the install switch reads live'


def check_app(root, names, pages):
    page = Page((root / APP_PAGE).read_text())
    assert not page.books, 'a booking link outside the team page: the app'
    assert not page.x_links, 'one X link per page, the footer\'s: the app has one'
    assert not page.report_links, 'Report a problem link, the footer\'s: the app has one'
    assert not set(page.refs) & {f'/{name}' for name in HASHED}, 'the app uses an unfingerprinted style or script'
    styles = {f'/{names[name]}': name for name in APP_PART_STYLES}
    applied = [styles.get(ref, ref) for ref in page.stylesheets[1:]]
    assert page.stylesheets[:1] == [f'/{names[APP_STYLE]}'] and len(set(applied)) == len(applied) \
        and set(applied) <= set(APP_PART_STYLES) and APP_NEEDED & set(APP_PART_STYLES) <= set(applied), \
        'the app must apply exactly the fingerprinted ember.css, then each of its pages\' styles once (and a card\'s at most once)'
    parts = {f'/{names[name]}': name for name in APP_PARTS}
    shown = [parts[ref] for ref in page.scripts if ref in parts]
    assert len(set(shown)) == len(shown) and APP_NEEDED & set(APP_PARTS) <= set(shown), \
        'the app must load each of its pages\' scripts once (and a card\'s at most once)'
    assert [name for name in shown if name in APP_LEGACY_ORDER] == list(APP_LEGACY_ORDER), \
        'the app must load You, Specs, Spec and Agents in that order: it sets the v1 pages\' order and default route'
    ordered = ('app/data.js', 'app/records.js', 'app/ui.js', *shown, 'app/palette.js', 'app/shell.js')
    assert page.scripts == [ref for name in ordered for ref in [f'/{v}' for v, (_, before) in APP_VENDOR.items() if before == name] + [f'/{names[name]}']], \
        'the app must load its fingerprinted scripts (and each pinned file before its user) in order'
    assert not page.inline_scripts, 'the app allows no inline script'
    for ref in page.refs:
        check_ref(root, root / APP_PAGE, ref, pages, page.favicons)
    assert '/app/manifest.webmanifest' in page.refs, 'the app must link its manifest'
    manifest = json.loads((root / 'app/manifest.webmanifest').read_text())
    assert manifest['start_url'] == manifest['scope'] == '/app/' and manifest['display'] == 'standalone', 'the app manifest must open /app/ standalone'
    for icon in manifest['icons']:
        assert icon['src'].lstrip('/') in STATIC, f'manifest icon is not a built file: {icon["src"]}'
    for name in (APP_STYLE,) + APP_PART_STYLES:
        style = (root / names[name]).read_text()
        assert not re.search(r'\b(animation|transition)\s*:', style), f'Ember allows no motion: {name}'
    headers = (root / '_headers').read_text()
    for path in ('/app/*',):
        rule = re.search(rf'^{re.escape(path)}\n((?:  .*\n?)*)', headers, re.M)
        lines = rule[1].splitlines() if rule else []
        assert '  ! Content-Security-Policy' in lines and f'  Content-Security-Policy: {APP_CSP}' in lines, f'_headers must detach and set the app CSP for {path}'
        assert '  ! Referrer-Policy' in lines and '  Referrer-Policy: no-referrer' in lines, f'_headers must detach and set no-referrer for {path}'


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
    # PRIVACY: font binaries contain author metadata, so the fonts and legal attributions need review.
    # Every other tracked file must be UTF-8. Scan paths too; do not follow symlinks.
    font = path.removeprefix('dist/')
    if font in FONT_HASHES:
        assert sha256(data).hexdigest() == FONT_HASHES[font], 'unreviewed font or licence'
    if path.endswith('.woff2'):
        assert font in FONT_HASHES, 'unreviewed binary font'
    if path.endswith(('.webp', '.mp4', '.vtt')):
        check_art(font, data)
    if path.endswith(('.png', '.ico')):
        pinned = DOC_HASHES.get(path) or ICON_HASHES.get(font) or DRIVER_LOGOS.get(font, (None,))[0]
        assert pinned and sha256(data).hexdigest() == pinned, 'unreviewed picture'
        assert not any(marker.encode() in data.lower() for marker in DENYLIST), f'private marker in {path}'
    if font in VECTORS:
        check_vector(data)
    if font in DRIVER_LOGOS:
        assert sha256(data).hexdigest() == DRIVER_LOGOS[font][0], f'a drivers logo changed bytes: {path}'
    binary = path.endswith(('.webp', '.mp4', '.png', '.ico')) or (font in FONT_HASHES and font.endswith('.woff2'))
    text = path + '\n' + ('' if binary else data.decode('utf-8'))
    assert not any(word in text.lower() for word in BANNED_COPY), f'banned word in {path}'
    # PRIVACY: the documented rule definition must name its own markers. No other exemption.
    if path == 'scripts/check.py':
        text = re.sub(r'DENYLIST = \([^)]*\)', '', text)
    assert not any(marker in text.lower() for marker in DENYLIST), f'private marker in {path}'


def main():
    output = ROOT / 'dist'
    check_site(output)
    for name in RUNTIME - set(FINGERPRINTS.values()) - set(ALL_PAGES) - {ASK_INDEX}:
        source = APP_VENDOR[name][0] if name in APP_VENDOR else name
        assert (ROOT / source).read_bytes() == (output / name).read_bytes(), f'export differs: {name}'
    assert built_fingerprints(output) == FINGERPRINTS, 'build is stale: rebuild the site'
    for name, hashed in FINGERPRINTS.items():
        assert (ROOT / name).read_bytes() == (output / hashed).read_bytes(), f'export differs: {name}'
    for name in ALL_PAGES:
        built = (output / name).read_text()
        if name == 'changelog/index.html':
            built = split_releases(built)[0]
        if name == MARKET_PAGE:
            built = split_market(built)[0]
        if name == DRIVERS_PAGE and driver_listing_urls(ROOT / 'market/registry.json'):
            check_drivers_export(built)
            continue
        assert fingerprinted_page((ROOT / name).read_text(), cta=name != APP_PAGE) == built, f'export differs: {name}'
    paths = subprocess.check_output(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], cwd=ROOT).decode().split('\0')
    for name in set(paths) - {''}:
        path = ROOT / name
        assert not path.is_symlink(), f'symlink requires review: {name}'
        check_privacy(name, path.read_bytes())
    for name in RUNTIME:
        check_privacy('dist/' + name, (output / name).read_bytes())
    print('PASS: pinned WebP artwork and spec recording within budget; the launch video within its own budget')
    print('PASS: exact export, local links/fragments, CSS resources, fonts/licences, copy and privacy')
    print('GAP: the landing page has no automated browser test (layout, keyboard, accessibility, animation); the app has npm run test:app')
    print('LIMIT: external URL destinations are constrained; remote availability is not checked')


if __name__ == '__main__':
    main()

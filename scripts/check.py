"""Dependency-free checks for this site's literal HTML/CSS and public source."""
from hashlib import sha256
from html import escape, unescape
from html.parser import HTMLParser
from pathlib import Path
import json
import re
import subprocess
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
# The landing's three moments show the real to-do run in place, in moment order: its grill's questions and answers, its
# spec (a static copy of openwizdev/todo-demo issue 1) and the live app's capture. Each moment must carry these texts.
TODO_RUN = (
    ('Where should tasks live?', 'One list for now.', 'Keep completed tasks visible?', 'Yes, greyed out.'),
    ('Problem Statement', 'As a user, I want an empty task to be refused', 'todo-demo.tasks.v1', 'Out of Scope'),
    ('openwizdev.github.io/todo-demo',),
)
TODO_APP = '/art/todo-app.webp'
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
    # The landing's spec video (#70, J267): the to-do app's real spec (openwizdev/todo-demo #1), narrated with captions,
    # its poster and captions; local voice, no paid service; every frame privacy-scanned.
    'art/todo-spec.mp4': '52bb1fa94a154e17270f7512db19efcedae921e4769a28742bc8a36093d1c732',
    'art/todo-spec-poster.webp': '94a69b2033a98e4ae6663b61bf9f0af0ba06d5a4d4d28aa4b46247570cac5b72',
    'art/todo-spec.vtt': '47e9ffb41081dd72f541110c43312521a8dd92f1c8e58c11092ecd0daa74eee2',
    # Step 3's real capture of the live to-do app (openwizdev.github.io/todo-demo), shown small and opened in place.
    'art/todo-app.webp': 'ccc5be87687b1d4ac387cfb623033c0f567890cfe73570f8e4d4bb4b8a81de54',
    # OpenWiz's model config spec video (#1802), off the landing (J267) but still served at its URL for #1802's links.
    'art/spec-video.mp4': 'feb357b9a80453d676123a31285a36c34b5873e102ed58c95728bfd6315bfe16',
    # The model config video's poster frame and captions (#1405), still served for OpenWiz #1802's links (J267).
    'art/spec-poster.webp': '4922f6d265ed8c0c57dead86a62288c94d97159dda34f95969db0ee42b72fdc4',
    'art/spec-video.vtt': '570f5621ff3d84152587612d1be5d78ba5e0fbf6a7da306088a5897c755dc09d',
    # The drivers page, variant D (#50): the night sea and the Wiz family's ship, painted layers of its hero.
    'art/drivers-d-sea.webp': 'f2699bd8fe4763993a492dfac2bdbfc3eae46ec33bae0ab74127ad6ebc6a6285',
    'art/drivers-d-ship.webp': '885dd800aae2e75d45f2b88e1e69232bbf987df44beec9fa8070d4354b64cd04',
    # Round 2F (#56): variant C's painted cutaway of the Wiz crew's ship (#49), beside boat.dev's five checks.
    'art/drivers-c-boat.webp': '39fd43d08aa36bce84e964699d493a03af090499a63dffbfaa43e61804b7e1ef',
    # The landing's From idea to shipped panel: our own warm sunset sea from the Limitr build-night video, with its
    # bouncer Wiz, velvet rope, label and deck painted out.
    'art/moments-sea.webp': '903adfdf5e77c61d49bbbfba6b5aa7942a45a12293dbce40cf04175949d1fbb7',
    # Team page round 2 (#81): the boat video's poster frame, linking to the video on X.
    'art/team-boat-poster.webp': '656c0c75f92a17390beda0d8afb45be3f9164330357635295998406dad3a69d4',
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
    # Lucide (ISC): the drivers page's generic icons, drivers/logos/monitor.svg (#62) and drivers/logos/bot.svg (#66).
    'vendor/LUCIDE-LICENSE.txt': 'b495047bd93a9b06913511076f504daba17d5bbeb3e0650f3bb53a4220329c57',
    'vendor/gsap-3.15.1.min.js': '3d1bea374ab1b703cc5c4105358eec63c4465efdc573931dc116e34a0a190c1b',
}

# #62 item 2: real logos, each the owner's official file, unaltered (pinned to the downloaded original's sha256), small,
# same-origin, with alt text naming its host. No Grok or xAI mark: xAI's brand terms require permission for its marks, so
# Grok Bot's name is text, and its card shows one neutral generic icon (#66 item 6).
DRIVER_LOGOS = {
    'drivers/logos/boat-dev.svg': ('9a103b949a566589486527567cda9051c9e2c81aa32e723b332df63067fca533', 'boat.dev'),
    'drivers/logos/cloudroom.png': ('357d4b00935ff9b9ebf676e9dbe35ddd22af82b3e62a0fcafd59341b6b702592', 'Cloudroom'),
    'drivers/logos/monitor.svg': ('9ef659c8515c6afe223a2d60407e7472b086593516f892963569692342ef2189', 'computer'),
    'drivers/logos/bot.svg': ('dcc04dfbe4330e73de3a093bc7b692ac9c373b6a40f41f38c0b05e746c99a250', 'bot'),
}

HASHED = ('tokens.css', 'site.css', GSAP, 'site.js', 'faq.js')
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
    return with_faq(with_footer(with_cta(html))) if cta else html


# The header's one buy button (#63): one snippet, which the build adds to every site page's top bar (not the app's).
CTA = (ROOT / 'header-cta.html').read_text()
CTA_LINK = '<a class="nav-team" href="/team/">'
TOP_BAR_END = '  </nav>\n</header>'
# The team page (openwiz.dev/team, #63) and its one booking link: the href of its one data-book link is the link's
# only value. Until the real link is set it is this in-page placeholder; otherwise it must be an https URL.
TEAM_PAGE = 'team/index.html'
BOOK_PLACEHOLDER = '#book'
# Team page round 2, design P (#81): the round 1 copy, word for word, with headline A. Round 3, candidate 2 (#89):
# curly apostrophes, the terms under their label, the timeline in the hero and Proof as three cards.
TEAM_HEADLINE = 'Book 30 minutes. Leave with a shipped pull request.'
TEAM_TERMS = ('A small, real change of your choice.',
              'On a repository with working CI and a signed-in coding agent (Claude Code or Codex).',
              "If it hasn’t shipped in 30 minutes, Jake stays on until it does.")
TEAM_TERMS_LABEL = 'How the call works'
TEAM_SHIPS = 'Ships means a pull request opens on your repo, built by your agents and passing your CI. Merging is your call.'
TEAM_COPY = ('For solo builders and small teams', TEAM_HEADLINE,
             'A 30-minute call with Jake, who builds OpenWiz. We connect it to your repo and the coding agent you already '
             'use, you pick one small change, and your first fleet ships it on your workflow.',
             *TEAM_TERMS, TEAM_SHIPS,
             TEAM_TERMS_LABEL, 'Grok Bot: coming soon', 'See how drivers work',
             'Our Drivers page was built the same way: a fleet of agents drew six designs, a council of judges picked one, '
             'and it merged in one night.', 'See the Drivers page',
             'Watch the fleet build it (49 s, on X)',
             'Solo builders and small teams who already use Claude Code or Codex.', 'Custom pricing. No checkout.', 'Book a call')
# The hero, then its sections in order: the timeline, proof, who it's for, pricing, the Questions (#76), the closing call.
# #89: the timeline is the hero's second column, and Proof's first card carries the drivers, so the page has no separate
# where-your-agents-run section.
TEAM_PARTS = ('The 30 minutes, roughly', 'Proof', 'Who it’s for', 'Pricing', 'Questions', 'Your first fleet ships on the call.')
TEAM_STEPS = (('Minute 0', 'We connect your repo and your agents.'),
              ('Minute 10', 'You answer a few questions about your change.'),
              ('Minute 20', 'Your agents build it.'), ('Minute 30', 'A pull request ships.'))
# #89: Proof's first card, the drivers that passed: its heading, what the five checks are (as /drivers/ names them), then
# each logo (as /drivers/ ships it) with its result under it.
TEAM_PASSED_HEADING = 'Three drivers passed all five checks'
TEAM_PASSED_ABOUT = 'The same test for every place your agents run: version, start, wake, stop and token.'
TEAM_PASSED = ('/drivers/logos/monitor.svg', '/drivers/logos/cloudroom.png', '/drivers/logos/boat-dev.svg')
TEAM_PASSED_LINE = '5 of 5'
# The boat video's poster: a picture linking to the X post, never an embedded or hosted video.
TEAM_POSTER = '/art/team-boat-poster.webp'
TEAM_POSTER_ALT = 'Wizards on a boat: the fleet that built the Drivers page'
TEAM_NEVER = re.compile(r'\binstall|\bguarantee', re.I)
# #1851: Report a problem opens GitHub's new-issue form on openwizdev/openwiz with the feedback template
# (contracts/feedback-loop.v1.md: .github/ISSUE_TEMPLATE/feedback.yml). The only external URL with a query; nothing
# else may ride along, so no words leave openwiz.dev. In the footer of every site page.
REPORT_LINK = 'https://github.com/openwizdev/openwiz/issues/new?template=feedback.yml'
# The site footer (#73): one snippet, which the build adds at each site page's one slot (not the app's). Its links, in order.
FOOTER = (ROOT / 'footer.html').read_text()
FOOTER_SLOT = '<!-- footer.html -->\n'
FOOTER_LINKS = (('/drivers/', 'Drivers'), ('/changelog/', 'Changelog'), ('https://github.com/openwizdev/openwiz#readme', 'Docs'),
                ('/faq/', 'FAQ'), ('/app/', 'The app'), (REPORT_LINK, 'Report a problem'), ('/team/', 'For teams'),
                ('https://github.com/openwizdev/openwiz', 'GitHub'), ('https://x.com/openwiz', 'X @openwiz'))
FOOTER_LINE = 'Apache-2.0. Owned by no one.'
# The only external link off GitHub: OpenWiz's own X account, in the footer.
X_ACCOUNT = 'https://x.com/openwiz'
# #1674 (RL2): the install box's last line names what 0.1.0 needs; its one link, CloudRoom's site, is the landing's only
# link off GitHub besides the footer's X account.
CLOUDROOM_LINK = 'https://cloudroom.dev'
INSTALL_NOTE = 'Needs CloudRoom, on an Apple-silicon Mac or x86_64 Linux. Your agent can install it; you sign in.'
INSTALL_NOTE_HTML = ('<p class="install-note">Needs <a href="https://cloudroom.dev" rel="noreferrer">CloudRoom</a>, '
                     'on an Apple-silicon Mac or x86_64 Linux. Your agent can install it; you sign in.</p>')
# The Questions (#76): one snippet, faq.html, the FAQ's one source. The build adds it at the landing's and /team's slot,
# and at /faq's top slot as the page's own heading (its title the h1, each question an h2). Its questions, in order.
FAQ = (ROOT / 'faq.html').read_text()
FAQ_TOP = re.sub(r'<(/?)h3\b', r'<\1h2', re.sub(r'<(/?)h2\b', r'<\1h1', FAQ))
FAQ_SLOTS = {'<!-- faq.html -->\n': FAQ, '<!-- faq.html h1 -->\n': FAQ_TOP}
FAQ_PAGE = 'faq/index.html'
FAQ_ON = {'index.html': FAQ, TEAM_PAGE: FAQ, FAQ_PAGE: FAQ_TOP}
FAQ_TITLE = ('Questions', 'The short ones are here.')
FAQ_QUESTIONS = ('What is OpenWiz?', 'What is a kernel?', 'What do I need to run it?', 'Where do my agents run?',
                 'Does OpenWiz see my code or my logins?', 'What does it cost?', 'Can you set it up for my team?')
# #89: the last answer, word for word (the team page's offer).
FAQ_LAST = 'Yes. Book a 30-minute call. Your first fleet ships on it.'
# #1674 (RL2): where agents run, word for word: 0.1.0 runs through CloudRoom; the other drivers come after it.
FAQ_WHERE = ('Through CloudRoom: OpenWiz runs on it, so it comes first. Once OpenWiz is set up, a fleet can also run '
             'agents on boat.dev or your own computer. Each is a driver that passed the same five-check test.')


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
# Ask a Wiz's docs index (FA2, #1900): built from the built pages and ask-docs/, so it has no source copy to compare;
# it is privacy-scanned with every runtime file.
ASK_INDEX = 'ask-index.json'
STATIC = {
    'index.html', 'changelog/index.html', 'drivers/index.html', 'team/index.html', 'faq/index.html', '_headers', APP_PAGE, 'app/manifest.webmanifest',
    'fonts/Geist-var.woff2', 'fonts/GeistMono-var.woff2', 'fonts/OFL.txt',
} | ART | set(ICON_HASHES) | set(VECTORS) | (set(VENDOR_HASHES) - {GSAP}) | set(APP_VENDOR) | set(DRIVER_LOGOS) | {ASK_INDEX}
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
PAGES = ('index.html', 'changelog/index.html', 'drivers/index.html', TEAM_PAGE, FAQ_PAGE)
ALL_PAGES = PAGES + (APP_PAGE,)
# The to-do example and both app entry points stay visible in the static landing page.
STORY_COPY = ('Build a to-do app', 'Bring any agent', 'Sign in with GitHub', 'Put the app on your phone')
OLD_EXAMPLE = ('dark mode', 'dark-mode')
MOTION_OK = '@media (prefers-reduced-motion:no-preference)'
PHONE_QUERY = re.compile(r'\(max-width:[0-9]+px\)')
# The Changelog (#78): named Changelog everywhere; its source page is the title and one line, and nothing else in its
# main (no version number or date: those come only from the release data). Private repositories are never named.
# Its reviewed text is pinned below. The repository map and What exists today moved to docs/repos.md.
CHANGELOG_MAIN = '53ec7d0b87a84daf1ad319c06ed75ea810e35bd269496612631b7d4f5750d1dc'
CHANGELOG_LINKS = ('/changelog/', '/changelog')
PUBLIC_REPOS = ('OpenWiz', 'WizSkills', 'WizLoops', 'WizPlugins', 'WizSite')
PUBLIC_WIZ_NAMES = set(PUBLIC_REPOS) | {'WizBar'}  # WizBar is WizPlugins' plugin, not a repository
# The generated entries (#78): build.mjs adds them last in the Changelog's main, between these markers, from one data
# file per public release in RELEASE_DIR. check_release_data checks each file; check_releases checks the built section
# against them and the landing's install switch: no entry until it reads live (RL2), then every entry, newest first.
RELEASES = ('<!-- releases:start -->', '<!-- releases:end -->')
RELEASE_DIR = ROOT / 'changelog/releases'
RELEASE_FIELDS = ('name', 'semver', 'date', 'headline', 'bullets', 'notes')
RELEASE_BULLETS = (1, 6)  # a human-readable number: about 2 to 5, never none and never more than 6
RELEASE_BULLET_MAX = 120  # characters
RELEASE_HEADLINE_MAX = 80  # characters: one line
PRE_RELEASES = 'https://github.com/openwizdev/OpenWiz/releases'
MONTHS = ('Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec')
# The drivers page (openwiz.dev/drivers, #50; round 3H, #62): boat.dev's spotlight card first, then the other three
# drivers' compact cards, in this order, each with its status line (the ticket's facts, word for word). #66's facts
# (2026-11-20): boat.dev, Cloudroom and your own computer or VPS each passed the kit, five of five; Grok Bot is coming soon.
DRIVERS_PAGE = 'drivers/index.html'
DRIVERS_LINKS = ('/drivers/', '/drivers')
DRIVERS = (
    ('boat-dev', 'boat.dev', 'Passed all five checks', 'passed'),
    ('vps', 'Your own computer or VPS', 'Passed the kit on a Linux PC', 'passed'),
    ('cloudroom', 'Cloudroom', 'Passed the kit, run from a Cloudroom cloud thread against real Cloudroom', 'passed'),
    ('grok-bot', 'Grok Bot', 'Coming soon: listed when its driver lands', 'not yet run'),
)
DRIVER_HERO = 'boat-dev'
# Round 3 final (#66 item 4): the spotlight's clean headline, then the date on its own metadata line under it.
DRIVER_DATE = 'On a real account, 2026-11-19'
# #66 facts: the drivers that passed the kit, each with its date and its public evidence; and the one still to come.
# The spotlight stays boat.dev's, and says under its five checks that the other two passed the same ones.
DRIVER_PASSED = {
    'boat-dev': ('2026-11-19', 'https://github.com/openwizdev/OpenWiz/pull/1444'),
    'cloudroom': ('2026-11-20', 'https://github.com/openwizdev/OpenWiz/pull/1458#issuecomment-7034556153'),
    'vps': ('2026-11-20', 'https://github.com/openwizdev/OpenWiz/pull/1455#issuecomment-7034588211'),
}
DRIVER_COMING = 'grok-bot'
# OpenWiz #2005 (DW8): each driver's login line, word for word from its README (kernel/driver.v1.md, The login line).
DRIVER_LOGINS = {
    'boat-dev': 'Login: held by boat.dev',
    'vps': 'Login: stays on your machine',
    'cloudroom': 'Login: held by Cloudroom',
}
DRIVER_ALSO = 'Cloudroom and your own computer or VPS passed the same five checks on 2026-11-20.'
DRIVER_CARD_DATE = 'Kit run, {}'
# Words that described the three passing drivers before they passed; none may come back anywhere on the page. "not run
# yet" stays only on Grok Bot's card.
DRIVER_STALE = re.compile(r'being fixed|works today|kit run next|in progress|not (?:yet )?run(?: yet)?|kit run (?:comes )?next', re.I)
DRIVER_WORDS = ('version', 'start', 'wake', 'stop')
KIT_CHECKS = ('version', 'start', 'wake', 'stop', 'token')
KIT_STATES = ('passed', 'in progress', 'not yet run')
# Round 3H (#62): a pending driver shows one kit line, never five identical rows. Round 3 final (#66 item 6): each kit
# line fits one line at 1440; Cloudroom's status sentence says its kit run comes next, so "works" and "not run yet"
# never read as a conflict.
DRIVER_KIT_LINES = {
    'vps': 'Kit: passed, 5 of 5',
    'cloudroom': 'Kit: passed, 5 of 5',
    'grok-bot': 'Kit: not run yet',
}
# #66 item 2: the hero's host pills, in order, each saying in words what works today; every mark sits in one
# fixed-height slot (Grok Bot has no mark: its name in text). #66 facts: three passed, five of five; Grok Bot is coming.
HOST_PILLS = (
    ('vps', 'Your computer or VPS', 'passed 5 of 5', 'passed'),
    ('cloudroom', 'Cloudroom', 'passed 5 of 5', 'passed'),
    ('boat-dev', 'boat.dev', 'passed 5 of 5', 'passed'),
    ('grok-bot', 'Grok Bot', 'coming soon', 'coming soon'),
)
# Every number the page shows comes from these facts: the kit dates, the contract's v1 and the kit's result, 5 of 5.
# Other counts are said in words (#62 item 4).
DRIVER_NUMBERS = {'2026', '11', '19', '20', '1', '5'}
# #62 item 4: no jargon counts ("4 words", "5 checks in the kit", "1 passed", "3 of 5"), and the five-of-five result
# said at most twice in words on the page: the hero's one link and boat.dev's spotlight. #66 facts: the kit's own
# result, "5 of 5", is the one count shown in digits, in the host pills and the kit lines.
DRIVER_JARGON = re.compile(r'\b\d+\s+(?:drivers?|words?|checks?|commands?|passed)\b|\b(?!5 of 5\b)\d+\s+of\s+\d+\b', re.I)
DRIVER_RESULT = re.compile(r'\ball five checks\b|\bfive passed checks\b|\bfive of five\b', re.I)
DRIVER_RESULT_MAX = 2
# #62 item 1: what a driver is, in plain words, in the hero above every card: two sentences at most. #66 item 1: under
# the headline, first what OpenWiz's agents do, then the same four commands and five-check test; the command-by-command
# detail stays in the spotlight and Write your own driver, never in the hero.
DRIVER_EXPLAINER_WORDS = ('driver', 'agents', 'tickets', 'four commands', 'five-check test')
# The five checks as boat.dev passed them, each with what passing it proved, in plain words from kernel/driver.v1.md
# section 3; the spotlight is the page's one list of them.
PROOF_LINES = (
    ('version', 'It names the kernel\'s records version, and prints its schema unchanged.'),
    ('start', 'It answered a run id, and the agent\'s status note appeared on a throwaway ticket.'),
    ('wake', 'It reached the same run again: that note was edited, never a second one.'),
    ('stop', 'It ended the run: a wake after it was refused, and nothing the run started still runs.'),
    ('token', 'No credential appeared in its output, command lines or environment, and it refused a token field.'),
)
# #66 item 7: wherever token is explained, say only what the run inspected; no broader claim.
TOKEN_CLAIM = 'no credential appeared in its output, command lines or environment, and it refused a token field'
TOKEN_BROAD = re.compile(r'credentials? leaks?|leaks? no credential|never leaks?|proves? no credential|no credential (?:can|will|ever)', re.I)
DRIVER_LOGO_MAX = 30_000  # bytes, each logo
# #66 item 6: Grok Bot's card shows only a neutral generic icon from the same open-licence set, never a Grok or xAI mark.
DRIVER_GENERIC_ICON = ('grok-bot', 'drivers/logos/bot.svg')
DRIVER_MIN_FONT = 12  # px: no drivers-page text smaller
DRIVER_LABEL_TRACKING = 0.06  # em: the least tracking on an uppercase drivers-page label
OWN_DRIVER = 'Write your own driver'
OPENWIZ_REPO = 'https://github.com/openwizdev/OpenWiz'
# The meta description names the drivers that passed (#59 R2; #66 facts: all three, and Grok Bot coming soon).
DRIVER_DESCRIPTION = 'boat.dev, Cloudroom and your own computer or VPS passed all five checks; Grok Bot is coming soon'
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
        self.x_links = 0
        self.report_links = 0
        self.cloudroom_links = 0
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
        elif tag == 'a' and attrs.get('href') == X_ACCOUNT:
            # #75 R3: OpenWiz's X account, only as a link a visitor follows (check_site allows one, the footer's);
            # anywhere else, as a resource or in CSS, check_ref refuses it like any external URL.
            self.x_links += 1
            attrs = {key: value for key, value in attrs.items() if key != 'href'}
        elif tag == 'a' and attrs.get('href') == CLOUDROOM_LINK:
            # #1674: CloudRoom's site, exempt from check_ref by its exact href only; check_site allows one, the
            # landing install box's, and check_install pins the element around it.
            self.cloudroom_links += 1
            attrs = {key: value for key, value in attrs.items() if key != 'href'}
        elif tag == 'a' and attrs.get('href') == REPORT_LINK:
            # #1851: the Report a problem link, exempt from check_ref's no-query rule by its exact href only;
            # check_site counts it per page.
            # R2 (WizSite #90): no Referer, so the form request never carries the page the visitor came from.
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
    assert page.scripts == [f'/{names[GSAP]}', f'/{names["site.js"]}', f'/{names["faq.js"]}'], 'load the pinned GSAP before site.js, then faq.js'
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
        # #81: the team page's boat poster links to the X post too, beside the footer's X link.
        x_links = 2 if path == root / TEAM_PAGE else 1
        assert page.x_links == x_links, f'one X link per page, the footer\'s: {path.relative_to(root)} has {page.x_links}'
        for ref in page.refs:
            check_ref(root, path, ref, pages, page.favicons)
        # After check_ref, so a changed Report a problem URL is refused as an external URL first.
        assert page.cloudroom_links == (1 if path == root / 'index.html' else 0), \
            f'CloudRoom link, the landing install box\'s only: {path.relative_to(root)} has {page.cloudroom_links}'
        assert page.report_links == 1, f'Report a problem link: {path.relative_to(root)} has {page.report_links}, not 1'
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
    assert 'The real spec of an OpenWiz-built to-do app' in flat, 'the spec video must say it is the to-do app\'s real spec'
    # The three moments show the real to-do run on this page and never send the visitor away for it: no link out.
    section = re.search(r'<section class="moments[\s\S]*?</section>', re.sub(r'<!--.*?-->', '', landing, flags=re.S))
    section = section[0] if section else ''
    # Parsed, not pattern-matched, so a link written with single quotes or none counts too.
    links = Page(section)
    assert not links.books and not links.x_links and all(ref.startswith('/') and not ref.startswith('//') for ref in links.refs), \
        'the moments must keep visitors on the site: no link out'
    blocks = {}
    # Comments hide markup from visitors, so a commented-out moment or text counts as missing.
    for block in re.findall(r'<li class="(?:moment-step|spec-moment)[^"]*">.*?</(?:details|div)>\s*</li>', section, re.S):
        blocks[re.search(r'<h3>([^<]+)</h3>', block)[1]] = Text(block).spaced()
    for card, texts in zip(moments, TODO_RUN):
        for text in texts:
            assert text in blocks.get(card, ''), f'the {card} moment must show the real to-do run in place: {text}'
    # Each grill question shows with its own answer right after it: in the bubbles (open on phones) and in the expanded grill.
    grill = TODO_RUN[0]
    chat = re.search(r'<div class="moment-chat"[^>]*>(.*?)</div>', section, re.S)
    panel = re.search(r'<div class="moment-panel grill-panel">(.*?)</div>', section, re.S)
    for question, answer in zip(grill[::2], grill[1::2]):
        q, a = re.escape(escape(question, quote=False)), re.escape(escape(answer, quote=False))
        assert chat and re.search(rf'<p class="ask">{q}</p>\s*<p class="reply">{a}</p>', chat[1]), \
            f'the grill bubbles must show each question with its answer: {question}'
        assert panel and re.search(rf'<p class="ask"><strong>{q}</strong>[^<]*<span>[^<]*</span></p>\s*<p class="reply">{a}</p>', panel[1]), \
            f'the expanded grill must show each question with its answer: {question}'
    # The live app is shown as its pinned real capture, described, inside step 3.
    ship = re.search(r'<li class="moment-step moment-ship">.*?</li>', section, re.S)
    shot = next((i for i in Page(ship[0]).images if i.get('src') == TODO_APP and (i.get('alt') or '').strip()), None) if ship else None
    assert shot, f'the Watch it ship moment lost its described capture of the live app: {TODO_APP}'
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
    unlabelled = check_install(landing, pages[root / 'index.html'])
    assert not re.search(r'\b\d{4}-\d{2}-\d{2}\b', words), 'dated landing promise'
    changelog, releases = split_releases((root / 'changelog/index.html').read_text())
    # #1674 (J264): the install box's one version label (check_install reads it exactly and returns the landing
    # without that element) is the only version allowed.
    unlabelled = re.sub(r'\s+', ' ', unescape(re.sub(r'<[^>]*>', '', re.sub(r'<br>', ' ', unlabelled))))
    assert not re.search(r'(?<![\d.])\d+\.\d+\.\d+(?![\d.])', unlabelled), 'release version mentioned on the landing'
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
    check_driver_logo_files(root)
    check_drivers(landing, changelog, (root / DRIVERS_PAGE).read_text(), pages[root / DRIVERS_PAGE])
    check_drivers_nav((root / names['site.css']).read_text(), {name: (root / name).read_text() for name in PAGES})
    check_changelog(landing, changelog)
    check_releases(releases, read_releases(), install_switch(landing) == 'live')
    check_team({name: (root / name).read_text() for name in PAGES}, {name: pages[root / name] for name in PAGES})
    check_footer({name: (root / name).read_text() for name in PAGES})
    check_faq({name: (root / name).read_text() for name in PAGES}, {name: pages[root / name] for name in PAGES}, names)
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
INSTALL_VERSION = 'OpenWiz 0.01 0.1.0'  # the public name with its semver small beside it (#1674, J264)


def check_install(landing, page):
    flat = lambda html: re.sub(r'\s+', ' ', unescape(re.sub(r'<[^>]*>', '', html))).strip()
    boxes = re.findall(r'<div class="install-box"([^>]*)>([\s\S]*?)</div>\s*</div>', landing)
    assert len(boxes) == 1, 'exactly one install box'
    attrs, box = boxes[0]
    switch = re.fullmatch(r'\s*data-install="([^"]*)"\s*', attrs)
    assert switch and switch[1] in INSTALL_SWITCH, f'the install box needs its one switch, data-install = {" or ".join(INSTALL_SWITCH)}'
    lines = re.findall(r'<code class="install-line">([^<]*)</code>', box)
    assert lines == [INSTALL_LINE], f'the install line must read exactly: {INSTALL_LINE}'
    # #1674: the version label is the box's first element, the only one of its class on the landing (#46 R2).
    label = re.search(r'<div class="install-box"[^>]*>\s*(<p class="install-version">([^<]*<small>[^<]*</small>)</p>)', landing)
    assert label and landing.count('install-version') == 1 and flat(label[2]) == INSTALL_VERSION, f'the install box must show {INSTALL_VERSION}'
    # #1674 (RL2): the note is the box's last element, exactly, after its row.
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
    # Outside the box, no install wording or unsettled claim, in any reading of the page.
    rest = landing.replace(box, ' ', 1)
    reader = Text(rest)
    for reading in [reader.joined(), reader.spaced()] + reader.shown:
        assert not re.search(r'install|coming soon|paid plans|works today', re.sub(r'\s+', ' ', reading), re.I), 'unsettled landing claim or a second install mention'
    return landing[:label.start(1)] + landing[label.end(1):]


def check_changelog(landing, changelog):
    """The Changelog's name, and its source page: the title, one line, and nothing else in its main; no version number
    or date there, and no private repository named. `landing` and `changelog` are the two pages' HTML (the Changelog
    without its generated section)."""
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
    for style in page.styles:
        check_motion(style)


def check_public_names(html):
    """Fail closed: every Wiz name is a public one. Text read joined can run a name into the next name or into a
    lowercase word, never into a capital: "WizSkillsthe" passes, "WizVault" and "WizSiteOps" fail."""
    reader = Text(html)
    public = '(?:' + '|'.join(sorted(PUBLIC_WIZ_NAMES)) + ')+(?:[a-z][A-Za-z]*)?'
    for reading in [reader.joined(), reader.spaced()] + reader.attrs:
        for name in re.findall(r'\bWiz[A-Z][A-Za-z]*', reading):
            assert re.fullmatch(public, name), f'a private repository is named; say "private records and tools": {name}'


class DriverOutline(HTMLParser):
    """The drivers page's cards: each card's id, classes, name (its heading's text, or its heading logo's alt), status
    line, kit line and its state, per-check rows, pictures, and every link inside the Write your own driver section."""
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
        elif tag == 'svg' and 'kit-icon' not in classes:  # a kit state's icon shape is not a logo
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
        # A self-closed tag (<path/>, <img/>) opens and closes at once, so the depth stays balanced.
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
    """The drivers page (#50, round 3H #62): the landing's exact top bar with Drivers current; the explainer of what a
    driver is in the hero, above every card; boat.dev's spotlight first, then the three other drivers' compact cards
    in order with their exact facts and one kit line each; real logos, Grok Bot's name in text with only a generic icon; no jargon counts; the
    Write your own driver section linking only the public OpenWiz repository; no script; no invented number."""
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
    assert not re.search(r'\b(each|every)\b[^.]*\bpass', description[0], re.I), \
        f'the drivers description must not say every driver passes: {description[0]}'
    assert not DRIVER_JARGON.search(description[0]), f'a jargon count in the drivers description: {description[0]}'
    assert not re.search(r'grok bot[^.;]*\bpass', description[0], re.I), f'Grok Bot has not passed: {description[0]}'
    # #75 R1: the page itself reads without scripts; it loads only the site's own two (GSAP, then site.js), as every site
    # page does, for the shared footer's star count and Wizes.
    # (#76: the landing's faq.js is for its Questions, which the drivers page doesn't show.)
    assert page.scripts == [s for s in Page(landing).scripts if not s.startswith('/faq.')] and not page.inline_scripts, \
        'the drivers page loads only the site\'s footer scripts (GSAP, site.js), never its own'
    main = re.search(r'<main\b[^>]*>[\s\S]*?</main>', drivers)
    assert main, 'the drivers page needs its main'
    main = main[0]
    assert not re.search(r'\shidden\b', main), 'nothing on the drivers page waits for a script to show'
    check_driver_explainer(main)
    outline = DriverOutline(main)
    assert [(c['id'], c['name']) for c in outline.cards] == [(d[0], d[1]) for d in DRIVERS], \
        f'four driver cards, boat.dev first: {[(c["id"], c["name"]) for c in outline.cards]}'
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
        # #66 item 6: all three compact cards share one header structure: a generic icon or logo, then the name.
        heading = re.search(rf'<h3 class="driver-name" id="{key}-name">([\s\S]*?)</h3>', main)
        assert heading and re.fullmatch(rf'<img class="driver-logo[^"]*" src="/drivers/logos/[^"]+" alt="[^"]+"[^>]*><span>{re.escape(name)}</span>', heading[1].strip()), \
            f'{name}: the compact cards share one header structure (icon or logo, then the name): {heading[1] if heading else None!r}'
    check_driver_proof(main)
    check_host_pills(main)
    check_driver_results(drivers, main, outline)
    reader = Text(main)
    readings = [reader.joined(), reader.spaced()] + reader.shown
    for reading in readings:
        found = DRIVER_JARGON.search(re.sub(r'\b5 of 5\b', 'the kit result', re.sub(r'\s+', ' ', reading)))  # #66: the one count in digits
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
    assert not Outline(drivers).styles, 'the drivers page keeps its styles in site.css'
    check_driver_logins(main)
    check_driver_token(drivers, main)


def plain(html):
    return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', html)).strip()


def check_driver_explainer(main):
    """#62 item 1: one explainer of what a driver is, inside the hero and above every card, in two sentences at most,
    naming the four commands and the five-check test with token."""
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
    listed = [word for word in KIT_CHECKS if re.search(rf'\b{word}\b', text)] + re.findall(r'<code\b', found[0])
    assert not listed, f'the command-by-command detail stays out of the hero\'s explainer: {listed}'


def check_driver_logos(main, outline):
    """#62 item 2: every logo on the page is a pinned official file, used with alt text naming its host; every pinned
    logo is used; Grok Bot shows no Grok or xAI mark, only its generic icon (#66), and no Grok picture appears anywhere."""
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
    key, icon = DRIVER_GENERIC_ICON
    for card in outline.cards:
        if card['id'] == key:
            assert [src for src, _ in card['images']] == [f'/{icon}'] and not card['svgs'], \
                f'no Grok logo: {card["name"]} shows only the generic icon {icon}: {card["images"]}, {card["svgs"]} other pictures'
    assert used == set(DRIVER_LOGOS), f'unused drivers logos: {sorted(set(DRIVER_LOGOS) - used)}'
    assert not any('grok' in name.lower() for name in DRIVER_LOGOS), 'no Grok logo file'


def check_driver_logo_files(root):
    for name, (digest, _) in DRIVER_LOGOS.items():
        data = (root / name).read_bytes()
        assert sha256(data).hexdigest() == digest, f'a drivers logo changed bytes: {name}'
        assert len(data) <= DRIVER_LOGO_MAX, f'the drivers logo {name} is over {DRIVER_LOGO_MAX} bytes'


def check_driver_proof(main):
    """boat.dev's spotlight (#62), right after the hero and before the other drivers: the kit's five checks in order,
    each passed with its plain line, beside the crew painting; and no painting shown twice."""
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
    # #66 item 4: the mark, the clean headline, the date on its own line and the five checks come before the painting,
    # so on a phone they lead and the painting follows as the supporting image.
    assert spot.index('class="proof-copy"') < spot.index('class="proof-scene"'), \
        'the spotlight\'s mark, result and five checks come before its painting (phone order)'
    head = re.search(r'<p class="driver-line">([^<]*)</p>\s*<p class="driver-date">([\s\S]*?)</p>', spot)
    assert head and head[1] == DRIVERS[0][2] and plain(head[2]) == DRIVER_DATE, \
        f'the spotlight\'s headline reads {DRIVERS[0][2]!r}, then its own date line {DRIVER_DATE!r}: {head.groups() if head else None}'
    images = [src for src in re.findall(r'<img\b[^>]*\bsrc="([^"]+)"', main) if src.startswith('/art/')]
    twice = sorted({src for src in images if images.count(src) > 1})
    assert not twice, f'a painting shown twice on the drivers page: {twice}'


def check_host_pills(main):
    """#66 item 2: the hero's host pills, in order, each with its availability in words; every mark (Grok Bot has none)
    sits alone in the pill's fixed-height mark slot."""
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
        assert len(re.findall(r'<img\b', body)) == len(slots) == (0 if key == DRIVER_GENERIC_ICON[0] else 1), \
            f'the {name} pill\'s mark sits alone in its fixed-height slot: {body.strip()[:120]!r}'
        shown = plain(re.sub(r'<span class="host-state">[^<]*</span>', '', body)) or \
            ' '.join(re.findall(r'\balt="([^"]*)"', body))
        assert shown == name, f'the {name} pill names its host: {shown!r}'


def check_driver_results(drivers, main, outline):
    """#66 facts: boat.dev, Cloudroom and your own computer or VPS are shown as passed everywhere the page states a
    result (pill, card or spotlight, kit line, date and its public evidence), and Grok Bot never as passed; no word that
    described them before they passed comes back; boat.dev is never the only one said to have passed."""
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
            dated = re.findall(r'<p class="driver-date"><a href="([^"]+)">([\s\S]*?)</a></p>', card)
            assert [(href, plain(text)) for href, text in dated] == [(evidence, DRIVER_CARD_DATE.format(date))], \
                f'{name}: its card dates its kit run {date}, linked to its public evidence: {dated}'
        else:
            assert re.search(rf'<p class="driver-date"><a href="{re.escape(evidence)}">', card), \
                f'{name}: its spotlight date links to its public evidence {evidence}'
        assert f'datetime="{date}"' in card, f'{name}: its kit run is dated {date}'
        stale = DRIVER_STALE.search(plain(card) + ' ' + plain(pills.get(key, ('', ''))[1]))
        assert not stale, f'{name} passed the kit: no stale state word: {stale[0]!r}'
    coming = re.search(rf'<article class="driver[^"]*" id="{DRIVER_COMING}"[\s\S]*?</article>', main)
    assert pills.get(DRIVER_COMING, ('',))[0] == 'coming soon' and coming and cards[DRIVER_COMING]['kit_state'] != 'passed' \
        and not re.search(r'\bpass', plain(coming[0]) + ' ' + pills[DRIVER_COMING][1], re.I), \
        f'Grok Bot has not run the kit: never shown as passed'
    spot = re.search(r'<section class="spotlight[\s\S]*?</section>', main)[0]
    also = re.findall(r'</ol>\s*<p class="proof-also">([\s\S]*?)</p>', spot)
    assert [plain(a) for a in also] == [DRIVER_ALSO], \
        f'boat.dev is one of three: under its five checks, the spotlight says {DRIVER_ALSO!r}: {also}'
    rest = re.sub(rf'<article class="driver[^"]*" id="{DRIVER_COMING}"[\s\S]*?</article>', '', main)
    rest = re.sub(rf'<li data-host="{DRIVER_COMING}"[\s\S]*?</li>', '', rest)
    stale = DRIVER_STALE.search(re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', rest)) + ' ' + ' '.join(re.findall(r'content="([^"]*)"', drivers)))
    assert not stale, f'a stale driver state word on the drivers page: {stale[0]!r}'
    only = re.search(r'\bonly (?:boat\.dev|one)\b[^.]*\bpass|\bboat\.dev is the only\b', re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', unescape(drivers))), re.I)
    assert not only, f'boat.dev is never the only one that passed: {only[0]!r}'


def check_driver_logins(main):
    """OpenWiz #2005: each driver shows its login line right after its name, word for word from its README; a card with
    no driver yet (Grok Bot) shows none, and no login line sits outside a driver card."""
    cards = {key: re.search(rf'<article class="driver[^"]*" id="{key}"[\s\S]*?</article>', main) for key, *_ in DRIVERS}
    for key, name, _, _ in DRIVERS:
        card = cards[key][0] if cards[key] else ''
        want = [DRIVER_LOGINS[key]] if key in DRIVER_LOGINS else []
        lines = [plain(line) for line in re.findall(r'<p class="driver-login">([\s\S]*?)</p>', card)]
        assert lines == want, f'{name}: its login line must read exactly {want}: {lines}'
        if want:
            assert re.search(r'</h[23]>\s*<p class="driver-login">', card), f'{name}: its login line sits right after its name'
    found = len(re.findall(r'class="driver-login"', main))
    assert found == len(DRIVER_LOGINS), f'a login line only on a driver card: {found} on the page'


def check_driver_token(drivers, main):
    """#66 item 7: wherever token is explained (boat.dev's token row and Write your own driver's), say what the run
    inspected, in the scoped words, and nowhere make a broader claim."""
    rows = re.findall(r'data-check="token"[^>]*>([\s\S]*?)</li>', main) + \
        re.findall(r'<dt><code>token</code></dt><dd>([\s\S]*?)</dd>', main)
    assert len(rows) == 2, f'token is explained in the spotlight and in Write your own driver: {len(rows)}'
    for row in rows:
        assert TOKEN_CLAIM in plain(row).lower(), f'say what the token check inspected: {TOKEN_CLAIM!r}: {plain(row)!r}'
    broad = TOKEN_BROAD.search(re.sub(r'\s+', ' ', plain(drivers)) + ' ' + ' '.join(re.findall(r'content="([^"]*)"', drivers)))
    assert not broad, f'a broader token claim than the run inspected: {broad[0]!r}'


def check_team(htmls, pages):
    """#63: every site page's top bar has the one buy button to /team/; the team page has its copy, no price, and the
    site's one booking link: the placeholder (an id on the page) or an https URL with no credentials."""
    for name, html in htmls.items():
        bar = top_bar(html)
        assert bar.count('class="nav-team"') == 1 and bar.count(CTA_LINK) == 1, f'the {name} top bar needs its one buy button to /team/'
        assert html.count('class="nav-team"') == 1, f'the {name} page needs exactly one buy button'
    # Two Book a call links, the hero's and the closing one (#73), both on the team page with the one booking value.
    books = [(name, href) for name, page in pages.items() for href in page.books]
    assert len(books) == 2 and all(name == TEAM_PAGE for name, _ in books), f'the site needs its two booking links, both on the team page: {books}'
    assert books[0][1] == books[1][1], f'both booking links share the one booking value: {books}'
    href = books[0][1]
    if href == BOOK_PLACEHOLDER:
        assert 'book' in pages[TEAM_PAGE].ids, 'the booking placeholder needs its id on the team page'
    else:
        url = urlsplit(href)
        assert url.scheme == 'https' and url.netloc and not url.username and not url.password, f'the booking link must be https: {href}'
    flat = re.sub(r'\s+', ' ', unescape(re.sub(r'<[^>]*>', ' ', htmls[TEAM_PAGE])))
    assert not re.search(r'[$€£]\s*\d|\bper (?:month|seat|user)\b', flat, re.I), 'the team page shows no price'
    labels = re.findall(r'<a [^>]*data-book[^>]*>([^<]*)</a>', htmls[TEAM_PAGE])
    assert labels == ['Book a call', 'Book a call'], f'team page copy: both booking links read Book a call: {labels}'
    main = htmls[TEAM_PAGE].split('<footer', 1)[0]
    parts = [plain(h) for h in re.findall(r'<h2\b[^>]*>([\s\S]*?)</h2>', main)]
    assert parts == list(TEAM_PARTS), f'the team page sections, in order: {parts}'
    h1 = re.findall(r'<h1\b[^>]*>([\s\S]*?)</h1>', main)
    assert [plain(h) for h in h1] == [TEAM_HEADLINE], f'the team page headline: {h1}'
    # #81: the hero holds the headline, the first Book a call and the three terms right under it, under their label (#89).
    # #89: its second column is the timeline; the poster is in Proof.
    hero = re.search(r'<div class="team wrap">([\s\S]*?)\n</div>\n', main)
    assert hero, 'the team page needs its hero'
    hero = hero[1]
    terms = re.search(r'<ul class="team-terms"[^>]*>([\s\S]*?)</ul>', hero)
    assert terms and [plain(t) for t in re.findall(r'<li>([\s\S]*?)</li>', terms[1])] == list(TEAM_TERMS), \
        f'the terms: three exact lines right under the hero button: {TEAM_TERMS}'
    assert hero.index('data-book') < hero.index('class="team-terms"'), 'the terms: under the first Book a call'
    label = re.search(r'<p class="team-label" id="([^"]+)">([^<]*)</p>\s*<ul class="team-terms" aria-labelledby="([^"]+)"', hero)
    assert label and label[2] == TEAM_TERMS_LABEL and label[1] == label[3], f'the terms: under their label, {TEAM_TERMS_LABEL}'
    assert 'wizes' not in plain(hero).lower(), 'no Wizes in the team hero'
    assert 'class="team-steps"' in hero and hero.index('class="team-terms"') < hero.index('class="team-steps"'), \
        'the timeline: in the hero, after the terms'
    assert 'x.com' not in hero and '<img' not in hero, 'the hero shows no poster: it is in Proof'
    proof = re.search(r'<section class="team-part wrap" aria-labelledby="team-proof">([\s\S]*?)</section>', main)
    assert proof, 'Proof: its section'
    proof = proof[1]
    cards = re.findall(r'<li class="team-card">([\s\S]*?)</li>\n', proof)
    assert len(cards) == 3 and proof.count('<li') == 3, f'Proof: three cards: {len(cards)}'
    passed = re.fullmatch(r'\s*<h3>([^<]*)</h3>\s*<p>([^<]*)</p>\s*<div class="team-logos">([\s\S]*?)</div>\s*'
                          r'<p class="team-soon">Grok Bot: coming soon</p>\s*<a href="/drivers/">See how drivers work</a>\s*', cards[0])
    logos = re.findall(r'<img\b[^>]*src="([^"]*)"[^>]*>\s*(?:<span>[^<]*</span>\s*)?<small>([^<]*)</small>', passed[3]) if passed else []
    assert passed and (passed[1], passed[2]) == (TEAM_PASSED_HEADING, TEAM_PASSED_ABOUT) \
        and [src for src, _ in logos] == list(TEAM_PASSED) and all(line == TEAM_PASSED_LINE for _, line in logos), \
        f'Proof: the first card: {TEAM_PASSED_HEADING}, what the checks are, the three drivers\u2019 logos with ' \
        f'{TEAM_PASSED_LINE} under each, Grok Bot coming soon and See how drivers work, to /drivers/'
    built = re.fullmatch(r'\s*<p>([^<]*)</p>\s*<a href="/drivers/">See the Drivers page</a>\s*', cards[1])
    assert built and built[1].startswith('Our Drivers page was built the same way'), \
        'Proof: the second card says how the Drivers page was built, with its one link, See the Drivers page'
    poster = re.findall(r'<a [^>]*href="https://x\.com/openwiz"[^>]*>([\s\S]*?)</a>', cards[2])
    images = [dict(re.findall(r'([a-z-]+)="([^"]*)"', img)) for img in re.findall(r'<img\b[^>]*>', poster[0])] if len(poster) == 1 else []
    assert len(images) == 1 and images[0].get('src') == TEAM_POSTER and images[0].get('alt') == TEAM_POSTER_ALT \
        and images[0].get('width') == '1280' and images[0].get('height') == '720' and images[0].get('loading') == 'lazy', \
        f'the boat poster: Proof\u2019s third card, one sized, lazy picture linking to the X post: {images}'
    assert 'Watch the fleet build it (49 s, on X)' in plain(poster[0]), 'the boat poster: its label is its caption'
    assert not re.search(r'<(?:video|iframe|embed|object|details)\b', main.replace(FAQ, '')), 'the team page embeds no video and folds nothing away'
    steps = re.search(r'<ol class="team-steps">([\s\S]*?)</ol>', main)
    found = re.findall(r'<li( class="team-end")?><h3>([\s\S]*?)</h3><p>([\s\S]*?)</p></li>', steps[1]) if steps else []
    assert [(plain(m), plain(t)) for _, m, t in found] == list(TEAM_STEPS), f'The 30 minutes, roughly: its four marks, in order: {TEAM_STEPS}'
    assert [bool(end) for end, _, _ in found] == [False, False, False, True] and steps[1].count('team-end') == 1, \
        'The 30 minutes, roughly: Minute 30 is its one highlighted stop'
    ships = re.search(r'</ol>\s*<p class="team-ships">([\s\S]*?)</p>', main)
    assert ships and plain(ships[1]) == TEAM_SHIPS, 'the ships line: right under the timeline'
    # This page's own copy, without the shared Questions (#76), which check_faq owns.
    own = main.replace(FAQ, '')
    shown = re.sub(r'\s+', ' ', unescape(re.sub(r'<[^>]*>', ' ', own)))
    assert not TEAM_NEVER.search(shown), f'a word the team page never uses: {TEAM_NEVER.search(shown)[0]}'
    assert "'" not in shown and "'" not in ' '.join(re.findall(r'aria-label="([^"]*)"', own)), \
        'the team page uses curly apostrophes'
    assert not re.search(r'\bhidden\b|aria-hidden', own.split('<main', 1)[1]), 'the team page hides none of its copy'
    # Last, so a broken part above fails on its own line first: the rest of the round 1 copy, word for word.
    for text in TEAM_COPY:
        assert text in flat, f'missing team page copy: {text}'


def check_footer(htmls):
    """#73: every site page has the one footer from footer.html, once, at its end: both link groups in order, the small
    line, the wordmark and the twelve Wizes."""
    for name, html in htmls.items():
        assert html.count('<footer') == 1 and html.count(FOOTER) == 1, f'the {name} page needs the one site footer'
        assert html.rstrip().endswith(FOOTER + '</body></html>'), f'the {name} page ends with the site footer'
    links = [(href, plain(text)) for href, text in re.findall(r'<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)</a>', FOOTER)]
    assert tuple(links) == FOOTER_LINKS, f'the footer links, in order: {links}'
    groups = [plain(h) for h in re.findall(r'<h2>([\s\S]*?)</h2>', FOOTER)]
    assert groups == ['Product', 'Company'], f'the footer link groups: {groups}'
    assert FOOTER_LINE in plain(FOOTER), f'the footer says {FOOTER_LINE}'
    assert '<p class="footer-wordmark">OpenWiz</p>' in FOOTER, 'the footer shows the wordmark'
    assert FOOTER.count('class="family-wiz"') == 12, 'the footer has the twelve Wizes'


def check_faq(htmls, pages, names):
    """#76: the landing, /team and /faq each show the one Questions snippet from faq.html, once, and load faq.js; no other
    page shows it. On the landing it closes the main; on /team it sits right above the closing Book a call. Each row is a
    real button that names its answer, shipped open and disabled until faq.js runs; the answers link only within the site."""
    for name, html in htmls.items():
        want = FAQ_ON.get(name)
        assert html.count('class="faq ') == (1 if want else 0) and (not want or html.count(want) == 1), \
            f'the {name} page needs the one Questions section from faq.html' if want else f'the {name} page shows no Questions'
        assert (f'/{names["faq.js"]}' in pages[name].scripts) == bool(want), \
            f'the {name} page needs faq.js for its Questions' if want else f'the {name} page loads faq.js without Questions'
    assert re.search(r'</section>\n' + re.escape(FAQ) + '</main>', htmls['index.html']), 'the landing Questions close its main'
    assert (FAQ + '<section class="team-part team-close') in htmls[TEAM_PAGE], 'the /team Questions sit above its closing Book a call'
    assert (FAQ_TOP + '</main>') in htmls[FAQ_PAGE], 'the /faq page is its Questions'
    Page(FAQ)  # its ids never repeat
    title = [plain(h) for h in re.findall(r'<h2\b[^>]*>([\s\S]*?)</h2>', FAQ)] + [plain(p) for p in re.findall(r'<p class="faq-lead">([\s\S]*?)</p>', FAQ)]
    assert tuple(title) == FAQ_TITLE, f'the Questions heading and its line: {title}'
    rows = re.findall(r'<div class="faq-row">\s*<h3 class="faq-q"><button ([^>]*)>([\s\S]*?)</button></h3>\s*<div class="faq-a" id="([^"]*)"><div>([\s\S]*?)</div></div>\s*</div>', FAQ)
    assert tuple(plain(q) for _, q, _, _ in rows) == FAQ_QUESTIONS and FAQ.count('class="faq-row"') == len(FAQ_QUESTIONS), \
        f'the Questions rows, in order: {[plain(q) for _, q, _, _ in rows]}'
    for attrs, question, answer_id, answer in rows:
        assert 'type="button"' in attrs and f'aria-controls="{answer_id}"' in attrs, \
            f'each question is a button that names its answer: {plain(question)}'
        # #77 R1: it ships open and disabled, so its answer reads even if faq.js never loads; faq.js closes and enables it.
        assert re.search(r'(?:^|\s)disabled(?:\s|$)', attrs) and 'aria-expanded="true"' in attrs, \
            f'each question ships open and disabled until faq.js runs: {plain(question)}'
        assert plain(answer), f'a question without its answer: {plain(question)}'
        for href in re.findall(r'href="([^"]*)"', answer):
            assert href.startswith('/'), f'an answer links off the site: {href}'
    where = [plain(a) for _, q, _, a in rows if plain(q) == 'Where do my agents run?']
    assert where == [FAQ_WHERE], f'the Questions\u2019 answer to Where do my agents run?: {FAQ_WHERE}'
    assert rows and plain(rows[-1][3]) == FAQ_LAST, f'the Questions\u2019 last answer: {FAQ_LAST}'
    assert not re.search(r'<(?:form|input|textarea)\b', FAQ), 'part 1 asks nothing: no form or input in the Questions'


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


def css_rules(css, selector):
    return [body for sel, body in re.findall(r'([^{}]+)\{([^{}]*)\}', css) if selector in [s.strip() for s in sel.split(',')]]


def check_driver_css(css):
    """Round 2F (#56): no drivers-page text under DRIVER_MIN_FONT px. Round 3 final (#66): every host pill's mark is
    scaled inside one fixed-height slot; on a phone the spotlight's painting follows as a shorter image."""
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
    # #74 R1: an official mark shows whole, as its file draws it: no rounded corners, clip or crop on a logo image.
    for sel, body in re.findall(r'([^{}]+)\{([^{}]*)\}', css):
        if re.search(r'host-(?:tile|lockup|icon)\b|spot-logo|driver-logo|host-mark img', sel):
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


def install_switch(landing):
    found = re.findall(r'<div class="install-box" data-install="([^"]*)"', landing)
    assert len(found) == 1, 'the landing needs exactly one install box switch'
    return found[0]


def read_releases(folder=RELEASE_DIR):
    """Every release data file, checked, as {file name: data}."""
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
    """One release: its public name (also the file name), semver from 0.1.0 on, date, a one-line headline, a short
    list of plain bullets (1 to 6, each at most 120 characters) and the link to its full notes on GitHub."""
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
    check_public_names(escape(' '.join(text + bullets)))  # data is text: escaped, as the page shows it


class ReleaseOutline(HTMLParser):
    """The generated section's tags, its entries (name, small line, date, headline, bullets, links) and its last line."""
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
    """The generated entries: none until the landing's install switch reads live, then one per release file, newest
    first by semver, each exactly its data; then one line pointing at the earlier pre-releases on GitHub."""
    outline = ReleaseOutline(section)
    allowed = {'section': {'class', 'aria-label'}, 'article': {'class', 'aria-labelledby'}, 'h2': {'id'}, 'small': set(),
               'time': {'datetime'}, 'p': {'class'}, 'ul': set(), 'li': set(), 'a': {'href'}}
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
        # Never claim an unreleased version: before the switch reads live, the line alone, with no version or date.
        assert not re.search(r'\d+\.\d+|\b(?:19|20)\d\d\b', Text(section).joined()), 'no release version shows before the install switch reads live'


def check_app(root, names, pages):
    """The app's page: fingerprinted Ember and scripts only, no inline script, local links, its manifest, its CSP."""
    page = Page((root / APP_PAGE).read_text())
    assert not page.books, 'a booking link outside the team page: the app'
    assert not page.x_links, 'one X link per page, the footer\'s: the app has one'
    assert not page.report_links, 'Report a problem link, the footer\'s: the app has one'
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
        pinned = DOC_HASHES.get(path) or ICON_HASHES.get(font) or DRIVER_LOGOS.get(font, (None,))[0]
        assert pinned and sha256(data).hexdigest() == pinned, 'unreviewed picture'
        assert not any(marker.encode() in data.lower() for marker in DENYLIST), f'private marker in {path}'
    if font in VECTORS:
        check_vector(data)
    if font in DRIVER_LOGOS:
        assert sha256(data).hexdigest() == DRIVER_LOGOS[font][0], f'a drivers logo changed bytes: {path}'
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

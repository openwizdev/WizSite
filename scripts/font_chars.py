#!/usr/bin/env python3
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parent.parent

SUBSET_RANGES = (
    (0x0020, 0x007E),
    (0x00A0, 0x00FF),
    (0x0100, 0x017F),
    (0x2000, 0x206F),
    (0x20A0, 0x20CF),
    (0x2190, 0x21FF),
    (0x2212, 0x2212),
)
SUBSET_CODEPOINTS = frozenset(cp for lo, hi in SUBSET_RANGES for cp in range(lo, hi + 1))
UNICODE_RANGE = ', '.join(f'U+{lo:04X}' if lo == hi else f'U+{lo:04X}-{hi:04X}' for lo, hi in SUBSET_RANGES)
PYFTSUBSET_UNICODES = ','.join(f'U+{lo:04X}' if lo == hi else f'U+{lo:04X}-{hi:04X}' for lo, hi in SUBSET_RANGES)

SYSTEM_FALLBACK_CHARS = frozenset({'\u2318', '\u25b4', '\u25be', '\u27a1', '\ufe0f'})

HTML_PAGES = (
    'index.html',
    'changelog/index.html',
    'drivers/index.html',
    'team/index.html',
    'faq/index.html',
    'market/index.html',
    'app/index.html',
)
HTML_SNIPPETS = ('header-cta.html', 'footer.html', 'faq.html')
CSS_FILES = (
    'tokens.css',
    'site.css',
    'changelog/changelog.css',
    'market/market.css',
    'app/ember.css',
)
JS_FILES = ('site.js', 'faq.js')


class _TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self._skip = 0
        self.chunks = []

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self._skip += 1

    def handle_endtag(self, tag):
        if tag in ('script', 'style') and self._skip:
            self._skip -= 1

    def handle_data(self, data):
        if not self._skip:
            self.chunks.append(data)


def extract_html_text(text):
    parser = _TextExtractor()
    parser.feed(text)
    parser.close()
    return ''.join(parser.chunks)


def extract_css_content(text):
    out = []
    for match in re.finditer(r'\bcontent\s*:\s*([^;{}]+)', text):
        val = match.group(1)
        for q in re.finditer(r'"((?:\\.|[^"\\])*)"|\'((?:\\.|[^\'\\])*)\'', val):
            out.append(q.group(1) if q.group(1) is not None else q.group(2))
    return ''.join(out)


def _decode_js_escapes(s):
    s = re.sub(r'\\u\{([0-9a-fA-F]+)\}', lambda m: chr(int(m.group(1), 16)), s)
    s = re.sub(r'\\u([0-9a-fA-F]{4})', lambda m: chr(int(m.group(1), 16)), s)
    s = re.sub(r'\\x([0-9a-fA-F]{2})', lambda m: chr(int(m.group(1), 16)), s)
    return s


def extract_js_strings(text):
    pattern = re.compile(
        r'//[^\n]*|/\*[\s\S]*?\*/'
        r'|\'((?:\\.|[^\'\\\n])*)\''
        r'|"((?:\\.|[^"\\\n])*)"'
        r'|`((?:\\.|[^`\\])*)`'
    )
    out = []
    for match in pattern.finditer(text):
        lit = match.group(1) if match.group(1) is not None else (
            match.group(2) if match.group(2) is not None else match.group(3)
        )
        if lit is not None:
            out.append(_decode_js_escapes(lit))
    return ''.join(out)


def extract_json_strings(obj):
    out = []
    if isinstance(obj, str):
        out.append(obj)
    elif isinstance(obj, list):
        for item in obj:
            out.extend(extract_json_strings(item))
    elif isinstance(obj, dict):
        for val in obj.values():
            out.extend(extract_json_strings(val))
    return out


def _collect_chars(chars, text, source):
    for ch in text:
        cp = ord(ch)
        if cp < 0x20 or cp == 0x7F:
            continue
        chars.setdefault(ch, set()).add(source)


def scan_sources(root=ROOT):
    root = Path(root)
    chars = {}
    for rel in HTML_PAGES + HTML_SNIPPETS:
        path = root / rel
        if path.exists():
            _collect_chars(chars, extract_html_text(path.read_text('utf-8')), rel)
    css_paths = [root / rel for rel in CSS_FILES]
    for folder in ('app/pages', 'app/cards'):
        if (root / folder).exists():
            css_paths.extend(sorted((root / folder).glob('*.css')))
    for path in css_paths:
        if path.exists():
            rel = path.relative_to(root).as_posix()
            _collect_chars(chars, extract_css_content(path.read_text('utf-8')), rel)
    js_paths = [root / rel for rel in JS_FILES]
    if (root / 'app').exists():
        js_paths.extend(sorted((root / 'app').rglob('*.js')))
    for path in js_paths:
        if path.exists():
            rel = path.relative_to(root).as_posix()
            _collect_chars(chars, extract_js_strings(path.read_text('utf-8')), rel)
    releases_dir = root / 'changelog/releases'
    if releases_dir.exists():
        for path in sorted(releases_dir.glob('*.json')):
            rel = path.relative_to(root).as_posix()
            data = json.loads(path.read_text('utf-8'))
            _collect_chars(chars, ''.join(extract_json_strings(data)), rel)
    registry = root / 'market/registry.json'
    if registry.exists():
        data = json.loads(registry.read_text('utf-8'))
        _collect_chars(chars, ''.join(extract_json_strings(data)), 'market/registry.json')
    featured = root / 'market/featured.json'
    if featured.exists():
        data = json.loads(featured.read_text('utf-8'))
        _collect_chars(chars, ''.join(extract_json_strings(data)), 'market/featured.json')
    return chars


def scan_built(dist_root, src_root=ROOT):
    dist_root = Path(dist_root)
    src_root = Path(src_root)
    chars = {}
    for rel in HTML_PAGES:
        path = dist_root / rel
        if path.exists():
            _collect_chars(chars, extract_html_text(path.read_text('utf-8')), f'dist/{rel}')
    for path in sorted(dist_root.rglob('*.css')):
        rel = path.relative_to(dist_root).as_posix()
        _collect_chars(chars, extract_css_content(path.read_text('utf-8')), f'dist/{rel}')
    for path in sorted(dist_root.rglob('*.js')):
        rel = path.relative_to(dist_root).as_posix()
        if rel.startswith(('vendor/', 'app/vendor/')):
            continue
        _collect_chars(chars, extract_js_strings(path.read_text('utf-8')), f'dist/{rel}')
    releases_dir = src_root / 'changelog/releases'
    if releases_dir.exists():
        for path in sorted(releases_dir.glob('*.json')):
            rel = path.relative_to(src_root).as_posix()
            data = json.loads(path.read_text('utf-8'))
            _collect_chars(chars, ''.join(extract_json_strings(data)), rel)
    registry = src_root / 'market/registry.json'
    if registry.exists():
        data = json.loads(registry.read_text('utf-8'))
        _collect_chars(chars, ''.join(extract_json_strings(data)), 'market/registry.json')
    featured = src_root / 'market/featured.json'
    if featured.exists():
        data = json.loads(featured.read_text('utf-8'))
        _collect_chars(chars, ''.join(extract_json_strings(data)), 'market/featured.json')
    return chars


def unexpected_chars(chars):
    return {
        ch: sorted(sources)
        for ch, sources in sorted(chars.items(), key=lambda kv: ord(kv[0]))
        if ord(ch) not in SUBSET_CODEPOINTS and ch not in SYSTEM_FALLBACK_CHARS
    }


def check_font_chars(dist_root, src_root=ROOT):
    bad = unexpected_chars(scan_built(dist_root, src_root))
    if bad:
        details = ', '.join(
            f'U+{ord(ch):04X} ({ch!r}) in {"/".join(srcs[:2])}'
            for ch, srcs in bad.items()
        )
        raise AssertionError(f'character outside font subset: {details}')


def main():
    chars = scan_sources(ROOT)
    extra = unexpected_chars(chars)
    fallback = sorted((ch for ch in chars if ch in SYSTEM_FALLBACK_CHARS), key=ord)
    non_ascii = sorted((ch for ch in chars if ord(ch) >= 0x80), key=ord)
    print(f'Unique printable characters in site sources: {len(chars)}')
    print(f'Subset ranges ({len(SUBSET_CODEPOINTS)} codepoints): {UNICODE_RANGE}')
    print(f'pyftsubset --unicodes={PYFTSUBSET_UNICODES}')
    print('Non-ASCII characters used:', ' '.join(f'U+{ord(c):04X}({c})' for c in non_ascii))
    if fallback:
        print('System-fallback symbols (not in Geist):', ' '.join(f'U+{ord(c):04X}({c})' for c in fallback))
    if extra:
        print('ERROR: characters outside font subset:', extra, file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())

from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parent.parent
AA_TEXT, CONTROL_EDGE = 4.5, 3.0


def colours(path, prefix):
    return dict(re.findall(rf'--({prefix}[\w-]+):\s*(#[0-9a-fA-F]{{6}})\b', (ROOT / path).read_text()))


def luminance(hex_colour):
    channels = [int(hex_colour[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    r, g, b = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in channels]
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b):
    high, low = sorted((luminance(a), luminance(b)), reverse=True)
    return (high + 0.05) / (low + 0.05)


class Contrast(unittest.TestCase):
    def assert_contrast(self, palette, fronts, backs, least):
        for front in fronts:
            for back in backs:
                ratio = contrast(palette[front], palette[back])
                self.assertGreaterEqual(ratio, least, f'--{front} on --{back}: {ratio:.2f}:1, needs {least}:1')

    def test_site_text_and_control_edges_read_on_every_dark_surface(self):
        tokens = colours('tokens.css', 'ow-color-')
        surfaces = [f'ow-color-{s}' for s in ('canvas', 'sheet', 'panel', 'overlay', 'hover', 'selected')]
        self.assert_contrast(tokens, [f'ow-color-text-{t}' for t in ('primary', 'secondary', 'tertiary')], surfaces, AA_TEXT)
        self.assert_contrast(tokens, ['ow-color-control-edge'], surfaces, CONTROL_EDGE)

    def test_app_text_reads_on_every_ember_surface(self):
        ember = colours('app/ember.css', 'em-')
        self.assert_contrast(ember, ['em-text', 'em-text-2', 'em-muted'], ['em-bg', 'em-side', 'em-card', 'em-card-hover'], AA_TEXT)


if __name__ == '__main__':
    unittest.main()

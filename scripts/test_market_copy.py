import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class MarketCopyTest(unittest.TestCase):
    def test_install_clipboard_in_browser(self):
        result = subprocess.run(
            ["node", "--test", "tests/market-copy-fixtures/copy.test.mjs"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=60,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

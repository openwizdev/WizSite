from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]


class MarketBrowser(unittest.TestCase):
    def test_market_in_a_browser(self):
        run = subprocess.run(['node', 'scripts/market-check.mjs'], cwd=ROOT, capture_output=True, text=True, timeout=600)
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)


if __name__ == '__main__':
    unittest.main()

"""Runs the landing page's browser check (scripts/landing-check.mjs) as part of npm test; needs the build first."""
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]


class Landing(unittest.TestCase):
    def test_landing_in_a_browser(self):
        run = subprocess.run(['node', 'scripts/landing-check.mjs'], cwd=ROOT, capture_output=True, text=True, timeout=600)
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)


if __name__ == '__main__':
    unittest.main()

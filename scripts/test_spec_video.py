"""Runs the "Watch your spec" moment's browser check (scripts/spec-video-check.mjs) as part of npm test; needs the build first."""
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]


class SpecVideo(unittest.TestCase):
    def test_spec_video_in_a_browser(self):
        run = subprocess.run(['node', 'scripts/spec-video-check.mjs'], cwd=ROOT, capture_output=True, text=True, timeout=300)
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)


if __name__ == '__main__':
    unittest.main()

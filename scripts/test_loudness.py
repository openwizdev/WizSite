from pathlib import Path
import json
import re
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
NARRATED = ['art/todo-spec.mp4']


def loudness(path):
    run = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', str(path), '-af', 'loudnorm=I=-16:TP=-1.5:print_format=json',
                          '-vn', '-f', 'null', '-'], capture_output=True, text=True, timeout=120)
    found = json.loads(re.search(r'\{[^{}]*"input_i"[^{}]*\}', run.stderr).group(0))
    return float(found['input_i']), float(found['input_tp'])


@unittest.skipUnless(shutil.which('ffmpeg'), 'ffmpeg is needed to measure loudness')
class Loudness(unittest.TestCase):
    def test_narrated_spec_videos_are_as_loud_as_the_launch_film(self):
        for name in NARRATED:
            with self.subTest(video=name):
                integrated, peak = loudness(ROOT / name)
                self.assertGreaterEqual(integrated, -17.5, f'{name} is too quiet: {integrated} LUFS (aim for -16)')
                self.assertLessEqual(integrated, -14.5, f'{name} is too loud: {integrated} LUFS (aim for -16)')
                self.assertLessEqual(peak, -1.0, f'{name} clips: true peak {peak} dBTP (keep it at or under -1.5)')


if __name__ == '__main__':
    unittest.main()

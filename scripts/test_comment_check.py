import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
WORKFLOW = ROOT / '.github' / 'workflows' / 'site.yml'
CHECKER = ROOT / 'tools' / 'comment-check' / 'check.py'
STEP = 'Check added comments against contracts/comments.v1.md'


def step_script():
    lines = WORKFLOW.read_text().split('\n')
    start = next((i for i, line in enumerate(lines) if line.strip() == f'- name: {STEP}'), None)
    if start is None:
        raise AssertionError(f'the Site workflow has no "{STEP}" step')
    step, indent = {}, len(lines[start]) - len(lines[start].lstrip()) + 2
    i = start + 1
    while i < len(lines) and (not lines[i].strip() or len(lines[i]) - len(lines[i].lstrip()) >= indent):
        m = re.match(r'^\s*(if|run):\s*(.*)$', lines[i])
        if m and m.group(1) == 'run' and m.group(2) == '|':
            body = []
            i += 1
            while i < len(lines) and (not lines[i].strip() or len(lines[i]) - len(lines[i].lstrip()) > indent):
                body.append(lines[i][indent + 2:])
                i += 1
            step['run'] = '\n'.join(body).strip() + '\n'
            continue
        if m:
            step[m.group(1)] = m.group(2)
        i += 1
    return step


def git(cwd, *args):
    return subprocess.run(['git', '-C', str(cwd), *args], check=True, capture_output=True, text=True).stdout.strip()


class PullRequest:
    def __init__(self, test):
        tmp = tempfile.TemporaryDirectory()
        test.addCleanup(tmp.cleanup)
        self.origin, self.runner = Path(tmp.name) / 'origin', Path(tmp.name) / 'runner'
        git(tmp.name, 'init', '-q', '-b', 'main', str(self.origin))
        git(self.origin, 'config', 'uploadpack.allowAnySHA1InWant', 'true')
        for key, value in (('user.name', 'Synthetic'), ('user.email', 'synthetic@example.com')):
            git(self.origin, 'config', key, value)
        (self.origin / 'tools' / 'comment-check').mkdir(parents=True)
        shutil.copy(CHECKER, self.origin / 'tools' / 'comment-check' / 'check.py')
        self.write('site.js', 'const answer = 42;\n')
        self.write('old.js', '// an old comment on main\nconst old = 1;\n')
        self.commit('main')
        git(self.origin, 'checkout', '-q', '-b', 'feature')
        self.write('later.js', 'const later = 1;\n')
        self.commit('a commit main gets after the branch')
        git(self.origin, 'checkout', '-q', 'main')
        git(self.origin, 'merge', '-q', '--ff-only', 'feature')
        git(self.origin, 'checkout', '-q', '-b', 'pr', 'main~1')

    def write(self, path, text):
        (self.origin / path).write_text(text)

    def commit(self, message):
        git(self.origin, 'add', '-A')
        git(self.origin, 'commit', '-q', '-m', message)

    def ci(self, path, text):
        self.write(path, text)
        self.commit('the pull request')
        git(self.origin, 'checkout', '-q', 'main')
        git(self.origin, 'merge', '-q', '--no-ff', '-m', 'the merge ref', 'pr')
        merge = git(self.origin, 'rev-parse', 'HEAD')
        git(self.origin, 'reset', '-q', '--hard', 'HEAD~1')
        git(self.origin, 'update-ref', 'refs/pull/1/merge', merge)
        self.runner.mkdir()
        git(self.runner, 'init', '-q')
        git(self.runner, 'remote', 'add', 'origin', self.origin.as_uri())
        git(self.runner, 'fetch', '-q', '--no-tags', '--depth=1', 'origin', merge)
        git(self.runner, 'checkout', '-q', '--detach', merge)
        env = {**os.environ, 'GITHUB_SHA': merge, 'GITHUB_EVENT_NAME': 'pull_request'}
        return subprocess.run(['bash', '-e', '-c', step_script()['run']], cwd=self.runner, env=env, capture_output=True, text=True)


class CommentCheckStep(unittest.TestCase):
    def test_runs_on_every_pull_request(self):
        self.assertEqual(step_script().get('if'), "github.event_name == 'pull_request'")

    def test_fails_a_pull_request_that_adds_a_disallowed_comment(self):
        run = PullRequest(self).ci('site.js', 'const answer = 42; // the answer, for now\n')
        self.assertEqual(run.returncode, 1, run.stdout + run.stderr)
        self.assertEqual(run.stdout.splitlines()[0].split(': ')[:2], ['site.js:1', 'comment'])
        self.assertNotIn('old.js', run.stdout)

    def test_passes_a_pull_request_whose_comment_has_a_reasoned_escape_tag(self):
        run = PullRequest(self).ci('site.js', '// comment-ok: the synthetic host reads this line\nconst answer = 42;\n')
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)


if __name__ == '__main__':
    unittest.main()

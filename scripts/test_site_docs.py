import json
import re
import shlex
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHECKER = ROOT / 'tools' / 'comment-check' / 'check.py'
LOCAL_COMMENT_CHECK = 'python3 -I tools/comment-check/check.py diff --base origin/main'
CI_COMMENT_CHECK = 'python3 -I tools/comment-check/check.py diff --base HEAD^1'
COMMENT_DRIFT_CHECK = 'python3 -I tools/comment-check/drift.py'
PR_ONLY_IF = "github.event_name == 'pull_request'"

APP_PAGES = ('You', 'Queue', 'Specs', 'Agents', 'Canvas', 'Models')
FUNCTIONS = ('/api/sign-in/start', '/api/sign-in/token', '/api/sign-in/refresh', '/api/ask', '/api/count')
TOP_BAR_PAGES = (
    '/',
    '/what-is-openwiz/',
    '/guides/run-many-coding-agents/',
    '/drivers/',
    '/changelog/',
    '/market/',
    '/faq/',
    '/team/',
    '/pricing/',
    '404',
)


def read_text(rel):
    return (ROOT / rel).read_text()


def discovery_page_urls():
    run = subprocess.run(
        [
            'node',
            '--input-type=module',
            '-e',
            "import { pages } from './scripts/discovery.mjs'; console.log(JSON.stringify(Object.keys(pages)));",
        ],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    keys = json.loads(run.stdout)
    return tuple(
        'https://openwiz.dev/' + (key[:-len('index.html')] if key.endswith('index.html') else key)
        for key in keys
    )


def fleet_rows(fleet_text):
    rows = re.findall(r'^\| (\d+) \| root \| `([^`]+)` \| ([^|\n]+) \|$', fleet_text, re.M)
    if not rows:
        raise AssertionError('the fleet test-command table has no rows')
    return [(int(num), cmd, ci.strip()) for num, cmd, ci in rows]


def fleet_commands(fleet_text):
    return [cmd for _, cmd, _ in fleet_rows(fleet_text)]


def parse_site_run_steps(workflow_text):
    lines = workflow_text.splitlines()
    jobs_idx = next((i for i, line in enumerate(lines) if re.match(r'^jobs:\s*$', line)), None)
    if jobs_idx is None:
        raise AssertionError('workflow has no jobs section')
    site_idx = next(
        (i for i in range(jobs_idx + 1, len(lines)) if re.match(r'^\s+site:\s*$', lines[i])),
        None,
    )
    if site_idx is None:
        raise AssertionError('workflow has no site job')
    site_indent = len(lines[site_idx]) - len(lines[site_idx].lstrip())
    steps_idx = None
    for i in range(site_idx + 1, len(lines)):
        stripped = lines[i].strip()
        if not stripped or stripped.startswith('#'):
            continue
        indent = len(lines[i]) - len(lines[i].lstrip())
        if indent <= site_indent:
            break
        if stripped == 'steps:':
            steps_idx = i
            break
    if steps_idx is None:
        raise AssertionError('site job has no steps section')
    steps_indent = len(lines[steps_idx]) - len(lines[steps_idx].lstrip())
    steps = []
    i = steps_idx + 1
    while i < len(lines):
        raw = lines[i]
        stripped = raw.strip()
        if not stripped or stripped.startswith('#'):
            i += 1
            continue
        indent = len(raw) - len(raw.lstrip())
        if indent <= steps_indent:
            break
        if not stripped.startswith('- '):
            raise AssertionError(f'unexpected line in steps: {raw!r}')
        step = {'if': None, 'continue-on-error': None, 'run': None}
        step_indent = indent
        first_body = stripped[2:].strip()
        i += 1
        entries = [(step_indent + 2, first_body)]
        while i < len(lines):
            nxt = lines[i]
            nxt_stripped = nxt.strip()
            if not nxt_stripped or nxt_stripped.startswith('#'):
                i += 1
                continue
            nxt_indent = len(nxt) - len(nxt.lstrip())
            if nxt_indent <= step_indent:
                break
            entries.append((nxt_indent, nxt))
            i += 1
        j = 0
        while j < len(entries):
            entry_indent, entry_raw = entries[j]
            entry = entry_raw.strip() if j > 0 else entry_raw
            m = re.match(r'^(if|continue-on-error|run):\s*(.*)$', entry)
            if m and m.group(1) in ('if', 'continue-on-error'):
                step[m.group(1)] = m.group(2).strip()
                j += 1
            elif m and m.group(1) == 'run':
                val = m.group(2).strip()
                if val in ('|', '|-', '|+', '>', '>-', '>+'):
                    run_lines = []
                    j += 1
                    while j < len(entries) and entries[j][0] > entry_indent:
                        cmd = entries[j][1].strip()
                        if cmd and not cmd.startswith('#'):
                            run_lines.append(cmd)
                        j += 1
                    step['run'] = run_lines
                else:
                    step['run'] = [val] if val and not val.startswith('#') else []
                    j += 1
            else:
                j += 1
        if step['run'] is not None:
            steps.append(step)
    return steps


def verify_fleet_against_workflow(commands, workflow_text):
    steps = parse_site_run_steps(workflow_text)
    if len(steps) != len(commands):
        raise AssertionError(f'fleet has {len(commands)} commands, workflow has {len(steps)} executable run steps')
    if len(commands) < 2:
        raise AssertionError(f'expected at least two pull-request-only steps, got {len(commands)}')
    if commands[0] != LOCAL_COMMENT_CHECK:
        raise AssertionError(f'command 1 must check against origin/main locally, got {commands[0]!r}')
    if steps[0]['if'] != PR_ONLY_IF:
        raise AssertionError(f"comment-check step condition mismatch: {steps[0]['if']!r}")
    if steps[0]['continue-on-error'] not in (None, 'false'):
        raise AssertionError(f"comment-check step must fail the job: {steps[0]['continue-on-error']!r}")
    if CI_COMMENT_CHECK not in steps[0]['run']:
        raise AssertionError(f'comment-check step does not run {CI_COMMENT_CHECK!r}: {steps[0]["run"]!r}')
    if commands[1] != COMMENT_DRIFT_CHECK:
        raise AssertionError(f'command 2 must check comment-check drift, got {commands[1]!r}')
    if steps[1]['if'] != PR_ONLY_IF:
        raise AssertionError(f"comment-check drift step condition mismatch: {steps[1]['if']!r}")
    if steps[1]['continue-on-error'] not in (None, 'false'):
        raise AssertionError(f"comment-check drift step must fail the job: {steps[1]['continue-on-error']!r}")
    if steps[1]['run'] != [COMMENT_DRIFT_CHECK]:
        raise AssertionError(f'comment-check drift step mismatch: fleet={commands[1]!r}, workflow={steps[1]["run"]!r}')
    for idx, (command, step) in enumerate(zip(commands[2:], steps[2:]), start=3):
        if step['if'] is not None:
            raise AssertionError(f'command {idx} ({command}) has unexpected workflow condition: {step["if"]!r}')
        if step['continue-on-error'] not in (None, 'false'):
            raise AssertionError(f'command {idx} ({command}) must fail the job: {step["continue-on-error"]!r}')
        if step['run'] != [command]:
            raise AssertionError(f'command {idx} mismatch: fleet={command!r}, workflow={step["run"]!r}')


def git(cwd, *args):
    return subprocess.run(['git', '-C', str(cwd), *args], check=True, capture_output=True, text=True).stdout.strip()


class SiteDocsMatchTheSite(unittest.TestCase):
    def test_readme_names_the_release_every_page_and_every_function(self):
        readme = read_text('README.md')
        self.assertIn('0.1.0', readme)
        self.assertRegex(readme, r'current release')
        self.assertNotIn('coming soon', readme.lower())
        pages = discovery_page_urls()
        self.assertIn('https://openwiz.dev/404.html', pages)
        for page in pages:
            self.assertIn(page, readme)
        for name in APP_PAGES:
            self.assertIn(name, readme)
        for path in FUNCTIONS:
            self.assertIn(path, readme)

    def test_repository_map_names_real_repos_skills_wizdeck_and_a_live_install(self):
        repos = read_text('docs/repos.md')
        repo_map = read_text('docs/repo-map.svg')
        self.assertNotIn('coming soon', repos.lower())
        self.assertIn('WizMarket', repos)
        self.assertIn('WizDeck', repos)
        self.assertIn('22 skills', repos)
        self.assertIn('0.7.0', repos)
        self.assertNotIn('0.6.0', repos)
        self.assertNotIn('until the `wizbar/v0.7.0`', repos)
        self.assertIn('WizMarket', repo_map)
        self.assertIn('WizDeck', repo_map)
        label = re.search(r'aria-label="([^"]*)"', repo_map).group(1)
        self.assertIn(label, repos)

    def test_maintaining_faq_top_bar_install_switch_and_ci_coverage(self):
        maintaining = read_text('docs/maintaining.md')
        fleet = read_text('docs/agents/fleet.md')
        faq = read_text('faq.html')
        landing = read_text('index.html')
        rows = faq.count('class="faq-row"')
        self.assertEqual(rows, 10)
        self.assertIn('ten flat rows', maintaining)
        self.assertNotIn('seven flat rows', maintaining)
        self.assertNotIn("above `/team`'s closing", maintaining)
        self.assertNotIn('a later change', maintaining)
        self.assertIn('site.js', maintaining)
        switch = re.search(r'data-install="([^"]+)"', landing).group(1)
        self.assertEqual(switch, 'live')
        self.assertIn('reads `live`', maintaining)
        self.assertNotIn('When RL2 flips', maintaining)
        for page in TOP_BAR_PAGES:
            self.assertIn(page, maintaining)
        self.assertIn('test:v2', maintaining)
        self.assertIn('models-page', maintaining)
        self.assertIn('comment-check', maintaining)
        self.assertIn('tools/comment-check/drift.py', maintaining)
        self.assertTrue((ROOT / 'scripts' / 'test_landing.py').is_file())
        self.assertTrue((ROOT / 'scripts' / 'test_spec_video.py').is_file())
        self.assertIn('scripts/test_landing.py', maintaining)
        self.assertIn('scripts/test_spec_video.py', maintaining)
        self.assertNotIn('still not a browser test in CI', maintaining)
        self.assertIn('Commands 6 to 10 also need Chrome or Chromium', fleet)
        self.assertIn('test commands 1 to 10', fleet)
        self.assertIn('Commands 1 and 2 run only on a pull request', fleet)
        self.assertIn("Commands 5 to 10 need command 4's `dist/` first", fleet)

    def test_every_fleet_test_command_has_a_package_script_and_runs_in_ci(self):
        package = json.loads(read_text('package.json'))
        scripts = package['scripts']
        fleet = read_text('docs/agents/fleet.md')
        workflow = read_text('.github/workflows/site.yml')
        self.assertEqual(scripts['test:v2'], "node --test 'tests/v2/*.test.mjs'")
        self.assertEqual(scripts['test:models'], 'node --test tests/models-page.test.mjs')
        self.assertEqual(scripts['test:comments'], LOCAL_COMMENT_CHECK)
        rows = fleet_rows(fleet)
        self.assertEqual([num for num, _, _ in rows], list(range(1, len(rows) + 1)))
        self.assertIn('--base HEAD^1', rows[0][2])
        self.assertIn('pull requests only', rows[0][2].lower())
        self.assertEqual(rows[1][1], COMMENT_DRIFT_CHECK)
        self.assertIn('pull requests only', rows[1][2].lower())
        commands = [cmd for _, cmd, _ in rows]
        verify_fleet_against_workflow(commands, workflow)
        disabled_drift = workflow.replace(
            '      - name: Check the carried comment checker matches its source\n'
            "        if: github.event_name == 'pull_request'\n",
            '      - name: Check the carried comment checker matches its source\n'
            '        if: false\n',
        )
        with self.assertRaises(AssertionError):
            verify_fleet_against_workflow(commands, disabled_drift)
        unguarded_drift = workflow.replace(
            '      - name: Check the carried comment checker matches its source\n'
            "        if: github.event_name == 'pull_request'\n",
            '      - name: Check the carried comment checker matches its source\n',
        )
        with self.assertRaises(AssertionError):
            verify_fleet_against_workflow(commands, unguarded_drift)
        soft_fail_drift = workflow.replace(
            '      - name: Check the carried comment checker matches its source\n',
            '      - name: Check the carried comment checker matches its source\n        continue-on-error: true\n',
        )
        with self.assertRaises(AssertionError):
            verify_fleet_against_workflow(commands, soft_fail_drift)
        disabled_if = workflow.replace(
            '      - name: Test the Models page against the models contract\'s fixtures\n',
            '      - name: Test the Models page against the models contract\'s fixtures\n        if: false\n',
        )
        with self.assertRaises(AssertionError):
            verify_fleet_against_workflow(commands, disabled_if)
        commented_models = workflow.replace(
            '        run: node --test tests/models-page.test.mjs',
            '        # run: node --test tests/models-page.test.mjs',
        )
        with self.assertRaises(AssertionError):
            verify_fleet_against_workflow(commands, commented_models)
        disabled_npm_test = workflow.replace(
            '      - name: Test the checkers\n',
            '      - name: Test the checkers\n        if: false\n',
        )
        with self.assertRaises(AssertionError):
            verify_fleet_against_workflow(commands, disabled_npm_test)
        soft_fail_models = workflow.replace(
            '      - name: Test the Models page against the models contract\'s fixtures\n',
            '      - name: Test the Models page against the models contract\'s fixtures\n        continue-on-error: true\n',
        )
        with self.assertRaises(AssertionError):
            verify_fleet_against_workflow(commands, soft_fail_models)

    def test_local_comment_check_catches_disallowed_comment_in_earlier_commit(self):
        package = json.loads(read_text('package.json'))
        script = package['scripts']['test:comments']
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            origin, work = root / 'origin', root / 'work'
            git(root, 'init', '-q', '-b', 'main', str(origin))
            for key, value in (('user.name', 'Synthetic'), ('user.email', 'synthetic@example.com')):
                git(origin, 'config', key, value)
            (origin / 'tools' / 'comment-check').mkdir(parents=True)
            shutil.copy(CHECKER, origin / 'tools' / 'comment-check' / 'check.py')
            (origin / 'site.js').write_text('const answer = 42;\n')
            git(origin, 'add', '-A')
            git(origin, 'commit', '-q', '-m', 'base')
            git(root, 'clone', '-q', str(origin), str(work))
            for key, value in (('user.name', 'Synthetic'), ('user.email', 'synthetic@example.com')):
                git(work, 'config', key, value)
            git(work, 'checkout', '-q', '-b', 'topic')
            (work / 'README.md').write_text('# Clean docs change\n')
            git(work, 'add', 'README.md')
            git(work, 'commit', '-q', '-m', 'clean commit')
            clean = subprocess.run(shlex.split(script), cwd=work, capture_output=True, text=True)
            self.assertEqual(clean.returncode, 0, clean.stdout + clean.stderr)
            (work / 'site.js').write_text('const answer = 42; // synthetic disallowed comment\n')
            git(work, 'add', 'site.js')
            git(work, 'commit', '-q', '-m', 'commit with comment')
            (work / 'README.md').write_text('# Unrelated docs change\n')
            git(work, 'add', 'README.md')
            git(work, 'commit', '-q', '-m', 'later commit without code')
            run = subprocess.run(shlex.split(script), cwd=work, capture_output=True, text=True)
            self.assertEqual(run.returncode, 1, run.stdout + run.stderr)
            self.assertIn('site.js:1: comment:', run.stdout)


if __name__ == '__main__':
    unittest.main()

import json
import os
import sys
from multiprocessing import Pool
from pathlib import Path

SPACE = {}
exec((Path(__file__).parent / 'wizmarket-private.py').read_text(), SPACE)
PRIVATE = SPACE['PRIVATE']
POINTS = [c for c in range(0x10000) if not 0xd800 <= c < 0xe000]
PROBES = [
    'ghp_' + 'a' * 20, 'github_pat_' + 'a' * 20, 'glpat-' + 'a' * 20, 'xoxb-' + 'a' * 10, 'sk-' + 'a' * 16,
    'AIza' + 'a' * 30, 'npm_' + 'a' * 30, 'AKIA' + 'A' * 16, 'eyJ' + 'a' * 8 + '.' + 'a' * 8 + '.',
    '-----BEGIN RSA PRIVATE KEY-----', 'https://u:p@h',
    'password: x', 'passwd=x', 'secret=x', 'api_key=x', 'apikey=x', 'access_key=x', 'private_key=x',
    'client_secret=x', 'auth_token=x', 'access_token=x', 'bearer ' + 'a' * 16,
    'thr_a', 'proj_a', 'prj_a', 'mch_a', 'usr_a', 'acct_a', 'auto_a', 'sess_a', 'ses_a', 'sbx_a',
    'cr_' + '0' * 8 + '-' + '0' * 4, '0' * 8 + '-' + '0' * 4 + '-' + '0' * 4 + '-' + '0' * 4 + '-' + '0' * 12,
    '/home/', '/Users/', '/root/', '/tmp/', '/var/folders/', '/private/var/', 'C:\\',
]


def private(text):
    return any(pattern.search(text) for _, pattern in PRIVATE)


def positions_but_inside_a_run(probe):
    return [i for i in range(len(probe))
            if not (0 < i < len(probe) - 1 and probe[i - 1] == probe[i] == probe[i + 1] and probe[i - 2:i] == probe[i] * 2)]


def refused(job):
    probe, i = job
    before, after = probe[:i], probe[i + 1:]
    width = len(probe) + 1
    joined = '\0'.join(before + chr(c) + after for c in POINTS)
    sure, maybe = set(), set()
    for _, pattern in PRIVATE:
        for match in pattern.finditer(joined):
            first, last = match.start() // width, max(match.end() - 1, match.start()) // width
            if first == last and '\0' not in match.group():
                sure.add(first)
            else:
                maybe.update(range(first, last + 1))
    found = sorted(sure | {k for k in maybe - sure if private(before + chr(POINTS[k]) + after)})
    ranges = []
    for k in found:
        if ranges and ranges[-1][1] + 1 == POINTS[k]:
            ranges[-1][1] = POINTS[k]
        else:
            ranges.append([POINTS[k], POINTS[k]])
    return [probe, i, ranges]


if __name__ == '__main__':
    jobs = [(f' {probe} ', i) for probe in PROBES for i in positions_but_inside_a_run(f' {probe} ')]
    with Pool(min(4, os.cpu_count() or 1)) as pool:
        cases = pool.map(refused, jobs)
    json.dump({'commit': SPACE['WIZMARKET_COMMIT'], 'patterns': [[label, pattern.pattern, bool(pattern.flags & SPACE['re'].I)] for label, pattern in PRIVATE],
               'cases': cases}, sys.stdout)

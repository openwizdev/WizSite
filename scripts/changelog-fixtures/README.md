# Changelog generator fixtures

Synthetic release data, the same shape as `changelog/releases/*.json` and `changelog/stats.json`, read by `scripts/test_changelog.py`
through `node scripts/changelog.mjs --releases <case> [--stats <file>] --switch <state>`. Every version, date, time, count and line here is made up.

- `two`: two releases whose semver sorts wrong as text (0.1.2 and 0.1.10), one with markup in its headline and a bullet.
- `two-stats.json`: stats for `two`. 0.1.10 has every stat, a selection of its changes and security fixes; 0.1.2 has only a commit count, and its list holds all its changes.

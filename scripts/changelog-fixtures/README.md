# Changelog generator fixtures

Synthetic release data, the same shape as `changelog/releases/*.json` and `changelog/stats.json`, read by `scripts/test_changelog.py`
through `node scripts/changelog.mjs --releases <case> [--stats <file>] [--ship <file>] --switch <state>`. Every version, date, time, count and line here is made up.

- `two`: two releases whose semver sorts wrong as text (0.1.2 and 0.1.10), one with markup in its headline and a bullet.
- `two-stats.json`: stats for `two`. 0.1.10 has every stat, a selection of its changes and security fixes; 0.1.2 has only a commit count, and its list holds all its changes.
- `ship`: today's short entry and a 0.2.0 entry of 60 lines in six areas (`areas` in place of `bullets`), one line with markup and a long identifier.
- `ship-on.json`, `ship-off.json`: `release.json` with the changelog switch for 0.2.0 on and off, passed with `--ship <file>`. Off holds the 0.2.0 entry; every other entry shows as before.
- `notes-0.2.0.md`: a changelog in the release tools' form (`## <semver> · <date>`, a bold headline, bold area names over their lines, the full-release link). `node scripts/changelog.mjs --from-notes notes-0.2.0.md --version 0.2.0 --name 0.02` prints `ship/0.02.json` byte for byte; links and backticks become plain text, and paragraphs that are not list lines stay in the full notes.

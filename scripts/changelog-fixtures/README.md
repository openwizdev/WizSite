# Changelog generator fixtures

Synthetic release data files, the same shape as `changelog/releases/*.json`, read by `scripts/test_changelog.py`
through `node scripts/changelog.mjs --releases <case> --switch <state>`. Every version, date and line here is made up.

- `two`: two releases whose semver sorts wrong as text (0.1.2 and 0.1.10), one with markup in its headline and a bullet.
- `ship`: today's short entry and a 0.2.0 entry of 60 lines in six areas (`areas` in place of `bullets`), one line with markup and a long identifier.
- `ship-on.json`, `ship-off.json`: `release.json` with the changelog switch for 0.2.0 on and off, passed with `--ship <file>`. Off holds the 0.2.0 entry; every other entry shows as before.
- `notes-0.2.0.md`: a changelog in the release tools' form (`## <semver> · <date>`, a bold headline, bold area names over their lines, the full-release link). `node scripts/changelog.mjs --from-notes notes-0.2.0.md --version 0.2.0 --name 0.02` prints `ship/0.02.json` byte for byte; links and backticks become plain text, and paragraphs that are not list lines stay in the full notes.

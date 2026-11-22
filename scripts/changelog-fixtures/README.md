# Changelog generator fixtures

Synthetic release data files, the same shape as `changelog/releases/*.json`, read by `scripts/test_changelog.py`
through `node scripts/changelog.mjs --releases <case> --switch <state>`. Every version, date and line here is made up.

- `two`: two releases whose semver sorts wrong as text (0.1.2 and 0.1.10), one with markup in its headline and a bullet.

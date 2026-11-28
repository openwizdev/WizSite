# Changelog generator fixtures

`two/` contains two OpenWiz releases and one WizSkills release. Two products share a tag, and the
publication times deliberately sort differently from semver. One release contains HTML-like text to
exercise escaping. `stats.json` supplies the numbers without network access.

Use `node scripts/changelog.mjs --releases scripts/changelog-fixtures/two --stats scripts/changelog-fixtures/stats.json --switch live`.

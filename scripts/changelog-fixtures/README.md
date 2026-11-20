# Changelog generator fixtures

Synthetic GitHub release lists (the `GET /repos/{owner}/{repo}/releases` answer), one file per repository, read by
`scripts/test_changelog.py` through `node scripts/changelog.mjs --fixtures <case>`. A missing file is a failed read.
Every version, date and line here is made up.

- `full`: OpenWiz with a patch, pre-releases before and after 0.1.0, a draft and two Ships with lists; WizSkills with three
  releases whose newest is a two-digit patch; WizLoops with none.
- `failed`: OpenWiz answers an API error object, WizSkills isn't there, and WizLoops' one release has a numeric tag.
- `sparse`: OpenWiz's only release lists no shipped versions; WizSkills' one release has a tag that is no version;
  WizLoops has no release.
- `named` (#1674): OpenWiz releases named by public name (`OpenWiz 0.01`, `OpenWiz 0.02`), one with no name and one whose
  name only starts like one; WizSkills' release carries an OpenWiz-style name; WizLoops' release name is a number.

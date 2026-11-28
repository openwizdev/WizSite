# Synthetic docs sources

Run `node --test tests/docs-source-fixtures/check.test.mjs` from the repository root.
The check reads local files with Node's standard library.

For the success case, read the files in `cases.json`'s `pages` from `source/`
and use their listed docs routes. The repository and revision are invented.
`expected.json` gives the hand-written destinations in source order and the exact
shell fence body. The fence also contains Markdown-like text that should remain
literal.

For the failure case, run the same build with `missingSource` requested as an
additional page. It is deliberately absent from `source/`. The
`unimportedSource` exists there and is excluded from the pages, so links to it
use the pinned GitHub fallback.

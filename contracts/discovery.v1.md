# openwiz.dev discovery contract, version 1 (`openwiz.discovery.v1`)

How a page on openwiz.dev joins search: its registry entry, the sitemaps, its breadcrumb, its Markdown copy, and the structured-data ids other pages may point at. Every page generator (the market, listing, docs and answer pages, the manifesto and the leaderboard) registers its pages here instead of keeping its own list.

**Contract first** (openwizdev/OpenWiz#4067, SO1 of spec openwizdev/OpenWiz#3513). Later tickets build against this file: SO8 (answer pages), SO14 (listing and category pages), SO15 (docs pages), SO17 (share images), and SO5/SO6 (IndexNow), which read the sitemaps. The code is `scripts/registry.mjs` and `scripts/sitemap.mjs`; `scripts/check.py`'s `check_discovery` enforces it on the built `dist/`.

## A registry entry

| Field | Rule |
| --- | --- |
| `path` | The built file, relative to `dist/`: `faq/index.html`, `market/<id>/index.html`. Its URL is `https://openwiz.dev/` plus the path without `index.html`. Unique. |
| `title` | Plain text, 1 to 60 characters, contains `OpenWiz`, unique across the registry. |
| `description` | Plain text, 1 to 160 characters, unique across the registry. |
| `section` | One of `pages`, `market`, `docs`, `answers`. It picks the page's section sitemap. |
| `trail` | The breadcrumb from the home, as a list of `{ name, path }`, ending with the page itself; `[]` for the home. Every `path` in it is a registered or built page. |
| `lastmod` | `YYYY-MM-DD`: the last commit that touched the page's source (`git log -1 --format=%cs`), or the source data's own date (a listing's `since`, a docs page's pinned commit date, an answer's `checked`), or the build date when neither is known. |
| `indexable` | `true`, or `false` with `noindex` (the app and the 404). A page that is not indexable is in no sitemap, has no breadcrumb data and no Markdown copy. |

A generator registers its pages with one call, `registry.add(entry)`, before the crawler files are written; the page's head metadata (`withMetadata`) then comes from its entry, and a page with no entry fails the build. The build refuses an entry that breaks a rule above (an impossible date included), a second entry with the same path, title or description, and, when the sitemaps are written, a trail step that names an unregistered page. The site check accepts every section sitemap the index lists and every page those sitemaps list, as long as each is a built, indexable page with its own canonical link.

## Sitemaps

- `https://openwiz.dev/sitemap.xml` is a **sitemap index** (`<sitemapindex>`). `robots.txt` keeps pointing at it, so search consoles keep the one URL.
- Each section with at least one indexable page has `https://openwiz.dev/sitemaps/<section>.xml`, a `<urlset>` listing each of its indexable pages exactly once, each with its `lastmod`. The index lists each section sitemap once, with the newest `lastmod` of its pages.
- No page is in two sections. No section sitemap lists more than 50,000 URLs.

## Breadcrumbs

Every indexable page except the home has exactly one `BreadcrumbList` JSON-LD block in its head, built from its `trail` with the home first (`OpenWiz`, `https://openwiz.dev/`), positions from 1, and the page itself last. It is a separate `<script type="application/ld+json">` block from the page's own structured data. A page that shows a visible breadcrumb shows the same names.

## Markdown copies

Every indexable page has a Markdown copy of its `<main>` at its URL path plus `.md` (`/faq.md`, `/guides/run-many-coding-agents.md`); the home page's copy is `/index.md`. Its head links it with `<link rel="alternate" type="text/markdown" href="...">`, `llms.txt` lists it, and `llms-full.txt` holds it (SO4, `scripts/mirrors.mjs`).

## Shared structured-data ids

Other pages point at these with `{ "@id": ... }` and never redefine them:

| `@id` | What |
| --- | --- |
| `https://openwiz.dev/#organization` | OpenWiz, the organization |
| `https://openwiz.dev/#website` | openwiz.dev |
| `https://openwiz.dev/#software` | OpenWiz, the application (the open source agent factory) |
| `https://openwiz.dev/#source` | The OpenWiz source code (SO2) |

A listing page is `isPartOf` `#software`; a docs page, an answer page and a comparison are `about` `#software`.

## Changes

A new section, field or id is a new version of this file (`discovery.v2.md`), and the tickets relying on v1 are re-checked.

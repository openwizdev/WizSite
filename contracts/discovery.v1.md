# Discovery v1

Every page generator registers its complete batch with `registry.register(entries)` in the site build. The registry supplies page metadata, sitemap URLs and breadcrumb trails. Registration fails on a duplicate path, title or description, including among pages excluded from indexing.

| Field | Rule |
| --- | --- |
| `path` | The unique canonical site path, starting with `/`. Directory pages end in `/` and build to an `index.html` file. A standalone HTML page uses its file path. Use the directory path for an `index.html` page. Paths use letters, digits, dots, underscores or hyphens in each segment. |
| `title` | Unique, contains `OpenWiz`, and has at most 60 characters. |
| `description` | Unique, nonempty, and at most 160 characters. |
| `breadcrumbs` | Ordered `{ name, path }` entries from the home page to the page itself. The home page's trail contains only itself. Use the same names and paths in any visible breadcrumb. |
| `section` | One of `pages`, `market`, `docs` or `answers`. Use `pages` for the general site, `market` for the market and its listings and categories, `docs` for documentation and `answers` for answer and comparison pages. |
| `lastmod` | The last content modification date in `YYYY-MM-DD`, from Git for checked-in pages or from the source data for generated pages. |
| `indexable` | Boolean. Indexable pages appear in their section sitemap. Other pages get a `noindex` robots tag and stay out of sitemaps. |

`/sitemap.xml` lists the sitemap for each section that has indexable pages. Each `/sitemaps/<section>.xml` lists its indexable canonical URLs once with their `lastmod`. `/robots.txt` points to the index. Each indexable page other than the home page gets one Schema.org `BreadcrumbList` in its HTML head using RDFa. The list uses the registry trail in order, with the page's canonical URL as the last item.

SO4 adds a Markdown copy for each indexable page. Append `.md` to the page path after dropping its trailing slash, as in `/faq.md` and `/guides/run-many-coding-agents.md`. The home page uses `/index.md`.

## Shared structured data identifiers

Pages may refer to these entities with `{"@id": "..."}`:

- `https://openwiz.dev/#organization` identifies the OpenWiz organization.
- `https://openwiz.dev/#software` identifies the OpenWiz application.
- `https://openwiz.dev/#source` identifies the OpenWiz source code entity defined by SO2.

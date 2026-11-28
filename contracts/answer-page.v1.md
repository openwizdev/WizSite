# Answer page v1

Put one JSON object in `answers/<slug>.json` per page. Use the fields in
[the schema](answer-page.v1.schema.json). The filename stem matches `slug`.
Run `npm test` or directly run `python3 -B scripts/test_answers.py` from the
repository root. The check uses Python's standard library and reads local files.

| Field | Form and rule |
| --- | --- |
| `slug` | Lowercase ASCII letters and digits separated by single hyphens. |
| `kind` | `answer` goes at `/guides/<slug>/`. `compare` goes at `/compare/<slug>/`. |
| `query` | The search query the page answers. |
| `title` | Includes `OpenWiz`, has at most 60 characters and is unique in the page registry. |
| `description` | At most 160 characters and unique in the page registry. |
| `answer` | Two or three complete sentences that directly answer the query. They appear first, immediately under the page heading. |
| `sections` | One or more ordered objects with a `heading` and a Markdown `body`. |
| `steps` | Optional ordered objects with a `name` and instruction `text`. When supplied, include at least one. These are the steps for `HowTo`. |
| `faq` | Ordered objects with a `question` and `answer` for `FAQPage`. An empty array requires `steps`. |
| `sources` | One or more objects with a public HTTP(S) `url`, `supports` identifying the claim it supports, and a `checked` date. |
| `checked` | The date the page was last checked. |
| `other` | Comparisons require an object with the other tool's `name` and its public HTTP(S) `homepage`. |
| `better_fit` | Comparisons require text explaining where the other tool fits better. |

All fields are required except `steps` and the two comparison fields, which
belong only on comparisons. Text fields contain non-whitespace text.
Dates use real calendar dates in `YYYY-MM-DD` form. Additional fields are
refused, including in nested objects. The answer check compares titles and
descriptions across answer files. The page registry checks them across the site.

Write each OpenWiz claim from its public README, docs or changelog. Link every
claim about another tool to a public source that tool owns and record the
checked date for that source. A Markdown link in a section or a dated
`sources` entry that names the claim makes the connection visible to readers.
Keep the page and its sources free of requests for votes or stars.

The offline check enforces the schema, the filename, sentence punctuation and
common requests for votes or stars. In review, follow the sources to confirm
their ownership and that they support every claim. Check that the opening
actually answers the query and that any comparison gives a concrete use case
for the other tool. The fixtures include [examples for review](../answers/fixtures/review.md).

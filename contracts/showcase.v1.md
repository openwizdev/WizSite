# Public showcase export

The [JSON Schema](showcase.v1.schema.json) defines the `openwiz.showcase.v1` export. Each export is one JSON object with exactly six required fields.

| Field | Value |
| --- | --- |
| `schema` | The literal `openwiz.showcase.v1`. |
| `read_at` | When the numbers were read, in UTC as `YYYY-MM-DDTHH:MM:SSZ`. The timestamp must be a valid calendar date and time, with seconds from `00` to `59`. Enable `date-time` format validation when checking the schema. |
| `prs_merged_total` | Pull requests merged by the factory's agents, all time. |
| `prs_merged_7d` | Pull requests merged by the factory's agents in the seven days ending at `read_at`. |
| `drivers_verified` | WizMarket driver listings with status `verified`. |
| `agents_running` | Factory agents running at `read_at`. |

Each count is a non-negative integer or `null` when the count is unavailable. Zero is a count. Only `schema` and `read_at` can contain strings.

When `read_at` is more than two hours ago, show all four counts as unavailable. For a fresh export, show each `null` count as unavailable and show every available count, including zero.

The [fixtures](../scripts/showcase-fixtures/) are synthetic. The valid example contains four counts and the all-null example shows an export with every count unavailable.

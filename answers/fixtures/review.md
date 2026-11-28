# Answer page review fixtures

These examples pair the JSON fixtures with changes for a reviewer to refuse.
Keep dates and the rest of the page from the named fixture.

| Rule | Pass | Refuse |
| --- | --- | --- |
| The opening answers the query directly. | In `example-answer.json`, the answer names the license and tells the reader where to find it. | Replace the opening with “Licenses matter. Read on for our thoughts.” |
| Each OpenWiz claim comes from its README, docs or changelog. | In `example-answer.json`, the license claim links to the license entry in the README. | Change “Apache 2.0” in the opening to “MIT” while keeping the same source. |
| Each claim about the other tool links to its own public source. | In `example-compare.json`, the fictional tool's scheduling claim links to its own documentation both in the section and in the dated sources. | Change both links to an unrelated review site's coverage of the tool. |
| The comparison explains when the other tool fits better. | In `example-compare.json`, the advantage is the case where the user only needs job scheduling. | Set `better_fit` to “It depends on your needs.” |
| Page copy never solicits votes or stars. | The examples direct readers to documentation. | Ask readers to give OpenWiz a GitHub star or vote for it on Product Hunt. The automated fixtures exercise both requests. |

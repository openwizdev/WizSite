# Models page fixtures

Byte-for-byte copies of the models contract's fixtures (`openwiz.models.v1`, OpenWiz `contracts/fixtures/models/`, MD1 #1803 at `4a3cbea`): each case's `fleet.md` and the `show.json` every reader must agree with, `handoff.json` (the exact lines the Change button copies) and `list/models-offered.json` (the offered-models snapshot, copied here as `models-offered.json`). `tests/models-page.test.mjs` reads them; when the contract's fixtures change, copy them again.

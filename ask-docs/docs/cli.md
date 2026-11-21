# Using OpenWiz from a terminal

OpenWiz's command line is for agents, scripts and people alike: explicit commands, each with `--json`. It is a thin client: nothing here adds a CloudRoom operation or a safety limit. People who want a visual view use [the app](https://openwiz.dev/app).

## Explicit commands

- `openwiz help --agent` prints one compact JSON catalogue of every shipped command, flag, effect, result schema and exit code ([`contracts/cli.v1.md`](../contracts/cli.v1.md)). It reads no source and writes no state.
- Every command takes `--json` and then prints exactly one document on stdout, its existing report or an `openwiz.cli-error.v1` error. Exit codes are fixed per command in the catalogue.
- Explicit commands never prompt or wait for a terminal.
- `openwiz` with no arguments prints the help (`openwiz --help`) in a terminal. Piped, it is a usage error (exit 2), as is `openwiz ui`.

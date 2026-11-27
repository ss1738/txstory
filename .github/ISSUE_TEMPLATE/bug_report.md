---
name: Bug report
about: TxStory produced a wrong, misleading or failed result
labels: bug
---

**What happened** (one or two sentences)

**Network and transaction hash** (public data only; never paste private keys, seed phrases, or RPC URLs that contain API keys)

**Interface and version**: browser / CLI / API / library; `npm run -s txstory -- --version` (or the commit) and `node --version`

**Configuration**: the output of `npm run -s txstory -- networks`, which prints endpoints with credentials redacted. Redaction removes key-like query parameters, user info and long path segments; check that nothing secret remains before pasting.

**Expected vs actual**: which field (e.g. a ledger row, an interpretation, completeness) and why you believe it is wrong. If you have an independent reference (node state, another explorer, `cast`), include it.

**Reproduction**: ideally a recording: `npm run -s txstory -- record <network> <hash> -o tx.json --embed-story` (URLs in it are redacted; check it before attaching), and the output of `npm run -s txstory -- replay tx.json --json`. Or the exact command / URL.

**Output**: `--json` output or the relevant excerpt.

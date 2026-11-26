---
name: Bug report
about: TxStory produced a wrong, misleading or failed result
labels: bug
---

**What happened** (one or two sentences)

**Network and transaction hash** (public data only; never paste private keys, seed phrases, or RPC URLs that contain API keys)

**Interface and version**: browser / CLI / API / library, and `txstory --version` or the commit

**Expected vs actual**: which field (e.g. a ledger row, an interpretation, completeness) and why you believe it is wrong. If you have an independent reference (node state, another explorer, `cast`), include it.

**Reproduction**: ideally a recording: `txstory record <network> <hash> -o tx.json` (URLs in it are redacted; check it before attaching), or the exact command / URL.

**Output**: `--json` output or the relevant excerpt.

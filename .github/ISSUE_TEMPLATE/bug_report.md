---
name: Bug report
about: TxStory produced a wrong, misleading or failed result
labels: bug
---

Never paste API keys, RPC URLs that contain keys, private keys or seed phrases,
or recordings you are not allowed to share.

**Command or workflow**: the interface (browser, CLI, API or library) and the
exact command, request, or page and steps.

**Expected and observed**: which field (for example a ledger row, an
interpretation or a completeness flag) and why you believe it is wrong. Include
an independent reference, such as node state or `cast` output, if you have one.

**Versions**: `npm run -s txstory -- --version` (or the commit) and
`node --version`.

**Reproduction**, one of:
- a shipped example (`fixtures/synthetic/` or `fixtures/devnet/`) that shows it;
- a recording made with
  `npm run -s txstory -- record <network> <hash> -o tx.json --embed-story`,
  after checking it holds no credentials (URLs are redacted, but redaction is a
  heuristic) and that you may share the provider responses in it;
- otherwise the network and the public transaction hash.

**Providers**: the output of `npm run -s txstory -- networks` (endpoints are
printed redacted; check before pasting), and any provider errors or
`unavailable` or `partial` flags shown in the story's Sources or Completeness.

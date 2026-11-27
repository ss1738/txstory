# Changelog

Version numbers follow semantic versioning in spirit. During 0.x, any minor
version may change the library surface. Serialized formats are versioned
independently (see docs/formats.md).

## 0.4.1: unreleased (prepared 2026-11-27)

Fixes found in a fresh-checkout review of 0.4.0. No story, recording or
evidence-bundle format version changes.

**Fixed**

- **Fallback when a node reports its own limits.** A JSON-RPC error that
  describes the answering node now moves on to the next configured endpoint
  instead of ending the analysis: codes -32601 and -32005, "pruned history",
  and Geth's "does not exist/is not available". Errors about the request
  itself, such as a reverted `eth_call` or invalid params, are still not
  retried. Found when PublicNode answered a block request with "pruned history
  unavailable" while other default endpoints were configured.
- **Inconclusive not-found and pending results.** A `null` answer from one
  endpoint is still reported as not found or pending, but the message now names
  the endpoint that answered and, when other configured endpoints could not
  answer, says the result is not conclusive and lists them.
- **Replaying with user ABIs (`replay --abi`, "Decode with ABI files").** A
  replay that matches its stored digests still succeeds, with or without ABIs.
  With user ABIs, the recording is now also rebuilt without them, and one
  additional case succeeds (CLI exit 0, `ok: true`, browser badge "Decoded with
  your ABIs"): the evidence is identical, the rebuild without the ABIs
  reproduces both stored digests, and the only difference comes from the
  supplied ABIs. Previously that case exited 1. Any other difference, such as
  changed evidence, a stored output that already mismatched, or a changed
  recorded stage, still fails with or without ABIs. The CLI prints both
  results, for example
  `Without your ABIs: same evidence true · same output true`.
- **Provider URLs in shareable output.** A configured endpoint's URL appears in
  stories, recordings, evidence exports, API responses and CLI output only when
  the whole URL is trusted: an exact built-in public endpoint, a bare loopback
  origin (scheme, host and port only), or an exact URL that library code lists
  in `EngineConfig.trustedEndpointUrls`. Other endpoints, including a public
  host with an extra path or query and `localhost` or `.invalid` URLs with
  userinfo, a path or a query, are withheld as
  `https://rpc-<n>.withheld.invalid/` or `https://explorer.withheld.invalid`
  plus the request path TxStory generated, with the provider label kept.
  Requests stay distinct and new recordings rebuild offline. Previously short
  path tokens, hostname tokens and credentials under unrecognized query names
  could appear.
- **Provider error sanitization.** Known fragments of withheld endpoint URLs
  and the explorer API key are removed from provider error responses before
  analysis and recording: transport failure text, non-2xx bodies (JSON string
  values, or plain text when not JSON), and the top-level `error` member of a
  JSON-RPC response. JSON structure, ids and numeric codes are kept. Successful
  responses, including results that contain fields named `error`, are passed
  through unchanged. Malformed percent encoding in a configured URL no longer
  throws.
- After `record`, the CLI suggests the replay command in the form it was started
  with (`npm run -s txstory --` from a clone).

**API and output changes**

- New required fields: `RpcCall.unanswered` (library), and in the
  reconstruction report (`replay --json`, browser) `withoutUserAbis`,
  `userAbisChangedOutput` (both `null` when no user ABIs are supplied) and
  `differsOnlyByUserAbis`. Existing fields are unchanged.
- New optional fields: `EngineConfig.trustedEndpointUrls` and
  `ChainEndpoints.recorded`.
- `replay --abi` exits 0 in the additional case above, where it exited 1.
- Not-found and pending messages carry the answering endpoint and, when it
  applies, the "Not conclusive" note.
- Custom endpoints that are not trusted appear in withheld form in new
  recordings and in `txstory networks`. Recordings made with the built-in
  public endpoints, and the shipped synthetic and devnet recordings, keep their
  URLs, request keys and output digests. Recordings from earlier versions are
  replayed with the URLs they contain.

**Documentation**

- README command blocks use `npm run -s txstory -- ...`, which works after
  `npm ci` without a build; the HTTP API example uses a shipped example and no
  longer requires `jq`; endpoint fallback and pre-Byzantium transactions are
  documented. `docs/cli.md` leads with the same command.
- `docs/trial.md`: three developer tasks with observable success and failure.
- The bug report template asks for the command, expected and observed
  behaviour, versions, a safe reproduction and provider details.
- `docs/configuration.md`, "Provider URLs in shareable output", states the URL
  rule and its limits.

**Remaining limits on sharing recordings**

Check a recording before sharing it. Successful and malformed 2xx provider
responses are stored as received and are not inspected; a secret shorter than
the scrubbing thresholds can survive in echoed error text; explorer pagination
parameters are kept; and recordings made by earlier versions keep the URLs they
were written with, which may include credentials. This release is not the
result of a complete security audit.

## 0.4.0: released 2026-11-27

Developer-journey release: rebuild recordings in the browser, a static
developer site, and a contributor path that is tested.

**Added**

- **Open a recording in the browser** (`/open`): a local file is read in the
  page and the analysis is rebuilt with the same engine the CLI and server use.
  The file is not uploaded, and rebuilding makes no network requests.
- **Reconstruction report** (`reconstruct()`, `txstory replay`, the browser):
  what a recording captured, requests it cannot answer, unused exchanges, the
  recording and rebuilding engine versions, digest agreement, field differences
  from an embedded story, and a plain explanation of the verdict. `txstory
  replay --json` adds it as `report`; existing fields are unchanged.
- **Static developer site** (`npm run build:site`, `npm run site:preview`):
  examples rebuilt in the browser from the shipped recordings, recording import,
  installation and usage commands, limitations, and project links. No server
  and no provider credentials. A Content-Security-Policy limits the page to its
  own origin. Not deployed by this project.
- **Decode with ABI files** on a rebuilt recording in the browser, the
  equivalent of `txstory replay --abi`. The report records the ABIs
  (`userAbis`) and explains that they, not the evidence, changed the output.
  Case: the devnet `customError` recording shows `unknown error selector
  0xcf479181` until `fixtures/devnet/Demo.abi.json` is supplied, then
  `InsufficientBalance(available="1000000000000000000", required="5")`.
- **Get started page** whose commands are checked by a unit test that runs the
  offline ones.
- **Decoder example** `examples/decoder/split.ts`, tested against values read
  from the anvil node.
- **Library:** `parseRecording`, `reconstruct`, `RECONSTRUCTION_SCOPE` and the
  report types are exported from `src/engine/index.ts`.

**Changed**

- The engine's replay path no longer imports Node built-ins, so it bundles for
  browsers. SHA-256 now comes from `@noble/hashes` (already a dependency);
  digests are identical, and every shipped recording still reproduces its
  stored output digest.
- Recording files are read and written by `src/engine/fixture-files.ts`.
  `RecordedTransport` and `readRecording`/`writeRecording` moved there; the
  library entry point still exports `readRecording` and `writeRecording`.
- Recording validation is stricter: bounded structure depth, label and URL
  lengths, endpoint counts, and `config` values within the environment bounds.
  A recording without `recordedAt` reports it as `unknown`.
- `txstory replay` text output adds an origin line, the rebuilding engine
  version, and any requests the recording could not answer.
- The README quick start uses `npm run -s txstory -- …` (the bare `txstory`
  command is only available after `npm link`), and documents the kinds of data,
  recordings, live provider requirements and the static site.
- The Method page describes traces, ABI decoding and recordings accurately.
- `decodeAbiString` returns null for non-hex input instead of decoding a
  truncated prefix.

**Fixed**

- **Recordings of one custom network key no longer share a definition.**
  Replay registered a recording's embedded network in the shared registry and
  skipped it when the key was already known, so a second recording with the
  same key but a different name, native symbol, chain id or fee model was
  analysed with the first one's definition, and verdicts depended on which file
  was opened first (CLI, server and browser). Each analysis now receives its
  network definition explicitly (`AssembleOptions.network`, `BuildInput.network`);
  replay uses the recording's own validated definition and does not write to
  the registry. The server warns `recording-network-conflict` at startup when
  two recordings define one key differently.
- A broken link from `docs/configuration.md` to `.env.example`.
- `docs/extending.md` referred to a Seaport test against explorer decoding that
  is not in the public suite.

## 0.3.0: released 2026-11-27 (prepared 2026-11-26)

Developer release: one engine behind a browser UI, CLI, HTTP API and library.
Licensed under the Apache License, Version 2.0 (Copyright 2026 Satyawan Singh).

**Added**

- **CLI `txstory`:** `explain`, `record`, `replay`, `compare`, `decode`,
  `selector` and `networks`. JSON on stdout, stable exit codes, redacted URLs.
- **Call traces** (`debug_traceTransaction` with the callTracer):
  - the call tree, with failure propagation;
  - native value inside execution from the trace, with rolled-back transfers
    excluded;
  - comparison with explorer internal transactions;
  - endpoints that do not offer traces are skipped and recorded.
- **ABI decoding** of calldata, logs, trace frames and revert data:
  - `Error(string)`, `Panic(uint256)` and custom errors;
  - strict and bounded;
  - ambiguity reported;
  - provenance labels: built-in, user and signature.
- **Decoder modules** as the extension point: ERC-20/721/1155, WETH,
  Uniswap-style pools, and Seaport with evidence-validated interpretations.
- **Recordings** (`txstory-fixture-v3`): the actual provider responses, the
  endpoints and options, and output and evidence digests. Offline replay never
  uses the network.
- **`compareStories` / `txstory compare`,** which explain differences.
- **Custom networks** from chain files, or embedded in recordings. Includes a
  local anvil devnet scenario with expected values from the node.
- **HTTP:** `/api/recording/...` (replayable recordings) and `/api/openapi.json`
  (the contract). Documentation examples are executed in tests.
- **Browser:** a Call trace tab, and ABI decodings in the Call data and Logs
  tabs. Custom networks are supported.
- **Synthetic recordings** (`fixtures/synthetic`, 15 cases) generated from
  `tests/synthetic/cases.ts`. Recordings carry an `origin` (`captured`,
  `local-devnet`, `synthetic`). Synthetic replays are labelled `synthetic` in
  sources, stories, the API, the CLI and the browser.
- **Opt-in captured suite** (`npm run test:captured`) for recordings of real
  provider responses kept outside the repository.
- **Startup warnings** for unreadable fixture directories and invalid
  recordings, instead of silently missing examples.
- **Open-source release preparation:** README, docs/, CONTRIBUTING, SECURITY,
  data provenance, third-party notices, CI, and issue and PR templates.

**Changed**

- **Story schema 3:** `network`, `trace`, `revert`, `abiDecoding`,
  `completeness.trace`, and the `protocol` interpretation kind.
- **Code layout:**
  - acquisition moved to `src/engine`;
  - the Node build outputs to `dist/node`;
  - the engine config never reads the environment implicitly.
- **Deterministic source ordering,** so the same evidence gives the same output.
- **Examples come from `fixtures/synthetic` and `fixtures/devnet`** (21
  recordings). Set `TXSTORY_FIXTURES_DIR` to add your own.
- **`study/verify_answer_key.py`** takes the captured recordings as explicit
  arguments (`--captured`, `--evidence`), and has a `--check` mode.

**Removed**

- `legacy/`: the original Python prototype, superseded. It is still in Git
  history.
- **Captured provider responses** (the former `fixtures/recorded`,
  `study/evidence`, `fixtures/legacy`) were moved out of the repository tree,
  because their redistribution terms are unresolved (DATA_PROVENANCE.md). They
  remain in earlier commits; see RELEASE.md.
- `scripts/record-fixture.ts` and `npm run record-fixture`. Use
  `txstory record <network> <hash> -o FILE`.

## 0.2.0: 2026-11-26 (not published)

Story model with provenance, ledger, cross-check, React UI, HTTP API, recorded
fixtures, the usability study kit, and private-pilot preparation (proxy-aware
limits, admission control, container). See VERIFICATION.md for the verification
record of these rounds.

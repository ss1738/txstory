# Changelog

Version numbers follow semantic versioning in spirit. During 0.x, any minor
version may change the library surface. Serialized formats are versioned
independently (see docs/formats.md).

## 0.4.0: unreleased (prepared 2026-11-27)

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

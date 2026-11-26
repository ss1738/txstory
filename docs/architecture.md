# Architecture

One engine, four front ends: browser, CLI, HTTP API and library. There is no
second implementation of transaction logic. The browser runs the pure core for
display; the server, CLI and library run the same core plus acquisition.

```
                 ┌──────────── src/core (pure, browser-safe, no I/O) ────────────┐
provider JSON →  │ inputs ─► build ─► events/decoders ─► ledger ─► crosscheck    │ → Story (schema v3)
 (validated)     │            │        abi (calldata, logs, reverts)  interpret  │
                 │            └─► trace (call tree, value flow)  analysis        │
                 │ compare (explains differences)   chains (network registry)    │
                 └────────────────────────────────────────────────────────────────┘
                 ┌──────────── src/engine (Node; acquisition + reproducibility) ──┐
                 │ config (endpoints, timeouts, trace mode; explicit env)          │
                 │ transport: Live (bounded) · Caching · Recorded · Recording      │
                 │ providers: rpc (fallbacks) · blockscout (paginated) · trace     │
                 │ analyze: orchestrates fast/full stages → BuildInput → buildStory│
                 │ recording: record / validate / replay offline / check digests   │
                 │ index.ts: the public library surface                            │
                 └────────────────────────────────────────────────────────────────┘
      src/server (HTTP: admission control, OpenAPI contract, static client)
      src/cli    (txstory command)      src/client (React UI, renders Story)
```

## Layers and their boundaries

| Concern | Where | Notes |
|---|---|---|
| Data acquisition | `engine/transport.ts`, `engine/providers/*` | The only code that performs I/O. Bounded (timeouts, size caps, page caps, budgets). Every response becomes a `SourceRecord` with a digest. |
| Provider-specific parsing | `engine/providers/rpc.ts` (`parseTx`/`parseReceipt`/`parseBlock`), `blockscout.ts`, `trace.ts` | Untrusted JSON is converted to the typed inputs in `core/inputs.ts`. Explorer strings are sanitised. |
| Normalisation | `core/inputs.ts` → `core/build.ts` | `BuildInput` is the boundary. Exact integers stay strings or bigint throughout. |
| Decoding | `core/events.ts` (token semantics that move balances), `core/abi.ts` + `core/decoders/*` (display decoding with provenance), `core/trace.ts` | Only standard token events change balances. ABI decodes annotate; they never move money. |
| Interpretation | `core/interpret.ts`, decoder-module `interpret` hooks | Every interpretation cites evidence ids and carries a confidence (`decoded`/`heuristic`/`explorer`). |
| Ledger and comparison | `core/ledger.ts`, `core/crosscheck.ts`, `core/compare.ts` | The cross-check compares with the explorer. `compare` compares two analyses. |
| Presentation and export | `src/client`, `src/cli/main.ts`, `client/lib/exporters.ts` | Rendering only. |

## Stages

- **`fast`** is RPC only: transaction, receipt, block and token metadata. It
  gives a quick first render.
- **`full`** adds the explorer (labels, internal transfers, state changes,
  summary), the call trace (when an endpoint offers it) and contract detection.

The server runs the two in separate admission pools, so slow explorer or trace
work cannot block first renders.

## Reproducibility

`RecordingTransport` captures every request and its full response. A
`txstory-fixture-v3` recording adds:

- the redacted endpoints;
- the options that affect interpretation;
- the network definition, for custom networks;
- digests of the output.

Replay keys requests exactly as recording did. Missing requests fail with "not
present in the recording"; replay never uses the network. Source ordering is
deterministic, so identical evidence gives an identical normalised story; this
is checked by tests.

## Trust and safety model

- **Inputs:** provider responses, explorer strings and ABIs are all untrusted
  data. They are validated, bounded, sanitised for display, and never executed.
- **Decoder modules** are trusted code reviewed in this repository. They
  declare ABI data and may add interpretations, but cannot change balances.
- **Credentials** live only in endpoint URLs or the explorer key, server-side.
  Every stored or printed URL passes through `redactUrl`. Cache identity uses
  the private full URL; recordings use the public redacted URL.

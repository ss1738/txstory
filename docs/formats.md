# Formats

Every serialized format carries its own version. Consumers should check it.

## Story (`schemaVersion` 3)

A story is produced by the engine and returned by the API (`story`), by
`txstory explain --json`, and by the library. Integers (amounts, fees, block
numbers, gas) are **decimal strings**, so no precision is lost.

| Field | Meaning |
|---|---|
| `schemaVersion` | `3` |
| `chain`, `network` | Network key and `{key, chainId, name, nativeSymbol, explorerUi, builtin}` |
| `hash`, `outcome` | `success` or `reverted` (receipt status) |
| `tx` | from, to, createdContract, value, nonce, type, input selector and size, explorer-decoded method or input (`source: "explorer"`), explorer revert reason |
| `block` | number, hash, timestamp, baseFeePerGas, feeRecipient |
| `fees` | total and components (burned/tip/L1 data/blob), gasUsed, effectiveGasPrice, notes |
| `assets` | Per asset key (`native`, contract, or `contract#id` for ERC-1155): kind, symbol, decimals, metadata source, `metadataAltered` |
| `participants` | Roles, explorer labels (not verified identity), contract-ness and its source |
| `movements` | Every value movement with `provenance` (`chain`, `derived`, `explorer`, `heuristic`) and `sourceIds` |
| `ledger` | Net signed delta per address and asset. ERC-721 rows include `tokenIdsIn` / `tokenIdsOut`. |
| `crossCheck` | Rows comparing the ledger with explorer state changes, with a `scope` (`amount`, `token-ids`, `count`, `none`) and `status` |
| `logs` | Every receipt log: raw topics and data, the TxStory decoding, and the explorer name |
| `interpretations` | `{id, kind, confidence: decoded\|heuristic\|explorer, headline, detail, evidence[], caveats[]}`. Decoder modules add `kind: "protocol"` with ids `<module>:<id>`. |
| `completeness` | `logs`, `tokenTransfers`, `nativeInternal`, `explorerTokenTransfers`, `stateChanges`, `tokenMetadata`, `trace` |
| `trace` | Status, provider, frames, revertedFrames and `valueMoves` (see below). Frames: pre-order, each with `{id: "0.2.1", depth, type, from, to, value, input (≤ 4 KiB), output, error, reverted, undone, call?, revert?}`. Value moves: `{frameId, type, from, to, value, committed}`. |
| `revert` | `null`, or `{source: "trace", frameId, data, decoded, summary}` for a failed top-level call |
| `abiDecoding` | Libraries used (label, source, entries), calldata decoding, logs whose topic 0 matched, and the count of unmatched logs. Decodings: `{status, id, candidates: [{signature, sources[], ok, params?, error?, notes[]}]}`. Long values are shortened; full raw data stays in `logs` and `trace`. |
| `warnings` | Human-readable caveats (partial data, rolled-back transfers, disagreements) |
| `sources` | Every request: provider, redacted URL, method, status, HTTP status, retrievedAt, sha256, note |
| `generatedAt`, `mode`, `stage` | Build time; `live`, `recorded`, `synthetic` or `mixed`; `fast` or `full` |

**History:**

- **v3** added `network`, `trace`, `revert`, `abiDecoding`, `completeness.trace`
  and interpretation kind `protocol`.
- **v2** added cross-check `scope` and ERC-721 id sets.

## Recording (`txstory-fixture-v3`)

A recording is the replayable form of an analysis. It is written by
`txstory record`, `/api/recording`, the devnet scenario and the synthetic
generator (`scripts/synthetic-fixtures.ts`).

| Field | Meaning |
|---|---|
| `schema` | `txstory-fixture-v3` (v1 and v2 are still read) |
| `chain`, `hash`, `description`, `recordedAt`, `recorder` | Identity |
| `origin` | `captured` (real providers; the default when absent), `local-devnet` (a node you ran), or `synthetic` (generated responses, not real provider data). Replay of a synthetic recording marks every source and the story `synthetic`. |
| `engine` | `{name, version, storySchema}` at recording time |
| `endpoints` | The RPC and explorer URLs used, **redacted**. Replay issues requests to these same strings. |
| `options` | `{trace}`. v1/v2 recordings have no traces, so replay uses `off`. |
| `config` | `{maxExplorerPages, maxTokenMetadataCalls, explorerApiKeyUsed}`. The key itself is never stored. |
| `network` | The network definition, for custom networks (validated on read) |
| `exchanges` | Keyed by request digest: `{kind, provider, method, url (redacted), body, httpStatus, retrievedAt, failure?, text}`. `text` is the **full response body**. |
| `output` | `{stage, kind, storySha256, evidenceSha256, story?}`. `story` is present only with `--embed-story`, or from `/api/recording`. |

What a recording is enough for:

- **Rebuilding offline.** Recordings contain the actual inputs, not only hashes.
- **Distinguishing two checks:**
  - `sameEvidence`: the replayed sources have the same response digests;
  - `sameOutput`: the normalised story (excluding build time and live/recorded
    labels) has the same SHA-256.

What it excludes:

- credentials (URLs are redacted, and the API key is reduced to a boolean);
- the local environment;
- anything not requested by the analysis.

Bounds and failure behaviour:

- `readRecording` rejects files over 64 MiB, unknown schemas, malformed
  exchanges, and redefinitions of built-in networks.
- Replay never uses the network.

## Evidence bundle (`formatVersion` 2)

The browser's "Download evidence (.json)" produces `{format:
"txstory-evidence-bundle", formatVersion: 2, notice, story, sources, …}`.

- **Contents:** a report of one analysis, with the story at its current schema
  version (now 3), which consumers should check.
- **Not replayable.** It does not contain provider response bodies. For a
  replayable artifact use a recording (`/api/recording/...`, or `txstory record`).

## Chain file

```json
{ "chains": [ { "key": "anvil", "chainId": 31337, "name": "Anvil devnet", "nativeSymbol": "ETH",
                "feeModel": "ethereum-l1", "rpc": ["http://127.0.0.1:8545"], "explorerApi": null,
                "explorerUi": null, "wrappedNative": [] } ] }
```

The file is data only. Unknown fields are rejected, and so are built-in keys.
URLs must be http(s).

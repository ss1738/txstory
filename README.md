# TxStory

TxStory explains what an EVM transaction did, and shows the evidence for every
claim, including what it could not establish. Use it from a browser, the command
line, an HTTP API, or as a TypeScript library. All four run on the same engine.

For each transaction, TxStory reports:

- **Facts:**
  - the outcome;
  - exact net balance changes per address and asset, including fees;
  - token movements decoded from receipt logs;
  - native value moved inside execution, taken from a call trace when your node
    provides one (rolled-back transfers excluded).
- **Interpretations,** each labelled by how they were reached:
  - `decoded`: follows from receipts, events or decoded data;
  - `heuristic`: a pattern match that can be wrong;
  - `explorer`: the explorer's own wording, not verified.
- **Decoding:**
  - calldata, logs, call-trace frames and revert data (`Error`, `Panic`, custom
    errors);
  - built-in decoder modules plus ABIs you supply, with the source of every ABI
    shown;
  - ambiguity (selector collisions) reported, never silently resolved.
- **Evidence:**
  - every provider request with its HTTP status, retrieval time and SHA-256;
  - completeness flags;
  - a cross-check against the explorer's independently computed balance changes
    where available.
- **Reproducibility:**
  - recordings contain the actual provider responses;
  - they replay offline (never touching the network) and report whether the
    evidence and the output are identical;
  - `compare` explains differences between two analyses.

**Website:** https://txstory-site.satyawansinghinuk.workers.dev is a static
demo. It rebuilds the included example recordings in your browser, and it can
open a recording file you choose and rebuild that analysis on your device. It
is not a hosted lookup service: it has no RPC backend and cannot fetch a
transaction. For live analysis, run TxStory locally (see
[Live analysis](#live-analysis-what-providers-you-need)).

TxStory is read-only: no wallet, no signing, no accounts, no telemetry. It
trusts the RPC nodes and explorer it queries (there is no light-client or proof
verification), and it says so in every output.

## Requirements

- **Node.js 22 or later, and npm.** The lockfile pins every dependency, so
  install with `npm ci`.
- **No API keys, accounts or global tools.** TxStory is not published to npm or
  a container registry; it runs from a clone of this repository.
- **Optional:**
  - Docker, for the container;
  - Chrome or Chromium, for the browser test suite;
  - Python 3, for the study kit scripts;
  - Foundry (`anvil`, `cast`, `forge`), only to regenerate the devnet recordings
    or ABI test vectors.

## Quick start (offline, no API keys)

```bash
git clone https://github.com/ss1738/txstory.git && cd txstory
npm ci
npm run -s txstory -- replay fixtures/devnet/anvil-0xdce671e4526d6d277669b28b2a9108c3f291951eb893a8d716101d94a2640359.json
```

This rebuilds an analysis from a recording of a real execution on a local anvil
devnet. In it, a contract pays 1 ETH to one recipient and sends 1 ETH into a call
that reverts inside a `try/catch`. Nothing is fetched. Actual output (abridged):

```text
Recording: anvil 0xdce671e4526d6d277669b28b2a9108c3f291951eb893a8d716101d94a2640359 (txstory-fixture-v3, recorded by TxStory 0.3.0; 5 exchanges; offline replay)
Origin: local-devnet · recorded 2026-11-26T17:02:58.713Z · Devnet: payAndTry
Same evidence: true · Same output: true · Rebuilt by TxStory 0.4.0
…
Net balance changes (exact):
  0x0000…0000                  +0.000000000000043844 ETH
  0x7099…79c8                  +1 ETH
  0xe7f1…0512                  +1 ETH
  0xf39f…2266 (sender)         −2.000025875905804276 ETH
…
Trace: complete via Anvil devnet RPC 1 · 3 frames, 1 failed, 1 rolled-back transfer(s)
Warnings:
  - 1 native transfer(s) inside execution were rolled back by a failed call and are not counted as balance changes (see the call trace).
```

"Same evidence" and "Same output" compare the rebuilt analysis with digests
stored in the recording. The node's own state agrees with these balance
changes; `tests/unit/devnet.test.ts` checks that against `cast balance`.

`npm run -s txstory -- <command>` is the CLI from source; it needs no build.
After `npm run build`, `node dist/node/cli/main.js <command>` runs the compiled
CLI, and `npm link` puts a `txstory` command on your PATH if you want one. The
command blocks below use the source form so they work as copied.

## Kinds of data

Every story and recording says which kind it is.

| Kind | Where it comes from | Real chain data? |
|---|---|---|
| **Live** | Fetched now from the RPC nodes and explorer you configure | Yes, as reported by those providers |
| **Local devnet** (`fixtures/devnet/`) | Recordings of transactions this project executed on a local anvil node, with expected values read from the node | Real EVM execution on a private test chain |
| **Synthetic** (`fixtures/synthetic/`) | Responses written to exercise specific behaviour (explorer refusals, pagination, L2 fees, NFT id disagreement and more); endpoints use the reserved `.invalid` domain | No. Labelled "Synthetic example" everywhere |
| **Your recordings** | `txstory record`, or "Download recording" on a story page | Whatever was captured, labelled `captured` |

Recordings captured from public providers are not distributed with the
repository, because their redistribution terms are unresolved (see
[DATA_PROVENANCE.md](DATA_PROVENANCE.md)).

## Recordings: capture, share, rebuild

A recording holds every provider response one analysis used, plus digests of
the evidence and of the result. Endpoints you configure are withheld from it
(see [Provider URLs in shareable output](docs/configuration.md#provider-urls-in-shareable-output));
check a recording before sharing it, because provider responses are stored as
received.

```bash
npm run -s txstory -- record ethereum 0x<hash> -o tx.json   # live analysis, saved
npm run -s txstory -- replay tx.json                        # rebuild offline on any machine
npm run -s txstory -- replay tx.json --json                 # the same, with a machine-readable report
```

The browser does the same: **Open recording** in the web UI (or on the static
site) reads a local file in the page, rebuilds the analysis with the same engine,
and reports:

- what was captured (responses, providers, origin, recording time);
- requests the recording cannot answer, shown as missing data and never fetched;
- which engine version recorded it and which rebuilt it;
- whether the evidence and output digests match, and what a mismatch means;
- field-level differences when the recording embeds its original story
  (`record --embed-story`).

"Decode with ABI files" rebuilds the same recording with contract ABIs you
supply, like `npm run -s txstory -- replay tx.json --abi MyContract.json`. Try it with
the shipped devnet recording of a custom error:

```bash
npm run -s txstory -- replay fixtures/devnet/anvil-0x27dbc58bd2861be2ea7264fd2d03aa97510ebc7ff3e00ab59a0bb114cbbe4aab.json --abi fixtures/devnet/Demo.abi.json
```

Without the ABI the revert is `unknown error selector 0xcf479181`; with it,
`InsufficientBalance(available="1000000000000000000", required="5")`. The
evidence is unchanged, so this exits 0. The report then says
the output changed because of those ABIs, not because the evidence did.

The file is not uploaded. What rebuilding does **not** do: it does not
re-execute EVM code, and it does not verify chain history. The recorded
responses are trusted as captured. Details: [docs/formats.md](docs/formats.md).

## Use it

**Browser (local server):**

```bash
npm run build
TXSTORY_MODE=recorded npm start     # http://127.0.0.1:8787, offline: examples and opened recordings only
npm start                           # live lookups through the configured providers
npm run dev                         # development (API :8787 + Vite :5173)
```

Paste a hash or an explorer link. The Evidence panel has Completeness, Logs,
Call data (with ABI decoding), Call trace, Participants and Sources tabs.

**Static site (no server):**

```bash
npm run build:site                  # writes dist/site
npm run site:preview                # http://127.0.0.1:4173
```

The static site rebuilds the shipped example recordings in the browser, opens
local recordings, and documents installation. It cannot look up live
transactions and does not ask for an RPC URL. The public copy at
https://txstory-site.satyawansinghinuk.workers.dev is built from the `v0.4.0`
tag and served by Cloudflare Workers Static Assets with the configuration in
[deploy/cloudflare](deploy/cloudflare/README.md). To host your own copy,
`dist/site` can be served by any static file host that falls back to
`404.html` for unknown paths.

**CLI** ([docs/cli.md](docs/cli.md)):

```bash
npm run -s txstory -- explain ethereum 0x<hash>
npm run -s txstory -- explain https://eth.blockscout.com/tx/0x<hash> --json --strict
npm run -s txstory -- explain ethereum 0x<hash> --abi MyContract.json --rpc http://127.0.0.1:8545
npm run -s txstory -- compare before.json after.json
npm run -s txstory -- decode revert --data 0x4e487b710000000000000000000000000000000000000000000000000000000000000011
```

The CLI keeps its output scriptable:

- `--json` puts one JSON document on stdout;
- errors go to stderr;
- exit codes are stable (`0` ok, `1` incomplete or different, `2` usage,
  `3` not found or pending, `4` providers down, `5` bad input file);
- configured provider URLs are withheld; only exact built-in public endpoints
  and bare loopback origins are printed.

**HTTP API** ([docs/api.md](docs/api.md); contract at `GET /api/openapi.json`):

With `TXSTORY_MODE=recorded npm start` running, these work offline on a
shipped synthetic example (with a live server, use any mainnet hash):

```bash
curl -s "http://127.0.0.1:8787/api/story/ethereum/0xefb65ab1ab71b94063c0ee8e8c7bdde47b808c19f4e653ed931e3006f4983112?stage=full" -o story.json
curl -s "http://127.0.0.1:8787/api/recording/ethereum/0xefb65ab1ab71b94063c0ee8e8c7bdde47b808c19f4e653ed931e3006f4983112" -o tx.recording.json
npm run -s txstory -- replay tx.recording.json
```

`story.json` holds `{"ok": true, "story": {...}}`; the exact balance changes are
in `story.ledger` (for example `jq '.story.ledger' story.json`, if you have
`jq`).

**Library** ([docs/engine.md](docs/engine.md), runnable example in
[examples/library/explain.ts](examples/library/explain.ts): `npx tsx examples/library/explain.ts`):

```ts
import { analyzeTransaction, engineConfigFromEnv, LiveTransport } from './src/engine/index.js';
const config = engineConfigFromEnv(process.env);
const transport = new LiveTransport({ timeoutMs: 15000, maxBytes: 8_000_000, userAgent: config.userAgent });
const r = await analyzeTransaction('ethereum', hash, transport, config);
if (r.kind === 'ok') console.log(r.story.ledger, r.story.completeness);
```

## Live analysis: what providers you need

Live analysis is the only mode that uses the network. With no configuration it
uses the public endpoints below. They are best-effort services run by others,
so for anything beyond trying it out, point TxStory at a node you control.

| Network | Key | Default RPCs (public, best-effort) | Explorer (optional) |
|---|---|---|---|
| Ethereum | `ethereum` | PublicNode, dRPC, Flashbots | eth.blockscout.com |
| OP Mainnet | `optimism` | PublicNode, mainnet.optimism.io | explorer.optimism.io |
| Base | `base` | PublicNode, mainnet.base.org | base.blockscout.com |
| Arbitrum One | `arbitrum` | PublicNode, arb1.arbitrum.io | arbitrum.blockscout.com |
| Your own | any key | from a chain file (`--chains`, `TXSTORY_CHAINS_FILE`) | optional |

What each provider is needed for:

- **A JSON-RPC endpoint is required.** Configure your own with
  `TXSTORY_RPC_<NETWORK>=url1,url2` or `--rpc`. Endpoints are tried in order:
  TxStory moves to the next one on network errors, HTTP 403/429/5xx, and
  JSON-RPC errors that describe the node's own limits (pruned history, an
  unsupported method, rate limits). Errors about the request itself, such as a
  reverted `eth_call`, are not retried. Public nodes differ in how much history
  they keep; in one check on 2026-11-27 PublicNode answered a block request for
  block 46147 with "pruned history unavailable". Exit code 4 means no
  configured endpoint could answer.
- **Call traces need `debug_traceTransaction` with the callTracer.** Self-hosted
  Geth, Reth, Erigon, Nethermind and Anvil offer it. Among the defaults, in a
  read-only check on 2026-11-26, PublicNode and Flashbots refused it and dRPC
  answered. TxStory tries each endpoint and records why it skipped one.
- **Blockscout is optional.** It provides labels, the balance cross-check, the
  explorer's summary and internal transfers when no trace is available. Base and
  Arbitrum Blockscout refused server-side requests (HTTP 403) in earlier checks,
  and stories there say so.

Fee models: Ethereum (burned base fee, priority fee, blob fee), OP Stack
(execution plus L1 data fee; deposit transactions are fee-less), Arbitrum.

## Built-in decoders

| Module | Recognises |
|---|---|
| ERC-20, ERC-721, ERC-1155 | Transfer/Approval/TransferSingle/TransferBatch/ApprovalForAll events and common calls (balance movements come from these) |
| WETH-style | Deposit/Withdrawal (wrapped native) |
| Uniswap-style pools | V2 Swap/Sync/Mint/Burn, V3 Swap, V4 Swap (and forks with identical signatures) |
| Seaport | OrderFulfilled/OrdersMatched/OrderCancelled with an evidence-backed interpretation |
| Solidity built-ins | `Error(string)`, `Panic(uint256)` with named panic codes |

Add your own ABIs at runtime with `--abi`. To add a decoder module, start from
the runnable example `npx tsx examples/decoder/split.ts` and see
[docs/extending.md](docs/extending.md).

## Known limitations

- **Trust.** TxStory trusts the RPC node and the explorer. Nothing is
  cryptographically verified.
- **Decoding is evidence of consistency, not of behaviour.** A selector or event
  match says the bytes fit an ABI. Any contract can emit any event. Rebasing and
  fee-on-transfer tokens can make event-based balances differ from real
  balances; the explorer cross-check is where that shows.
- **Without a trace,** native value moved inside execution comes from the
  explorer if it answers, and is otherwise marked unavailable.
- **Ordering.** The position of internal value transfers relative to token events
  is not known, and is not invented.
- **Pre-Byzantium transactions** (Ethereum blocks before 4,370,000, October
  2017) are not supported: their receipts have no status field, and TxStory
  reports `unsupported` (exit 3) instead of guessing the outcome.
- **Pending transactions** are reported, not explained. Very large transactions
  can exceed explorer page caps and are marked partial.
- **Older recordings (schema v1/v2)** did not request traces, and some predate
  the explorer's `/summary` endpoint. Replay reports such requests as "not
  captured in this recording" instead of fetching them.
- **Rebuilding is not verification.** A rebuilt analysis that matches its
  recording shows the analysis is deterministic over those responses. It says
  nothing about whether the responses were true.
- **One server instance.** Rate limits and caches are in memory.
- **Usability is unmeasured.** A study kit exists in `study/`, but no
  participant sessions have been run.

## Documentation

- [Architecture](docs/architecture.md) and [design decisions](docs/decisions.md)
- [Engine / library API](docs/engine.md)
- [Formats](docs/formats.md): story schema v3, recordings, evidence bundle
- [CLI](docs/cli.md) and [HTTP API](docs/api.md)
- [Extending](docs/extending.md): decoders, networks, providers
- [Self-hosting](docs/self-hosting.md), including the private-pilot configuration in [DEPLOYMENT.md](DEPLOYMENT.md)
- [Configuration reference](docs/configuration.md)
- [Developer trial](docs/trial.md): three tasks with observable success and failure
- [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Changelog](CHANGELOG.md) · [Releases](RELEASE.md)
- [Data provenance](DATA_PROVENANCE.md) · [Third-party notices](THIRD_PARTY_NOTICES.md) · [Verification record](VERIFICATION.md)

## License

TxStory is licensed under the [Apache License, Version 2.0](LICENSE).
Copyright 2026 Satyawan Singh (see [NOTICE](NOTICE)).

Third-party packages keep their own licenses ([THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)).
Recorded provider responses are third-party data, and their redistribution
status is documented separately ([DATA_PROVENANCE.md](DATA_PROVENANCE.md)).

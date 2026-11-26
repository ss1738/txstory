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

TxStory is read-only: no wallet, no signing, no accounts, no telemetry. It
trusts the RPC nodes and explorer it queries (there is no light-client or proof
verification), and it says so in every output.

## Requirements

- **Node.js 22 or later, and npm.** The lockfile pins every dependency, so
  install with `npm ci`.
- **Optional:**
  - Docker, for the container;
  - Chrome or Chromium, for the browser test suite;
  - Python 3, for the study kit scripts;
  - Foundry (`anvil`, `cast`, `forge`), only to regenerate the devnet recordings
    or ABI test vectors.
- **No API keys are needed.**

## Try it in one minute (offline, no API keys)

```bash
git clone <this repository> txstory && cd txstory
npm ci
npx tsx src/cli/main.ts replay fixtures/devnet/anvil-0xdce671e4526d6d277669b28b2a9108c3f291951eb893a8d716101d94a2640359.json
```

This replays a real execution recorded on a local anvil devnet. In it, a contract
pays 1 ETH to one recipient and sends 1 ETH into a call that reverts inside a
`try/catch`. Actual output:

```text
Same evidence: true · Same output: true

Anvil devnet · 0xdce671e4526d6d277669b28b2a9108c3f291951eb893a8d716101d94a2640359
Succeeded · block 5 · 2026-11-26T14:22:27.000Z · recorded data · stage full
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

The node's own state agrees with these balance changes, and
`tests/unit/devnet.test.ts` checks that against `cast balance`.

## Example data

The repository ships two kinds of recordings, and every output says which one
it is.

- **`fixtures/devnet/`:** real execution on a local anvil node run by this
  project, with expected values read from the node.
- **`fixtures/synthetic/`:** generated responses that exercise specific behaviour
  (explorer refusals, pagination, L2 fees, NFT id disagreement and more). They
  are **not real transactions or provider data**, and the UI labels them
  "Synthetic example".

Recordings captured from public providers are not distributed, because their
redistribution terms are unresolved (see [DATA_PROVENANCE.md](DATA_PROVENANCE.md)).
`txstory record` makes your own.

## Use it

**Browser:**

```bash
npm run build && npm start                          # http://127.0.0.1:8787, live public providers
TXSTORY_MODE=recorded npm start                     # offline: only the example recordings
npm run dev                                         # development (API :8787 + Vite :5173)
```

Paste a hash or an explorer link. The Evidence panel has Completeness, Logs,
Call data (with ABI decoding), Call trace, Participants and Sources tabs.

**CLI** ([docs/cli.md](docs/cli.md)):

```bash
npm run build      # then `node dist/node/cli/main.js …`, `npx tsx src/cli/main.ts …`, or `npm link` for `txstory`
txstory explain ethereum 0xec893ce03b8b8ef2d5e0d5edb9db9f63ad0972e2a6845504bc31cca395869804
txstory explain https://eth.blockscout.com/tx/0x… --json --strict
txstory explain ethereum 0x… --abi MyContract.json --rpc http://127.0.0.1:8545
txstory record ethereum 0x… -o tx.json && txstory replay tx.json
txstory compare before.json after.json
txstory decode revert --data 0x4e487b71…11
```

The CLI keeps its output scriptable:

- `--json` puts one JSON document on stdout;
- errors go to stderr;
- exit codes are stable (`0` ok, `1` incomplete or different, `2` usage,
  `3` not found or pending, `4` providers down, `5` bad input file);
- URLs are always redacted.

**HTTP API** ([docs/api.md](docs/api.md); contract at `GET /api/openapi.json`):

```bash
curl -s "http://127.0.0.1:8787/api/story/ethereum/0x…?stage=full" | jq '.story.ledger'
curl -s "http://127.0.0.1:8787/api/recording/ethereum/0x…" > tx.recording.json
```

**Library** ([docs/engine.md](docs/engine.md), runnable example in
[examples/library/explain.ts](examples/library/explain.ts)):

```ts
import { analyzeTransaction, engineConfigFromEnv, LiveTransport } from './src/engine/index.js';
const config = engineConfigFromEnv(process.env);
const transport = new LiveTransport({ timeoutMs: 15000, maxBytes: 8_000_000, userAgent: config.userAgent });
const r = await analyzeTransaction('ethereum', hash, transport, config);
if (r.kind === 'ok') console.log(r.story.ledger, r.story.completeness);
```

## Networks, providers and what they are needed for

| Network | Key | Default RPCs (public, best-effort) | Explorer (optional) |
|---|---|---|---|
| Ethereum | `ethereum` | PublicNode, dRPC, Flashbots | eth.blockscout.com |
| OP Mainnet | `optimism` | PublicNode, mainnet.optimism.io | explorer.optimism.io |
| Base | `base` | PublicNode, mainnet.base.org | base.blockscout.com |
| Arbitrum One | `arbitrum` | PublicNode, arb1.arbitrum.io | arbitrum.blockscout.com |
| Your own | any key | from a chain file (`--chains`, `TXSTORY_CHAINS_FILE`) | optional |

What each provider is needed for:

- **A JSON-RPC endpoint is required.** Configure your own with
  `TXSTORY_RPC_<NETWORK>=url1,url2` or `--rpc`.
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
| Seaport | OrderFulfilled/OrdersMatched/OrderCancelled with an evidence-backed interpretation (the worked example for contributors) |
| Solidity built-ins | `Error(string)`, `Panic(uint256)` with named panic codes |

Add your own ABIs at runtime with `--abi`. To add a decoder module, see
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
- **Pending transactions** are reported, not explained. Very large transactions
  can exceed explorer page caps and are marked partial.
- **Older recordings (schema v1/v2)** did not request traces, and some predate
  the explorer's `/summary` endpoint. Replay reports such requests as "not
  captured in this recording" instead of fetching them.
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
- [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Changelog](CHANGELOG.md) · [Release notes and checklist](RELEASE.md)
- [Data provenance](DATA_PROVENANCE.md) · [Third-party notices](THIRD_PARTY_NOTICES.md) · [Verification record](VERIFICATION.md)

## License

TxStory is licensed under the [Apache License, Version 2.0](LICENSE).
Copyright 2026 Satyawan Singh (see [NOTICE](NOTICE)).

Third-party packages keep their own licenses ([THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)).
Recorded provider responses are third-party data, and their redistribution
status is documented separately ([DATA_PROVENANCE.md](DATA_PROVENANCE.md)).

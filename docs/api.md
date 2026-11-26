# HTTP API

The server (`npm start`, or the container) exposes a read-only JSON API. The
machine-readable contract is **`GET /api/openapi.json`** (OpenAPI 3.1,
generated from `src/server/openapi.ts`). `tests/unit/api-contract.test.ts`
checks the implementation against it and runs every example on this page.

All routes are `GET` (and `HEAD`). Other methods return `405`.

## Examples

Start a server in recorded mode to try these. It replays the recordings in
`fixtures/synthetic` and `fixtures/devnet`, so it is offline and deterministic.
The transaction below is the synthetic fee-on-transfer swap: generated test
data, not a real transaction.

```bash
npm run build && TXSTORY_MODE=recorded npm start   # http://127.0.0.1:8787
```

```bash
TXSTORY=http://127.0.0.1:8787
curl -s "$TXSTORY/api/health"                                       # → 200
curl -s "$TXSTORY/api/chains"                                       # → 200
curl -s "$TXSTORY/api/examples"                                     # → 200
curl -s "$TXSTORY/api/example/ethereum/0xefb65ab1ab71b94063c0ee8e8c7bdde47b808c19f4e653ed931e3006f4983112"            # → 200
curl -s "$TXSTORY/api/story/ethereum/0xefb65ab1ab71b94063c0ee8e8c7bdde47b808c19f4e653ed931e3006f4983112?stage=fast"   # → 200
curl -s "$TXSTORY/api/recording/ethereum/0xefb65ab1ab71b94063c0ee8e8c7bdde47b808c19f4e653ed931e3006f4983112"          # → 200
curl -s "$TXSTORY/api/story/ethereum/0x1234"                        # → 400
curl -s "$TXSTORY/api/story/solana/0xefb65ab1ab71b94063c0ee8e8c7bdde47b808c19f4e653ed931e3006f4983112"                # → 400
curl -s "$TXSTORY/api/example/ethereum/0xabababababababababababababababababababababababababababababababab"               # → 404
curl -s "$TXSTORY/api/nope"                                         # → 404
curl -s "$TXSTORY/api/openapi.json"                                 # → 200
```

With `jq`, for example the sender's net balance changes:

```bash
curl -s "$TXSTORY/api/example/ethereum/0xefb65ab1ab71b94063c0ee8e8c7bdde47b808c19f4e653ed931e3006f4983112" \
  | jq '.story as $s | $s.ledger[] | select(.address == $s.tx.from) | {asset: .assetKey, delta}'
```

## Routes

| Route | Purpose |
|---|---|
| `/api/health` | `200 {ok, mode, draining:false}`; `503 {draining:true}` during shutdown |
| `/api/chains` | Configured networks: key, chain id, explorer link base, RPC **provider names** (never URLs) |
| `/api/examples` | Examples available at `/api/example/...`, each with its `origin` (`local-devnet`, `synthetic`, or `captured`) |
| `/api/story/{network}/{hash}?stage=fast\|full` | Explain a transaction. `fast`: RPC only. `full` (default): adds explorer data, the cross-check and the call trace. |
| `/api/example/{network}/{hash}` | Explain an example from its recording. Offline. `story.mode` is `recorded`, or `synthetic` for synthetic recordings. |
| `/api/recording/{network}/{hash}` | A replayable recording (`txstory-fixture-v3`): every provider response used, plus the output. Replay it with `txstory replay`. |
| `/api/openapi.json` | The contract |

## Responses and errors

- **Success:** `{ "ok": true, "story": { … } }`. The Story format, schema version 3,
  is described in [formats.md](formats.md). Integers are decimal strings, so no
  precision is lost.
- **Errors:** `{ "ok": false, "code", "message", "sources"? }`. `sources` lists the
  requests made before the failure, with redacted URLs.

| Status | `code` | Meaning |
|---|---|---|
| 400 | `invalid-chain`, `invalid-hash` | Bad input |
| 404 | `not-found`, `unknown-route` | No such transaction, recording or route |
| 405 | `method-not-allowed` | Only GET/HEAD |
| 409 | `pending` | Known but not mined; retry later |
| 422 | `unsupported` | Cannot be explained (e.g. pre-Byzantium receipt) |
| 429 | `rate-limited` | See `Retry-After` |
| 502 | `rpc-unavailable` | Every RPC endpoint failed |
| 503 | `busy` | No build slot became free in time, or the server is draining. See `Retry-After`. |

**Partial outcomes are not errors.** A `200` story can be incomplete. Check:

- `story.completeness` (anything other than `complete`);
- `story.warnings`;
- `story.sources[].status === "error"`;
- `story.trace.status`.

## Limits, cancellation and providers

- **Rate limits.** Live `story` and `recording` requests are limited per client
  (`TXSTORY_RATE_LIMIT_PER_MINUTE`, default 30) and globally
  (`TXSTORY_GLOBAL_RATE_LIMIT_PER_MINUTE`, default 300). The windows are fixed
  one-minute windows.
  - **What counts:** one browser lookup is two requests (`fast`, then `full`).
  - **Client identity** behind proxies follows `TXSTORY_TRUST_PROXY` (README).
- **Concurrency.** Fast and full builds have separate pools, there is a
  per-client cap, and requests wait a short bounded time for a slot
  (`TXSTORY_SLOT_WAIT_MS`). Cache hits and requests identical to one already
  running take no slot.
- **Cancellation.** Closing the connection does **not** cancel a build. The
  build finishes within its budget (`TXSTORY_FAST_BUDGET_MS`,
  `TXSTORY_FULL_BUDGET_MS`), and a clean result is cached for
  `TXSTORY_CACHE_TTL_MS`, so retries are cheap.
- **Provider dependencies.** `story` needs a working JSON-RPC endpoint for the
  network. The following are optional, and when they are missing the story says
  so:
  - Blockscout, for labels, the cross-check and internal transfers;
  - an RPC endpoint that offers `debug_traceTransaction` with the callTracer, for
    traces and revert data.

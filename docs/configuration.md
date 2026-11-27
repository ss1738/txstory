# Configuration reference

All settings are optional environment variables. See [.env.example](../.env.example).

| Variable | Default | Purpose |
|---|---|---|
| `TXSTORY_MODE` | `live` | `recorded` serves only saved fixtures |
| `TXSTORY_HOST` / `TXSTORY_PORT` | `127.0.0.1` / `8787` | Listen address |
| `TXSTORY_RPC_<CHAIN>` | public endpoints (below) | Comma-separated RPC list; replaces the defaults |
| `TXSTORY_EXPLORER_<CHAIN>` | Blockscout per chain | Blockscout v2 base URL, or `off` |
| `TXSTORY_BLOCKSCOUT_API_KEY` | none | Optional; redacted from all records |
| `TXSTORY_MAX_EXPLORER_PAGES` | `6` | Pagination cap per explorer list |
| `TXSTORY_MAX_TOKEN_METADATA` | `30` | Cap on `eth_call` metadata lookups |
| `TXSTORY_TIMEOUT_MS` | `15000` | Per-request timeout |
| `TXSTORY_SLOW_EXPLORER_TIMEOUT_MS` | `45000` | Timeout for the explorer's slow endpoints (state changes, internal transactions; measured at up to about 20 s) |
| `TXSTORY_MAX_RESPONSE_BYTES` | `8000000` | Per-response size cap |
| `TXSTORY_RATE_LIMIT_PER_MINUTE` | `30` | Live story requests per client per minute (one lookup = a fast plus a full request) |
| `TXSTORY_GLOBAL_RATE_LIMIT_PER_MINUTE` | `300` | Live story requests per minute across all clients (protects upstream providers) |
| `TXSTORY_TRUST_PROXY` | none | Which TCP peers may supply `X-Forwarded-For`: `loopback`, `private`, IPs or CIDRs. See below. |
| `TXSTORY_MAX_CONCURRENT_FAST` / `_FULL` | `8` / `6` | Concurrent fresh builds per stage. The pools are separate, so slow explorer work cannot block first renders. |
| `TXSTORY_MAX_CONCURRENT_PER_CLIENT` | `2` | Concurrent fresh builds one client may hold, per stage, including queued ones |
| `TXSTORY_SLOT_WAIT_MS` | `10000` | How long a request may wait for a free slot (queue of 4× the pool), then 503 with `Retry-After` |
| `TXSTORY_FAST_BUDGET_MS` / `_FULL_BUDGET_MS` | `35000` / `90000` | Wall-clock budget for all provider calls of one story; afterwards it finishes with partial data |
| `TXSTORY_CACHE_MAX_MB` | `64` | Byte bound for each in-memory cache (stories; provider responses) |
| `TXSTORY_SHUTDOWN_GRACE_MS` | `8000` | On SIGTERM: drain time for in-flight requests before connections are closed |
| `TXSTORY_LOG_REQUESTS` | `1` | One JSON line per API request (no IPs, hashes or URLs); `0` disables |
| `TXSTORY_CACHE_TTL_MS` | `600000` | Cache for finished stories |

## Reverse proxies and client identity

- **Default.** Rate limits and per-client concurrency key on the TCP peer
  address, and `X-Forwarded-For` is ignored. Direct deployments need no setting,
  and clients cannot choose their identity.
- **Behind a proxy**, set `TXSTORY_TRUST_PROXY` to exactly the proxy's address or
  range. The header is then read only when the TCP peer is one of those proxies:
  - It is walked right to left, through trusted hops, at most 10 hops.
  - The first untrusted address is the client. Spoofed entries further left are
    ignored.
  - A malformed hop stops the walk at the last trusted address.
  - `Forwarded`, `X-Real-IP` and similar headers are never used.
  - IPv4-mapped IPv6 counts as IPv4, and IPv6 clients are limited per /64.
- **Refused at startup:** "trust everything" ranges and malformed entries.
- **Limits.** These are fixed one-minute windows, and the response's
  `Retry-After` says when a client may retry. At most 10,000 clients are
  tracked; when the table is full, new clients share one overflow bucket, so
  address spraying cannot reset limits that are already being tracked.
- **Topology examples:** see `DEPLOYMENT.md`.

Credentials can live in RPC URLs. API keys stay on the server and never reach
the browser.

### Provider URLs in shareable output

Stories, recordings, evidence exports, HTTP API responses, CLI output and the
browser show a configured endpoint's URL only when the endpoint is trusted.
Trust is decided for the whole endpoint URL, never for a host alone:

- an **exact** built-in public endpoint (the defaults listed in the README):
  same scheme, host, port and path, with no userinfo, query or fragment;
- a **bare loopback origin**: `http(s)://localhost`, `127.0.0.1` or `[::1]`
  with an optional port and nothing else (no path, userinfo or query);
- an exact URL listed in `EngineConfig.trustedEndpointUrls` by library code
  (the synthetic fixture generator lists its `.invalid` endpoints this way).

Everything else is **withheld**, including a public host with an extra path or
query, and `localhost` or `.invalid` URLs with a path, query or userinfo. This
covers `TXSTORY_RPC_<NETWORK>`, `--rpc`, `TXSTORY_EXPLORER_<NETWORK>`,
`--explorer` and chain files. A withheld RPC endpoint appears as
`https://rpc-<n>.withheld.invalid/` (its position in the endpoint list) and a
withheld explorer as `https://explorer.withheld.invalid` followed by the path
and query TxStory generated for the request (the explorer's own `apikey`
parameter becomes `REDACTED`). The provider label (for example
`custom RPC 1`) is kept. These forms are also the request identifiers in new
recordings: distinct requests stay distinct, and the recordings rebuild offline
without the real URLs. Endpoints read back from a recording are shown as they
were stored.

Omitted on purpose: the real host, path and query of withheld endpoints. A
reader of a shared recording learns which position and label answered each
request, not which provider or account it was.

Provider error text can echo a URL or key. Before an error response (a non-2xx
status, a transport failure, or a JSON-RPC `error`) is analysed or recorded,
fragments of withheld endpoint URLs and the explorer API key are replaced with
`REDACTED`: userinfo, path segments, query values and host labels other than
the last two, when they have at least 6 characters including a digit or at
least 16 characters. Successful responses are not changed.

Limits: a secret shorter than those thresholds can survive in echoed error
text; successful response bodies are recorded as received; explorer pagination
parameters come from explorer responses and are kept; and nothing makes an
arbitrary provider response or a file you supply safe to share. Check a
recording before sharing it. Recordings made by earlier versions keep the URLs
they were written with, which may include credentials that the earlier
redaction missed.

## Engine, CLI and analysis settings

These variables configure the engine, which the server, the CLI and the
library share:

| Variable | Default | Purpose |
|---|---|---|
| `TXSTORY_TRACE` | `auto` | `auto` requests `debug_traceTransaction` (callTracer) in the full stage, trying each RPC endpoint in order. `off` never requests traces. |
| `TXSTORY_CHAINS_FILE` | none | Add networks from a JSON chain file. See [extending.md](extending.md#adding-a-network). |
| `TXSTORY_FIXTURES_DIR` | `fixtures/synthetic,fixtures/devnet` | Comma-separated directories of recordings served as examples. Add a directory of your own recordings to serve them too. |
| `TXSTORY_RPC_<NETWORK>` | network defaults | Comma-separated RPC URLs. The key is upper-cased, with `-` becoming `_`. |
| `TXSTORY_EXPLORER_<NETWORK>` | network default | Blockscout v2 API base, or `off` |

Server-only settings (rate limits, concurrency, budgets, logging, proxy trust)
are listed above. The CLI has flags that override the network-specific variables
for one command (`--rpc`, `--explorer`, `--no-trace`, `--timeout`).

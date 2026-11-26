# Verification record

## 0.3.0 public-release preparation (2026-11-27; not published)

This is implementer validation, not an independent review. The evidence kinds
are kept apart:

- synthetic recordings;
- real local execution (anvil);
- captured real provider responses (private, opt-in);
- live provider calls;
- human usability: **none**.

### Release data decision

- **Moved out of the tree:** captured provider responses (20 recordings, one
  study evidence file, one unused prototype response). The reasons and primary
  sources are in DATA_PROVENANCE.md.
- **Preserved privately:** copies were verified by SHA-256 before removal.
- **Replaced by:**
  - `fixtures/synthetic`: 15 deterministic generated cases, labelled synthetic
    everywhere;
  - `fixtures/devnet`: real local execution, now labelled `local-devnet`.

### Clean release copy (MEASURED)

The tree of commit `dac141c` was exported with `git archive` into an empty
directory: no `.git`, `node_modules`, build output or ignored files. Checks ran
under `env -i PATH HOME`, with Node 22.19.0 and npm 11.12.1.

| Check | Result |
|---|---|
| `npm ci` from the lockfile; `npm audit --omit=dev` | Installed; 0 vulnerabilities |
| `npm run build` (both typechecks, client, node) | Exit 0 |
| `npm test` (offline) | 204 passed, 11 files. One assertion was added afterwards; see below. |
| `npm run test:e2e` with installed Chrome | 21 passed |
| `TXSTORY_E2E_BROWSER=chromium npm run test:e2e` (the CI configuration, with Playwright's Chromium headless shell v1254 downloaded by `npx playwright install chromium`) | 21 passed, on macOS. GitHub Actions has **not** run it. |
| CLI `help`, `--version` | Correct output; documented examples run in `tests/unit/cli.test.ts` |
| Library example `examples/library/explain.ts` | Ran offline; decoded the custom error |
| `node scripts/third-party.mjs` vs THIRD_PARTY_NOTICES.md | No difference |
| Synthetic recordings regenerated | Byte-identical (also identical across three local regenerations) |
| `python3 study/score.py --self-test` | Passed |
| `python3 study/verify_answer_key.py` without captured inputs | Exit 2 with an explanation, as designed. With the private copy and `--check`, it reports the committed key consistent. |
| `npm run test:captured` without `TXSTORY_CAPTURED_DIR` | Fails with an explanation. With the private copy: 43 passed. |

### Core workflow with outbound network blocked (MEASURED)

1. **Capture.** A real Ethereum NFT transfer (`0x1f9753…`) was captured live
   (read-only) with `txstory record ... --embed-story`: 11 provider exchanges.
   The explorer's state-changes request failed during capture, and the
   recording kept that failure.
2. **Block.** A macOS `sandbox-exec` profile denied all outbound network. Inside
   it, `curl` failed (exit 6) and Node `fetch` failed (`ENOTFOUND`).
3. **Reconstruct.** Under that profile, `txstory replay` exited 0:
   - same evidence and same output (digest `fce17418…` both times);
   - 11 sources, all `recorded`;
   - the same failed state-changes source as at capture;
   - a complete trace (as recorded from dRPC);
   - the ledger shows BAYC #3703 leaving one address and arriving at the other.
4. **Inspect.** Under the same profile, `txstory explain --recording` printed
   the story.

What was reproduced is TxStory's analysis of the saved responses. This is not
EVM re-execution or cryptographic verification. The raw files are kept privately
(they contain third-party responses).

### One server, several transactions (MEASURED)

Recorded mode, built release copy:

- **Transactions:** 4 synthetic ones (two ethereum NFT cases, one swap, one OP
  transfer) and 1 devnet one.
- **Requests:** each was fetched sequentially, again after the others, then
  twice concurrently, plus once in the fast stage.
- **Results:**
  - every response had its own hash and network;
  - concurrent results equalled sequential ones;
  - the first transaction was identical when requested again;
  - each transaction had a distinct digest.

The two NFT cases have identical ledgers by construction (only the explorer's
token id differs).

Cache isolation, pending to mined retries, NFT identity, trace rollback and
deterministic reconstruction stay covered by the unit suite (regressions, devnet,
synthetic and engine tests).

### Container from the release copy (MEASURED)

- **Image:** `txstory:release`, 241 MB, runs as uid 1000.
- **Contents:** no CSV, `.env`, study, `.git`, test or captured-recording files.
  `/app` holds the build, `fixtures/{synthetic,devnet}`, production
  `node_modules` and the notices.
- **Behaviour:**
  - health OK;
  - 21 examples (15 synthetic, 6 local-devnet);
  - the swap example reports `mode: synthetic`;
  - a deep link serves the shell;
  - CLI replay works inside the container;
  - `docker stop` exits 0.

### Defect found by this verification and fixed

- **Spurious startup warnings.** The container printed 3 `recording-rejected`
  warnings for `expected.json`, `chains.json` and `Demo.abi.json` in
  `fixtures/devnet`. These are not recordings, and the startup scan added
  earlier in this round treated them as if they were.
- **Fix:** the scan and the examples list now consider only file names of the
  form `<network>-0x<64 hex>.json` (`RECORDING_FILE_NAME`).
- **Regression check:** an assertion that the shipped directories produce no
  warnings.

### Not verified

- GitHub Actions on GitHub's runners.
- Any publication step.
- Real Geth, Reth or Erigon trace endpoints.
- Human usability.


## Earlier records

The sections below are dated records of earlier development rounds. They
describe the repository as it was then. Paths such as `fixtures/recorded` and
`study/evidence` no longer exist in the release: those captured recordings were
moved out of the repository (DATA_PROVENANCE.md). Test counts in those sections
refer to the suites of that time.

## Developer release 0.3.0 (prepared 2026-11-26; not published)

Evidence is grouped by kind and never mixed:

- synthetic (fakes and local mocks);
- recorded real provider responses;
- real local execution (anvil);
- live public providers;
- human usability: **none**.

Raw evidence for the live measurements is kept privately outside the
repository, because it contains third-party responses (see DATA_PROVENANCE.md).

### Commands and results (final source)

| Check | Result |
|---|---|
| `npm run build` (both typechecks, client, node) | OK |
| `npm test` (Vitest, offline) | **225 passed**, 11 files |
| `npm run test:e2e` (Playwright, recorded mode) | **20 passed** |
| `python3 study/verify_answer_key.py`, `python3 study/score.py --self-test` | Consistent; passed |
| `node scripts/third-party.mjs \| diff - THIRD_PARTY_NOTICES.md` | No difference |
| `npm audit --omit=dev` | 0 vulnerabilities |
| gitleaks over all commits, plus pre-commit on every commit | No leaks. No allowlist was added: a proposed address allowlist was declined, so recordings were made leaner instead (docs/decisions.md D6). |
| Clean clone, minimal environment (`env -i PATH HOME`) | `npm ci`, audit, build, 224 unit, 20 e2e, CLI replay, library example, notices, study kit all passed, and no untracked files remained (raw output kept privately). One test was added after this run (225 now); the clean-clone run is repeated on the final commit below. |
| Container from the clean clone (`txstory:ci`, 245 MB) | Runs as uid 1000. No CSV, `.env`, study, `.git` or tests in the image. Healthy; 26 examples; devnet story with a complete trace; OpenAPI served; deep link serves the shell; CLI works inside the container; `docker stop` exits 0. |

### Independent references used

| Reference | Covers | Where |
|---|---|---|
| **Foundry `cast` as encoder** (v1.7.1) | 12 calldata, error and event vectors: nested tuples, fixed and dynamic arrays, negative integers, empty values, a known selector collision | `tests/vectors/abi-cast.json`, `tests/unit/abi.test.ts` |
| **Blockscout's own decodings** in recorded fixtures | Every recorded `decoded_input` (≥ 8 calls, including Seaport `matchAdvancedOrders` with deep tuples) and every log carrying a verified ABI item (≥ 50 logs) | `tests/unit/abi.test.ts` |
| **Node state on a real EVM** (anvil 1.7.1; `cast balance` at blocks N−1 and N) | Native balance changes and fees for 6 transactions: nested transfers, a transfer rolled back inside `try/catch`, a custom error, `Error(string)`, `Panic(0x11)`, an ERC-20 transfer | `fixtures/devnet/expected.json`, `tests/unit/devnet.test.ts` |

### Defects found and fixed during this work

All of these are MEASURED.

- **Source records were numbered by completion order.** This applied to RPC
  metadata calls and to explorer pages, so identical evidence could give a
  different story.
  - Found first on devnet replays, then on a live mainnet recording ("same
    evidence: true, same output: false").
  - Fixed by request-ordered, endpoint-derived ids.
  - The regression test fails on the old client and passes now.
  - Two fresh live recordings now replay with identical output digests
    (raw output kept privately).
- **An ABI array-length bound used a non-integer division.** Seaport calldata
  threw "cannot be converted to a BigInt". Found by the Blockscout comparison;
  fixed.
- **The same signature under different parameter names was reported as
  ambiguous.** Fixed: candidates are merged, and all sources are listed.
- **Endpoints missing from older recordings became errors.** After a message
  rename, they turned from "not captured" (`empty`) into `error`. Fixed with a
  shared constant; the test now asserts `empty`.
- **A network registered only from a recording made config building throw.**
  Fixed.
- **The CLI crashed with `EPIPE`** when piped into `head`. Fixed.
- **The CI workflow used an invalid container name (`t`)** and a
  `! cmd | grep` check, which never fails under `bash -e`. Both fixed before CI
  ever ran.
- **Trace frames failed colour contrast** (axe) because of reduced opacity on
  rolled-back frames. Fixed with a border marker plus text.

### Live provider observations (read-only, 2026-11-26)

These are single observations, not guarantees.

- **Ethereum swap `0xec893c…`** (CLI, live, 23.7 s):
  - complete trace via dRPC; PublicNode refused `debug_traceTransaction`;
  - all completeness flags complete;
  - cross-check: 6 match, **1 mismatch**.
  - Explanation via `txstory compare` against the earlier recording: TxStory's
    facts are identical. The explorer's state change for the pool's M87 changed
    from `…388113022` (equal to the Transfer event) to `…388113026`, and its
    token-transfer list returned HTTP 500.
  - Files: raw output kept privately, `live-explain.txt`.
- **OP Mainnet `0x12b0f3…`:**
  - no trace (PublicNode: method not offered; mainnet.optimism.io: HTTP 403);
  - the explorer gave native internal transfers as complete;
  - cross-check 9 match, 1 only explorer.
- **Base `0x9031bb…` and Arbitrum `0x5182a3…`:**
  - no trace: PublicNode refused on both; Base's public RPC returned HTTP 401,
    and Arbitrum's public RPC refused the method;
  - the explorers were unavailable;
  - native internal transfers correctly reported as `unavailable`.
- **`GET /api/recording` (live, NFT transfer `0x1f9753…`):**
  - 200 in 38.5 s with 11 exchanges and no credential-like strings;
  - replayed offline with same evidence. Same output was false before the
    ordering fix; after it, the fresh recordings above replay with identical
    output.

### Not verified

- **GitHub Actions has not run.** The repository is not published. The workflow
  was checked as YAML, and its steps were executed locally in the clean-clone
  run, but not on GitHub. Using Playwright's bundled Chromium
  (`TXSTORY_E2E_BROWSER=chromium`) was not exercised locally; local runs used
  installed Chrome.
- **Live traces** were exercised only on Ethereum via dRPC, plus local anvil.
  Real Geth, Reth and Erigon nodes were not tested.
- **Human usability** has not been measured.


## Private-pilot preparation, 2026-11-26

Engineering for a small private pilot. **Nothing was deployed.** These results
come from local runs on the development machine with local mock providers; no public RPC or
explorer service was load-tested. They are not evidence of internet-scale
capacity, usability or production readiness.

### Gaps found and fixed

| Gap (how found) | Fix |
|---|---|
| Rate limit keyed on the socket address. Behind a proxy all clients shared one bucket. (Code; README "unfinished") | `clientIp.ts` adds `TXSTORY_TRUST_PROXY` (default: trust nothing). `X-Forwarded-For` is read only from trusted peers, right to left, at most 10 hops; malformed hops stop the walk; IPv4-mapped addresses are normalised; IPv6 is limited per /64; unsafe settings are refused at startup. |
| The limiter `clear()`ed every client when 10k addresses were tracked, so spraying addresses reset all limits. (Code) | `RateLimiter`: expired windows are reclaimed oldest-first; when full, new keys share one overflow bucket; a global per-minute ceiling is added. |
| Slow provider calls held all 8 shared slots, blocking first renders. (MEASURED on the previous build, scenario s2 below) | Separate fast and full pools; a per-client cap; a wall-clock budget per build (`withDeadline`); cache hits and identical in-flight joins take no slot. |
| A burst of 12 clients got 34/120 immediate 503s although builds took about 200 ms. (MEASURED, s1, first run) | A bounded FIFO wait for slots (`TXSTORY_SLOT_WAIT_MS`, queue 4× pool). Re-run: 120/120 returned 200. |
| Caches were bounded by entry count only: 500 stories of up to 711 KB each (MEASURED largest), and 2000 responses of up to 8 MB. | Byte-bounded caches (`TXSTORY_CACHE_MAX_MB`, default 64 MB each). Recorded examples are cached too. |
| Recorded examples returned 502 whenever custom RPCs or an explorer key were configured. (MEASURED, s8 on both builds) | Replay always uses the recording endpoints and no API key. Regression test fails without the fix (expected 502 to be 200). |
| `/api/examples` listed only schema-v1 fixtures (15 of 20). (MEASURED) | v2 fixtures are listed too; the e2e count is updated to 20. |
| Shutdown waited without limit: 22.4 s with one slow request in flight, on the previous build. (MEASURED, s8) | Draining: health returns 503, new live work is refused, idle connections close, then a `TXSTORY_SHUTDOWN_GRACE_MS` deadline applies. |
| No request logging. | One JSON line per API request: route, chain, stage, status, cache, ms, sourceErrors, limit. No IPs, hashes or URLs (tested). |
| The build context included `study/` (including private results), tests and scripts. | `.dockerignore` is now an allowlist. |

### Tests

`tests/unit/operations.test.ts` has 35 tests: IP parsing, trust configuration,
spoofing, trusted and untrusted hops, malformed input, hop bounds, IPv6 /64,
limiter recovery, global and overflow buckets, slots and their queue, byte
caches, budgets, HTTP-level starvation and recovery, draining, log content,
replay of recorded examples with custom endpoints, and the example listing.

- `npm run typecheck`: clean.
- `npm run build`: OK.
- `npm test`: **128 passed** (6 files). This includes the 27 earlier regression
  tests: cache isolation, pending → mined, NFT identity.
- `npm run test:e2e`: **19 passed**.
- `python3 study/verify_answer_key.py`: consistent.
- `python3 study/score.py --self-test`: passed.
- `python3 study/score.py`: reports "Human usability remains unmeasured" and
  exits 1, because no results exist.

### Production build against local mock providers (`node scripts/ops-check.mjs`)

| Scenario | Previous build (7492e73) | This build |
|---|---|---|
| s1: 12 clients × 5 lookups (fast + full), 120 requests | n/a | 120 × 200; fast p50/p95 49/150 ms, full p50/p95 454/501 ms; cache built 98 / joined 16 / hit 6; RSS 57 → 103 MB |
| s2: explorer hangs; 8 full builds, then 3 first renders | first renders **503 in 4 to 5 ms** (all 8 shared slots held) | first renders **200 in 51 to 52 ms**; 6 full builds admitted, 2 refused after a 10 s wait with `Retry-After`; builds end at about 15 s with partial data flagged; recovers |
| s3: state changes answered after 20 s | n/a | 200 in 20.2 s, `stateChanges: complete`, 3 cross-check matches (longer timeout works) |
| s4: first state-changes request 503, then OK | n/a | partial (`unavailable`) → retry complete → third request served from cache |
| s5: RPC 429 → 403 → OK; all 429; RPC hangs with a 5 s budget | n/a | fallback 200 with the reasons noted; 502 `rpc-unavailable`; 502 in 5012 ms |
| s6: explorer 403 / 429 / 9 MB body | n/a | all 200 with gaps labelled; size cap "response larger than 8000000 bytes"; RSS ≤ 94 MB |
| s7: limit 5 per client, global 12 | n/a | one client 5 × 200 then 429; rotating spoofed left-hand XFF all 429; global ceiling 429 with its own message |
| s8: static files, deep links, recorded example, SIGTERM during a 20 s build (3 s grace), restart | example **502**; shutdown waited **22.4 s** | shell and assets OK (immutable cache); example 200 recorded; exit 0 after **3.0 s**, in-flight connection closed, new connections refused; idle exit 3 ms; restart OK |

### Container (image `cb2b00aae60e`, 245 MB, built from this source)

- **Build context:** listed by a probe build. It holds only `package*.json`,
  tsconfigs, `vite.config.ts`, `src/` and `fixtures/recorded/`. Blank local
  `study/results/P0*.csv` files existed and were excluded.
- **Image contents:**
  - runs as `User=node`, uid 1000;
  - `/app` is root-owned and not writable;
  - no `.env*`, CSV, `study`, `.git` or test files;
  - only the 20 fixtures, the built client and server, and production
    `node_modules` (9 MB).
- **Recorded mode:**
  - health checks report `healthy`;
  - 20 examples are listed;
  - deep links `/tx/...` and `/about` serve the shell;
  - assets are served immutable, and CSP and security headers are present;
  - an unrecorded hash returns 404;
  - all 10 study task links show a "Recorded example" badge, and their fee
    totals equal the answer key (10/10);
  - JSON and SVG exports work (no credentials); 0 console errors.
- **Shutdown and configuration:**
  - `docker stop` exits 0 in 0.25 s, logging `shutdown → stopped`;
  - `TXSTORY_TRUST_PROXY=0.0.0.0/0` or `everyone`, and a non-numeric rate
    limit, exit with code 1 and a clear message.
- **Live mode** (RPC mock on the host):
  - with `trust=none`, rotating XFF gives 200 200 200 429 429;
  - with `trust=private`, the same client gives 200 200 200 429, a different
    client 200 200, an IPv6 /64 200 200 200 429, and malformed XFF falls back
    to the proxy's identity;
  - no client IPs or hashes appear in the logs.
- **`deploy/compose.yaml`** (app service only, without a tunnel token):
  - healthy, no published ports, read-only root filesystem, `cap_drop ALL`,
    512 MB limit;
  - a probe at the trusted connector address (`.2`) gets per-visitor buckets,
    with spoofed left entries ignored;
  - a probe at an untrusted address (`.4`) is limited as one client;
  - `compose stop` exits 0 in 0.24 s.

### Still unverified

- **The real tunnel and Access:** the Cloudflare Tunnel and Access layer
  themselves, including that `cloudflared` forwards `X-Forwarded-For`
  unchanged. DEPLOYMENT.md has the post-deploy check.
- **Real-provider behaviour under pilot traffic.**
- **Graceful stop with a request in flight, inside Docker:** measured at the
  process level (s8), not with `docker stop`.
- **Human usability:** not measured.

## Usability-phase fixes, 2026-11-26

Engineering changes prompted by the expert walkthrough in `study/WALKTHROUGH.md`,
where the full problem, evidence and reasoning for each are recorded. No human
participant data exists; see `study/README.md`.

| ID | Change | Check |
|---|---|---|
| W0 | The explorer's state-changes and internal-transactions requests use `TXSTORY_SLOW_EXPLORER_TIMEOUT_MS` (default 45 s). Measured response time was 20.3 s, which exceeded the 15 s default. | 2 unit tests. Re-recorded fixtures cross-check 16/4/4 rows, 0 mismatches. |
| W1 | The fee panel states "Total paid by the sender" before the burned and priority parts | e2e (plain and failed); the total equals the independent answer key on all 10 study transactions |
| W2 | The partial-data banner states consequences (e.g. "ETH balance changes may be incomplete") | Unit test (`gapConsequences`) and e2e on the 949-log fixture |
| W3 | The page title carries the lead interpretation's provenance badge and a one-sentence explanation | e2e (Heuristic on a swap, Decoded on the large transaction) |
| W4 | The SVG card no longer labels explorer-written headlines "Decoded from chain data" | Unit test |
| W5 | NFT token IDs in the movement list are no longer muted (contrast 4.44:1 failed AA) | New e2e axe scan of NFT, failed and partial-data stories |

Five new public fixtures (schema v2) support matched study tasks; see
`fixtures/recorded/README.md`. Existing v1 fixtures are unchanged.

Commands, run 2026-11-26 on the development machine (no Rust involved):

- `npm run typecheck`: clean.
- `npm run build`: OK.
- `npm test`: 93 passed. This includes all 27 regression tests (cache isolation,
  pending → mined, NFT identity).
- `npm run test:e2e`: 19 passed.
- `python3 study/verify_answer_key.py`: consistent with the explorer evidence.
- `python3 study/score.py --self-test`: passed.

## Fix round, 2026-11-26 (after independent review)

An independent review (Codex) reproduced three bugs. This section records how
they were fixed and verified. It is the implementer's own validation, not a
second independent review.

### Bugs, root causes and fixes

| Bug | Root cause | Fix |
|---|---|---|
| **A. Cross-transaction cache collision** | `requestKey` hashed `redactUrl(url)`, and `redactUrl` replaced every path segment of 24+ characters, including transaction hashes. Explorer requests for different transactions therefore shared a key, in the cache, in in-flight coalescing, and in fixture keys. | Request identity is now separate from display redaction: `privateRequestKey` (full URL, memory only), `fixtureRequestKey` (schema v2, public URL that keeps hashes), and a frozen `legacyFixtureKeyV1`, used only for v1 files and guarded per fixture. `redactUrl` keeps `0x`+40/64-hex identifiers and still redacts credentials. A fixture is rejected if its `chain`/`hash` don't match the file it is loaded for. |
| **B. Null/error RPC responses cached** | `CachingTransport` cached any HTTP-2xx response, including `result: null`, JSON-RPC error envelopes, malformed bodies and `latest`-tag calls. | `isCacheableResponse` decides by meaning: only mined, non-null, explicit-block JSON-RPC successes are cached. Finished stories are cached only when no source errored, and the UI offers a retry. |
| **C. NFT match on count only** | The cross-check compared the net count (`+1` vs `+1`) for ERC-721 and ignored the token ids. | Rows now carry a `scope` (`amount` / `token-ids` / `count` / `none`). ERC-721 rows compare net token-id sets (order-insensitive, de-duplicated, pass-through ids cancelled). Count-only data is labelled "token ids not compared". Conflicting provider entries are *not comparable*. ERC-1155 is still compared by exact amount per token id. |

### Regression tests (`tests/unit/regressions.test.ts`, 27 tests)

- **Against the previous commit:** run in a temporary worktree at `afb87dd`,
  **21 of these 27 tests failed**. The 6 that passed are
  guard tests for behaviour that was never broken: distinct pagination,
  pass-through NFTs, missing detail, mined-receipt reuse, credential redaction,
  credential-free records.
- **Earlier check:** the first 19 tests were also run against the code before any
  fix: **15 failed**, each for the reported reason (B received A's URL; the app
  returned `methodA` for B; a null receipt was served from cache; a count-only NFT
  "matched").
- **Expected values are independent literals:** URLs echoed by a fake upstream,
  literal token ids, literal JSON-RPC bodies.

Plus `tests/unit/client.test.ts`: the labels never overstate the comparison scope.
Plus `tests/e2e/journeys.spec.ts`: the ERC-721 identity label and evidence scope
text, and an A → B → A browser session.

### Commands and final results (run on 2026-11-26)

| Command | Result |
|---|---|
| `npx tsc -p tsconfig.json --noEmit --noUnusedLocals` and the server config | clean |
| `npm run build` | built (client 286 kB JS / 90 kB gzip) |
| `npm test` | **90 passed** (5 files) |
| `npm run test:e2e` | **16 passed** (production build, recorded mode, Chrome) |

### Deterministic simulated-provider cases (fake transports, no network)

- **A then B**, sequential and concurrent, through one `CachingTransport`: each
  gets its own response. A → B → A gives a legitimate cache hit for the second A
  (2 upstream calls).
- **One application process:** stories A and B have their own explorer method,
  labels and summary, and every explorer source URL of B names B.
- **Same endpoint, different path credentials:** distinct cache identities.
- **Receipts:** a null receipt, then a mined receipt on retry, becomes visible. A
  null transaction, a JSON-RPC error, malformed bodies and `latest`-tag calls are
  not cached. A mined receipt is reused (1 upstream call for 2 requests).
- **Partial stories:** a story built during an explorer outage (HTTP 503) is not
  cached; the retry obtains the enrichment.
- **NFTs (ERC-721):** different ids are a mismatch; the same ids in another order
  match with scope `token-ids`; a net-zero swap of different NFTs is compared by
  identity; pass-through ids net out; missing provider detail is not comparable;
  duplicate observations are not double counted.
- **ERC-1155:** amount scope, with matches and mismatches as before.

### Recorded-fixture cases

- All 15 original v1 fixtures still build through the production pipeline,
  including the 40+ exact explorer matches and the per-case expectations.
- The v1 compatibility path returns the fixture's own data, and refuses the same
  path for another transaction hash.
- A fixture file whose contents name a different hash is rejected.
- A new v2 recording replays per transaction.
- **ENS fixture (real data):** both ERC-721 rows now compare token ids
  (`scope: token-ids`, identical id sets). ERC-1155 rows use amount scope.

### Live-provider observations (one server process, never restarted)

Production build, `TXSTORY_MODE=live`, on 2026-11-26 around 11:32 UTC. The
transactions were selected at random from recent blocks via RPC and were not
fixtures. Raw report: `shared-report.json` in the session scratchpad (not
committed).

| Visit | First render | Full | Identity matches | Explorer sources all for this tx | Cross-check |
|---|---|---|---|---|---|
| Ethereum A `0xa755fa8d…` (1st) | 1.87 s | 15.26 s | yes | 6/6 | 5 match (amount) |
| Ethereum B `0xa23570dc…` | 1.82 s | 15.22 s | yes | 6/6 | 5 match (amount) |
| Ethereum A (2nd) | 0.04 s | 0.04 s | yes | 6/6 | same as the 1st visit; **same retrievedAt and SHA-256 as the 1st visit** (legitimate reuse) |
| OP A `0x8336cda7…` (1st) | 3.32 s | 4.62 s | yes | 6/6 | 7 match incl. **1 ERC-721 row "matches explorer (same token ids)"**, 1 explorer-only, 1 not comparable |
| OP B `0x04a07853…` | 1.81 s | 1.82 s | yes | 6/6 | 3 match; explorer summary "…Initiated Withdraw of 468.470093 USDC from ether.fi Cash", present **only** on B |
| OP A (2nd) | 0.03 s | 0.04 s | yes | 6/6 | identical to the 1st visit; A's summary is still empty (no leak from B) |

**Exports**, downloaded in the browser for Ethereum A and inspected:
- **JSON bundle:** `formatVersion` 2, story `schemaVersion` 2, the correct hash,
  `chain: ethereum`, `mode: live`, `stage: full`.
- **Provenance:** all explorer source URLs contain the hash; retrieval times
  11:32:12 to 11:32:15Z (the original fetch, not export time).
- **Amounts and scope:** every delta is an exact integer; every row states its
  scope (5 × amount); the scope notice is present.
- **Credentials:** none (no `apikey`, `Bearer` or `password`; 0 `REDACTED` because
  public endpoints carry no credentials).
- **SVG:** valid XML with the hash, "ETHEREUM · SUCCEEDED · BLOCK 26499011", "Live
  lookup", and no `<script>` or `href`.
- **Server log:** it contained only the startup line (no provider URLs).

**Partial enrichment and retry (Base):** the Base explorer still answered HTTP 403
(not bypassed). The story showed the "Partial data" banner, every cross-check cell
read "not checked", and "Retry missing explorer data" was offered. Pressing it made
a **new** explorer request (retrievedAt 11:33:19 → 11:33:22), confirming the
degraded story was not cached.

### Still unverified

- **Pending → mined transition with real providers.** Covered only
  deterministically, as required.
- **A live ERC-721 mismatch, or a count-only explorer response.** Not observed;
  covered by simulated cases.
- **Base and Arbitrum explorer enrichment.** Never succeeded from this machine
  (HTTP 403).
- **Reorg safety.** Not implemented, not claimed.

---

## Initial build record (superseded figures noted above)


This is the implementer's own validation. It is not an independent review.

Environment:
- macOS (arm64), Node v22.19.0, npm 11.12.1, Google Chrome via Playwright 1.65.0.
- Dependencies: React 19.3.1, Vite 8.3.8, Vitest 5.1.0, TypeScript 6.0.3,
  @noble/hashes 2.4.0.
- `npm audit`: 0 vulnerabilities after choosing versions published at least 14 days
  earlier. The first-pinned older versions had advisories and were replaced.

## Automated tests

| Suite | Command | Result |
|---|---|---|
| Unit + integration | `npm test` | **62 passed**, ~1.2 s, no network |
| Browser end-to-end | `npm run test:e2e` | **14 passed**, ~11 s, production build, recorded mode |
| Typecheck | `npm run typecheck` (and `--noUnusedLocals`) | clean |

**What the unit and integration tests cover** (`tests/unit/`):

- **Precision.** Exact formatting of values up to 2²⁵⁶−1, negative values,
  rejection of malformed numbers and unsafe JS numbers, and compact display rules.
- **Independent references.** Published EIP-55 checksum vectors, and the well-known
  ERC-20 `Transfer` topic hash, which matches the topic TxStory derives with keccak.
- **Decoding.** ERC-20 vs ERC-721 Transfer told apart by layout. Non-standard layouts
  are refused, not guessed. ERC-1155 TransferBatch arrays decode, and hostile
  offsets are rejected.
- **Untrusted text.** Bidi and zero-width characters are stripped and the change is
  reported; long strings are truncated.
- **Ledger.** Netting, and conservation (sum of deltas = mints − burns).
- **Cross-check.** Matches, mismatches, zero-address bookkeeping, net-zero rows, and
  an unavailable explorer.
- **Fixture integration** (all 15 recorded fixtures through the production
  pipeline):
  - exact integer strings everywhere;
  - supply conservation for every ERC-20 asset;
  - **zero mismatches against the explorer's independently computed state changes
    wherever its data is complete (at least 40 rows compared)**;
  - deterministic rebuilds;
  - the swap fee recomputed directly from the raw recorded receipt JSON, not
    through TxStory's parser;
  - case checks: revert, plain ETH, wrap and unwrap, NFT ids, contract creation,
    pending, OP deposit tx, the L1 data fee, the explorer 403 path, the
    explorer-timeout path, and the fast stage not contacting the explorer;
  - the explorer's own summary equals the expected text exactly.
- **Server.**
  - strict validation (400), read-only (405), security headers and CSP;
  - not-found after trying all RPC fallbacks (404);
  - per-client rate limit with `Retry-After` (429);
  - recorded examples labelled as recorded;
  - the SPA shell is served, and `..%2f` traversal returns the shell, not files;
  - immutable caching for hashed assets.
- **Transport and providers.**
  - URL credential redaction; the streaming size cap; timeouts;
  - RPC fallback on transport failures only, with JSON-RPC errors not retried;
  - a well-formed null beats later transport failures;
  - ABI string and bytes32 decoding, with hostile offsets rejected;
  - the Blockscout pagination cap reported as partial;
  - a 403 reported as unavailable, with the API key redacted.
- **Client libraries.**
  - input parsing: hashes, explorer links, look-alike hosts not trusted,
    address-vs-hash guidance, `javascript:` input rejected;
  - route parsing, with focus-parameter allow-listing;
  - graph layout on 446 movements: every movement drawn exactly once, edges
    aggregated, no overlapping nodes;
  - SVG escaping of hostile headlines;
  - recorded bundles labelled as recorded.

**What the browser tests cover** (`tests/e2e/journeys.spec.ts`):
- **Home:** examples load, and the recorded-mode notice shows.
- **Lookup:** address input is rejected with accessible error state
  (`role=alert`, `aria-invalid`); an Etherscan link overrides the selected network.
- **Swap story:**
  - 7 rows read "matches explorer";
  - the exact-amounts toggle shows `−13,022,183.624750241637229919 M87`;
  - "Show evidence" highlights the ledger rows.
- **Replay:** operated by keyboard (listbox ↑/↓/End); the deep link `?m=` survives a
  reload; the transport buttons work.
- **Evidence tabs:** arrow-key navigation; recorded sources are labelled.
- **Exports: downloaded file contents verified.**
  - The bundle has its format, hash and mode, the exact −13022183624750241637229919
    delta, and the RECORDED notice.
  - The SVG is valid XML, labelled "Recorded example", with no script or href.
- **Large transaction (446 movements):** renders in under 5 s, flags partial data,
  lists all 446 options, and shows the "Expected gap" notes.
- **Failure states:** failed, pending and unknown-network states, each with
  recovery actions.
- **axe-core:** no serious or critical violations on home and story. A separate run
  covered three pages in light and dark mode: 0 violations. Two real issues were
  found and fixed first: contrast 4.44:1 on the active step label, and a
  non-focusable scroll region.
- **Mobile and motion:** no horizontal overflow at 375 px on home, swap and the
  large transaction; reduced motion hides the animated token.
- **Console:** no errors across home, method, swap and the RPC-only Base story.

## Live integration (real providers, not fixtures)

Run against the production build in live mode on 2026-11-26, using transactions
picked at random from recent blocks via RPC (not fixtures). Timings are wall-clock
in the browser, cold (server restarted, transactions never seen before):

| Chain | Tx | First render | Cross-check done | Result |
|---|---|---|---|---|
| Ethereum | 0xe78d2019… | 2.35 s | 7.70 s | 5/5 balance rows match the explorer |
| OP Mainnet | 0x6f98ad57… | 3.85 s | 14.26 s | 3/3 match; L1 data fee itemised |
| Ethereum (unknown hash) | 0x1212… | n/a | n/a | "Transaction not found" after 3.3 s, all fallbacks tried |

Earlier live runs:
- Ethereum 0x0963af87…: 5/5 match.
- OP Mainnet 0x63558bd9…: 6/6 match.
- Base 0xc23733a4…: RPC-only, explorer refused with HTTP 403, shown as partial.

Measured latency breakdown (one Ethereum transaction): RPC 0.3 to 0.7 s per call. The
explorer endpoints took 0.6 to 0.9 s each, except `state-changes`, which took
**12.0 s**. That measurement is the reason for two-stage loading.

**Provider observations** (all from this machine, may differ elsewhere):
- **Blockscout on Base, Arbitrum and Polygon:** HTTP 403 Cloudflare challenge pages
  for non-browser clients. Not bypassed.
- **Ankr:** requires an API key.
- **LlamaRPC:** HTTP 525.
- **Cloudflare ETH:** returned null for a known receipt.
- **PublicNode (OP/Arbitrum):** transient HTTP 403 during block scanning; recovered
  minutes later. This motivated the ordered fallbacks.
- **Blockscout internal transactions:** the request timed out (15 s) for a 949-log
  transaction. Kept as a fixture to exercise partial data.

## Container

`docker build -t txstory .`, then `docker run -e TXSTORY_MODE=recorded`:
- image size 58.6 MB, running as user `node`;
- `/api/health`, a recorded example, and an SPA route all return 200.

Nothing was pushed, published or deployed.

## Not verified / remaining limitations

- **No independent review** has taken place.
- **No usability study.** Whether people understand transactions better with
  TxStory than with an explorer is unmeasured.
- **Real third-party fuzzers or real-device testing** (iOS/Android browsers, screen
  readers): not done. Accessibility was checked with axe and keyboard tests only.
- **Explorer endpoints refused from this machine.** Base and Arbitrum explorer
  enrichment was never observed working here. The code path is exercised by unit
  tests with synthetic responses and by Ethereum/OP live data, which use the same
  adapter.
- **Rate limiter behind a reverse proxy.** It keys on the socket address, so it
  needs trusted-proxy handling before deployment behind a proxy.
- **Fixture drift.** Fixtures reflect the providers on 2026-11-26. Provider response
  formats can change; re-run `npm run record-fixture` and the tests to detect drift.
- **Fee handling.** The OP Stack operator fee is detected but not itemised.
  Arbitrum's L1 component is folded into its gas price and not separated.

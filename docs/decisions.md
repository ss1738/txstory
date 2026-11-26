# Design decisions (concise record)

**D1. One engine, several front ends** (0.3.0).
- `src/core` stays pure and browser-safe. `src/engine` owns I/O and
  reproducibility. The server, CLI and library all call `analyzeTransaction`.
- Rejected: a separate CLI implementation, or a published package split. The
  repository is the unit of distribution; `src/engine/index.ts` is the
  supported surface.

**D2. Networks are data.**
- A validated chain file, or a recording's embedded network, adds a network.
  Built-ins cannot be redefined. Keys match `^[a-z][a-z0-9-]{1,31}$`.
- Stories carry a `network` descriptor, so consumers need no registry.

**D3. Deeper analysis: traces, reverts and ABIs.**
- Chosen because they are verifiable against real execution. The local anvil
  devnet plus `cast balance` supplies independent expected values, and the
  methods are standard (Geth's callTracer, Solidity ABI).
- Considered and deferred:
  - storage/state diffs (prestateTracer: heavier, and less often offered);
  - proxy implementation lookup (needs `eth_getStorageAt` at a block, plus
    explorer verification data);
  - signature databases (4byte and similar). These would be a network-fetched,
    unverified source; bare user-supplied signatures are supported instead, and
    labelled `signature`.

**D4. Trace semantics.**
- Rolled-back value is never a balance change.
- CALLCODE has no net transfer; DELEGATECALL and STATICCALL transfer nothing.
- When both a trace and the explorer's internal transactions exist, the trace is
  used and differences are reported as warnings.
- No ordering is invented between call frames and events.

**D5. ABI decoding never silently picks.**
- Strict checks reject impossible encodings: padding, ranges, offsets and bounds.
- Several fitting signatures are reported as `ambiguous`. Identical signatures
  from several sources are merged, and every source is listed.

**D6. Recordings are the reproducibility format.**
- Fixtures and bundles are the same thing (v3 adds endpoints, options and output
  digests).
- The full output story is embedded only on request (`--embed-story`) or by the
  `/api/recording` route.
- Reasons for not embedding by default: the story is re-derivable, and
  embedding it repeats public addresses under key-like JSON names that generic
  secret scanners flag. The scan stays strict; no allowlist was added.

**D7. Comparison explains, it does not grade.**
- Facts (balances, NFT ids, outcome, fees) are separated from evidence and
  presentation differences.
- Likely causes are given only as "coincides with …".

**D8. Removed `legacy/`** (the original Python prototype).
- It was a second implementation of transaction logic, and it is superseded.
- It remains in Git history (commit 8551993).

**D9. No accounts, telemetry or hosted backend.**
- Private deployments rely on infrastructure access control (see DEPLOYMENT.md).

**D10. The public release ships no captured third-party responses.**
- The services' published terms were checked (DATA_PROVENANCE.md). None of them
  establishes that verbatim responses may be republished in a public
  repository.
- Examples and tests therefore use:
  - local devnet execution (real EVM, our own node);
  - clearly labelled synthetic responses, generated deterministically from case
    definitions whose expected values are written in the definitions.
- Captured recordings remain usable privately through `npm run test:captured`.
- Rejected:
  - keeping the RPC-only part of captured responses (provider terms are still
    unresolved);
  - relabelling captured data as synthetic.


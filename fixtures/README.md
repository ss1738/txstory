# Fixtures

Recordings that TxStory replays offline (`txstory-fixture-v3`; see
docs/formats.md). The server serves both directories as examples by default
(`TXSTORY_FIXTURES_DIR=fixtures/synthetic,fixtures/devnet`).

| Directory | Origin | Regenerate |
|---|---|---|
| `synthetic/` | `synthetic`: responses written by `scripts/synthetic-fixtures.ts` from `tests/synthetic/cases.ts`. Not real transactions or provider data. Endpoints use the reserved `.invalid` domain. | `npx tsx scripts/synthetic-fixtures.ts` (deterministic; no network) |
| `devnet/` | `local-devnet`: real execution on a local anvil node, with expected values from `cast` in `expected.json`, the chain file `chains.json` and the compiled ABI `Demo.abi.json` | `npx tsx examples/devnet/scenario.ts` (needs Foundry; see examples/devnet/README.md) |

**Synthetic cases** (one recording each):

- plain transfer;
- reverted transfer;
- fee-on-transfer swap with an explorer summary;
- WETH unwrap with an explorer-reported internal transfer;
- WETH wrap the explorer has not indexed (404);
- ERC-721 and ERC-1155 movements where the explorer agrees on token ids;
- the same movements where the explorer reports a different id;
- contract creation;
- a pending transaction;
- an OP Stack deposit;
- an OP transfer with an L1 data fee;
- a Base transfer with the explorer refusing (403);
- an Arbitrum token transfer with metadata from `eth_call`;
- 80 token movements with an internal-transaction timeout and a paginated
  transfer list;
- an NFT sale emitting a Seaport-style event encoded by `cast`.

Recordings captured from public providers are not distributed. Why, and how to
use a private copy, is in DATA_PROVENANCE.md.

# Extending TxStory

Three extension points, each small and testable. Nothing is loaded from the
network or executed from data: modules are reviewed source files, while ABIs and
chain files are validated data.

## Adding a decoder module (recognise, decode, interpret)

A module lives in `src/core/decoders/<name>.ts` and exports a `DecoderModule`
(`src/core/decoders/types.ts`):

```ts
export const myProtocol: DecoderModule = {
  id: 'myprotocol',                       // prefixes interpretation ids
  name: 'My Protocol',
  description: 'What it recognises.',
  abi: [                                   // data: JSON ABI items or human-readable signatures
    'event Deposited(address indexed user, uint256 assets, uint256 shares)',
    'function deposit(uint256 assets, address receiver)',
    'error Paused()',
  ],
  interpret: ({ story, logs }) =>          // optional
    logs.filter((l) => l.match?.signature === 'Deposited(address,uint256,uint256)').map((l) => ({
      id: `deposit:${l.logIndex}`,
      confidence: 'decoded',
      headline: 'Deposit reported by the vault',
      detail: `Event fields: user ${String(param(l.match!, 'user', 0))}, assets ${String(param(l.match!, 'assets', 1))} (raw).`,
      evidence: [`log:${l.logIndex}`],    // REQUIRED: logs, movement ids or ledger:<address>:<asset>
      caveats: [`Emitted by ${l.contract}; any contract can emit this event.`],
    })),
};
```

Then add it to `BUILTIN_DECODERS` in `src/core/decoders/index.ts`.

**A runnable example.** `examples/decoder/split.ts` is a complete module for the
`Split` event of the devnet contract (`examples/devnet/src/Demo.sol`). It runs
offline against a devnet recording without being built in:

```bash
npx tsx examples/decoder/split.ts
npx vitest run tests/unit/decoder-example.test.ts   # checks the decoded fields against values read from the anvil node
```

Copy it as a starting point. `decodeLogs(story, libraryFor([...BUILTIN_DECODERS, myModule]))`
and `runInterpreters(story, logs, [myModule])` are the same calls the engine
makes for built-in modules.

What the framework guarantees:

1. **Recognition.** Your ABI joins the built-in library (source `builtin`,
   labelled with your module name). Topic 0 or the selector selects candidates.
   For events, the indexed layout must also fit; ERC-20 and ERC-721 `Transfer`
   share a topic and are told apart this way.
2. **Decoding.** `core/abi.ts` decodes strictly:
   - impossible encodings are rejected (bad padding, out-of-range integers,
     offsets past the data, absurd lengths);
   - values are JSON-safe, with integers as decimal strings;
   - selector collisions and other ambiguity come back as `ambiguous` with
     every fitting candidate. Your `interpret` only receives `match` when
     exactly one signature fits.
3. **Raw data stays.** The log's raw topics and data remain in `story.logs`, and
   decoded values are shortened for size only in `abiDecoding`.
4. **Unsupported or ambiguous cases.** If nothing fits, the log stays
   "unknown event" and is shown raw. If several fit, the UI and CLI show all
   candidates. Do not force a choice.
5. **Evidence.** The registry drops interpretations whose evidence does not
   reference an existing log, movement or ledger row. A module that throws is
   skipped with a warning; the story still builds.
6. **Balances are off-limits.** Modules cannot change movements or balances.
   Those come only from standard token semantics (`core/events.ts`) and traces.

**Write the interpretation honestly:**

- Report what the event *says* (with the emitter address), and put the actual
  value movements in the balance table.
- Use `heuristic` for anything inferred from patterns rather than decoded fields.

**Test against independent expected values.** Your own decoder isn't evidence;
test it against something outside TxStory. Independent sources:

- `cast` (Foundry): encode calldata and events with `cast calldata` or
  `cast abi-encode`, as in `scripts/gen-abi-vectors.mjs` and
  `tests/vectors/abi-cast.json`;
- a devnet transaction against a contract you deploy (`examples/devnet`), with
  expected values from the node (`cast call`, `cast balance`).

Recordings of real provider responses are useful locally
(`txstory record ethereum 0x<hash> -o my-case.json`), but this repository does
not accept captured third-party responses as committed fixtures, because their
redistribution terms are unresolved (DATA_PROVENANCE.md). For committed tests,
use one of:

- **A devnet scenario.** Extend `examples/devnet/` and take expected values from
  the node.
- **A synthetic case.** Add a definition to `tests/synthetic/cases.ts`, run
  `npx tsx scripts/synthetic-fixtures.ts`, and assert the values the definition
  states. Synthetic recordings are labelled `synthetic` everywhere. Use them for
  adapter and pipeline behaviour, not as evidence about real providers.

## ABIs at runtime (no code)

`--abi file.json` (CLI) or `options.userAbi` (library) adds ABIs labelled
`user`. Accepted forms:

- a JSON ABI array;
- `{"abi": [...]}` (Foundry or Hardhat artifacts);
- an array of human-readable signatures (`"event E(uint256 indexed x)"`).
  Signatures without parameter names are labelled `signature`.

Limits: 5,000 entries, nesting depth 8. Unsupported types (`fixed`/`ufixed`)
are rejected with the entry's position.

## Adding a network

Data only, no code: write a chain file and pass it with `--chains`,
`TXSTORY_CHAINS_FILE` or `loadChainFile()`. The format is in
[formats.md](formats.md#chain-file).

- **Fee model:** choose one of `ethereum-l1`, `op-stack` or `arbitrum`. A chain
  with different fee rules needs code in `core/build.ts`: add a model and tests
  with expected fees from receipts.
- **Wrapped native:** list contracts whose Deposit/Withdrawal events mint or
  burn without a Transfer.
- **Recordings embed the network definition,** so a replay works without the
  chain file.

Making a network built-in: add it to `BUILTIN` in `src/core/chains.ts` and its
public endpoints to `PUBLIC_DEFAULTS` in `src/engine/config.ts`. Record at least
a plain transfer, a token transfer and a failed transaction as fixtures.

## Adding a provider

- **RPC:** any JSON-RPC endpoint works through configuration
  (`TXSTORY_RPC_<NETWORK>`, `--rpc`). Endpoints are tried in order, and
  transport failures, 403, 429 and 5xx move to the next one. For traces,
  endpoints that do not offer `debug_traceTransaction` are skipped, and each
  skip is recorded.
- **A different kind of explorer:** implement an adapter like
  `engine/providers/blockscout.ts` that returns the `ExplorerInput` shape
  (`core/inputs.ts`) and records a `SourceRecord` per request. The core never
  sees provider-specific JSON.
- **Transport:** to route requests through your own infrastructure
  (authentication proxy, request pool, cache), implement `Transport.send`. The
  engine passes per-request timeouts, and you must not log full URLs (use
  `redactUrl`).

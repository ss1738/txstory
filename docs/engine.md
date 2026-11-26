# Engine (library) API

Import from `src/engine/index.ts`, the supported surface. Internal modules may
change without notice. During 0.x the surface may change between minor versions
(see CHANGELOG.md). Serialized formats are versioned separately
([formats.md](formats.md)).

This is not published to a package registry. Use it from a clone (TypeScript
via `tsx` or your bundler), or build it with `npm run build` and import from
`dist/node/engine/index.js`.

## Analyse

```ts
import { analyzeTransaction, engineConfigFromEnv, LiveTransport } from './src/engine/index.js';

const config = engineConfigFromEnv(process.env);            // or engineConfigFromEnv({}) for pure defaults
const transport = new LiveTransport({ timeoutMs: config.requestTimeoutMs, maxBytes: config.maxResponseBytes, userAgent: config.userAgent });
const r = await analyzeTransaction('ethereum', '0x…', transport, config, { stage: 'full' });
if (r.kind === 'ok') {
  r.story.ledger;          // exact signed deltas per address and asset
  r.story.completeness;    // what is complete, partial, unavailable
  r.story.trace;           // call tree, value moves (committed or rolled back)
} else {
  r.kind;                  // 'not-found' | 'pending' | 'rpc-unavailable' | 'unsupported'
}
```

`analyzeTransaction(network, hash, transport, config, options)`:

- **Network key:** any registered network.
- **`options.stage`:** `'fast'` or `'full'` (default `'full'`).
- **`options.userAbi`:** `{ library: AbiLibrary, labels }`. Your ABIs decode
  calldata, logs, trace frames and revert data, labelled `user`.
- **`options.trace`:** `'auto'` or `'off'` overrides `config.trace`.

The transport is yours to choose. Use `LiveTransport` (bounded fetch), wrap it
in `CachingTransport`, or implement `Transport` (one method,
`send(request) → response`) for your own infrastructure: a proxy, a pool, or
test doubles.

## Reproduce

```ts
import { recordAnalysis, writeRecording, readRecording, replayRecording, checkReplay } from './src/engine/index.js';

const { result, recording } = await recordAnalysis('ethereum', hash, transport, config, { embedStory: false });
await writeRecording('tx.json', recording);

const rec = await readRecording('tx.json');             // validated, size-bounded
const replayed = await replayRecording(rec, config);   // offline; never uses the network
checkReplay(rec, replayed);                            // { sameEvidence, sameOutput, … }
```

## Compare

```ts
import { compareStories } from './src/engine/index.js';
const c = compareStories(storyA, storyB);
c.factsAgree; c.differences;   // [{ area, subject, a, b, delta?, explanation? }]
```

## Decode with ABIs

```ts
import { AbiLibrary, decodeCalldata, decodeEventLog, decodeRevertData } from './src/engine/index.js';
const lib = new AbiLibrary();
lib.addJson(JSON.parse(abiJsonText), 'user', 'MyContract.json');   // JSON ABI, {abi:[…]}, or ["function f(uint256 x)", …]
decodeCalldata(tx.input, lib);        // { status: 'decoded'|'ambiguous'|'no-match'|…, candidates: [...] }
decodeRevertData(revertData, lib);    // also Error(string) and Panic(uint256) built in
```

## Networks

```ts
import { loadChainFile } from './src/engine/index.js';
loadChainFile('chains.json');     // registers networks; then engineConfigFromEnv() includes their endpoints
```

## Runnable example

`examples/library/explain.ts` replays a recording offline, decodes a custom error
with an inline signature, and compares two analyses. It runs in CI.

```bash
npx tsx examples/library/explain.ts                    # offline
npx tsx examples/library/explain.ts ethereum 0x<hash>  # live
```

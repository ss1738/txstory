/**
 * Using TxStory as a library (local integration example; nothing is published).
 *
 *   npx tsx examples/library/explain.ts                       # offline, from a recording in this repo
 *   npx tsx examples/library/explain.ts ethereum 0x<hash>     # live, using default public providers
 *
 * Everything is imported from the engine's public entry point.
 */
import {
  AbiLibrary, analyzeTransaction, compareStories, engineConfigFromEnv, LiveTransport, readRecording, replayRecording,
  type Story,
} from '../../src/engine/index.js';

/** The sender's net change per asset, with exact integer amounts. */
export function senderSummary(story: Story): Array<{ asset: string; symbol: string | null; delta: string }> {
  return story.ledger
    .filter((r) => r.address === story.tx.from)
    .map((r) => ({ asset: r.assetKey, symbol: story.assets[r.assetKey]?.symbol ?? null, delta: r.delta }));
}

export async function offlineDemo() {
  const config = engineConfigFromEnv({});
  // 1. Replay a recording (no network), with an extra user-supplied ABI.
  const rec = await readRecording('fixtures/devnet/anvil-0x27dbc58bd2861be2ea7264fd2d03aa97510ebc7ff3e00ab59a0bb114cbbe4aab.json');
  const abi = new AbiLibrary();
  abi.addJson(['error InsufficientBalance(uint256 available, uint256 required)'], 'user', 'inline signature');
  const r = await replayRecording(rec, config, { userAbi: { library: abi, labels: [{ label: 'inline signature', entries: 1 }] } });
  if (r.kind !== 'ok') throw new Error(r.message);
  // 2. Compare with a replay without the user ABI: only the revert decoding should differ.
  const plain = await replayRecording(rec, config);
  if (plain.kind !== 'ok') throw new Error(plain.message);
  const diff = compareStories(plain.story, r.story);
  return { outcome: r.story.outcome, revert: r.story.revert?.summary, sender: senderSummary(r.story), comparison: diff.summary };
}

async function liveDemo(network: string, hash: string) {
  const config = engineConfigFromEnv(process.env);
  const transport = new LiveTransport({ timeoutMs: config.requestTimeoutMs, maxBytes: config.maxResponseBytes, userAgent: config.userAgent });
  const r = await analyzeTransaction(network, hash, transport, config, { stage: 'full' });
  if (r.kind !== 'ok') return { error: r.kind, message: r.message };
  return { outcome: r.story.outcome, headline: r.story.interpretations[0]?.headline, sender: senderSummary(r.story), completeness: r.story.completeness };
}

if (process.argv[1]?.endsWith('explain.ts')) {
  const [network, hash] = process.argv.slice(2);
  const out = network && hash ? await liveDemo(network, hash) : await offlineDemo();
  console.log(JSON.stringify(out, null, 2));
}

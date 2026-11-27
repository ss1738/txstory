/**
 * A minimal decoder module, run against a real devnet execution.
 *
 *   npx tsx examples/decoder/split.ts
 *
 * The module recognises the `Split` event of examples/devnet/src/Demo.sol
 * (`Vault.split` sends equal ETH to two addresses). It is not built in: this
 * file shows the whole extension path on one recording, offline. To ship a
 * module, put it in src/core/decoders/ and add it to BUILTIN_DECODERS
 * (docs/extending.md). tests/unit/decoder-example.test.ts checks it against
 * values read from the anvil node (fixtures/devnet/expected.json).
 */
import { decodeLogs, libraryFor, runInterpreters, BUILTIN_DECODERS } from '../../src/core/decoders/index.js';
import { param, type DecoderModule } from '../../src/core/decoders/types.js';
import type { Story } from '../../src/core/types.js';
import { engineConfigFromEnv } from '../../src/engine/config.js';
import { readRecording } from '../../src/engine/fixture-files.js';
import { replayRecording } from '../../src/engine/recording.js';

export const SPLIT_RECORDING = 'fixtures/devnet/anvil-0xa4d670d57f77054e10b64484d96899664322ec83582abc1b351a6d85e4946cb1.json';

export const demoSplit: DecoderModule = {
  id: 'demo-split',
  name: 'Demo vault split',
  description: 'The Split event of the devnet Demo vault.',
  abi: ['event Split(address indexed a, address indexed b, uint256 each)'],
  interpret: ({ logs }) =>
    logs.filter((l) => l.match?.signature === 'Split(address,address,uint256)').map((l) => ({
      id: `split:${l.logIndex}`,
      confidence: 'decoded',
      headline: 'Vault reports an equal split',
      detail: `Event fields: a ${String(param(l.match!, 'a', 0))}, b ${String(param(l.match!, 'b', 1))}, each ${String(param(l.match!, 'each', 2))} wei (raw).`,
      evidence: [`log:${l.logIndex}`],
      caveats: [`Emitted by ${l.contract}. The event is a claim by that contract; the balance table shows what actually moved.`],
    })),
};

/** Replay the recording, then decode and interpret its logs with the extra module. */
export async function runSplitExample(): Promise<{ story: Story; result: ReturnType<typeof runInterpreters> }> {
  const r = await replayRecording(await readRecording(SPLIT_RECORDING), engineConfigFromEnv({}));
  if (r.kind !== 'ok') throw new Error(`${r.kind}: ${r.message}`);
  const logs = decodeLogs(r.story, libraryFor([...BUILTIN_DECODERS, demoSplit]));
  return { story: r.story, result: runInterpreters(r.story, logs, [demoSplit]) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { result } = await runSplitExample();
  for (const i of result.interpretations) console.log(`${i.headline}\n  ${i.detail}\n  evidence: ${i.evidence.join(', ')}\n  caveat: ${i.caveats.join(' ')}`);
  for (const w of result.warnings) console.log(`warning: ${w}`);
}

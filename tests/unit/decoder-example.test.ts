/** The contributor decoder example (examples/decoder/split.ts), checked against the anvil node's values. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runSplitExample } from '../../examples/decoder/split.js';

const expected = JSON.parse(readFileSync('fixtures/devnet/expected.json', 'utf8'));
const split = expected.transactions.find((t: { name: string }) => t.name === 'split');

describe('decoder example: Demo vault Split event', () => {
  it('decodes the event and its fields agree with the balances the node reported', async () => {
    const { story, result } = await runSplitExample();
    expect(story.hash).toBe(split.hash);
    expect(result.warnings).toEqual([]);
    expect(result.interpretations).toHaveLength(1);
    const i = result.interpretations[0]!;
    expect(i.id).toBe('demo-split:split:0');
    const each = split.nativeDeltas.recipientB;
    expect(split.nativeDeltas.recipientC).toBe(each);
    expect(i.detail).toContain(`a ${expected.addresses.recipientB}`);
    expect(i.detail).toContain(`b ${expected.addresses.recipientC}`);
    expect(i.detail).toContain(`each ${each} wei`);
    expect(i.evidence).toEqual(['log:0']);
  });
});

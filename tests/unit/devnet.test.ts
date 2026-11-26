/**
 * Real EVM execution (anvil) replayed offline from recordings in fixtures/devnet.
 * Expected native balance changes come from the node's own state via `cast
 * balance` at blocks N-1 and N (fixtures/devnet/expected.json), independent of
 * TxStory's trace and ledger logic. Regenerate with examples/devnet/scenario.ts.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { AbiLibrary } from '../../src/core/abi.js';
import type { Story } from '../../src/core/types.js';
import { engineConfigFromEnv } from '../../src/engine/config.js';
import { checkReplay, readRecording, replayRecording, type Recording } from '../../src/engine/recording.js';

const DIR = 'fixtures/devnet';
const expected = JSON.parse(readFileSync(`${DIR}/expected.json`, 'utf8')) as {
  addresses: Record<string, string>;
  contracts: Record<string, string>;
  transactions: Array<{ name: string; hash: string; status: number; fee: string; nativeDeltas: Record<string, string> }>;
};
const userAbi = () => {
  const library = new AbiLibrary();
  const entries = library.addJson(JSON.parse(readFileSync(`${DIR}/Demo.abi.json`, 'utf8')), 'user', 'Demo.abi.json');
  return { library, labels: [{ label: 'Demo.abi.json', entries }] };
};

const stories = new Map<string, Story>();
const recordings = new Map<string, Recording>();
beforeAll(async () => {
  const config = engineConfigFromEnv({});
  for (const f of readdirSync(DIR).filter((x) => x.startsWith('anvil-'))) {
    const rec = await readRecording(`${DIR}/${f}`);
    const r = await replayRecording(rec, config);
    if (r.kind !== 'ok') throw new Error(`${f}: ${r.kind}`);
    stories.set(rec.hash, r.story);
    recordings.set(rec.hash, rec);
  }
});
const byName = (name: string) => {
  const t = expected.transactions.find((x) => x.name === name)!;
  return { t, story: stories.get(t.hash)! };
};
const nativeDelta = (story: Story, address: string) =>
  story.ledger.find((r) => r.address === address.toLowerCase() && r.assetKey === 'native')?.delta ?? '0';

describe('devnet: native balance changes match the node state (cast balance)', () => {
  for (const name of ['split', 'payAndTry', 'customError', 'errorString', 'panic', 'tokenTransfer']) {
    it(name, () => {
      const { t, story } = byName(name);
      expect(story.outcome).toBe(t.status === 1 ? 'success' : 'reverted');
      expect(story.fees.total).toBe(t.fee);
      for (const [role, addr] of Object.entries(expected.addresses)) {
        expect(nativeDelta(story, addr), `${name} ${role}`).toBe(t.nativeDeltas[role]);
      }
      expect(story.completeness.trace).toBe('complete');
      expect(story.completeness.nativeInternal).toBe('complete');
      expect(story.network).toMatchObject({ key: 'anvil', chainId: 31337, builtin: false, explorerUi: null });
    });
  }
});

describe('devnet: trace semantics', () => {
  it('records nested transfers with their call path', () => {
    const { story } = byName('split');
    expect(story.trace.valueMoves.filter((m) => m.committed)).toHaveLength(2);
    expect(story.movements.filter((m) => m.kind === 'native-internal').every((m) => m.provenance === 'chain')).toBe(true);
  });
  it('does not count value sent into a call that was rolled back', () => {
    const { story } = byName('payAndTry');
    const rolledBack = story.trace.valueMoves.filter((m) => !m.committed);
    expect(rolledBack).toHaveLength(1);
    expect(rolledBack[0]!.to).toBe(expected.contracts.reverter!.toLowerCase());
    expect(nativeDelta(story, expected.contracts.reverter!)).toBe('0');
    expect(story.trace.frames.find((f) => f.to === expected.contracts.reverter!.toLowerCase())?.revert?.summary).toBe('Error("nope")');
    expect(story.warnings.join(' ')).toMatch(/rolled back/);
  });
  it('decodes built-in revert errors from the trace', () => {
    expect(byName('errorString').story.revert?.summary).toBe('Error("boom: not allowed")');
    expect(byName('panic').story.revert?.summary).toBe('Panic(17: arithmetic overflow or underflow)');
    expect(byName('errorString').story.interpretations[0]!.detail).toMatch(/boom: not allowed/);
  });
  it('reports a custom error as unknown without an ABI, and decodes it with the user ABI', async () => {
    const { t, story } = byName('customError');
    expect(story.revert?.decoded.status).toBe('no-match');
    expect(story.revert?.summary).toMatch(/unknown error selector 0xcf479181/);
    const r = await replayRecording(recordings.get(t.hash)!, engineConfigFromEnv({}), { userAbi: userAbi() });
    if (r.kind !== 'ok') throw new Error(r.kind);
    expect(r.story.revert?.summary).toBe('InsufficientBalance(available="1000000000000000000", required="5")');
    expect(r.story.revert?.decoded.candidates[0]!.sources).toEqual([{ source: 'user', label: 'Demo.abi.json' }]);
    expect(r.story.abiDecoding.libraries.map((l) => l.source)).toEqual(['builtin', 'user']);
  });
  it('decodes calldata with built-in and user ABIs, labelled by source', async () => {
    const { story } = byName('tokenTransfer');
    const call = story.abiDecoding.call!;
    expect(call.status).toBe('decoded');
    expect(call.candidates[0]!.signature).toBe('transfer(address,uint256)');
    expect(call.candidates[0]!.sources[0]!.source).toBe('builtin');
    const tr = story.movements.find((m) => m.kind === 'token-transfer')!;
    expect(tr.amount).toBe('1234500000000000000');
  });
});

describe('devnet: replay is deterministic and offline', () => {
  it('rebuilds identical evidence and output for every recording', async () => {
    for (const [hash, rec] of recordings) {
      const check = checkReplay(rec, { kind: 'ok', story: stories.get(hash)! });
      expect(check, hash).toMatchObject({ sameEvidence: true, sameOutput: true });
    }
  });
});

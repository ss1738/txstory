/**
 * Builds every CAPTURED recording through the production pipeline (recorded
 * transport). These tests exercise real provider responses, not mocks; they
 * still do not prove live providers behave the same today.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { type StoryResult } from '../../src/engine/analyze.js';
import { replayRecording, type Recording } from '../../src/engine/recording.js';
import { loadConfig } from '../../src/server/config.js';
import { RecordedTransport, type FixtureFile } from '../../src/engine/transport.js';
import type { Story } from '../../src/core/types.js';
import type { ChainKey } from '../../src/core/chains.js';
import { capturedDir } from './dir.js';

const DIR = capturedDir();
const config = loadConfig({ mode: 'recorded', fixturesDir: DIR });
const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));
const results = new Map<string, StoryResult>();

async function build(chain: ChainKey, hash: string, stage: 'fast' | 'full' = 'full') {
  const rt = new RecordedTransport(DIR);
  const fx = await rt.load(chain, hash);
  if (!fx) throw new Error(`fixture missing ${chain} ${hash}`);
  return replayRecording(fx as Recording, config, { stage });
}
const story = (hash: string): Story => {
  const r = [...results.entries()].find(([k]) => k.endsWith(hash))?.[1];
  if (!r || r.kind !== 'ok') throw new Error(`no story for ${hash}: ${r?.kind}`);
  return r.story;
};
const rawExchange = (file: string, method: string) => {
  const fx = JSON.parse(readFileSync(join(DIR, file), 'utf8')) as FixtureFile;
  const ex = Object.values(fx.exchanges).find((e) => e.method === method && e.httpStatus === 200);
  return ex ? JSON.parse(ex.text) : null;
};

beforeAll(async () => {
  for (const f of files) {
    const [chain, hash] = f.replace('.json', '').split('-') as [ChainKey, string];
    results.set(`${chain}-${hash}`, await build(chain, hash));
  }
});

describe('all recorded fixtures', () => {
  it('has the expected fixture set', () => {
    expect(files.length).toBeGreaterThanOrEqual(15);
  });

  it('keeps every amount an exact integer string', () => {
    for (const r of results.values()) {
      if (r.kind !== 'ok') continue;
      for (const m of r.story.movements) expect(m.amount).toMatch(/^\d+$/);
      for (const l of r.story.ledger) expect(l.delta).toMatch(/^-?\d+$/);
      expect(r.story.fees.total).toMatch(/^\d+$/);
    }
  });

  it('conserves fungible token supply (sum of deltas = mints − burns per asset)', () => {
    for (const r of results.values()) {
      if (r.kind !== 'ok') continue;
      const s = r.story;
      for (const [key, asset] of Object.entries(s.assets)) {
        if (asset.kind !== 'erc20') continue;
        const moves = s.movements.filter((m) => m.assetKey === key);
        const minted = moves.filter((m) => m.from === null).reduce((a, m) => a + BigInt(m.amount), 0n);
        const burned = moves.filter((m) => m.to === null).reduce((a, m) => a + BigInt(m.amount), 0n);
        const sum = s.ledger.filter((l) => l.assetKey === key).reduce((a, l) => a + BigInt(l.delta), 0n);
        expect(sum, `${s.hash} ${key}`).toBe(minted - burned);
      }
    }
  });

  it('agrees exactly with the explorer wherever its data is complete (independent pipeline)', () => {
    let compared = 0;
    for (const r of results.values()) {
      if (r.kind !== 'ok') continue;
      const s = r.story;
      if (!s.crossCheck.available || s.completeness.nativeInternal !== 'complete' || s.completeness.stateChanges !== 'complete') continue;
      expect(s.crossCheck.summary.mismatch, s.hash).toBe(0);
      expect(s.crossCheck.summary.onlyTxStory, s.hash).toBe(0);
      compared += s.crossCheck.summary.match;
    }
    expect(compared).toBeGreaterThanOrEqual(40);
  });

  it('is deterministic apart from generation time', async () => {
    const a = story('0xec893ce03b8b8ef2d5e0d5edb9db9f63ad0972e2a6845504bc31cca395869804');
    const b = await build('ethereum', a.hash);
    if (b.kind !== 'ok') throw new Error('rebuild failed');
    expect({ ...b.story, generatedAt: '' }).toEqual({ ...a, generatedAt: '' });
  });
});

describe('specific transactions', () => {
  it('swap with fee-on-transfer token: exact sender deltas and fee recomputed from raw receipt', () => {
    const s = story('0xec893ce03b8b8ef2d5e0d5edb9db9f63ad0972e2a6845504bc31cca395869804');
    const sender = s.tx.from;
    const d = (k: string) => s.ledger.find((r) => r.address === sender && r.assetKey === k)?.delta;
    expect(d('0x80122c6a83c8202ea365233363d3f4837d13e888')).toBe('-13022183624750241637229919');
    expect(d('0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2')).toBe('68300597997526149');
    const rc = rawExchange('ethereum-0xec893ce03b8b8ef2d5e0d5edb9db9f63ad0972e2a6845504bc31cca395869804.json', 'eth_getTransactionReceipt').result;
    expect(s.fees.total).toBe((BigInt(rc.gasUsed) * BigInt(rc.effectiveGasPrice)).toString());
    expect(d('native')).toBe((-BigInt(s.fees.total)).toString());
    expect(s.interpretations.map((i) => i.kind)).toEqual(['swap', 'explorer-summary', 'fee-on-transfer']);
    const ex = s.interpretations.find((i) => i.kind === 'explorer-summary')!;
    expect(ex.confidence).toBe('explorer');
    expect(ex.detail).toBe('Swap 13022183.624750241637229919 M87 for 0.068300597997526149 WETH on Uniswap V2');
    expect(s.interpretations[0]!.confidence).toBe('heuristic');
  });

  it('failed transaction: only the fee moves and the value is not transferred', () => {
    const s = story('0xdfd1aafcddded21d650c737b90940226b68e82902dfa807b8059e012f1fd0618');
    expect(s.outcome).toBe('reverted');
    expect(s.movements.every((m) => m.kind.startsWith('fee'))).toBe(true);
    expect(s.interpretations[0]!.kind).toBe('failed');
  });

  it('plain ETH transfer: one chain-observed value movement', () => {
    const s = story('0xf935435dedce77233eb8855ed84277c0ebf4fbbc278f03ad34167f11446a9730');
    expect(s.movements.filter((m) => !m.kind.startsWith('fee')).map((m) => [m.kind, m.provenance])).toEqual([['native-call-value', 'chain']]);
    expect(s.interpretations[0]!.kind).toBe('native-transfer');
  });

  it('WETH unwrap: Withdrawal becomes a burn and the explorer-reported ETH comes back internally', () => {
    const s = story('0x3ffde450d1f5dc25e38f2968958176b11d588bf4a13063d15dde85eb74454956');
    expect(s.movements.some((m) => m.kind === 'unwrap-burn')).toBe(true);
    expect(s.movements.some((m) => m.kind === 'native-internal' && m.provenance === 'explorer')).toBe(true);
    expect(s.interpretations[0]!.kind).toBe('unwrap');
    expect(s.crossCheck.summary.mismatch).toBe(0);
  });

  it('WETH wrap while the explorer had not indexed it: RPC-only story says so', () => {
    const s = story('0x55696a279cd550531b7f8ef4d8d234c2b5504fd5bc8dcc19f768d878ca484a83');
    expect(s.crossCheck.available).toBe(false);
    expect(s.crossCheck.reason).toMatch(/not indexed/);
    expect(s.movements.some((m) => m.kind === 'wrap-mint')).toBe(true);
    expect(s.interpretations[0]!.kind).toBe('wrap');
  });

  it('ERC-1155 movements carry token ids; ERC-721 ids tracked in the ledger', () => {
    const s = story('0x7dd83d861260f2807c22392c021b571f3798e3b2699afcceb0378af64e578dc8');
    expect(s.movements.some((m) => s.assets[m.assetKey]?.kind === 'erc1155' && m.tokenId)).toBe(true);
    expect(s.ledger.some((r) => r.tokenIdsIn?.length || r.tokenIdsOut?.length)).toBe(true);
  });

  it('contract creation is recognised', () => {
    const s = story('0x891c0a83d670d1d7c8bc9c02121e5209fedb51754d0caa324f1b7eeae53de7a4');
    expect(s.tx.createdContract).toMatch(/^0x[0-9a-f]{40}$/);
    expect(s.interpretations[0]!.kind).toBe('contract-creation');
  });

  it('pending transaction is reported as pending, not as an outage', () => {
    const r = results.get('ethereum-0x77c2e8c874262589ec80551175d247f6d3eab3d2120e880c0ac0abbcd2f6d6ad');
    expect(r?.kind).toBe('pending');
  });

  it('OP Stack deposit transaction has no fee and is labelled as a deposit', () => {
    const s = story('0x770bb167aadddf7a3315cb8c6b72256cf3dc274c222864370990bd0a11dc9be6');
    expect(s.fees.components).toEqual([]);
    expect(s.interpretations[0]!.headline).toMatch(/deposit transaction/);
  });

  it('OP Mainnet user transaction itemises the L1 data fee', () => {
    const s = story('0x12b0f3f82460bbe9425e6814a29606195d622cb4141a444bfd730d39d8c62838');
    expect(s.fees.components.map((c) => c.kind)).toEqual(['fee-execution', 'fee-l1-data']);
    expect(s.crossCheck.summary.mismatch).toBe(0);
  });

  it('explorer refusal (HTTP 403) degrades to an RPC-only story with the reason recorded', () => {
    const s = story('0x9031bb4c25be0b3a11fb7c1edea732c6ae41d5fcc6e2e4186069f1aa2e3abc9f');
    expect(s.crossCheck.available).toBe(false);
    expect(s.sources.some((x) => x.kind === 'explorer' && x.httpStatus === 403)).toBe(true);
    expect(s.completeness.nativeInternal).toBe('unavailable');
    expect(s.warnings.join(' ')).toMatch(/Internal native-value movements are unavailable/);
  });

  it('explorer timeout on internal transactions: native rows annotated as an expected gap', () => {
    const s = story('0x783cf8c07a02931b7271444c71524f8b29174bafbd74cec382ae802a87ff8a69');
    expect(s.completeness.nativeInternal).toBe('unavailable');
    expect(s.warnings.join(' ')).toMatch(/timed out/);
    const nativeDisagreements = s.crossCheck.rows.filter((r) => r.assetKey === 'native' && r.status !== 'match' && r.status !== 'not-comparable');
    expect(nativeDisagreements.length).toBeGreaterThan(0);
    for (const r of nativeDisagreements) expect(r.note).toMatch(/Expected gap/);
    expect(s.crossCheck.rows.filter((r) => r.assetKey !== 'native' && r.status === 'mismatch')).toEqual([]);
  });

  it('fast stage omits the cross-check and says it is loading', async () => {
    const r = await build('ethereum', '0xec893ce03b8b8ef2d5e0d5edb9db9f63ad0972e2a6845504bc31cca395869804', 'fast');
    if (r.kind !== 'ok') throw new Error(r.kind);
    expect(r.story.stage).toBe('fast');
    expect(r.story.crossCheck.available).toBe(false);
    expect(r.story.crossCheck.reason).toMatch(/loading/);
    expect(r.story.sources.every((x) => x.kind === 'rpc')).toBe(true); // explorer not contacted
    expect(r.story.warnings.join(' ')).not.toMatch(/unavailable/);
  });
});

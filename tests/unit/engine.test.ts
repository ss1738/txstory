/**
 * Engine boundary: decoder modules (extension path), comparison, chain files,
 * recording validation, and the library example. Recorded data only.
 */
import { describe, expect, it } from 'vitest';
import { parseChainFile } from '../../src/core/chains.js';
import { compareStories } from '../../src/core/compare.js';
import { runInterpreters, type DecoderModule } from '../../src/core/decoders/index.js';
import type { Story } from '../../src/core/types.js';
import { engineConfigFromEnv } from '../../src/engine/config.js';
import { readRecording, replayRecording, validateRecording } from '../../src/engine/recording.js';
import { BlockscoutClient } from '../../src/engine/providers/blockscout.js';
import type { Transport } from '../../src/engine/transport.js';
import { offlineDemo } from '../../examples/library/explain.js';
import { LARGE, ethFee, txHash } from '../synthetic/cases.js';

const config = engineConfigFromEnv({});
const replay = async (file: string) => {
  const r = await replayRecording(await readRecording(file), config);
  if (r.kind !== 'ok') throw new Error(r.kind);
  return r.story;
};
const SYN = (id: string) => `fixtures/synthetic/ethereum-${txHash(id)}.json`;

describe('decoder modules: Seaport (worked example)', () => {
  it('labels the decoded OrderFulfilled log with its built-in module and warns about emitters', async () => {
    const story = await replay(SYN('seaport-sale'));
    const i = story.interpretations.find((x) => x.id === 'seaport:fulfilled:2')!;
    expect(i.caveats.join(' ')).toMatch(/Any contract can emit/);
    const decoded = story.abiDecoding.logs.find((l) => l.logIndex === 2)!;
    expect(decoded.candidates.find((c) => c.ok)!.sources[0]).toEqual({ source: 'builtin', label: 'Seaport (built-in)' });
  });

  it('drops interpretations without valid evidence and survives a crashing module', async () => {
    const story = await replay(SYN('seaport-sale'));
    const bad: DecoderModule = { id: 'bad', name: 'Bad', description: '', abi: [], interpret: () => [{ id: 'x', confidence: 'decoded', headline: 'claim', detail: '', evidence: ['log:99999'], caveats: [] }] };
    const crash: DecoderModule = { id: 'crash', name: 'Crash', description: '', abi: [], interpret: () => { throw new Error('boom'); } };
    const r = runInterpreters(story, [], [bad, crash]);
    expect(r.interpretations).toEqual([]);
    expect(r.warnings).toEqual([
      'Decoder "bad" produced an interpretation without valid evidence; it was dropped.',
      'Decoder "crash" failed and was skipped: boom',
    ]);
  });
});

describe('compareStories explains disagreements', () => {
  it('flags NFT id differences even when counts agree', async () => {
    const a = await replay(SYN('nft-transfers'));
    const b: Story = JSON.parse(JSON.stringify(a));
    const row = b.ledger.find((r) => r.tokenIdsIn?.length)!;
    row.tokenIdsIn = ['1'];
    const c = compareStories(a, b);
    expect(c.factsAgree).toBe(false);
    expect(c.differences.map((d) => d.area)).toEqual(['nft-ids']);
  });
  it('attributes native differences to completeness when that coincides', async () => {
    const a = await replay(SYN('large-internal-timeout'));
    const b: Story = JSON.parse(JSON.stringify(a));
    const explorerFigure = (-LARGE.value + LARGE.refund - ethFee(LARGE.gas).total).toString(); // what the case's explorer reports
    const row = b.ledger.find((r) => r.address === b.tx.from && r.assetKey === 'native')!;
    row.delta = explorerFigure;
    b.completeness.nativeInternal = 'complete';
    const c = compareStories(a, b);
    const bal = c.differences.find((d) => d.area === 'balances')!;
    expect(bal.delta).toBe(LARGE.refund.toString());
    expect(bal.explanation).toMatch(/Coincides with different native-value completeness \(internal transfers: unavailable vs complete/);
  });
});

describe('formats and validation', () => {
  it('reports a request missing from an older recording as not captured, never by contacting the network', async () => {
    const rec = await readRecording(SYN('swap-fee-on-transfer'));
    // Simulate a recording made before the explorer /summary endpoint existed.
    for (const [k, e] of Object.entries(rec.exchanges)) if (e.method.endsWith('/summary')) delete rec.exchanges[k];
    const r = await replayRecording(rec, config);
    if (r.kind !== 'ok') throw new Error(r.kind);
    expect(r.story.sources.every((x) => x.status !== 'error')).toBe(true);
    expect(r.story.sources.find((x) => x.method.endsWith('/summary'))).toMatchObject({ status: 'empty', note: 'not captured in this recording (endpoint added after the fixture was recorded)' });
    expect(r.story.interpretations.some((i) => i.kind === 'explorer-summary')).toBe(false);
  });
  it('validates chain files strictly', () => {
    expect(() => parseChainFile({ chains: [{ key: 'ethereum', chainId: 1, name: 'x', rpc: ['http://a'] }] })).toThrow(/built-in/);
    expect(() => parseChainFile({ chains: [{ key: 'dev', chainId: 1, name: 'x', rpc: ['file:///etc/passwd'] }] })).toThrow(/rpc/);
    expect(() => parseChainFile({ chains: [{ key: 'dev', chainId: 1, name: 'x', rpc: ['http://a'], script: 'x' }] })).toThrow(/unknown field/);
    expect(parseChainFile({ chains: [{ key: 'dev-net', chainId: 1337, name: 'Dev', rpc: ['http://127.0.0.1:8545'] }] })[0]!.info).toMatchObject({ key: 'dev-net', feeModel: 'ethereum-l1', builtin: false });
  });
  it('rejects malformed recordings and network redefinitions', () => {
    expect(() => validateRecording({ schema: 'other' })).toThrow(/unknown schema/);
    const base = { schema: 'txstory-fixture-v3', chain: 'ethereum', hash: '0x' + '1'.repeat(64), exchanges: {} };
    expect(() => validateRecording({ ...base, exchanges: { zz: {} } })).toThrow(/exchange key/);
    expect(() => validateRecording({ ...base, network: { key: 'ethereum', chainId: 1, name: 'Fake' } })).toThrow(/built-in/);
    expect(validateRecording(base).chain).toBe('ethereum');
  });
});

describe('determinism', () => {
  it('explorer sources get the same ids and order whatever order responses arrive in', async () => {
    const H = '0x' + 'ab'.repeat(32);
    const run = async (delayFor: (url: string) => number) => {
      const t: Transport = { send: async (req) => {
        await new Promise((r) => setTimeout(r, delayFor(req.url)));
        const isTx = new URL(req.url).pathname.endsWith(H);
        return { ok: true, httpStatus: 200, sha256: 'x', retrievedAt: 't', mode: 'live', text: JSON.stringify(isTx ? { hash: H, block_number: 1 } : { items: [], next_page_params: null }) };
      } };
      return (await new BlockscoutClient(t, 'https://explorer.example', null, 2).fetchAll(H)).sources.map((x) => x.id);
    };
    const forward = await run((u) => (u.includes('logs') ? 40 : u.includes('state') ? 5 : 20));
    const reverse = await run((u) => (u.includes('logs') ? 1 : u.includes('state') ? 40 : 10));
    expect(forward).toEqual(reverse);
    expect(forward).toEqual(['explorer:transaction', 'explorer:summary', 'explorer:internal-transactions', 'explorer:state-changes', 'explorer:token-transfers', 'explorer:logs']);
  });
});

describe('offline guarantee', () => {
  it('replays with all network access disabled', async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => { calls++; throw new Error('network disabled in this test'); }) as typeof fetch;
    try {
      const s = await replay('fixtures/devnet/anvil-0xdce671e4526d6d277669b28b2a9108c3f291951eb893a8d716101d94a2640359.json');
      expect(s.trace.status).toBe('complete');
      expect(calls).toBe(0);
    } finally {
      globalThis.fetch = original;
    }
  });
  it('accepts the /api/recording envelope as a recording file', () => {
    const rec = { schema: 'txstory-fixture-v3', chain: 'ethereum', hash: '0x' + '1'.repeat(64), exchanges: {} };
    expect(validateRecording({ ok: true, recording: rec }).schema).toBe('txstory-fixture-v3');
  });
});

describe('library example (examples/library/explain.ts)', () => {
  it('runs offline and decodes the custom error with an inline signature', async () => {
    const r = await offlineDemo();
    expect(r).toMatchObject({ outcome: 'reverted', revert: 'InsufficientBalance(available="1000000000000000000", required="5")', sender: [{ asset: 'native', symbol: 'ETH', delta: '-11128085461860' }] });
    expect(r.comparison).toMatch(/Facts agree.*revert 1/);
  });
});

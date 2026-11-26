import { describe, expect, it, beforeAll } from 'vitest';
import { parseLookupInput } from '../../src/core/lookupInput.js';
import { layoutGraph, NODE_H, NODE_W } from '../../src/client/lib/graph.js';
import { buildEvidenceBundle, buildStoryCardSvg, xmlEscape } from '../../src/client/lib/exporters.js';
import { parseRoute } from '../../src/client/router.js';
import { assembleStory } from '../../src/engine/analyze.js';
import { loadConfig } from '../../src/server/config.js';
import { RecordedTransport } from '../../src/engine/transport.js';
import type { Story } from '../../src/core/types.js';

const H = '0xfeb89d8c5b4ec361b7e3bd004eef2b156f0d4a9f39515d07377a357935891eff'; // synthetic, 80 token movements (fixtures/synthetic)

describe('lookup input parsing', () => {
  it('accepts hashes with or without 0x and normalises case', () => {
    expect(parseLookupInput(`  ${H.toUpperCase().replace('0X', '0x')} `)).toEqual({ ok: true, hash: H, chain: null, from: 'hash' });
    expect(parseLookupInput(H.slice(2))).toMatchObject({ ok: true, hash: H });
  });
  it('extracts hash and network from explorer links without fetching them', () => {
    expect(parseLookupInput(`https://etherscan.io/tx/${H}`)).toMatchObject({ ok: true, chain: 'ethereum', from: 'url' });
    expect(parseLookupInput(`basescan.org/tx/${H}#eventlog`)).toMatchObject({ ok: true, chain: 'base' });
    expect(parseLookupInput(`https://optimistic.etherscan.io/tx/${H}`)).toMatchObject({ chain: 'optimism' });
    expect(parseLookupInput(`https://unknown-explorer.example/tx/${H}`)).toMatchObject({ ok: true, chain: null });
  });
  it('does not trust look-alike hosts for network selection', () => {
    expect(parseLookupInput(`https://etherscan.io.evil.example/tx/${H}`)).toMatchObject({ ok: true, chain: null });
  });
  it('gives specific guidance for common mistakes', () => {
    expect(parseLookupInput('0x' + 'a'.repeat(40))).toMatchObject({ ok: false, message: expect.stringMatching(/address/) });
    expect(parseLookupInput('0x1234')).toMatchObject({ ok: false, message: expect.stringMatching(/64 hex/) });
    expect(parseLookupInput(`https://etherscan.io/address/0x${'a'.repeat(40)}`)).toMatchObject({ ok: false });
    expect(parseLookupInput('javascript:alert(1)')).toMatchObject({ ok: false });
    expect(parseLookupInput('')).toMatchObject({ ok: false });
  });
});

describe('routing', () => {
  it('parses story and example routes and rejects bad focus params', () => {
    expect(parseRoute({ pathname: `/tx/base/${H}`, search: '?m=log:12', hash: '' })).toEqual({ name: 'story', chain: 'base', hash: H, example: false, focus: 'log:12' });
    expect(parseRoute({ pathname: `/example/ethereum/${H}`, search: '?m=<script>', hash: '' })).toMatchObject({ example: true, focus: null });
    expect(parseRoute({ pathname: `/tx/Not_A_Key/${H}`, search: '', hash: '' })).toMatchObject({ name: 'not-found' });
    // Unknown but well-formed networks are left to the server (it answers invalid-chain).
    expect(parseRoute({ pathname: `/tx/solana/${H}`, search: '', hash: '' })).toMatchObject({ name: 'story', chain: 'solana' });
  });
});

describe('graph layout on an 80-movement transaction', () => {
  let story: Story;
  beforeAll(async () => {
    const config = loadConfig({ mode: 'recorded', fixturesDir: 'fixtures/synthetic' });
    const rt = new RecordedTransport(config.fixturesDir);
    const r = await (await import('../../src/engine/recording.js')).replayRecording((await rt.load('ethereum', H))! as never, config);
    if (r.kind !== 'ok') throw new Error(r.kind);
    story = r.story;
  });
  it('aggregates edges, covers every movement exactly once, and does not overlap nodes', () => {
    const g = layoutGraph(story);
    const flowIds = story.movements.filter((m) => !m.kind.startsWith('fee')).map((m) => m.id).sort();
    expect(g.edges.flatMap((e) => e.movementIds).sort()).toEqual(flowIds);
    expect(g.edges.length).toBeLessThan(flowIds.length);
    const boxes = g.nodes.map((n) => [n.x, n.y, n.x + NODE_W, n.y + NODE_H] as const);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const [a, b] = [boxes[i]!, boxes[j]!];
      expect(a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1]).toBe(true);
    }
    expect(g.nodes.every((n) => n.x + NODE_W <= g.width && n.y + NODE_H <= g.height)).toBe(true);
  });
});

describe('exports', () => {
  it('escapes hostile text in the SVG card', () => {
    expect(xmlEscape(`<script>"&'`)).toBe('&lt;script&gt;&quot;&amp;&apos;');
    const fake = {
      chain: 'ethereum', outcome: 'success', hash: H, block: { number: '1' }, mode: 'recorded', generatedAt: '2026-01-01T00:00:00Z',
      network: { key: 'ethereum', chainId: 1, name: 'Ethereum', nativeSymbol: 'ETH', explorerUi: 'https://eth.blockscout.com', builtin: true },
      tx: { from: '0x' + '1'.repeat(40) }, ledger: [], participants: {}, assets: {}, sources: [],
      interpretations: [{ headline: '</text><script>alert(1)</script>', confidence: 'heuristic' }],
    } as unknown as Story;
    const svg = buildStoryCardSvg(fake);
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).toContain('Recorded example');
    expect(svg).toContain('Heuristic interpretation (may be wrong)');
    // Study walkthrough W4: an explorer-written lead must not be labelled as decoded chain data.
    const explorerLead = { ...fake, interpretations: [{ headline: 'Swap', confidence: 'explorer' }] } as unknown as Story;
    const svg2 = buildStoryCardSvg(explorerLead);
    expect(svg2).toContain('Explorer summary (not verified by TxStory)');
    expect(svg2).not.toContain('Decoded from chain data');
  });
  it('labels recorded bundles as recorded', () => {
    const b = buildEvidenceBundle({ mode: 'recorded', sources: [], generatedAt: '2026-01-01T00:00:00Z' } as unknown as Story, '2026-01-01T00:00:00Z');
    expect(b.notice[0]).toMatch(/RECORDED/);
    expect(b.format).toBe('txstory-evidence-bundle');
  });
});

describe('cross-check labels never overstate what was compared', async () => {
  const { crossCheckLabel } = await import('../../src/client/lib/crosscheckLabel.js');
  const row = (status: string, scope: string) => ({ address: '0x', assetKey: 'k', txstory: '1', explorer: '1', status, scope }) as never;
  it('identity, count-only and amount matches are labelled differently', () => {
    expect(crossCheckLabel(row('match', 'token-ids')).label).toMatch(/same token ids/);
    expect(crossCheckLabel(row('match', 'count')).label).toMatch(/token ids not compared/);
    expect(crossCheckLabel(row('match', 'count')).tone).not.toBe('ok');
    expect(crossCheckLabel(row('match', 'amount')).label).toBe('✓ matches explorer');
    expect(crossCheckLabel(row('mismatch', 'token-ids')).label).toMatch(/different token ids/);
  });
});

describe('gapConsequences (study walkthrough W2)', () => {
  it('says what a missing source means for the reader', async () => {
    const { gapConsequences } = await import('../../src/client/lib/gaps.js');
    expect(gapConsequences(['nativeInternal'], 'ETH')).toEqual(['ETH moved inside execution is not included, so ETH balance changes may be incomplete.']);
    expect(gapConsequences(['stateChanges', 'explorerTokenTransfers'], 'ETH')).toEqual(['Balance changes could not be checked against the explorer.']);
    expect(gapConsequences(['tokenMetadata'], 'ETH')).toEqual([]);
  });
});

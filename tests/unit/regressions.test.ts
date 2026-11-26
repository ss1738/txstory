/**
 * Regression tests for three bugs reproduced in independent review:
 *  A. explorer requests for different transactions collided in the response cache
 *  B. null / error JSON-RPC responses were cached as successful results
 *  C. ERC-721 cross-check matched on net count while token ids differed
 * Expected values are written independently (literal ids, literal bodies), not
 * derived from the code under test.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crossCheck } from '../../src/core/crosscheck.js';
import { computeLedger } from '../../src/core/ledger.js';
import type { ExplorerInput, ExplorerStateChangeInput } from '../../src/core/inputs.js';
import type { Asset, Movement } from '../../src/core/types.js';
import { createApp } from '../../src/server/app.js';
import { loadConfig } from '../../src/server/config.js';
import { RpcClient } from '../../src/engine/providers/rpc.js';
import { CachingTransport, type Transport, type TransportRequest, type TransportResponse } from '../../src/engine/transport.js';

const TX_A = '0x' + 'a1'.repeat(32);
/** Public ERC-721 contract address of ENS (on-chain data, not a credential). */
const TX_B = '0x' + 'b2'.repeat(32);
const resp = (text: string, over: Partial<TransportResponse> = {}): TransportResponse => ({
  ok: true, httpStatus: 200, text, sha256: 'x', retrievedAt: '2026-01-01T00:00:00Z', mode: 'live', ...over,
});
const explorerReq = (hash: string, suffix = '', query = ''): TransportRequest => ({
  kind: 'explorer', provider: 'Blockscout', method: `GET /api/v2/transactions/${hash}${suffix}`,
  url: `https://eth.blockscout.com/api/v2/transactions/${hash}${suffix}${query}`,
});

/** Upstream that answers with the URL it was asked for, so a wrong cache hit is visible. */
function echoUpstream(delayMs = 0) {
  const calls: string[] = [];
  const t: Transport = {
    send: async (req) => {
      calls.push(req.url);
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      return resp(JSON.stringify({ servedFor: req.url }));
    },
  };
  return { t, calls };
}

describe('A. request identity: different transactions never share cached explorer data', () => {
  it('sequential A then B through one cache returns A then B', async () => {
    const { t, calls } = echoUpstream();
    const cache = new CachingTransport(t, 60_000);
    const a = await cache.send(explorerReq(TX_A, '/state-changes'));
    const b = await cache.send(explorerReq(TX_B, '/state-changes'));
    expect(JSON.parse(a.text).servedFor).toContain(TX_A);
    expect(JSON.parse(b.text).servedFor).toContain(TX_B);
    expect(calls).toHaveLength(2);
  });

  it('concurrent A and B cannot share one in-flight response', async () => {
    const { t, calls } = echoUpstream(20);
    const cache = new CachingTransport(t, 60_000);
    const [a, b] = await Promise.all([cache.send(explorerReq(TX_A)), cache.send(explorerReq(TX_B))]);
    expect(JSON.parse(a.text).servedFor).toContain(TX_A);
    expect(JSON.parse(b.text).servedFor).toContain(TX_B);
    expect(calls).toHaveLength(2);
  });

  it('A → B → A reuses A from cache and still serves B correctly', async () => {
    const { t, calls } = echoUpstream();
    const cache = new CachingTransport(t, 60_000);
    await cache.send(explorerReq(TX_A, '/logs'));
    await cache.send(explorerReq(TX_B, '/logs'));
    const again = await cache.send(explorerReq(TX_A, '/logs'));
    expect(JSON.parse(again.text).servedFor).toContain(TX_A);
    expect(calls).toHaveLength(2); // the third request was a legitimate cache hit
  });

  it('endpoint paths and pagination parameters stay distinct', async () => {
    const { t, calls } = echoUpstream();
    const cache = new CachingTransport(t, 60_000);
    await cache.send(explorerReq(TX_A, '/token-transfers'));
    await cache.send(explorerReq(TX_A, '/internal-transactions'));
    await cache.send(explorerReq(TX_A, '/token-transfers', '?block_number=1&index=50'));
    await cache.send(explorerReq(TX_A, '/token-transfers', '?block_number=1&index=100'));
    expect(calls).toHaveLength(4);
  });

  it('endpoints that differ only by credential are distinct cache identities', async () => {
    const { t, calls } = echoUpstream();
    const cache = new CachingTransport(t, 60_000);
    const rpc = (key: string): TransportRequest => ({ kind: 'rpc', provider: 'custom', method: 'eth_chainId', url: `https://rpc.example/v2/${key}`, body: { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] } });
    await cache.send(rpc('k'.repeat(32)));
    await cache.send(rpc('q'.repeat(32)));
    expect(calls).toHaveLength(2);
  });

  describe('two transactions through one application process', () => {
    let server: Server; let base: string;
    const upstreamCalls: string[] = [];
    beforeAll(async () => {
      const ADDR = (n: number) => '0x' + String(n).repeat(40).slice(0, 40);
      const fake: Transport = {
        send: async (req) => {
          upstreamCalls.push(req.url);
          if (req.kind === 'rpc') {
            const body = req.body as { method: string; params: unknown[] };
            const hash = body.params[0] as string;
            const which = hash === TX_A ? 1 : 2;
            if (body.method === 'eth_getTransactionByHash') return resp(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { hash, from: ADDR(which), to: ADDR(9), value: '0x0', nonce: '0x1', input: '0x', type: '0x2', blockNumber: '0x10', blockHash: '0x' + 'cc'.repeat(32) } }));
            if (body.method === 'eth_getTransactionReceipt') return resp(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { status: '0x1', gasUsed: '0x5208', effectiveGasPrice: '0x1', logs: [] } }));
            if (body.method === 'eth_getBlockByNumber') return resp(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { number: '0x10', hash: '0x' + 'cc'.repeat(32), timestamp: '0x1', baseFeePerGas: '0x1', miner: ADDR(8) } }));
            return resp(JSON.stringify({ jsonrpc: '2.0', id: 1, result: null }));
          }
          const forA = req.url.includes(TX_A);
          const path = new URL(req.url).pathname;
          if (path.endsWith('/summary')) return resp(JSON.stringify({ data: { summaries: [{ summary_template: '{x}', summary_template_variables: { x: { type: 'string', value: forA ? 'SUMMARY-FOR-A' : 'SUMMARY-FOR-B' } } }] } }));
          if (/transactions\/0x[0-9a-f]{64}$/.test(path)) return resp(JSON.stringify({ hash: forA ? TX_A : TX_B, method: forA ? 'methodA' : 'methodB', from: { hash: forA ? ADDR(1) : ADDR(2), name: forA ? 'Label A' : 'Label B' } }));
          return resp(JSON.stringify({ items: [], next_page_params: null }));
        },
      };
      server = createServer(createApp({ config: loadConfig({ mode: 'live', fixturesDir: 'fixtures/synthetic', rateLimitPerMinute: 100 }), liveTransport: fake }));
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(() => server.close());

    it('B gets its own explorer method, labels and summary after A', async () => {
      const a = (await (await fetch(`${base}/api/story/ethereum/${TX_A}`)).json()).story;
      const b = (await (await fetch(`${base}/api/story/ethereum/${TX_B}`)).json()).story;
      expect(a.hash).toBe(TX_A);
      expect(b.hash).toBe(TX_B);
      expect(a.tx.method?.name).toBe('methodA');
      expect(b.tx.method?.name).toBe('methodB');
      expect(b.explorerSummaries).toEqual(['SUMMARY-FOR-B']);
      expect(b.participants['0x2222222222222222222222222222222222222222']?.labels.map((l: { text: string }) => l.text)).toEqual(['Label B']);
      // Every explorer source record of B names B's hash, never A's.
      for (const s of b.sources.filter((x: { kind: string }) => x.kind === 'explorer')) {
        expect(s.url).toContain(TX_B);
        expect(s.url).not.toContain(TX_A);
      }
    });
  });
});

describe('B. RPC response caching follows JSON-RPC semantics', () => {
  const ENDPOINT = [{ url: 'https://rpc.example', provider: 'Example' }];
  const MINED = { status: '0x1', gasUsed: '0x5208', effectiveGasPrice: '0x1', logs: [], blockNumber: '0x10' };

  function scripted(answers: Array<string | (() => string)>) {
    let i = 0;
    const calls: unknown[] = [];
    const t: Transport = { send: async (req) => { calls.push(req.body); const a = answers[Math.min(i++, answers.length - 1)]!; return resp(typeof a === 'function' ? a() : a); } };
    return { t, calls };
  }
  const env = (result: unknown) => JSON.stringify({ jsonrpc: '2.0', id: 1, result });

  it('a null receipt followed by a mined receipt becomes visible on retry', async () => {
    const { t, calls } = scripted([env(null), env(MINED)]);
    const cache = new CachingTransport(t, 60_000);
    const first = await new RpcClient(cache, ENDPOINT).call('eth_getTransactionReceipt', [TX_A]);
    expect(first.value).toBeNull();
    const second = await new RpcClient(cache, ENDPOINT).call('eth_getTransactionReceipt', [TX_A]);
    expect(second.value).toEqual(MINED);
    expect(calls).toHaveLength(2);
  });

  it('a null transaction lookup is not cached either', async () => {
    const { t, calls } = scripted([env(null), env({ hash: TX_A })]);
    const cache = new CachingTransport(t, 60_000);
    await new RpcClient(cache, ENDPOINT).call('eth_getTransactionByHash', [TX_A]);
    await new RpcClient(cache, ENDPOINT).call('eth_getTransactionByHash', [TX_A]);
    expect(calls).toHaveLength(2);
  });

  it('JSON-RPC error envelopes are not cached', async () => {
    const { t, calls } = scripted([JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32005, message: 'limit exceeded' } }), env(MINED)]);
    const cache = new CachingTransport(t, 60_000);
    const first = await new RpcClient(cache, ENDPOINT).call('eth_getTransactionReceipt', [TX_A]);
    expect(first.error).toMatch(/limit exceeded/);
    const second = await new RpcClient(cache, ENDPOINT).call('eth_getTransactionReceipt', [TX_A]);
    expect(second.value).toEqual(MINED);
    expect(calls).toHaveLength(2);
  });

  it('malformed envelopes are not cached', async () => {
    const { t, calls } = scripted(['<html>gateway</html>', '{"jsonrpc":"2.0"}', env(MINED)]);
    const cache = new CachingTransport(t, 60_000);
    for (let i = 0; i < 3; i++) await new RpcClient(cache, ENDPOINT).call('eth_getTransactionReceipt', [TX_A]);
    expect(calls).toHaveLength(3);
  });

  it('a mined receipt IS cached and reused (fast/full stage reuse still works)', async () => {
    const { t, calls } = scripted([env(MINED), env(null)]);
    const cache = new CachingTransport(t, 60_000);
    await new RpcClient(cache, ENDPOINT).call('eth_getTransactionReceipt', [TX_A]);
    const again = await new RpcClient(cache, ENDPOINT).call('eth_getTransactionReceipt', [TX_A]);
    expect(again.value).toEqual(MINED);
    expect(calls).toHaveLength(1);
  });

  it('requests at a moving block tag ("latest") are never cached', async () => {
    const { t, calls } = scripted([env('0x01'), env('0x02')]);
    const cache = new CachingTransport(t, 60_000);
    await new RpcClient(cache, ENDPOINT).call('eth_call', [{ to: '0x' + '1'.repeat(40), data: '0x95d89b41' }, 'latest']);
    const second = await new RpcClient(cache, ENDPOINT).call('eth_call', [{ to: '0x' + '1'.repeat(40), data: '0x95d89b41' }, 'latest']);
    expect(second.value).toBe('0x02');
    expect(calls).toHaveLength(2);
  });
});

describe('C. ERC-721 cross-check compares token identities, not just counts', () => {
  const NFT = '0x5555555555555555555555555555555555555555';
  const ALICE = '0x1111111111111111111111111111111111111111';
  const BOB = '0x2222222222222222222222222222222222222222';
  const CAROL = '0x3333333333333333333333333333333333333333';
  const assets: Record<string, Asset> = {
    [NFT]: { key: NFT, kind: 'erc721', contract: NFT as Asset['contract'], tokenId: null, symbol: 'NFT', name: null, decimals: 0, metadataSource: 'explorer' },
  };
  const move = (id: string, from: string, to: string, tokenId: string): Movement => ({
    id, kind: 'token-transfer', sequence: 0, from: from as Movement['from'], to: to as Movement['to'], assetKey: NFT, amount: '1', tokenId, provenance: 'derived', sourceIds: [], label: '',
  });
  const nftChange = (address: string, tokenIdsIn: string[], tokenIdsOut: string[]): ExplorerStateChangeInput => ({
    address: address as ExplorerStateChangeInput['address'], isCoin: false, token: NFT as ExplorerStateChangeInput['token'], tokenType: 'ERC-721', tokenId: null, isMiner: false,
    change: { kind: 'nft', tokenIdsIn, tokenIdsOut },
  });
  const explorer = (items: ExplorerStateChangeInput[]): ExplorerInput => ({
    available: true, txSourceId: 'x', method: null, decodedInput: null, revertReason: null, addresses: {},
    internal: { status: 'complete', items: [], sourceIds: [] }, stateChanges: { status: 'complete', items, sourceIds: [] },
    tokenTransfers: { status: 'complete', items: [], sourceIds: [] }, logNames: {}, summaries: [], summarySourceId: null,
  });
  const row = (ledgerMoves: Movement[], items: ExplorerStateChangeInput[], address: string) =>
    crossCheck(computeLedger(ledgerMoves, assets), explorer(items), true).rows.find((r) => r.address === address && r.assetKey === NFT);

  it('equal counts with different token ids are a mismatch, never a match', () => {
    const r = row([move('m1', ALICE, BOB, '101')], [nftChange(BOB, ['999'], []), nftChange(ALICE, [], ['999'])], BOB);
    expect(r?.status).toBe('mismatch');
  });

  it('identical ids in a different order match, and the match is identity-scoped', () => {
    const r = row([move('m1', ALICE, BOB, '7'), move('m2', ALICE, BOB, '3')], [nftChange(BOB, ['3', '7'], []), nftChange(ALICE, [], ['7', '3'])], BOB);
    expect(r?.status).toBe('match');
    expect(r?.scope).toBe('token-ids');
  });

  it('a net-zero exchange of different NFTs is compared by identity', () => {
    // Bob gives #1 to Carol and receives #2 from Carol: net count 0 for both.
    const moves = [move('m1', BOB, CAROL, '1'), move('m2', CAROL, BOB, '2')];
    expect(row(moves, [nftChange(BOB, ['2'], ['1'])], BOB)?.status).toBe('match');
    expect(row(moves, [nftChange(BOB, ['5'], ['1'])], BOB)?.status).toBe('mismatch');
  });

  it('an id that passes through within the transaction nets out on both sides', () => {
    const moves = [move('m1', ALICE, BOB, '42'), move('m2', BOB, CAROL, '42')];
    const r = row(moves, [nftChange(BOB, ['42'], ['42'])], BOB);
    expect(r?.status).toBe('match');
    expect(r?.note).toMatch(/[Nn]et zero/);
  });

  it('missing provider id detail is not comparable rather than a match', () => {
    const items: ExplorerStateChangeInput[] = [{ ...nftChange(BOB, [], []), change: { kind: 'unknown' } }];
    expect(row([move('m1', ALICE, BOB, '101')], items, BOB)?.status).toBe('not-comparable');
  });

  it('duplicate explorer observations of the same id are not double counted', () => {
    const r = row([move('m1', ALICE, BOB, '101')], [nftChange(BOB, ['101', '101'], [])], BOB);
    expect(r?.status).toBe('match');
  });

  it('ERC-1155 quantities per token id are unaffected (amount scope)', () => {
    const KEY = `${NFT}#5`;
    const a: Record<string, Asset> = { [KEY]: { key: KEY, kind: 'erc1155', contract: NFT as Asset['contract'], tokenId: '5', symbol: null, name: null, decimals: 0, metadataSource: 'none' } };
    const ledger = computeLedger([{ ...move('m1', ALICE, BOB, '5'), assetKey: KEY, amount: '3' }], a);
    const sc: ExplorerStateChangeInput = { address: BOB as never, isCoin: false, token: NFT as never, tokenType: 'ERC-1155', tokenId: '5', isMiner: false, change: { kind: 'amount', delta: '3' } };
    const ok = crossCheck(ledger, explorer([sc]), true).rows.find((r) => r.address === BOB);
    expect(ok?.status).toBe('match');
    expect(ok?.scope).toBe('amount');
    const bad = crossCheck(ledger, explorer([{ ...sc, change: { kind: 'amount', delta: '2' } }]), true).rows.find((r) => r.address === BOB);
    expect(bad?.status).toBe('mismatch');
  });
});

describe('A (continued). identities, redaction and fixture compatibility', () => {
  it('private and fixture identities differ for different transactions; display keeps the hash', async () => {
    const { privateRequestKey, fixtureRequestKey } = await import('../../src/engine/transport.js');
    const { redactUrl } = await import('../../src/server/config.js');
    expect(privateRequestKey(explorerReq(TX_A))).not.toBe(privateRequestKey(explorerReq(TX_B)));
    expect(fixtureRequestKey(explorerReq(TX_A))).not.toBe(fixtureRequestKey(explorerReq(TX_B)));
    expect(redactUrl(explorerReq(TX_A).url)).toContain(TX_A); // public on-chain identifier kept
  });

  it('credentials stay redacted in public URLs even when hashes are kept', async () => {
    const { redactUrl } = await import('../../src/server/config.js');
    // Obviously fake, but credential-shaped: a 27-char path segment like an RPC API key.
    const key = ['fake', 'path', 'credential', 'value', '0001'].join('');
    expect(redactUrl(`https://eth-mainnet.example/v2/${key}`)).not.toContain(key);
    expect(redactUrl(`https://x.example/api/v2/transactions/${TX_A}?apikey=SECRETVALUE123`)).not.toContain('SECRETVALUE123');
    // A 0x-prefixed secret of non-identifier length is still redacted.
    const hexSecret = '0x' + 'ab'.repeat(16);
    expect(redactUrl(`https://rpc.example/${hexSecret}`)).not.toContain(hexSecret);
  });

  it('source records and exported bundles never contain credentials', async () => {
    const { BlockscoutClient } = await import('../../src/engine/providers/blockscout.js');
    const { buildEvidenceBundle } = await import('../../src/client/lib/exporters.js');
    const SECRET = ['fake', 'secret', 'for', 'redaction', 'test'].join('-'); // never a real credential
    const t: Transport = { send: async () => resp(JSON.stringify({ hash: TX_A, block_number: 1, from: { hash: '0x' + '11'.repeat(20) } })) };
    const r = await new BlockscoutClient(t, 'https://explorer.example', SECRET, 1).fetchAll(TX_A);
    const json = JSON.stringify(r.sources);
    expect(json).not.toContain(SECRET);
    expect(json).toContain(TX_A);
    const bundle = JSON.stringify(buildEvidenceBundle({ sources: r.sources, mode: 'live', generatedAt: '2026-01-01T00:00:00Z' } as never, '2026-01-01T00:00:00Z'));
    expect(bundle).not.toContain(SECRET);
  });

  it('v1 fixtures replay through the legacy key, and the v1 compatibility path cannot answer for another transaction', async () => {
    const { RecordedTransport, FIXTURE_SCHEMA_V1, legacyFixtureKeyV1 } = await import('../../src/engine/transport.js');
    type Fixture = import('../../src/engine/transport.js').FixtureFile;
    // A v1-format fixture built in memory (synthetic body), keyed exactly as v1 files were.
    const req = explorerReq(TX_A, '/state-changes');
    const fx: Fixture = {
      schema: FIXTURE_SCHEMA_V1, chain: 'ethereum', hash: TX_A, description: 'in-memory v1 fixture', recordedAt: '2026-01-01T00:00:00Z', recorder: 'test',
      exchanges: { [legacyFixtureKeyV1(req)]: { kind: 'explorer' as const, provider: 'Blockscout', method: req.method, url: req.url, httpStatus: 200, retrievedAt: '2026-01-01T00:00:00Z', text: '{"items":[],"next_page_params":null}' } },
    };
    const bound = new RecordedTransport('/nonexistent').forFixture(fx);
    const own = await bound.send(req);
    expect(own.ok).toBe(true);
    expect(own.text).toContain('"items"');
    // Same path shape, different transaction: the legacy key would collide; the guard refuses it.
    const other = await bound.send(explorerReq(TX_B, '/state-changes'));
    expect(other.ok).toBe(false);
    expect(other.failure).toMatch(/not present/);
  });

  it('a fixture filed under one hash but describing another is rejected', async () => {
    const { mkdtempSync, writeFileSync, readFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { RecordedTransport } = await import('../../src/engine/transport.js');
    const dir = mkdtempSync(join(tmpdir(), 'txstory-fx-'));
    const { readdirSync } = await import('node:fs');
    const file = readdirSync('fixtures/synthetic').find((f) => f.startsWith('ethereum-'))!;
    const real = JSON.parse(readFileSync(join('fixtures/synthetic', file), 'utf8'));
    writeFileSync(join(dir, `ethereum-${TX_B}.json`), JSON.stringify(real));
    expect(await new RecordedTransport(dir).load('ethereum', TX_B)).toBeNull();
  });

  it('new recordings use schema v2 and replay per transaction', async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { RecordingTransport, RecordedTransport, FIXTURE_SCHEMA_V2 } = await import('../../src/engine/transport.js');
    const dir = mkdtempSync(join(tmpdir(), 'txstory-rec-'));
    const { t } = echoUpstream();
    const rec = new RecordingTransport(t);
    await rec.send(explorerReq(TX_A, '/logs'));
    await rec.save(dir, { chain: 'ethereum', hash: TX_A, description: 'test', recordedAt: '2026-01-01T00:00:00Z', recorder: 'test' });
    const rt = new RecordedTransport(dir);
    const fx = (await rt.load('ethereum', TX_A))!;
    expect(fx.schema).toBe(FIXTURE_SCHEMA_V2);
    const replay = await rt.forFixture(fx).send(explorerReq(TX_A, '/logs'));
    expect(JSON.parse(replay.text).servedFor).toContain(TX_A);
    expect(replay.mode).toBe('recorded');
    expect((await rt.forFixture(fx).send(explorerReq(TX_B, '/logs'))).ok).toBe(false);
  });
});

describe('retrying a partially enriched story reaches the providers again', () => {
  it('a story built during an explorer outage is not cached; the retry gets the enrichment', async () => {
    let explorerUp = false;
    const ADDR = '0x' + '1'.repeat(40);
    const fake: Transport = {
      send: async (req) => {
        if (req.kind === 'explorer') {
          if (!explorerUp) return resp('', { ok: false, httpStatus: 503 });
          if (new URL(req.url).pathname.endsWith(TX_A)) return resp(JSON.stringify({ hash: TX_A, block_number: 16, method: 'recovered', from: { hash: ADDR } }));
          return resp(JSON.stringify({ items: [], next_page_params: null }));
        }
        const body = req.body as { method: string };
        const result = body.method === 'eth_getTransactionByHash' ? { hash: TX_A, from: ADDR, to: ADDR, value: '0x0', nonce: '0x0', input: '0x', type: '0x2', blockNumber: '0x10', blockHash: '0x' + 'cc'.repeat(32) }
          : body.method === 'eth_getTransactionReceipt' ? { status: '0x1', gasUsed: '0x5208', effectiveGasPrice: '0x1', logs: [] }
          : body.method === 'eth_getBlockByNumber' ? { number: '0x10', hash: '0x' + 'cc'.repeat(32), timestamp: '0x1', baseFeePerGas: '0x1', miner: ADDR }
          : '0x';
        return resp(JSON.stringify({ jsonrpc: '2.0', id: 1, result }));
      },
    };
    const server = createServer(createApp({ config: loadConfig({ mode: 'live', fixturesDir: 'fixtures/synthetic', rateLimitPerMinute: 100 }), liveTransport: fake }));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const first = (await (await fetch(`${base}/api/story/ethereum/${TX_A}`)).json()).story;
      expect(first.tx.method).toBeNull();
      expect(first.sources.some((s: { status: string }) => s.status === 'error')).toBe(true);
      explorerUp = true;
      const second = (await (await fetch(`${base}/api/story/ethereum/${TX_A}`)).json()).story;
      expect(second.tx.method?.name).toBe('recovered');
    } finally {
      server.close();
    }
  });
});

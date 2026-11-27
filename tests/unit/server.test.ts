import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app.js';
import { loadConfig, redactUrl, type ServerConfig } from '../../src/server/config.js';
import { BlockscoutClient } from '../../src/engine/providers/blockscout.js';
import { decodeAbiString, decodeUint8, RpcClient } from '../../src/engine/providers/rpc.js';
import { LiveTransport, type Transport, type TransportRequest, type TransportResponse } from '../../src/engine/transport.js';

const HASH = '0xefb65ab1ab71b94063c0ee8e8c7bdde47b808c19f4e653ed931e3006f4983112'; // synthetic swap (fixtures/synthetic)
const resp = (over: Partial<TransportResponse>): TransportResponse => ({ ok: true, httpStatus: 200, text: '', sha256: 'x', retrievedAt: '2026-01-01T00:00:00Z', mode: 'live', ...over });

async function serve(config: ServerConfig, liveTransport?: Transport): Promise<{ url: string; server: Server }> {
  const server = createServer(createApp({ config, ...(liveTransport ? { liveTransport } : {}) }));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
}

describe('HTTP API', () => {
  let base: string; let server: Server; let staticDir: string;
  const calls: TransportRequest[] = [];
  beforeAll(async () => {
    staticDir = mkdtempSync(join(tmpdir(), 'txstory-static-'));
    writeFileSync(join(staticDir, 'index.html'), '<!doctype html><title>shell</title>');
    mkdirSync(join(staticDir, 'assets'));
    writeFileSync(join(staticDir, 'assets', 'a.js'), 'console.log(1)');
    // Live transport that knows nothing: every RPC returns null (transaction not found).
    const fake: Transport = { send: async (req) => { calls.push(req); return resp({ text: JSON.stringify({ jsonrpc: '2.0', id: 1, result: null }) }); } };
    ({ url: base, server } = await serve(loadConfig({ mode: 'live', fixturesDir: 'fixtures/synthetic', staticDir, rateLimitPerMinute: 4 }), fake));
  });
  afterAll(() => server.close());

  it('validates chain and hash strictly', async () => {
    expect((await fetch(`${base}/api/story/ethereum/0x1234`)).status).toBe(400);
    expect((await fetch(`${base}/api/story/solana/${HASH}`)).status).toBe(400);
    expect((await fetch(`${base}/api/story/ethereum/${HASH.slice(0, 65)}zz`)).status).toBe(400);
  });

  it('is read-only', async () => {
    const r = await fetch(`${base}/api/health`, { method: 'POST' });
    expect(r.status).toBe(405);
  });

  it('sends security headers including a strict CSP', async () => {
    const r = await fetch(`${base}/api/health`);
    expect(r.headers.get('content-security-policy')).toMatch(/default-src 'self'/);
    expect(r.headers.get('content-security-policy')).toMatch(/frame-ancestors 'none'/);
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('maps a transaction unknown to every RPC endpoint to 404 not-found', async () => {
    const r = await fetch(`${base}/api/story/ethereum/0x${'ab'.repeat(32)}`);
    expect(r.status).toBe(404);
    const body = await r.json();
    expect(body.code).toBe('not-found');
    expect(calls.filter((c) => c.kind === 'rpc').length).toBeGreaterThanOrEqual(3); // tried fallbacks
  });

  it('rate limits live lookups per client with Retry-After', async () => {
    let last: Response | null = null;
    for (let i = 0; i < 6; i++) last = await fetch(`${base}/api/story/ethereum/0x${'cd'.repeat(32)}`);
    expect(last!.status).toBe(429);
    expect(Number(last!.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('serves examples regardless of live mode, labelled by data origin (synthetic here)', async () => {
    const r = await fetch(`${base}/api/example/ethereum/${HASH}`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.story.mode).toBe('synthetic');
    expect(body.story.sources.every((s: { mode: string }) => s.mode === 'synthetic')).toBe(true);
  });

  it('serves the SPA shell for app routes and refuses path traversal', async () => {
    const shell = await (await fetch(`${base}/tx/ethereum/${HASH}`)).text();
    expect(shell).toContain('<title>shell</title>');
    const trav = await (await fetch(`${base}/..%2f..%2fpackage.json`)).text();
    expect(trav).toContain('<title>shell</title>');
    expect(trav).not.toContain('"name"');
    const asset = await fetch(`${base}/assets/a.js`);
    expect(asset.headers.get('cache-control')).toMatch(/immutable/);
  });

  it('lists examples with provenance', async () => {
    const body = await (await fetch(`${base}/api/examples`)).json();
    expect(body.examples.length).toBe(15);
    expect(body.examples.every((e: { origin: string }) => e.origin === 'synthetic')).toBe(true);
    expect(body.examples[0]).toHaveProperty('recordedAt');
  });
});

describe('transport and config', () => {
  it('redacts credentials from URLs', () => {
    expect(redactUrl('https://eth-mainnet.g.alchemy.com/v2/abcdefghijklmnopqrstuvwxyz123456')).toBe('https://eth-mainnet.g.alchemy.com/v2/REDACTED');
    expect(redactUrl('https://x.io/api?apikey=secret123&a=1')).toBe('https://x.io/api?apikey=REDACTED&a=1');
    expect(redactUrl('https://user:pw@x.io/')).toBe('https://REDACTED@x.io/');
  });

  it('enforces the response size limit while streaming', async () => {
    const big = new Response(new ReadableStream({ start(c) { for (let i = 0; i < 10; i++) c.enqueue(new Uint8Array(1000)); c.close(); } }));
    const t = new LiveTransport({ timeoutMs: 1000, maxBytes: 5000, userAgent: 't', fetchImpl: async () => big });
    const r = await t.send({ kind: 'rpc', provider: 'p', method: 'm', url: 'https://x' });
    expect(r.ok).toBe(false);
    expect(r.failure).toMatch(/larger than/);
  });

  it('honours a per-request timeout over the default', async () => {
    let seenTimeout = false;
    const t = new LiveTransport({ timeoutMs: 1000, maxBytes: 5000, userAgent: 't', fetchImpl: (_u, init) => new Promise((_, rej) => init!.signal!.addEventListener('abort', () => { seenTimeout = true; rej(new Error('aborted')); })) });
    const r = await t.send({ kind: 'explorer', provider: 'p', method: 'm', url: 'https://x', timeoutMs: 1200 });
    expect(seenTimeout).toBe(true);
    expect(r.failure).toBe('timed out after 1200 ms');
  });

  it('times out slow providers', async () => {
    const t = new LiveTransport({ timeoutMs: 1000, maxBytes: 5000, userAgent: 't', fetchImpl: (_u, init) => new Promise((_, rej) => init!.signal!.addEventListener('abort', () => rej(new Error('aborted')))) });
    const r = await t.send({ kind: 'rpc', provider: 'p', method: 'm', url: 'https://x' });
    expect(r.failure).toMatch(/timed out/);
  });
});

describe('RPC client', () => {
  const ok = (result: unknown) => resp({ text: JSON.stringify({ jsonrpc: '2.0', id: 1, result }) });
  it('falls back on transport failures and records the attempts', async () => {
    const seen: string[] = [];
    const t: Transport = { send: async (req) => { seen.push(req.url); return req.url.includes('a.example') ? resp({ ok: false, httpStatus: 429 }) : ok('0x1'); } };
    const c = new RpcClient(t, [{ url: 'https://a.example', provider: 'A' }, { url: 'https://b.example', provider: 'B' }]);
    const r = await c.call('eth_blockNumber', []);
    expect(r.value).toBe('0x1');
    expect(r.endpoint.provider).toBe('B');
    expect(r.failedAttempts[0]).toMatch(/A: rate limited/);
  });
  it('does not fall back on deterministic JSON-RPC errors', async () => {
    const seen: string[] = [];
    const t: Transport = { send: async (req) => { seen.push(req.url); return resp({ text: JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'execution reverted' } }) }); } };
    const r = await new RpcClient(t, [{ url: 'https://a.example', provider: 'A' }, { url: 'https://b.example', provider: 'B' }]).call('eth_call', []);
    expect(seen).toHaveLength(1);
    expect(r.error).toMatch(/execution reverted/);
  });
  it('falls back when a node reports its own limits, such as pruned history (live case: PublicNode, block 46147)', async () => {
    const seen: string[] = [];
    const pruned = { code: -32000, message: 'pruned history unavailable: requested 46147, earliest available 15500000' };
    const t: Transport = { send: async (req) => { seen.push(req.url); return req.url.includes('a.example') ? resp({ text: JSON.stringify({ jsonrpc: '2.0', id: 1, error: pruned }) }) : ok({ number: '0xb443' }); } };
    const r = await new RpcClient(t, [{ url: 'https://a.example', provider: 'A' }, { url: 'https://b.example', provider: 'B' }]).call('eth_getBlockByNumber', ['0xb443', false]);
    expect(seen).toEqual(['https://a.example', 'https://b.example']);
    expect(r.error).toBeUndefined();
    expect(r.endpoint.provider).toBe('B');
    expect(r.failedAttempts).toEqual(['A: RPC error: pruned history unavailable: requested 46147, earliest available 15500000']);
  });
  it('falls back on "method not found" and reports the last node error when every node is limited', async () => {
    const t: Transport = { send: async () => resp({ text: JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'the method does not exist' } }) }) };
    const r = await new RpcClient(t, [{ url: 'https://a.example', provider: 'A' }, { url: 'https://b.example', provider: 'B' }]).call('eth_getBlockByNumber', ['0x1', false]);
    expect(r.endpoint.provider).toBe('B');
    expect(r.error).toMatch(/method does not exist/);
    expect(r.failedAttempts).toHaveLength(1);
  });
  it('keeps request errors on the first node, even when the revert reason mentions a node limit', async () => {
    for (const error of [
      { code: 3, message: 'execution reverted: pruned history unavailable' },
      { code: -32602, message: 'invalid argument 0: hex string has odd length' },
    ]) {
      const seen: string[] = [];
      const t: Transport = { send: async (req) => { seen.push(req.url); return resp({ text: JSON.stringify({ jsonrpc: '2.0', id: 1, error }) }); } };
      const r = await new RpcClient(t, [{ url: 'https://a.example', provider: 'A' }, { url: 'https://b.example', provider: 'B' }]).call('eth_call', []);
      expect(seen, error.message).toEqual(['https://a.example']);
      expect(r.error).toContain(error.message);
    }
  });
  it('a node limit followed by a server error stays an error and keeps both reasons', async () => {
    const t: Transport = { send: async (req) => (req.url.includes('a.example')
      ? resp({ text: JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'pruned history unavailable' } }) })
      : resp({ ok: false, httpStatus: 503 })) };
    const r = await new RpcClient(t, [{ url: 'https://a.example', provider: 'A' }, { url: 'https://b.example', provider: 'B' }]).call('eth_getBlockByNumber', ['0x1', false]);
    expect(r.value).toBeNull();
    expect(r.error).toBe('HTTP 503');
    expect(r.failedAttempts).toEqual(['A: RPC error: pruned history unavailable']);
  });
  it('prefers a well-formed null answer over later transport failures', async () => {
    const t: Transport = { send: async (req) => (req.url.includes('a.example') ? ok(null) : resp({ ok: false, httpStatus: 0, failure: 'network error' })) };
    const r = await new RpcClient(t, [{ url: 'https://a.example', provider: 'A' }, { url: 'https://b.example', provider: 'B' }]).call('eth_getTransactionReceipt', ['0x'], { retryOnNull: true });
    expect(r.error).toBeUndefined();
    expect(r.value).toBeNull();
  });
});

describe('ABI decoding of untrusted token metadata', () => {
  const word = (n: number | bigint) => BigInt(n).toString(16).padStart(64, '0');
  it('decodes ABI strings and bytes32 symbols', () => {
    const s = Buffer.from('USDC').toString('hex').padEnd(64, '0');
    expect(decodeAbiString('0x' + word(32) + word(4) + s)).toBe('USDC');
    expect(decodeAbiString('0x' + Buffer.from('MKR').toString('hex').padEnd(64, '0'))).toBe('MKR');
    expect(decodeUint8('0x' + word(18))).toBe(18);
    expect(decodeUint8('0x' + word(1000))).toBeNull();
  });
  it('rejects hostile offsets and lengths', () => {
    expect(decodeAbiString('0x' + word(2n ** 200n) + word(4))).toBeNull();
    expect(decodeAbiString('0x' + word(32) + word(10_000_000) + word(0))).toBeNull();
    expect(decodeAbiString('0x12')).toBeNull();
  });
});

describe('Blockscout pagination', () => {
  it('stops at the page cap and reports partial data', async () => {
    let n = 0;
    const t: Transport = {
      send: async (req) => {
        if (/transactions\/0x[0-9a-f]+$/.test(new URL(req.url).pathname)) return resp({ text: JSON.stringify({ hash: HASH, from: { hash: '0x' + '11'.repeat(20) } }) });
        n++;
        return resp({ text: JSON.stringify({ items: [{ index: n, type: 'call', from: { hash: '0x' + '11'.repeat(20) }, to: { hash: '0x' + '22'.repeat(20) }, value: '1', success: true }], next_page_params: { index: n } }) });
      },
    };
    const r = await new BlockscoutClient(t, 'https://explorer.example', null, 2).fetchAll(HASH);
    expect(r.explorer.internal.status).toBe('partial');
    expect(r.explorer.internal.items).toHaveLength(2);
    expect(r.explorer.internal.note).toMatch(/stopped after 2 pages/);
  });
  it('gives slow explorer endpoints the longer timeout', async () => {
    const seen: Record<string, number | undefined> = {};
    const t: Transport = { send: async (req) => {
      seen[new URL(req.url).pathname.split('/').pop()!] = req.timeoutMs;
      if (/transactions\/0x[0-9a-f]+$/.test(new URL(req.url).pathname)) return resp({ text: JSON.stringify({ hash: HASH, block_number: 1 }) });
      return resp({ text: JSON.stringify({ items: [], next_page_params: null }) });
    } };
    await new BlockscoutClient(t, 'https://explorer.example', null, 1, 45_000).fetchAll(HASH);
    expect(seen['state-changes']).toBe(45_000);
    expect(seen['internal-transactions']).toBe(45_000);
    expect(seen['logs']).toBeUndefined();
  });

  it('reports a 403 refusal as unavailable with the reason', async () => {
    const t: Transport = { send: async () => resp({ ok: false, httpStatus: 403, text: '<html>Just a moment...</html>' }) };
    const r = await new BlockscoutClient(t, 'https://explorer.example', 'KEY123', 2).fetchAll(HASH);
    expect(r.explorer.available).toBe(false);
    expect(r.explorer.reason).toMatch(/403/);
    expect(r.sources[0]!.url).not.toContain('KEY123');
  });
});

describe('not-found with endpoints that could not answer', () => {
  it('reports a null answer as inconclusive while another configured endpoint could not check', async () => {
    const { assembleStory } = await import('../../src/engine/analyze.js');
    const { engineConfigFromEnv } = await import('../../src/engine/config.js');
    const config = engineConfigFromEnv({ TXSTORY_RPC_ETHEREUM: 'https://a.example,https://b.example', TXSTORY_EXPLORER_ETHEREUM: 'off' });
    const t: Transport = { send: async (req) => resp({ text: JSON.stringify(req.url.includes('a.example')
      ? { jsonrpc: '2.0', id: 1, result: null }
      : { jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'pruned history unavailable' } }) }) };
    const r = await assembleStory('ethereum', '0x' + 'ab'.repeat(32), t, config);
    if (r.kind !== 'not-found') throw new Error(r.kind);
    expect(r.message).toMatch(/was found on Ethereum by custom RPC 1\./);
    expect(r.message).toMatch(/Not conclusive: 1 other configured endpoint\(s\) could not answer \(custom RPC 2: RPC error: pruned history unavailable\)/);
  });
  it('states a plain not-found when every endpoint answered', async () => {
    const { assembleStory } = await import('../../src/engine/analyze.js');
    const { engineConfigFromEnv } = await import('../../src/engine/config.js');
    const config = engineConfigFromEnv({ TXSTORY_RPC_ETHEREUM: 'https://a.example,https://b.example', TXSTORY_EXPLORER_ETHEREUM: 'off' });
    const t: Transport = { send: async () => resp({ text: JSON.stringify({ jsonrpc: '2.0', id: 1, result: null }) }) };
    const r = await assembleStory('ethereum', '0x' + 'ab'.repeat(32), t, config);
    if (r.kind !== 'not-found') throw new Error(r.kind);
    expect(r.message).not.toMatch(/Not conclusive/);
  });
});

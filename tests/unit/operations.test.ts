/**
 * Operational behaviour for a small private pilot: client identity behind
 * proxies, rate limits, concurrency slots, time budgets, bounded caches,
 * draining and request logs. All providers are local fakes; no network.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assembleStory } from '../../src/engine/analyze.js';
import { recordingEndpoints } from '../../src/engine/config.js';
import { SyntheticProvider } from '../../scripts/synthetic-fixtures.js';
import { allCases } from '../synthetic/cases.js';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, type App, type RequestLog } from '../../src/server/app.js';
import { MAX_HOPS, normalizeIp, parseTrustedProxies, rateKey, resolveClient } from '../../src/server/clientIp.js';
import { loadConfig, type ServerConfig } from '../../src/server/config.js';
import { BoundedCache, BUDGET_EXHAUSTED, RateLimiter, Slots, withDeadline } from '../../src/server/limits.js';
import { CachingTransport, RecordingTransport, type Transport, type TransportRequest, type TransportResponse } from '../../src/engine/transport.js';
import { saveFixtureV2 } from '../../src/engine/fixture-files.js';

const none = parseTrustedProxies('');
const loopback = parseTrustedProxies('loopback');
const priv = parseTrustedProxies('loopback,private');

describe('IP normalisation', () => {
  it('accepts the forms proxies actually send and canonicalises them', () => {
    expect(normalizeIp('203.0.113.7')).toEqual({ ip: '203.0.113.7', family: 4 });
    expect(normalizeIp(' 203.0.113.7:51234 ')).toEqual({ ip: '203.0.113.7', family: 4 });
    expect(normalizeIp('::ffff:203.0.113.7')).toEqual({ ip: '203.0.113.7', family: 4 });
    expect(normalizeIp('[::FFFF:cb00:7107]:443')).toEqual({ ip: '203.0.113.7', family: 4 });
    expect(normalizeIp('2001:DB8::1')!.ip).toBe('2001:0db8:0000:0000:0000:0000:0000:0001');
    expect(normalizeIp('[2001:db8::1]:8080')!.ip).toBe(normalizeIp('2001:db8:0:0::1')!.ip);
    expect(normalizeIp('fe80::1%eth0')!.family).toBe(6);
  });
  it('rejects malformed input', () => {
    for (const bad of ['', 'unknown', '_hidden', '1.2.3', '1.2.3.4.5', '999.1.1.1', '1.2.3.4:99999', '[::1]:70000', 'not an ip', '2001:db8::1::2', '[1.2.3.4', 'a'.repeat(200), undefined, null]) {
      expect(normalizeIp(bad as string), String(bad)).toBeNull();
    }
  });
  it('groups IPv6 clients by /64 and keeps IPv4 addresses distinct', () => {
    expect(rateKey(normalizeIp('2001:db8:1:2::1')!)).toBe(rateKey(normalizeIp('2001:db8:1:2:ffff::9')!));
    expect(rateKey(normalizeIp('2001:db8:1:2::1')!)).not.toBe(rateKey(normalizeIp('2001:db8:1:3::1')!));
    expect(rateKey(normalizeIp('198.51.100.1')!)).not.toBe(rateKey(normalizeIp('198.51.100.2')!));
  });
});

describe('trusted proxy configuration', () => {
  it('defaults to trusting nothing', () => {
    expect(parseTrustedProxies(undefined).enabled).toBe(false);
    expect(parseTrustedProxies('none').enabled).toBe(false);
  });
  it('accepts presets, addresses and CIDR ranges', () => {
    const t = parseTrustedProxies('loopback, 192.0.2.10, 198.51.100.0/24, 2001:db8:aa::/48');
    expect(t.has(normalizeIp('127.0.0.1')!)).toBe(true);
    expect(t.has(normalizeIp('::1')!)).toBe(true);
    expect(t.has(normalizeIp('::ffff:127.0.0.1')!)).toBe(true);
    expect(t.has(normalizeIp('192.0.2.10')!)).toBe(true);
    expect(t.has(normalizeIp('192.0.2.11')!)).toBe(false);
    expect(t.has(normalizeIp('198.51.100.200')!)).toBe(true);
    expect(t.has(normalizeIp('2001:db8:aa:1::5')!)).toBe(true);
    expect(t.has(normalizeIp('10.0.0.1')!)).toBe(false);
  });
  it('refuses trust-everything and malformed entries at startup', () => {
    for (const bad of ['0.0.0.0/0', '::/0', '*', 'everyone', '10.0.0.0/33', '10.0.0.0/8/1', '[::1]', '10.0.0.0/x', '1.2.3.4/ 8']) {
      expect(() => parseTrustedProxies(bad), bad).toThrow(/TXSTORY_TRUST_PROXY/);
    }
  });
});

describe('client identity resolution', () => {
  it('direct connections use the socket address and ignore forwarding headers by default', () => {
    expect(resolveClient('203.0.113.7', '1.1.1.1', none)).toEqual({ ip: '203.0.113.7', key: '203.0.113.7', via: 'socket' });
    expect(resolveClient('::ffff:203.0.113.7', undefined, none).key).toBe('203.0.113.7');
  });
  it('an untrusted peer cannot choose its identity even when proxies are configured', () => {
    expect(resolveClient('203.0.113.7', '127.0.0.1, 9.9.9.9', loopback).key).toBe('203.0.113.7');
  });
  it('behind a trusted proxy the right-most untrusted hop is the client; spoofed entries to its left are ignored', () => {
    // Client sent "X-Forwarded-For: 9.9.9.9"; the proxy appended the real peer 203.0.113.7.
    expect(resolveClient('127.0.0.1', '9.9.9.9, 203.0.113.7', loopback)).toEqual({ ip: '203.0.113.7', key: '203.0.113.7', via: 'forwarded' });
  });
  it('walks through a chain of trusted hops', () => {
    // client → CDN-ish edge (10.0.0.5) → internal LB (10.0.0.9) → app; both proxies trusted.
    expect(resolveClient('10.0.0.9', '9.9.9.9, 203.0.113.7, 10.0.0.5', priv).key).toBe('203.0.113.7');
    // The same header from an untrusted peer is ignored entirely.
    expect(resolveClient('203.0.113.50', '9.9.9.9, 203.0.113.7, 10.0.0.5', priv).key).toBe('203.0.113.50');
  });
  it('joins repeated headers in order', () => {
    expect(resolveClient('127.0.0.1', ['9.9.9.9', '203.0.113.7'], loopback).key).toBe('203.0.113.7');
  });
  it('stops at a malformed hop and uses the last address it can vouch for', () => {
    expect(resolveClient('127.0.0.1', 'unknown', loopback)).toEqual({ ip: '127.0.0.1', key: '127.0.0.1', via: 'socket' });
    expect(resolveClient('127.0.0.1', '203.0.113.7, garbage', loopback).key).toBe('127.0.0.1');
    expect(resolveClient('127.0.0.1', '', loopback).key).toBe('127.0.0.1');
    // Malformed entries LEFT of the real client are never reached.
    expect(resolveClient('127.0.0.1', 'garbage, 203.0.113.7', loopback).key).toBe('203.0.113.7');
  });
  it('examines a bounded number of hops', () => {
    const many = ['9.9.9.9', ...Array.from({ length: 20 }, () => '127.0.0.1')].join(',');
    const r = resolveClient('127.0.0.1', many, loopback);
    expect(r.key).toBe('127.0.0.1');
    expect(MAX_HOPS).toBeLessThan(20);
  });
  it('treats IPv6 clients per /64 through a proxy as well', () => {
    expect(resolveClient('::1', '2001:db8:1:2::abcd', loopback).key).toBe('2001:0db8:0001:0002::/64');
  });
  it('falls back to a single unknown identity for an unusable socket address', () => {
    expect(resolveClient(undefined, '1.2.3.4', loopback).key).toBe('unknown');
  });
});

describe('RateLimiter', () => {
  it('limits per client, reports a wait, and recovers after the window', () => {
    let t = 0;
    const rl = new RateLimiter(2, 100, 10, 60_000, () => t);
    expect(rl.check('a').ok).toBe(true);
    expect(rl.check('a').ok).toBe(true);
    const denied = rl.check('a');
    expect(denied).toEqual({ ok: false, retryAfterS: 60, scope: 'client' });
    expect(rl.check('b').ok).toBe(true); // other clients unaffected
    t = 45_000;
    expect(rl.check('a')).toMatchObject({ ok: false, retryAfterS: 15 });
    t = 60_000;
    expect(rl.check('a').ok).toBe(true);
  });
  it('applies a global ceiling across clients', () => {
    const rl = new RateLimiter(10, 3, 100, 60_000, () => 0);
    expect(['a', 'b', 'c'].map((k) => rl.check(k).ok)).toEqual([true, true, true]);
    expect(rl.check('d')).toMatchObject({ ok: false, scope: 'global' });
  });
  it('bounds memory without resetting tracked clients when addresses are sprayed', () => {
    let t = 0;
    const rl = new RateLimiter(2, 1_000_000, 5, 60_000, () => t);
    rl.check('victim'); rl.check('victim');
    for (let i = 0; i < 1000; i++) rl.check(`spray-${i}`);
    expect(rl.trackedKeys).toBe(5);
    expect(rl.check('victim')).toMatchObject({ ok: false, scope: 'client' }); // still limited, not reset
    expect(rl.check('spray-new')).toMatchObject({ ok: false, scope: 'overflow' }); // sprayers share one bucket
    t = 61_000;
    expect(rl.check('fresh').ok).toBe(true); // expired windows are reclaimed
    expect(rl.trackedKeys).toBe(1);
  });
  it('restarts an expired window even when it is not at the front of the table', () => {
    let t = 0;
    const rl = new RateLimiter(1, 1000, 100, 60_000, () => t);
    rl.check('a');
    t = 30_000; rl.check('b');
    t = 61_000;
    expect(rl.check('a').ok).toBe(true);
    t = 89_999;
    expect(rl.check('b').ok).toBe(false); // b's window (started at 30 s) is still running
    t = 90_000;
    expect(rl.check('b').ok).toBe(true);
  });
});

describe('Slots, BoundedCache, withDeadline', () => {
  it('caps total and per-client concurrency; release is idempotent', () => {
    const s = new Slots(3, 2);
    const a1 = s.tryAcquire('a'); const a2 = s.tryAcquire('a');
    expect(s.tryAcquire('a')).toEqual({ refused: 'client-busy' });
    const b1 = s.tryAcquire('b');
    expect(s.tryAcquire('c')).toEqual({ refused: 'busy' });
    if ('release' in a1) { a1.release(); a1.release(); }
    expect(s.inUse).toBe(2);
    expect('release' in s.tryAcquire('c')).toBe(true);
    void a2; void b1;
  });
  it('queues bursts briefly in FIFO order, bounded in length and wait', async () => {
    const s = new Slots(1, 2, 2, 200);
    const a = s.tryAcquire('a');
    const order: string[] = [];
    const b = s.acquire('b').then((r) => { order.push('b'); return r; });
    const c = s.acquire('c').then((r) => { order.push('c'); return r; });
    expect(await s.acquire('d')).toEqual({ refused: 'busy' }); // queue full
    expect(s.waiting).toBe(2);
    if ('release' in a) a.release();
    const rb = await b;
    expect('release' in rb).toBe(true);
    if ('release' in rb) rb.release();
    expect('release' in (await c)).toBe(true);
    expect(order).toEqual(['b', 'c']);
  });
  it('gives up after the maximum wait and counts waiting requests toward the client cap', async () => {
    const s = new Slots(1, 1, 5, 100);
    s.tryAcquire('a');
    const t0 = Date.now();
    expect(await s.acquire('b')).toEqual({ refused: 'busy' });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(90);
    expect(s.waiting).toBe(0);
    const waitingB = s.acquire('b');
    expect(await s.acquire('b')).toEqual({ refused: 'client-busy' }); // b already holds a place in the queue
    expect(await waitingB).toEqual({ refused: 'busy' });
    expect(s.waiting).toBe(0);
    expect(s.inUse).toBe(1); // only a's slot; no leaked reservations
  });
  it('evicts by bytes and by TTL, and refuses single oversized items', () => {
    let t = 0;
    const c = new BoundedCache<string>(1000, 100, 10_000, () => t);
    c.set('a', 'A', 200); c.set('b', 'B', 200); c.set('c', 'C', 200); c.set('d', 'D', 200); c.set('e', 'E', 200);
    expect(c.bytes).toBe(1000);
    c.set('f', 'F', 200);
    expect(c.get('a')).toBeUndefined();
    expect(c.get('f')).toBe('F');
    c.set('huge', 'H', 300);
    expect(c.get('huge')).toBeUndefined();
    t = 10_000;
    expect(c.get('f')).toBeUndefined();
  });
  it('caps each provider request by the remaining budget, then fails fast', async () => {
    let t = 0;
    const seen: Array<number | undefined> = [];
    const inner: Transport = { send: async (req) => { seen.push(req.timeoutMs); return { ok: true, httpStatus: 200, text: '{}', sha256: '', retrievedAt: '', mode: 'live' }; } };
    const d = withDeadline(inner, 20_000, 15_000, () => t);
    await d.send({ kind: 'rpc', provider: 'p', method: 'm', url: 'https://x' });
    t = 10_000;
    await d.send({ kind: 'explorer', provider: 'p', method: 'm', url: 'https://x', timeoutMs: 45_000 });
    expect(seen).toEqual([15_000, 10_000]);
    t = 20_000;
    const r = await d.send({ kind: 'rpc', provider: 'p', method: 'm', url: 'https://x' });
    expect(r.failure).toBe(BUDGET_EXHAUSTED);
    expect(seen).toHaveLength(2);
  });
  it('bounds the provider-response cache by bytes', async () => {
    const inner: Transport = { send: async () => ({ ok: true, httpStatus: 200, text: JSON.stringify({ items: 'x'.repeat(100) }), sha256: '', retrievedAt: '', mode: 'live' }) };
    const c = new CachingTransport(inner, 60_000, 1000, Date.now, undefined, 1000);
    for (let i = 0; i < 20; i++) await c.send({ kind: 'explorer', provider: 'p', method: 'm', url: `https://x/${i}` });
    expect(c.cachedBytes).toBeLessThanOrEqual(1000);
    expect(c.cachedBytes).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// HTTP-level behaviour with controlled fake providers.

// RPC answers are taken from the synthetic plain-transfer recording and re-addressed per test hash.
const TEMPLATE_HASH = '0xcb55a82b95ca4bec1fa8ff890abda0691aaef7aac5795da9c4ab034d6d65cb57';
const templ = JSON.parse(readFileSync(`fixtures/synthetic/ethereum-${TEMPLATE_HASH}.json`, 'utf8')) as { exchanges: Record<string, { kind: string; method: string; text: string }> };
const rpcText = (method: string) => Object.values(templ.exchanges).find((e) => e.kind === 'rpc' && e.method === method)?.text;
const h = (n: number) => `0x${n.toString(16).padStart(64, '0')}`;
const SLOW_RPC_PREFIX = '0xdead';

/** Behaves like LiveTransport under failure: a hanging endpoint answers with a timeout after req.timeoutMs. */
function fakeProviders(opts: { explorerHangs: boolean }) {
  const counts = { rpc: 0, explorer: 0 };
  const ok = (text: string): TransportResponse => ({ ok: true, httpStatus: 200, text, sha256: 'x', retrievedAt: new Date().toISOString(), mode: 'live' });
  const hang = (req: TransportRequest) => new Promise<TransportResponse>((r) => setTimeout(() => r({ ok: false, httpStatus: 0, text: '', sha256: 'x', retrievedAt: new Date().toISOString(), mode: 'live', failure: `timed out after ${req.timeoutMs} ms` }), req.timeoutMs ?? 15_000));
  const transport: Transport = {
    send: async (req) => {
      if (req.kind === 'explorer') {
        counts.explorer++;
        if (opts.explorerHangs) return hang(req);
        return { ...ok(''), ok: false, httpStatus: 403 };
      }
      counts.rpc++;
      const body = req.body as { method: string; params: unknown[] };
      if (!rpcText(body.method) && body.method !== 'eth_getBlockByNumber') return ok(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: `the method ${body.method} does not exist/is not available` } }));
      const hash = String(body.params[0]);
      if (hash.startsWith(SLOW_RPC_PREFIX)) return hang(req);
      const text = body.method === 'eth_getBlockByNumber' ? rpcText('eth_getBlockByNumber')! : rpcText(body.method)!.split(TEMPLATE_HASH).join(hash);
      return ok(text);
    },
  };
  return { transport, counts };
}

let servers: Server[] = [];
afterEach(() => { for (const s of servers) s.close(); servers = []; });

async function start(over: Partial<ServerConfig>, transport: Transport, logs: RequestLog[] = []): Promise<{ base: string; app: App }> {
  const config = loadConfig({
    mode: 'live', fixturesDir: 'fixtures/synthetic,fixtures/devnet', rateLimitPerMinute: 1000, globalRateLimitPerMinute: 1000,
    maxConcurrentFast: 2, maxConcurrentFull: 2, maxConcurrentPerClient: 2, fastBudgetMs: 600, fullBudgetMs: 600,
    slowExplorerTimeoutMs: 45_000, requestTimeoutMs: 15_000, slotWaitMs: 0, ...over,
  });
  const app = createApp({ config, liveTransport: transport, log: (e) => logs.push(e) });
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  servers.push(server);
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, app };
}

const get = (url: string, headers: Record<string, string> = {}) => fetch(url, { headers });

describe('HTTP admission control (fake providers)', () => {
  it('spoofed X-Forwarded-For from a direct client does not evade the limit', async () => {
    const { transport } = fakeProviders({ explorerHangs: false });
    const { base } = await start({ rateLimitPerMinute: 3 }, transport);
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await get(`${base}/api/story/ethereum/${h(i + 1)}?stage=fast`, { 'x-forwarded-for': `198.51.100.${i}` })).status);
    expect(statuses).toEqual([200, 200, 200, 429, 429]);
  });

  it('behind a trusted proxy, distinct clients get distinct buckets and the same client is limited', async () => {
    const { transport } = fakeProviders({ explorerHangs: false });
    const { base } = await start({ rateLimitPerMinute: 2, trustProxy: parseTrustedProxies('loopback') }, transport);
    const as = (client: string, n: number) => get(`${base}/api/story/ethereum/${h(n)}?stage=fast`, { 'x-forwarded-for': `9.9.9.9, ${client}` });
    expect((await as('203.0.113.1', 1)).status).toBe(200);
    expect((await as('203.0.113.1', 2)).status).toBe(200);
    const third = await as('203.0.113.1', 3);
    expect(third.status).toBe(429);
    expect(Number(third.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await as('203.0.113.2', 4)).status).toBe(200); // a different real client
  });

  it('slow explorer requests are bounded by the story budget and cannot block first renders', async () => {
    const { transport } = fakeProviders({ explorerHangs: true });
    const { base, app } = await start({ trustProxy: parseTrustedProxies('loopback') }, transport);
    const t0 = Date.now();
    // Two different clients fill both full-stage slots with stories whose explorer hangs.
    const slow = [1, 2].map((n) => get(`${base}/api/story/ethereum/${h(n)}`, { 'x-forwarded-for': `203.0.113.${n}` }));
    await new Promise((r) => setTimeout(r, 100));
    expect(app.stats().fullInUse).toBe(2);
    // A third full build is refused quickly with Retry-After rather than queued indefinitely…
    const busy = await get(`${base}/api/story/ethereum/${h(3)}`, { 'x-forwarded-for': '203.0.113.3' });
    expect(busy.status).toBe(503);
    expect(busy.headers.get('retry-after')).toBe('5');
    // …while the fast (RPC-only) stage, which has its own pool, still answers.
    const fast = await get(`${base}/api/story/ethereum/${h(3)}?stage=fast`, { 'x-forwarded-for': '203.0.113.3' });
    expect(fast.status).toBe(200);
    // The slow builds finish at the budget (not the 45 s explorer timeout) with partial data.
    const done = await Promise.all(slow);
    const elapsed = Date.now() - t0;
    expect(done.map((r) => r.status)).toEqual([200, 200]);
    expect(elapsed).toBeLessThan(3000);
    const story = (await done[0]!.json()).story;
    expect(story.sources.some((s: { status: string }) => s.status === 'error')).toBe(true);
    // Slots are released; the refused lookup now succeeds (recovery).
    expect(app.stats().fullInUse).toBe(0);
    expect((await get(`${base}/api/story/ethereum/${h(3)}`, { 'x-forwarded-for': '203.0.113.3' })).status).toBe(200);
  });

  it('a burst larger than the pool waits briefly instead of failing', async () => {
    const { transport } = fakeProviders({ explorerHangs: false });
    const { base, app } = await start({ maxConcurrentFast: 2, slotWaitMs: 5000, trustProxy: parseTrustedProxies('loopback') }, transport);
    const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => get(`${base}/api/story/ethereum/${h(100 + i)}?stage=fast`, { 'x-forwarded-for': `203.0.113.${i}` })));
    expect(rs.map((r) => r.status)).toEqual(Array(8).fill(200));
    expect(app.stats().fastInUse).toBe(0);
  });

  it('one client cannot hold every slot', async () => {
    const { transport } = fakeProviders({ explorerHangs: true });
    const { base } = await start({ maxConcurrentFull: 4, maxConcurrentPerClient: 1 }, transport);
    const first = get(`${base}/api/story/ethereum/${h(1)}`);
    await new Promise((r) => setTimeout(r, 50));
    const second = await get(`${base}/api/story/ethereum/${h(2)}`);
    expect(second.status).toBe(503);
    expect((await second.json()).message).toMatch(/previous lookups/);
    expect((await first).status).toBe(200);
  });

  it('cache hits and identical in-flight lookups do not need a slot', async () => {
    const { transport, counts } = fakeProviders({ explorerHangs: false });
    const logs: RequestLog[] = [];
    const { base } = await start({ maxConcurrentFast: 2, maxConcurrentPerClient: 4, trustProxy: parseTrustedProxies('loopback') }, transport, logs);
    // Cached fast story.
    expect((await get(`${base}/api/story/ethereum/${h(7)}?stage=fast`)).status).toBe(200);
    const rpcAfterFirst = counts.rpc;
    // Fill both fast slots with lookups whose RPC hangs (until the 600 ms budget).
    const hanging = [1, 2].map((n) => get(`${base}/api/story/ethereum/${SLOW_RPC_PREFIX}${'0'.repeat(59)}${n}?stage=fast`, { 'x-forwarded-for': `203.0.113.${n}` }));
    await new Promise((r) => setTimeout(r, 100));
    // New work is refused…
    expect((await get(`${base}/api/story/ethereum/${h(8)}?stage=fast`)).status).toBe(503);
    // …but the cached story is still served, without touching providers.
    expect((await get(`${base}/api/story/ethereum/${h(7)}?stage=fast`)).status).toBe(200);
    expect(counts.rpc).toBeGreaterThanOrEqual(rpcAfterFirst);
    // Joining an identical in-flight lookup also needs no slot.
    const joined = await get(`${base}/api/story/ethereum/${SLOW_RPC_PREFIX}${'0'.repeat(59)}1?stage=fast`, { 'x-forwarded-for': '203.0.113.9' });
    const results = await Promise.all(hanging);
    expect(results.map((r) => r.status)).toEqual([502, 502]); // budget exhausted → RPC unavailable, retryable
    expect(joined.status).toBe(502);
    expect(logs.map((l) => l.cache).filter(Boolean)).toEqual(expect.arrayContaining(['built', 'hit', 'joined']));
  });

  it('draining reports unhealthy and refuses new live work', async () => {
    const { transport } = fakeProviders({ explorerHangs: false });
    const { base, app } = await start({}, transport);
    expect((await get(`${base}/api/health`)).status).toBe(200);
    app.drain();
    const health = await get(`${base}/api/health`);
    expect(health.status).toBe(503);
    expect((await health.json()).draining).toBe(true);
    expect((await get(`${base}/api/story/ethereum/${h(1)}`)).status).toBe(503);
    expect((await get(`${base}/api/example/ethereum/${TEMPLATE_HASH}`)).status).toBe(200); // recorded stays available
  });

  it('request logs carry no client address, transaction hash or provider URL', async () => {
    const { transport } = fakeProviders({ explorerHangs: false });
    const logs: RequestLog[] = [];
    const { base } = await start({ rateLimitPerMinute: 1, trustProxy: parseTrustedProxies('loopback') }, transport, logs);
    await get(`${base}/api/story/ethereum/${h(42)}?stage=fast`, { 'x-forwarded-for': '203.0.113.77' });
    await get(`${base}/api/story/ethereum/${h(43)}?stage=fast`, { 'x-forwarded-for': '203.0.113.77' });
    await get(`${base}/api/health`);
    const text = JSON.stringify(logs);
    expect(logs).toHaveLength(2); // health probes are not logged
    expect(logs[0]).toMatchObject({ route: 'story', chain: 'ethereum', stage: 'fast', status: 200, cache: 'built' });
    expect(logs[1]).toMatchObject({ status: 429, limit: 'rate:client' });
    for (const secret of ['203.0.113.77', '127.0.0.1', h(42).slice(2), 'publicnode', 'http']) expect(text).not.toContain(secret);
  });

  it('examples still replay when the operator configures custom RPCs and an explorer key', async () => {
    const { transport } = fakeProviders({ explorerHangs: false });
    // A schema-v2 recording (replayed against the public default endpoints) built in a temp
    // directory from the synthetic provider: the URLs are only request keys; the data is synthetic.
    const dir = mkdtempSync(join(tmpdir(), 'txstory-v2-'));
    const c = allCases(JSON.parse(readFileSync('tests/vectors/abi-cast.json', 'utf8'))).find((x) => x.id === 'eth-transfer')!;
    const rec = new RecordingTransport(new SyntheticProvider(c));
    await assembleStory('ethereum', c.hash, rec, { ...loadConfig({}), endpoints: recordingEndpoints(), explorerApiKey: null, trace: 'off' });
    await saveFixtureV2(rec, dir, { chain: 'ethereum', hash: c.hash, description: 'synthetic v2 test recording', recordedAt: '2026-01-01T00:00:00Z', recorder: 'test' });
    const custom = loadConfig({}).endpoints;
    for (const k of Object.keys(custom) as Array<keyof typeof custom>) custom[k] = { rpcs: [{ url: 'https://rpc.operator.example/v2/abcdefghijklmnopqrstuvwxyz123456', provider: 'custom RPC 1' }], explorerApi: 'https://explorer.operator.example', explorerProvider: 'Blockscout' };
    const { base } = await start({ endpoints: custom, explorerApiKey: 'operator-key', fixturesDir: `${dir},fixtures/synthetic,fixtures/devnet` }, transport);
    for (const [network, hash, mode] of [['ethereum', c.hash, 'recorded'], ['ethereum', '0xefb65ab1ab71b94063c0ee8e8c7bdde47b808c19f4e653ed931e3006f4983112', 'synthetic'], ['anvil', '0xdce671e4526d6d277669b28b2a9108c3f291951eb893a8d716101d94a2640359', 'recorded']] as const) {
      const r = await get(`${base}/api/example/${network}/${hash}`);
      expect(r.status, hash).toBe(200);
      const story = (await r.json()).story;
      expect(story.mode).toBe(mode);
      expect(JSON.stringify(story.sources)).not.toContain('operator');
    }
  });

  it('reports unreadable fixture directories and invalid recordings at startup instead of hiding them', () => {
    const dir = mkdtempSync(join(tmpdir(), 'txstory-bad-'));
    writeFileSync(join(dir, 'ethereum-0x' + 'ab'.repeat(32) + '.json'), '{"schema":"unknown"}');
    const warnings: Array<Record<string, unknown>> = [];
    createApp({ config: loadConfig({ fixturesDir: `${dir},${join(dir, 'missing')}`, logRequests: false }), warn: (e) => warnings.push(e) });
    expect(warnings.map((w) => w.event)).toEqual(['recording-rejected', 'fixtures-dir-unreadable']);
    expect(String(warnings[0]!.reason)).toMatch(/unknown schema/);
    // The shipped directories hold only valid recordings plus non-recording files (expected.json, chains.json, an ABI).
    const shipped: Array<Record<string, unknown>> = [];
    createApp({ config: loadConfig({ logRequests: false }), warn: (e) => shipped.push(e) });
    expect(shipped).toEqual([]);
  });

  it('lists examples with their data origin', async () => {
    const { transport } = fakeProviders({ explorerHangs: false });
    const { base } = await start({}, transport);
    const body = await (await get(`${base}/api/examples`)).json();
    const byOrigin = (o: string) => body.examples.filter((e: { origin: string }) => e.origin === o).length;
    expect([byOrigin('synthetic'), byOrigin('local-devnet'), byOrigin('captured')]).toEqual([15, 6, 0]);
  });
});

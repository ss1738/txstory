#!/usr/bin/env node
/**
 * Operational check of a BUILT TxStory server against LOCAL mock providers.
 * Never contacts public RPC or explorer services.
 *
 *   npm run build && node scripts/ops-check.mjs [--server <path to dist/node/server/index.js>] [--only s1,s2] [--out file.json]
 *
 * Each scenario starts a fresh server process (production build) whose RPC and
 * explorer URLs point at an in-process mock with controllable failure modes:
 * normal latency, hanging (until the client's timeout), HTTP 429/403/503,
 * slow state changes, a flaky first response, and oversized bodies.
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const SERVER = resolve(opt('--server', resolve(ROOT, 'dist/node/server/index.js')));
const SERVER_ROOT = resolve(dirname(SERVER), '../../..');
const ONLY = opt('--only', '')?.split(',').filter(Boolean) ?? [];
const OUT = opt('--out', null);

// Mock answers are taken from the SYNTHETIC plain-transfer recording and re-addressed per hash.
const TEMPLATE = '0xcb55a82b95ca4bec1fa8ff890abda0691aaef7aac5795da9c4ab034d6d65cb57';
const fixture = JSON.parse(readFileSync(resolve(ROOT, `fixtures/synthetic/ethereum-${TEMPLATE}.json`), 'utf8'));
const rpcText = (m) => Object.values(fixture.exchanges).find((e) => e.kind === 'rpc' && e.method === m)?.text;
const exText = (suffix) => Object.values(fixture.exchanges).find((e) => e.kind === 'explorer' && e.method === `GET /api/v2/transactions/${TEMPLATE}${suffix}`)?.text;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hx = (tag, n) => `0x${tag}${n.toString(16).padStart(64 - tag.length, '0')}`;

// ---------------------------------------------------------------- mock providers
const hits = {};
const flakySeen = new Set();
function mock() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const [, family, mode, ...rest] = url.pathname.split('/');
    const key = `${family}/${mode}`;
    hits[key] = (hits[key] ?? 0) + 1;
    const send = (status, body, delay = 0) => setTimeout(() => {
      if (res.destroyed) return;
      res.writeHead(status, { 'content-type': 'application/json' }); res.end(body);
    }, delay);
    req.on('error', () => {});
    res.on('error', () => {});
    if (mode === 'hang') return; // never answers; the client times out
    if (mode === '429') return send(429, '{"error":"rate limited"}');
    if (mode === '403') return send(403, '<html>forbidden</html>');
    if (family === 'rpc') {
      let body = '';
      for await (const c of req) body += c;
      const { method, params } = JSON.parse(body);
      const hash = String(params[0]);
      const text = method === 'eth_getBlockByNumber' ? rpcText(method) : (rpcText(method) ?? '{"jsonrpc":"2.0","id":1,"result":null}').split(TEMPLATE).join(hash);
      return send(200, text, 40);
    }
    // explorer: /ex/<mode>/api/v2/transactions/<hash>[/<sub>]
    const path = '/' + rest.join('/');
    const m = /^\/api\/v2\/transactions\/(0x[0-9a-f]{64})(\/[a-z-]+)?$/.exec(path);
    if (!m) return send(404, '{"message":"not found"}');
    const [, hash, sub = ''] = m;
    if (mode === 'slowsc' && sub === '/state-changes') return send(200, exText(sub).split(TEMPLATE).join(hash), 20_000);
    if (mode === 'flaky' && sub === '/state-changes' && !flakySeen.has(hash)) { flakySeen.add(hash); return send(503, '{"message":"busy"}'); }
    if (mode === 'huge' && sub === '/logs') return send(200, JSON.stringify({ items: [{ pad: 'x'.repeat(9_000_000) }], next_page_params: null }));
    const text = exText(sub);
    if (!text) return send(404, '{"message":"not found"}');
    return send(200, text.split(TEMPLATE).join(hash), 120);
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, base: `http://127.0.0.1:${server.address().port}` })));
}

// ---------------------------------------------------------------- app processes
let nextPort = 18900;
async function startApp(env) {
  const port = nextPort++;
  const logs = [];
  const proc = spawn(process.execPath, [SERVER], {
    cwd: SERVER_ROOT,
    env: { PATH: process.env.PATH, TXSTORY_MODE: 'live', TXSTORY_HOST: '127.0.0.1', TXSTORY_PORT: String(port), TXSTORY_STATIC_DIR: resolve(SERVER_ROOT, 'dist/client'), TXSTORY_FIXTURES_DIR: `${resolve(SERVER_ROOT, 'fixtures/synthetic')},${resolve(SERVER_ROOT, 'fixtures/devnet')}`, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', (d) => logs.push(...d.toString().split('\n').filter(Boolean)));
  proc.stderr.on('data', (d) => logs.push(...d.toString().split('\n').filter(Boolean).map((l) => `ERR ${l}`)));
  const exited = new Promise((r) => proc.on('exit', (code, signal) => r({ code, signal, at: Date.now() })));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* starting */ }
    await sleep(100);
  }
  return { base, proc, logs, exited, rssMb: () => rss(proc.pid) };
}
async function rss(pid) {
  const out = await new Promise((r) => { const p = spawn('ps', ['-o', 'rss=', '-p', String(pid)]); let s = ''; p.stdout.on('data', (d) => (s += d)); p.on('close', () => r(s)); });
  return Math.round(Number(out.trim()) / 1024);
}
async function timed(url, headers = {}) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers });
    const body = await r.json().catch(() => null);
    return { status: r.status, ms: Date.now() - t0, body, retryAfter: r.headers.get('retry-after') };
  } catch (e) {
    return { status: 0, ms: Date.now() - t0, error: e.cause?.code ?? e.message };
  }
}
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };
const tally = (rs) => rs.reduce((a, r) => ((a[r.status] = (a[r.status] ?? 0) + 1), a), {});
const xff = (n) => ({ 'x-forwarded-for': `198.51.100.250, 203.0.113.${n}` }); // left entry is a spoof attempt

// ---------------------------------------------------------------- scenarios
const scenarios = {
  async s1_concurrent_load(M) {
    const app = await startApp({ TXSTORY_RPC_ETHEREUM: `${M}/rpc/ok`, TXSTORY_EXPLORER_ETHEREUM: `${M}/ex/ok`, TXSTORY_TRUST_PROXY: 'loopback' });
    const rssStart = await app.rssMb();
    // 12 clients × 5 lookups (fast then full, like the UI); 1 in 5 lookups is a popular shared transaction.
    const all = [];
    await Promise.all(Array.from({ length: 12 }, async (_, c) => {
      for (let i = 0; i < 5; i++) {
        const hash = i === 2 ? hx('aa', 1) : hx('a1', c * 10 + i);
        const fast = await timed(`${app.base}/api/story/ethereum/${hash}?stage=fast`, xff(c));
        const full = await timed(`${app.base}/api/story/ethereum/${hash}`, xff(c));
        all.push({ stage: 'fast', ...fast }, { stage: 'full', ...full });
      }
    }));
    const rssEnd = await app.rssMb();
    app.proc.kill('SIGTERM'); await app.exited;
    const cacheLines = app.logs.filter((l) => l.includes('"cache"')).map((l) => JSON.parse(l).cache);
    const by = (s) => all.filter((r) => r.stage === s);
    return {
      requests: all.length, statuses: tally(all),
      fast_p50_ms: pct(by('fast').map((r) => r.ms), 0.5), fast_p95_ms: pct(by('fast').map((r) => r.ms), 0.95),
      full_p50_ms: pct(by('full').map((r) => r.ms), 0.5), full_p95_ms: pct(by('full').map((r) => r.ms), 0.95),
      cache: tally(cacheLines.map((c) => ({ status: c }))), rss_mb: { start: rssStart, end: rssEnd },
    };
  },

  async s2_slow_explorer_cannot_starve(M) {
    // Explorer never answers; each full build waits for its timeouts. Can first renders still happen?
    const app = await startApp({ TXSTORY_RPC_ETHEREUM: `${M}/rpc/ok`, TXSTORY_EXPLORER_ETHEREUM: `${M}/ex/hang`, TXSTORY_TRUST_PROXY: 'loopback' });
    const t0 = Date.now();
    const fulls = Array.from({ length: 8 }, (_, c) => timed(`${app.base}/api/story/ethereum/${hx('b2', c)}`, xff(c)));
    await sleep(1500);
    const fastDuring = await Promise.all([20, 21, 22].map((c) => timed(`${app.base}/api/story/ethereum/${hx('b3', c)}?stage=fast`, xff(c))));
    const fullDuring = await timed(`${app.base}/api/story/ethereum/${hx('b4', 1)}`, xff(30));
    const health = await timed(`${app.base}/api/health`);
    const done = await Promise.all(fulls);
    const after = await timed(`${app.base}/api/story/ethereum/${hx('b4', 1)}`, xff(30));
    app.proc.kill('SIGTERM'); await app.exited;
    return {
      full_builds_statuses: tally(done), full_build_max_ms: Math.max(...done.map((r) => r.ms)),
      fast_while_explorer_hangs: fastDuring.map((r) => `${r.status} in ${r.ms} ms`),
      extra_full_while_busy: `${fullDuring.status} retry-after=${fullDuring.retryAfter} in ${fullDuring.ms} ms`,
      health_while_busy: health.status,
      extra_full_after_recovery: `${after.status} (${Math.round((Date.now() - t0) / 1000)} s after start)`,
      partial_data_reported: done.filter((r) => r.status === 200).every((r) => r.body?.story?.sources?.some((s) => s.status === 'error')),
    };
  },

  async s3_slow_state_changes_within_longer_timeout(M) {
    const app = await startApp({ TXSTORY_RPC_ETHEREUM: `${M}/rpc/ok`, TXSTORY_EXPLORER_ETHEREUM: `${M}/ex/slowsc` });
    const r = await timed(`${app.base}/api/story/ethereum/${hx('c3', 1)}`);
    app.proc.kill('SIGTERM'); await app.exited;
    const st = r.body?.story;
    return { status: r.status, ms: r.ms, stateChanges: st?.completeness?.stateChanges, crossCheckMatches: st?.crossCheck?.rows?.filter((x) => x.status === 'match').length };
  },

  async s4_partial_then_retry_recovers(M) {
    const app = await startApp({ TXSTORY_RPC_ETHEREUM: `${M}/rpc/ok`, TXSTORY_EXPLORER_ETHEREUM: `${M}/ex/flaky` });
    const url = `${app.base}/api/story/ethereum/${hx('d4', 1)}`;
    const first = await timed(url); const second = await timed(url); const third = await timed(url);
    app.proc.kill('SIGTERM'); await app.exited;
    const cache = app.logs.filter((l) => l.includes('"cache"')).map((l) => JSON.parse(l).cache);
    return {
      first: `${first.status} stateChanges=${first.body?.story?.completeness?.stateChanges}`,
      retry: `${second.status} stateChanges=${second.body?.story?.completeness?.stateChanges}`,
      third_cache: cache[2], cache_sequence: cache,
    };
  },

  async s5_rpc_refusals_and_fallback(M) {
    const a = await startApp({ TXSTORY_RPC_ETHEREUM: `${M}/rpc/429,${M}/rpc/403,${M}/rpc/ok`, TXSTORY_EXPLORER_ETHEREUM: 'off' });
    const ok = await timed(`${a.base}/api/story/ethereum/${hx('e5', 1)}?stage=fast`);
    a.proc.kill('SIGTERM'); await a.exited;
    const b = await startApp({ TXSTORY_RPC_ETHEREUM: `${M}/rpc/429,${M}/rpc/429`, TXSTORY_EXPLORER_ETHEREUM: 'off' });
    const bad = await timed(`${b.base}/api/story/ethereum/${hx('e5', 2)}?stage=fast`);
    b.proc.kill('SIGTERM'); await b.exited;
    const c = await startApp({ TXSTORY_RPC_ETHEREUM: `${M}/rpc/hang`, TXSTORY_EXPLORER_ETHEREUM: 'off', TXSTORY_FAST_BUDGET_MS: '5000' });
    const hung = await timed(`${c.base}/api/story/ethereum/${hx('e5', 3)}?stage=fast`);
    c.proc.kill('SIGTERM'); await c.exited;
    return {
      fallback_after_429_and_403: `${ok.status}; note: ${ok.body?.story?.sources?.[0]?.note ?? '-'}`,
      all_rate_limited: `${bad.status} ${bad.body?.code}: ${bad.body?.message}`,
      rpc_hangs_with_5s_budget: `${hung.status} ${hung.body?.code} in ${hung.ms} ms`,
    };
  },

  async s6_explorer_refusals_and_size_cap(M) {
    const out = {};
    for (const mode of ['403', '429', 'huge']) {
      const app = await startApp({ TXSTORY_RPC_ETHEREUM: `${M}/rpc/ok`, TXSTORY_EXPLORER_ETHEREUM: `${M}/ex/${mode}` });
      const r = await timed(`${app.base}/api/story/ethereum/${hx('f6', 1)}`);
      const errs = (r.body?.story?.sources ?? []).filter((s) => s.status === 'error').map((s) => s.note ?? s.status);
      out[`explorer_${mode}`] = `${r.status}; completeness=${JSON.stringify(r.body?.story?.completeness)}; first error=${String(errs[0] ?? '-').slice(0, 80)}; rss=${await app.rssMb()} MB`;
      app.proc.kill('SIGTERM'); await app.exited;
    }
    return out;
  },

  async s7_rate_limits(M) {
    const app = await startApp({ TXSTORY_RPC_ETHEREUM: `${M}/rpc/ok`, TXSTORY_EXPLORER_ETHEREUM: 'off', TXSTORY_TRUST_PROXY: 'loopback', TXSTORY_RATE_LIMIT_PER_MINUTE: '5', TXSTORY_GLOBAL_RATE_LIMIT_PER_MINUTE: '12' });
    const one = [];
    for (let i = 0; i < 7; i++) one.push((await timed(`${app.base}/api/story/ethereum/${hx('a7', i)}?stage=fast`, xff(1))).status);
    const spoof = [];
    for (let i = 0; i < 3; i++) spoof.push((await timed(`${app.base}/api/story/ethereum/${hx('a8', i)}?stage=fast`, { 'x-forwarded-for': `203.0.113.${100 + i}, 203.0.113.1` })).status);
    const others = [];
    for (let c = 2; c < 6; c++) for (let i = 0; i < 2; i++) others.push((await timed(`${app.base}/api/story/ethereum/${hx('a9', c * 10 + i)}?stage=fast`, xff(c))).status);
    const last = await timed(`${app.base}/api/story/ethereum/${hx('a9', 99)}?stage=fast`, xff(9));
    app.proc.kill('SIGTERM'); await app.exited;
    return { one_client_7_requests: one, same_client_rotating_left_xff: spoof, four_other_clients_2_each: others, global_ceiling_new_client: `${last.status} ${last.body?.message}` };
  },

  async s8_static_health_shutdown_restart(M) {
    const app = await startApp({ TXSTORY_RPC_ETHEREUM: `${M}/rpc/ok`, TXSTORY_EXPLORER_ETHEREUM: `${M}/ex/slowsc`, TXSTORY_SHUTDOWN_GRACE_MS: '3000' });
    const shell = await fetch(`${app.base}/`); const shellText = await shell.text();
    const deep = await (await fetch(`${app.base}/tx/ethereum/${hx('99', 1)}`)).text();
    const asset = shellText.match(/\/assets\/[^"]+\.js/)?.[0];
    const assetRes = asset ? await fetch(`${app.base}${asset}`) : null;
    const example = await timed(`${app.base}/api/example/ethereum/${TEMPLATE}`);
    // Shutdown with a slow request in flight (state changes take 20 s, grace is 3 s).
    const inflight = timed(`${app.base}/api/story/ethereum/${hx('99', 2)}`);
    await sleep(800);
    const t0 = Date.now();
    app.proc.kill('SIGTERM');
    await sleep(200);
    const duringDrain = await timed(`${app.base}/api/health`);
    const exit = await app.exited;
    const inflightResult = await inflight;
    const idle = await startApp({ TXSTORY_RPC_ETHEREUM: `${M}/rpc/ok`, TXSTORY_EXPLORER_ETHEREUM: 'off' });
    const t1 = Date.now(); idle.proc.kill('SIGTERM'); const idleExit = await idle.exited;
    const restarted = await startApp({ TXSTORY_RPC_ETHEREUM: `${M}/rpc/ok`, TXSTORY_EXPLORER_ETHEREUM: 'off' });
    const afterRestart = await timed(`${restarted.base}/api/story/ethereum/${hx('99', 3)}?stage=fast`);
    restarted.proc.kill('SIGTERM'); await restarted.exited;
    return {
      shell: `${shell.status} csp=${!!shell.headers.get('content-security-policy')}`,
      deep_link_serves_shell: deep.includes('<div id="root"'),
      asset: assetRes ? `${assetRes.status} ${assetRes.headers.get('cache-control')}` : 'none found',
      example: `${example.status} mode=${example.body?.story?.mode}`,
      shutdown_with_inflight: `exit code=${exit.code} after ${exit.at - t0} ms; in-flight request: ${inflightResult.status || inflightResult.error}; new connection during drain: ${duringDrain.status || duringDrain.error}`,
      shutdown_idle: `exit code=${idleExit.code} after ${idleExit.at - t1} ms`,
      restart: `health ok, lookup ${afterRestart.status}`,
      shutdown_log: app.logs.filter((l) => l.includes('"event"')).map((l) => JSON.parse(l).event).join(' → '),
    };
  },
};

const { server: mockServer, base: M } = await mock();
const results = { server: SERVER, startedAt: new Date().toISOString(), scenarios: {} };
for (const [name, fn] of Object.entries(scenarios)) {
  if (ONLY.length && !ONLY.some((o) => name.startsWith(o))) continue;
  const t0 = Date.now();
  try { results.scenarios[name] = await fn(M); } catch (e) { results.scenarios[name] = { error: String(e?.stack ?? e).slice(0, 400) }; }
  results.scenarios[name].scenario_s = Math.round((Date.now() - t0) / 1000);
  console.log(name, JSON.stringify(results.scenarios[name], null, 1));
}
results.mockHits = hits;
mockServer.closeAllConnections?.(); mockServer.close();
if (OUT) writeFileSync(OUT, JSON.stringify(results, null, 1) + '\n');

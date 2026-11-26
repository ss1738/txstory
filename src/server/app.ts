import { createReadStream, readdirSync, readFileSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { chainKeys, getChain, isChainKey, type ChainKey } from '../core/chains.js';
import { isTxHash } from '../core/hex.js';
import { assembleStory, type StoryResult } from '../engine/analyze.js';
import { recordingEndpoints, type ServerConfig } from './config.js';
import { CachingTransport, FIXTURE_SCHEMA_V1, FIXTURE_SCHEMA_V2, FIXTURE_SCHEMA_V3, LiveTransport, RECORDING_FILE_NAME, type FixtureFile, type Transport } from '../engine/transport.js';
import { RecordedTransport } from '../engine/fixture-files.js';
import type { AssembleOptions } from '../engine/analyze.js';
import { resolveClient } from './clientIp.js';
import { recordAnalysis, registerRecordingNetwork, replayRecording, validateRecording, type Recording } from '../engine/recording.js';
import { OPENAPI } from './openapi.js';
import { BoundedCache, RateLimiter, Slots, withDeadline } from './limits.js';

export interface AppDeps {
  config: ServerConfig;
  /** Injected for tests; defaults to a LiveTransport built from config. */
  liveTransport?: Transport;
  now?: () => number;
  /** Receives startup warnings (unreadable fixture directories, rejected recordings); defaults to stderr JSON. */
  warn?: (entry: Record<string, unknown>) => void;
  /** Receives one structured line per API request; defaults to stdout JSON when config.logRequests. */
  log?: (entry: RequestLog) => void;
}

/** What is logged per API request. Deliberately excludes client addresses, hashes and provider URLs. */
export interface RequestLog {
  t: string;
  route: 'story' | 'example' | 'recording' | 'examples' | 'chains' | 'health' | 'openapi' | 'other';
  chain?: string;
  stage?: 'fast' | 'full';
  status: number;
  code?: string;
  /** hit: served from cache; joined: shared an identical in-flight build; built: new build. */
  cache?: 'hit' | 'joined' | 'built';
  ms: number;
  sourceErrors?: number;
  limit?: string;
}

export interface App {
  (req: IncomingMessage, res: ServerResponse): Promise<void>;
  /** Stop admitting work: health reports 503 and responses close their connection. */
  drain(): void;
  readonly stats: () => { fastInUse: number; fullInUse: number; storyCacheBytes: number; responseCacheBytes: number; rateLimitKeys: number; draining: boolean };
}

type Stage = NonNullable<AssembleOptions['stage']>;
type Built = { result: StoryResult; cache: 'hit' | 'joined' | 'built' };

const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'cross-origin-opener-policy': 'same-origin',
};

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.map': 'application/json',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json',
};

const STATUS_FOR: Record<Exclude<StoryResult['kind'], 'ok'>, number> = {
  'not-found': 404, pending: 409, 'rpc-unavailable': 502, unsupported: 422,
};

export function createApp(deps: AppDeps): App {
  const { config } = deps;
  const now = deps.now ?? Date.now;
  const log = deps.log ?? (config.logRequests ? (e: RequestLog) => console.log(JSON.stringify(e)) : () => {});
  const responseCache = new CachingTransport(
    deps.liveTransport ?? new LiveTransport({ timeoutMs: config.requestTimeoutMs, maxBytes: config.maxResponseBytes, userAgent: config.userAgent }),
    5 * 60_000, 2000, now, undefined, config.cacheMaxBytes,
  );
  const recorded = new RecordedTransport(config.fixturesDir);
  const fixtureDirs = config.fixturesDir.split(',').map((d) => d.trim()).filter(Boolean);
  // Validate every recording once at startup. Recordings of custom networks embed
  // the network definition; register those so their examples can be opened.
  // Problems are reported (one line each) instead of silently hiding examples.
  const warn = deps.warn ?? ((e: Record<string, unknown>) => console.error(JSON.stringify({ t: new Date().toISOString(), ...e })));
  for (const dir of fixtureDirs) {
    let names: string[];
    try { names = readdirSync(dir).filter((f) => RECORDING_FILE_NAME.test(f)); } catch (err) {
      warn({ event: 'fixtures-dir-unreadable', dir, reason: err instanceof Error ? err.message : 'unreadable' });
      continue;
    }
    for (const name of names) {
      try {
        registerRecordingNetwork(validateRecording(JSON.parse(readFileSync(join(dir, name), 'utf8'))));
      } catch (err) {
        warn({ event: 'recording-rejected', file: name, reason: err instanceof Error ? err.message.slice(0, 200) : 'invalid' });
      }
    }
  }
  // Replay must request exactly what was recorded: public endpoints, no API key.
  const recordedConfig: ServerConfig = { ...config, endpoints: recordingEndpoints(), explorerApiKey: null };
  const cache = new BoundedCache<StoryResult>(config.cacheMaxBytes, 500, config.cacheTtlMs, now);
  const inflight = new Map<string, Promise<StoryResult>>();
  const limiter = new RateLimiter(config.rateLimitPerMinute, config.globalRateLimitPerMinute, 10_000, 60_000, now);
  const slots: Record<Stage, Slots> = {
    fast: new Slots(config.maxConcurrentFast, config.maxConcurrentPerClient, config.maxConcurrentFast * 4, config.slotWaitMs),
    full: new Slots(config.maxConcurrentFull, config.maxConcurrentPerClient, config.maxConcurrentFull * 4, config.slotWaitMs),
  };
  let draining = false;

  function json(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}) {
    const data = JSON.stringify(body);
    res.writeHead(status, {
      ...SECURITY_HEADERS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
      'content-length': Buffer.byteLength(data).toString(), ...(draining ? { connection: 'close' } : {}), ...extra,
    });
    res.end(data);
  }

  const cleanResult = (result: StoryResult) => (result.kind === 'ok' ? result.story.sources.every((s) => s.status !== 'error') : result.kind === 'unsupported');

  /**
   * Cache → join an identical in-flight build → (only then) take a slot and build.
   * Only final outcomes built without transient source errors are cached, so
   * pending results, outages and partially enriched stories can be retried.
   */
  async function story(key: string, build: () => Promise<StoryResult>, acquire: () => Promise<{ release: () => void } | { refused: string }>): Promise<Built | { refused: string }> {
    const hit = cache.get(key);
    if (hit) return { result: hit, cache: 'hit' };
    const pending = inflight.get(key);
    if (pending) return { result: await pending, cache: 'joined' };
    const slot = await acquire();
    if ('refused' in slot) return slot;
    // While we waited for a slot, someone else may have built or started the same story.
    const late = cache.get(key) ?? inflight.get(key);
    if (late) { slot.release(); return { result: await late, cache: 'joined' }; }
    const p = build();
    inflight.set(key, p);
    try {
      const result = await p;
      if (cleanResult(result)) cache.set(key, result, JSON.stringify(result).length * 2);
      return { result, cache: 'built' };
    } finally {
      inflight.delete(key);
      slot.release();
    }
  }

  const noSlot = async () => ({ release: () => {} });

  function buildLive(chain: ChainKey, hash: string, stage: Stage): Promise<StoryResult> {
    if (config.mode === 'recorded') return storyRecorded(chain, hash, stage);
    const budget = stage === 'fast' ? config.fastBudgetMs : config.fullBudgetMs;
    return assembleStory(chain, hash, withDeadline(responseCache, now() + budget, config.requestTimeoutMs, now), config, { stage });
  }

  async function storyRecorded(chain: ChainKey, hash: string, stage: NonNullable<AssembleOptions['stage']> = 'full'): Promise<StoryResult> {
    const fixture = await recorded.load(chain, hash);
    if (!fixture) return { kind: 'not-found', message: 'No recorded fixture exists for this transaction. Recorded mode only serves saved examples.', sources: [] };
    return replayRecording(fixture as Recording, recordedConfig, { stage });
  }

  async function listExamples() {
    const files: string[] = [];
    for (const dir of fixtureDirs) {
      try { files.push(...(await readdir(dir)).filter((f) => RECORDING_FILE_NAME.test(f)).sort().map((f) => join(dir, f))); } catch { /* reported once at startup (fixtures-dir-unreadable) */ }
    }
    const out: Array<{ chain: string; hash: string; description: string; recordedAt: string; origin: 'captured' | 'local-devnet' | 'synthetic' }> = [];
    for (const f of files) {
      try {
        const fx = JSON.parse(await readFile(f, 'utf8')) as FixtureFile;
        if ((fx.schema === FIXTURE_SCHEMA_V1 || fx.schema === FIXTURE_SCHEMA_V2 || fx.schema === FIXTURE_SCHEMA_V3) && isChainKey(fx.chain) && isTxHash(fx.hash)) {
          out.push({ chain: fx.chain, hash: fx.hash, description: String(fx.description).slice(0, 160), recordedAt: fx.recordedAt, origin: fx.origin ?? 'captured' });
        }
      } catch { /* reported once at startup (recording-rejected); not listed */ }
    }
    return out;
  }

  async function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string) {
    if (!config.staticDir) {
      res.writeHead(404, { ...SECURITY_HEADERS, 'content-type': 'text/plain' });
      res.end('Static client not configured (run the Vite dev server, or build and set TXSTORY_STATIC_DIR).');
      return;
    }
    const root = resolve(config.staticDir);
    let decoded: string;
    try { decoded = decodeURIComponent(pathname); } catch { decoded = '/'; }
    let file = resolve(join(root, decoded));
    if (file !== root && !file.startsWith(root + sep)) file = join(root, 'index.html'); // traversal → app shell
    let st = await stat(file).catch(() => null);
    if (!st || st.isDirectory()) {
      // SPA routes (e.g. /tx/ethereum/0x…) fall back to the app shell.
      file = join(root, 'index.html');
      st = await stat(file).catch(() => null);
      if (!st) { res.writeHead(404, SECURITY_HEADERS); res.end(); return; }
    }
    const ext = extname(file);
    const immutable = file.includes(`${sep}assets${sep}`);
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      'content-length': st.size.toString(),
    });
    if (req.method === 'HEAD') { res.end(); return; }
    createReadStream(file).pipe(res);
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const started = now();
    const entry: Omit<RequestLog, 't' | 'ms' | 'status'> = { route: 'other' };
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return json(res, 405, { ok: false, code: 'method-not-allowed', message: 'TxStory is read-only.' }, { allow: 'GET, HEAD' });
      }
      const url = new URL(req.url ?? '/', 'http://localhost');
      const path = url.pathname;
      if (!path.startsWith('/api/')) return await serveStatic(req, res, path);

      if (path === '/api/health') {
        entry.route = 'health';
        return draining
          ? json(res, 503, { ok: false, mode: config.mode, draining: true })
          : json(res, 200, { ok: true, mode: config.mode, draining: false });
      }
      if (path === '/api/chains') {
        entry.route = 'chains';
        return json(res, 200, {
          ok: true, mode: config.mode,
          chains: chainKeys().map((k) => {
            const c = getChain(k);
            return {
              key: k, name: c.name, chainId: c.chainId, nativeSymbol: c.nativeSymbol, explorerUi: c.explorerUi, builtin: c.builtin,
              rpcProviders: config.endpoints[k]?.rpcs.map((r) => r.provider) ?? [],
              explorerConfigured: !!config.endpoints[k]?.explorerApi,
            };
          }),
        });
      }
      if (path === '/api/examples') { entry.route = 'examples'; return json(res, 200, { ok: true, examples: await listExamples() }); }
      if (path === '/api/openapi.json') { entry.route = 'openapi'; return json(res, 200, OPENAPI, { 'cache-control': 'no-cache' }); }

      const m = /^\/api\/(story|example|recording)\/([a-z][a-z0-9-]{1,31})\/([^/]+)$/.exec(path);
      if (!m) return json(res, 404, { ok: false, code: 'unknown-route', message: 'Unknown API route.' });
      const kind = m[1] === 'story' || m[1] === 'example' || m[1] === 'recording' ? m[1] : null;
      const chain = m[2]; const hash = m[3];
      if (!kind || !chain || !hash) return json(res, 404, { ok: false, code: 'unknown-route', message: 'Unknown API route.' });
      const stage: Stage = url.searchParams.get('stage') === 'fast' ? 'fast' : 'full';
      entry.route = kind;
      entry.stage = stage;
      if (!isChainKey(chain)) return json(res, 400, { ok: false, code: 'invalid-chain', message: `Unsupported network. Choose one of: ${chainKeys().join(', ')}.` });
      entry.chain = chain;
      if (!isTxHash(hash)) return json(res, 400, { ok: false, code: 'invalid-hash', message: 'A transaction hash is 0x followed by 64 hexadecimal characters.' });

      // Live work (story or recording builds) passes admission control first.
      const admit = (): { client: string } | null => {
        if (draining) { json(res, 503, { ok: false, code: 'busy', message: 'The server is restarting. Try again shortly.' }, { 'retry-after': '5' }); return null; }
        const client = resolveClient(req.socket.remoteAddress, req.headers['x-forwarded-for'], config.trustProxy);
        const decision = limiter.check(client.key);
        if (!decision.ok) {
          entry.limit = `rate:${decision.scope}`;
          const message = decision.scope === 'global'
            ? `TxStory is handling many lookups right now. Try again in ${decision.retryAfterS}s.`
            : `Too many lookups. Try again in ${decision.retryAfterS}s.`;
          json(res, 429, { ok: false, code: 'rate-limited', message }, { 'retry-after': String(decision.retryAfterS) });
          return null;
        }
        return { client: client.key };
      };
      const refuse = (refused: string, st: Stage) => {
        entry.limit = `slots:${st}:${refused}`;
        const message = refused === 'client-busy'
          ? 'Your previous lookups are still being built. Try again in a few seconds.'
          : 'The server is busy building other stories. Try again shortly.';
        return json(res, 503, { ok: false, code: 'busy', message }, { 'retry-after': '5' });
      };

      if (kind === 'recording') {
        // A replayable recording (txstory-fixture-v3): the provider responses plus the output.
        if (config.mode === 'recorded') {
          const fx = await recorded.load(chain, hash);
          if (!fx) return json(res, 404, { ok: false, code: 'not-found', message: 'No recorded fixture exists for this transaction.' });
          return json(res, 200, { ok: true, recording: fx });
        }
        const admitted = admit();
        if (!admitted) return;
        const slot = await slots.full.acquire(admitted.client);
        if ('refused' in slot) return refuse(slot.refused, 'full');
        try {
          const { result, recording } = await recordAnalysis(chain, hash, withDeadline(responseCache, now() + config.fullBudgetMs, config.requestTimeoutMs, now), config, { stage: 'full', embedStory: true });
          entry.cache = 'built';
          if (result.kind !== 'ok') entry.code = result.kind;
          return json(res, result.kind === 'ok' ? 200 : STATUS_FOR[result.kind], result.kind === 'ok'
            ? { ok: true, recording }
            : { ok: false, code: result.kind, message: result.message, sources: result.sources, recording });
        } finally {
          slot.release();
        }
      }

      let outcome: Built | { refused: string };
      if (kind === 'example') {
        // Recorded builds are deterministic and provider-free: cached, never slot-limited.
        outcome = await story(`example:${stage}:${chain}:${hash.toLowerCase()}`, () => storyRecorded(chain, hash, stage), noSlot);
      } else if (config.mode === 'recorded') {
        outcome = await story(`story:${stage}:${chain}:${hash.toLowerCase()}`, () => buildLive(chain, hash, stage), noSlot);
      } else {
        const admitted = admit();
        if (!admitted) return;
        outcome = await story(`story:${stage}:${chain}:${hash.toLowerCase()}`, () => buildLive(chain, hash, stage), () => slots[stage].acquire(admitted.client));
      }
      if ('refused' in outcome) return refuse(outcome.refused, stage);
      const { result } = outcome;
      entry.cache = outcome.cache;
      entry.sourceErrors = (result.kind === 'ok' ? result.story.sources : result.sources).filter((s) => s.status === 'error').length;
      if (result.kind === 'ok') return json(res, 200, { ok: true, story: result.story });
      entry.code = result.kind;
      return json(res, STATUS_FOR[result.kind], { ok: false, code: result.kind, message: result.message, sources: result.sources });
    } catch (err) {
      console.error('[txstory] unhandled error:', err instanceof Error ? err.message : 'unknown');
      entry.code = 'internal';
      if (!res.headersSent) return json(res, 500, { ok: false, code: 'internal', message: 'Unexpected server error.' });
      res.destroy();
    } finally {
      // Static files and health probes are not logged (noise); everything under /api/ else is.
      if (entry.route !== 'other' || (req.url ?? '').startsWith('/api/')) {
        if (entry.route !== 'health') {
          log({ t: new Date(started).toISOString(), ...entry, status: res.statusCode, ms: now() - started });
        }
      }
    }
  }

  const app = handle as App;
  app.drain = () => { draining = true; };
  Object.defineProperty(app, 'stats', {
    value: () => ({
      fastInUse: slots.fast.inUse, fullInUse: slots.full.inUse, storyCacheBytes: cache.bytes,
      responseCacheBytes: responseCache.cachedBytes, rateLimitKeys: limiter.trackedKeys, draining,
    }),
  });
  return app;
}

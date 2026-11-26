/**
 * HTTP server configuration = engine configuration + serving, admission
 * control and operational settings. Read from process.env.
 */
import { engineConfigFromEnv, intFrom, type EngineConfig } from '../engine/config.js';
import { parseTrustedProxies, type TrustedProxies } from './clientIp.js';

export { recordingEndpoints, redactUrl, legacyRedactUrlV1, type ChainEndpoints, type RpcEndpoint } from '../engine/config.js';

export interface ServerConfig extends EngineConfig {
  host: string;
  port: number;
  mode: 'live' | 'recorded';
  fixturesDir: string;
  staticDir: string | null;
  rateLimitPerMinute: number;
  /** Live story requests per minute across ALL clients (protects upstream providers). */
  globalRateLimitPerMinute: number;
  /** Which TCP peers may supply X-Forwarded-For (see clientIp.ts). Default: none. */
  trustProxy: TrustedProxies;
  /** Concurrent fresh builds: fast (RPC-only) and full (explorer) stages have separate pools. */
  maxConcurrentFast: number;
  maxConcurrentFull: number;
  /** Concurrent fresh builds one client may hold (per stage). */
  maxConcurrentPerClient: number;
  /** How long a request may wait for a free build slot (bounded queue of 4× the pool size). */
  slotWaitMs: number;
  /** Wall-clock budget for all provider calls of one story build. */
  fastBudgetMs: number;
  fullBudgetMs: number;
  /** Upper bound for each in-memory cache (stories; provider responses). */
  cacheMaxBytes: number;
  /** On SIGTERM/SIGINT: how long in-flight requests may finish before connections are closed. */
  shutdownGraceMs: number;
  /** One JSON line per API request (no IPs, no hashes, no URLs). */
  logRequests: boolean;
  cacheTtlMs: number;
}

export function loadConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  const env = process.env;
  const mode = env.TXSTORY_MODE?.trim() || 'live';
  if (mode !== 'live' && mode !== 'recorded') throw new Error('TXSTORY_MODE must be "live" or "recorded"');
  const str = (name: string) => env[name]?.trim() || undefined;
  const int = (name: string, fallback: number, min: number, max: number) => intFrom(env, name, fallback, min, max);
  return {
    ...engineConfigFromEnv(env),
    host: str('TXSTORY_HOST') ?? '127.0.0.1',
    port: int('TXSTORY_PORT', 8787, 1, 65535),
    mode,
    fixturesDir: str('TXSTORY_FIXTURES_DIR') ?? 'fixtures/synthetic,fixtures/devnet',
    staticDir: str('TXSTORY_STATIC_DIR') ?? null,
    rateLimitPerMinute: int('TXSTORY_RATE_LIMIT_PER_MINUTE', 30, 1, 10000),
    globalRateLimitPerMinute: int('TXSTORY_GLOBAL_RATE_LIMIT_PER_MINUTE', 300, 1, 100000),
    trustProxy: parseTrustedProxies(str('TXSTORY_TRUST_PROXY')),
    maxConcurrentFast: int('TXSTORY_MAX_CONCURRENT_FAST', 8, 1, 256),
    maxConcurrentFull: int('TXSTORY_MAX_CONCURRENT_FULL', 6, 1, 256),
    maxConcurrentPerClient: int('TXSTORY_MAX_CONCURRENT_PER_CLIENT', 2, 1, 64),
    slotWaitMs: int('TXSTORY_SLOT_WAIT_MS', 10_000, 0, 60_000),
    fastBudgetMs: int('TXSTORY_FAST_BUDGET_MS', 35_000, 1000, 110_000),
    fullBudgetMs: int('TXSTORY_FULL_BUDGET_MS', 90_000, 1000, 110_000),
    cacheMaxBytes: int('TXSTORY_CACHE_MAX_MB', 64, 1, 4096) * 1024 * 1024,
    shutdownGraceMs: int('TXSTORY_SHUTDOWN_GRACE_MS', 8000, 0, 120_000),
    logRequests: (str('TXSTORY_LOG_REQUESTS') ?? '1') !== '0',
    cacheTtlMs: int('TXSTORY_CACHE_TTL_MS', 10 * 60_000, 0, 24 * 3600_000),
    ...overrides,
  };
}

/**
 * Engine configuration types, public default endpoints, and URL redaction.
 * Browser-safe: no Node built-ins. Loading chain files and reading the
 * environment lives in config.ts (Node only), which re-exports all of this.
 */
import { chainKeys, getChain, registerChain, type ChainInfo, type ChainKey } from '../core/chains.js';

export interface RpcEndpoint { url: string; provider: string }

export interface ChainEndpoints {
  /** Ordered: later entries are used only when earlier ones fail. */
  rpcs: RpcEndpoint[];
  explorerApi: string | null;
  explorerProvider: string;
}

export type TraceMode = 'auto' | 'off';

export interface EngineConfig {
  endpoints: Record<ChainKey, ChainEndpoints>;
  explorerApiKey: string | null;
  maxExplorerPages: number;
  maxTokenMetadataCalls: number;
  requestTimeoutMs: number;
  /** Timeout for slow explorer endpoints (state changes, internal transactions). */
  slowExplorerTimeoutMs: number;
  maxResponseBytes: number;
  userAgent: string;
  /**
   * Call traces (`debug_traceTransaction` with callTracer) in the full stage.
   * auto: try each configured RPC in order; endpoints that do not offer the
   * method are skipped and recorded. off: never request traces.
   */
  trace: TraceMode;
}

export const ENGINE_VERSION = '0.4.0';
export const USER_AGENT = `TxStory/${ENGINE_VERSION} (+read-only transaction explainer)`;

/** Public endpoints. Recorded fixtures were captured against exactly these URLs. */
const PUBLIC_DEFAULTS: Record<string, { rpcs: RpcEndpoint[]; explorer: string }> = {
  ethereum: { rpcs: [
    { url: 'https://ethereum-rpc.publicnode.com', provider: 'PublicNode' },
    { url: 'https://eth.drpc.org', provider: 'dRPC (public)' },
    { url: 'https://rpc.flashbots.net', provider: 'Flashbots Protect RPC' },
  ], explorer: 'https://eth.blockscout.com' },
  optimism: { rpcs: [
    { url: 'https://optimism-rpc.publicnode.com', provider: 'PublicNode' },
    { url: 'https://mainnet.optimism.io', provider: 'Optimism public RPC' },
  ], explorer: 'https://explorer.optimism.io' },
  base: { rpcs: [
    { url: 'https://base-rpc.publicnode.com', provider: 'PublicNode' },
    { url: 'https://mainnet.base.org', provider: 'Base public RPC' },
  ], explorer: 'https://base.blockscout.com' },
  arbitrum: { rpcs: [
    { url: 'https://arbitrum-one-rpc.publicnode.com', provider: 'PublicNode' },
    { url: 'https://arb1.arbitrum.io/rpc', provider: 'Arbitrum public RPC' },
  ], explorer: 'https://arbitrum.blockscout.com' },
};

/** Default endpoints of custom (chain-file) networks. */
const CUSTOM_DEFAULTS: Record<string, { rpcs: RpcEndpoint[]; explorer: string | null }> = {};

/** Register a custom network and its default endpoints (from a chain file). */
export function registerCustomNetwork(info: ChainInfo, rpcUrls: string[], explorerApi: string | null): void {
  registerChain(info);
  CUSTOM_DEFAULTS[info.key] = { rpcs: rpcUrls.map((url, i) => ({ url, provider: `${info.name} RPC ${i + 1}` })), explorer: explorerApi };
}

function defaultsFor(chain: ChainKey): { rpcs: RpcEndpoint[]; explorer: string | null } | null {
  return PUBLIC_DEFAULTS[chain] ?? CUSTOM_DEFAULTS[chain] ?? null;
}

export type Env = Record<string, string | undefined>;

export const read = (env: Env, name: string): string | undefined => {
  const v = env[name];
  return v && v.trim() ? v.trim() : undefined;
};

export const intFrom = (env: Env, name: string, fallback: number, min: number, max: number): number => {
  const raw = read(env, name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be an integer between ${min} and ${max}`);
  return n;
};

/**
 * Endpoints for one network: defaults, replaced by TXSTORY_RPC_<KEY> /
 * TXSTORY_EXPLORER_<KEY> when set. null when nothing is known (e.g. a network
 * registered only from a recording, which brings its own endpoints).
 */
export function endpointsFor(chain: ChainKey, env: Env = {}): ChainEndpoints | null {
  const d = defaultsFor(chain);
  const upper = chain.toUpperCase().replace(/-/g, '_');
  const custom = read(env, `TXSTORY_RPC_${upper}`);
  const explorerUrl = read(env, `TXSTORY_EXPLORER_${upper}`);
  if (!d && !custom) return null;
  return {
    // A comma-separated custom list replaces the defaults entirely.
    rpcs: custom ? custom.split(',').map((url, i) => ({ url: url.trim(), provider: `custom RPC ${i + 1}` })) : d!.rpcs.map((r) => ({ ...r })),
    explorerApi: explorerUrl === 'off' ? null : explorerUrl ?? d?.explorer ?? null,
    explorerProvider: 'Blockscout',
  };
}

/**
 * An engine configuration from explicit values (defaults for anything unset).
 * Does not read chain files; config.ts engineConfigFromEnv does that first.
 */
export function engineConfigFromValues(env: Env = {}, overrides: Partial<EngineConfig> = {}): EngineConfig {
  const trace = read(env, 'TXSTORY_TRACE') ?? 'auto';
  if (trace !== 'auto' && trace !== 'off') throw new Error('TXSTORY_TRACE must be "auto" or "off"');
  return {
    endpoints: Object.fromEntries(chainKeys().flatMap((k) => { const e = endpointsFor(k, env); return e ? [[k, e]] : []; })),
    explorerApiKey: read(env, 'TXSTORY_BLOCKSCOUT_API_KEY') ?? null,
    maxExplorerPages: intFrom(env, 'TXSTORY_MAX_EXPLORER_PAGES', 6, 1, 50),
    maxTokenMetadataCalls: intFrom(env, 'TXSTORY_MAX_TOKEN_METADATA', 30, 0, 200),
    requestTimeoutMs: intFrom(env, 'TXSTORY_TIMEOUT_MS', 15000, 1000, 60000),
    slowExplorerTimeoutMs: intFrom(env, 'TXSTORY_SLOW_EXPLORER_TIMEOUT_MS', 45000, 1000, 120000),
    maxResponseBytes: intFrom(env, 'TXSTORY_MAX_RESPONSE_BYTES', 8_000_000, 100_000, 50_000_000),
    userAgent: USER_AGENT,
    trace,
    ...overrides,
  };
}


/** Make sure every registered network has endpoints (e.g. after loading a chain file late). */
export function withAllNetworks(config: EngineConfig, env: Env = {}): EngineConfig {
  const endpoints = { ...config.endpoints };
  for (const k of chainKeys()) { const e = endpoints[k] ?? endpointsFor(k, env); if (e) endpoints[k] = e; }
  return { ...config, endpoints };
}

/**
 * Endpoints for replaying the shipped fixtures. Fixture exchanges are keyed by
 * request URL, so replay must use the URLs they were recorded with, never
 * operator overrides (custom RPCs, explorer API keys), or examples break.
 */
export function recordingEndpoints(): Record<ChainKey, ChainEndpoints> {
  const out: Record<ChainKey, ChainEndpoints> = {};
  for (const k of chainKeys()) {
    const d = PUBLIC_DEFAULTS[k] ?? CUSTOM_DEFAULTS[k];
    if (d) out[k] = { rpcs: d.rpcs.map((r) => ({ ...r })), explorerApi: d.explorer, explorerProvider: 'Blockscout' };
  }
  return out;
}

export function networkName(chain: ChainKey): string {
  try { return getChain(chain).name; } catch { return chain; }
}

/**
 * On-chain identifiers that may appear as URL path segments (transaction hashes,
 * addresses). They are public data and must survive redaction: they are part of
 * a request's identity and of honest provenance. Exact lengths only.
 */
const PUBLIC_ONCHAIN_SEGMENT = /^0x(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/;

/**
 * Public display form of a URL: credentials removed, resource identity kept.
 * Used for source records, exports, fixtures and logs. NOT a cache key: two
 * endpoints that differ only by credential redact to the same string.
 */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const key of [...u.searchParams.keys()]) {
      if (/key|token|secret|auth|pass/i.test(key)) u.searchParams.set(key, 'REDACTED');
    }
    if (u.username || u.password) { u.username = 'REDACTED'; u.password = ''; }
    // Path segments that look like API keys (e.g. /v2/<key>) are common for RPC providers.
    u.pathname = u.pathname.split('/').map((seg) => (PUBLIC_ONCHAIN_SEGMENT.test(seg) ? seg : /^[A-Za-z0-9_-]{24,}$/.test(seg) ? 'REDACTED' : seg)).join('/');
    return u.toString();
  } catch {
    return '[invalid url]';
  }
}

/**
 * The redaction used up to fixture schema v1. It also replaced transaction
 * hashes, which made request keys of different transactions collide. Kept ONLY
 * to read existing v1 fixture files (see RecordedTransport); never use it for
 * display or caching.
 */
export function legacyRedactUrlV1(url: string): string {
  try {
    const u = new URL(url);
    for (const key of [...u.searchParams.keys()]) {
      if (/key|token|secret|auth/i.test(key)) u.searchParams.set(key, 'REDACTED');
    }
    if (u.username || u.password) { u.username = 'REDACTED'; u.password = ''; }
    u.pathname = u.pathname.split('/').map((seg) => (/^[A-Za-z0-9_-]{24,}$/.test(seg) ? 'REDACTED' : seg)).join('/');
    return u.toString();
  } catch {
    return '[invalid url]';
  }
}

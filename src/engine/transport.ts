/**
 * HTTP transport with provenance. Live requests are bounded (timeout, size);
 * replay answers from a recording that stores the original response body,
 * HTTP status, and retrieval time.
 *
 * Browser-safe: no Node built-ins. Reading and writing recording files lives
 * in fixture-files.ts (Node only).
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { legacyRedactUrlV1, redactUrl } from './defaults.js';
import type { DataMode } from '../core/types.js';

export interface TransportRequest {
  kind: 'rpc' | 'explorer';
  provider: string;
  method: string; // human label: 'eth_getTransactionReceipt' / 'GET /api/v2/...'
  url: string;
  body?: unknown; // JSON body for POST
  /** Optional per-request timeout (e.g. slow explorer endpoints). Not part of request identity. */
  timeoutMs?: number;
}

export interface TransportResponse {
  ok: boolean;
  httpStatus: number;
  text: string;
  sha256: string;
  retrievedAt: string;
  mode: DataMode;
  /** Set when the request did not complete (timeout, network, size). */
  failure?: string;
}

export interface Transport {
  send(req: TransportRequest): Promise<TransportResponse>;
}

const bodyText = (req: TransportRequest) => (req.body === undefined ? '' : JSON.stringify(req.body));

/**
 * Private request identity for in-memory caching and in-flight coalescing.
 * Hashes the FULL URL (including any credential) so endpoints that differ in
 * authentication or configuration never share entries. Never persisted or logged.
 */
export function privateRequestKey(req: TransportRequest): string {
  return sha256Hex(`private-v1\n${req.kind}\n${req.url}\n${bodyText(req)}`);
}

/**
 * Persisted fixture identity (schema v2): the public, credential-redacted URL,
 * which keeps transaction hashes and addresses, plus the request body.
 */
export function fixtureRequestKey(req: TransportRequest): string {
  return sha256Hex(`fixture-v2\n${req.kind}\n${redactUrl(req.url)}\n${bodyText(req)}`).slice(0, 32);
}

/**
 * Fixture schema v1 key. It collides across transactions (the hash was redacted),
 * so it is only ever used inside RecordedTransport.forFixture for a v1 file, where
 * every lookup is additionally checked to concern that fixture's own transaction.
 */
export function legacyFixtureKeyV1(req: TransportRequest): string {
  return sha256Hex(`${req.kind}\n${legacyRedactUrlV1(req.url)}\n${bodyText(req)}`).slice(0, 24);
}

/** Hex SHA-256 of UTF-8 text (same digest as Node's crypto module). */
export const sha256Hex = (text: string): string => bytesToHex(sha256(utf8ToBytes(text)));
const sha = sha256Hex;

export class LiveTransport implements Transport {
  constructor(private opts: { timeoutMs: number; maxBytes: number; userAgent: string; fetchImpl?: typeof fetch }) {}

  async send(req: TransportRequest): Promise<TransportResponse> {
    const retrievedAt = new Date().toISOString();
    const controller = new AbortController();
    const timeoutMs = req.timeoutMs ?? this.opts.timeoutMs;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await (this.opts.fetchImpl ?? fetch)(req.url, {
        method: req.body === undefined ? 'GET' : 'POST',
        headers: {
          'user-agent': this.opts.userAgent,
          accept: 'application/json',
          ...(req.body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: req.body === undefined ? undefined : JSON.stringify(req.body),
        signal: controller.signal,
        redirect: 'follow',
      });
      const text = await readLimited(res, this.opts.maxBytes);
      return { ok: res.ok, httpStatus: res.status, text, sha256: sha(text), retrievedAt, mode: 'live' };
    } catch (err) {
      const failure = controller.signal.aborted ? `timed out after ${timeoutMs} ms` : err instanceof SizeLimitError ? err.message : 'network error';
      return { ok: false, httpStatus: 0, text: '', sha256: sha(''), retrievedAt, mode: 'live', failure };
    } finally {
      clearTimeout(timer);
    }
  }
}

class SizeLimitError extends Error {}

async function readLimited(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (declared > maxBytes) throw new SizeLimitError(`response larger than ${maxBytes} bytes`);
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new SizeLimitError(`response larger than ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  return new TextDecoder('utf-8').decode(all);
}

/** On-disk fixture format: one file per transaction, many recorded exchanges. */
/** Failure text for a request that a recording does not contain (replay never uses the network). */
export const NOT_RECORDED = 'not present in the recording (replay never uses the network)';

export const FIXTURE_SCHEMA_V1 = 'txstory-fixture-v1';
export const FIXTURE_SCHEMA_V2 = 'txstory-fixture-v2';
export const FIXTURE_SCHEMA_V3 = 'txstory-fixture-v3';

export interface FixtureFile {
  /** v1 files are keyed by legacyFixtureKeyV1; v2 files by fixtureRequestKey. */
  schema: typeof FIXTURE_SCHEMA_V1 | typeof FIXTURE_SCHEMA_V2 | typeof FIXTURE_SCHEMA_V3;
  chain: string;
  hash: string;
  description: string;
  recordedAt: string;
  recorder: string;
  /**
   * Where the responses came from: captured from real providers (default when
   * absent), captured from a local devnet node, or synthetic (written by a
   * generator, not real provider data). Replay labels synthetic sources as such.
   */
  origin?: 'captured' | 'local-devnet' | 'synthetic';
  /** Analysis options the recording was made with (absent in older files: no traces). */
  options?: { trace?: 'auto' | 'off' };
  exchanges: Record<string, {
    kind: 'rpc' | 'explorer';
    provider: string;
    method: string;
    url: string; // redacted
    body?: unknown;
    httpStatus: number;
    retrievedAt: string;
    failure?: string;
    text: string;
  }>;
}

/** File names fixturePath produces: `<network>-0x<64 hex>.json`. Other files in a fixtures directory are not recordings. */
export const RECORDING_FILE_NAME = /^[a-z][a-z0-9-]{1,31}-0x[0-9a-f]{64}\.json$/;

export function fixturePath(dir: string, chain: string, hash: string): string {
  return `${dir.replace(/[\\/]+$/, '')}/${chain}-${hash.toLowerCase()}.json`;
}

/** Whether a parsed recording is a known schema filed under exactly this network and hash. */
export function isFixtureFor(f: FixtureFile, chain: string, hash: string): boolean {
  const known = f.schema === FIXTURE_SCHEMA_V1 || f.schema === FIXTURE_SCHEMA_V2 || f.schema === FIXTURE_SCHEMA_V3;
  return known && f.chain === chain && typeof f.hash === 'string' && f.hash.toLowerCase() === hash.toLowerCase();
}

/**
 * A transport that answers only from one recording. A request that is not in
 * the recording gets a NOT_RECORDED failure; nothing is ever fetched.
 */
export function replayTransport(fixture: FixtureFile): Transport {
  const isV2 = fixture.schema !== FIXTURE_SCHEMA_V1; // v2 and v3 share request keys
  const fixtureHash = fixture.hash.toLowerCase();
  const mode: DataMode = fixture.origin === 'synthetic' ? 'synthetic' : 'recorded';
  const missing = (failure: string): TransportResponse => ({ ok: false, httpStatus: 0, text: '', sha256: sha(''), retrievedAt: fixture.recordedAt, mode, failure });
  return {
    send: async (req) => {
      let key: string;
      if (isV2) {
        key = fixtureRequestKey(req);
      } else {
        // v1 compatibility: v1 keys erased transaction hashes from explorer URLs.
        // Only answer explorer requests about this fixture's own transaction, so a
        // v1 key can never return another transaction's data.
        if (req.kind === 'explorer' && !req.url.toLowerCase().includes(fixtureHash)) {
          return missing(NOT_RECORDED);
        }
        key = legacyFixtureKeyV1(req);
      }
      const ex = fixture.exchanges[key];
      if (!ex) return missing(NOT_RECORDED);
      return {
        ok: ex.httpStatus >= 200 && ex.httpStatus < 300 && !ex.failure, httpStatus: ex.httpStatus, text: ex.text,
        sha256: sha(ex.text), retrievedAt: ex.retrievedAt, mode, ...(ex.failure ? { failure: ex.failure } : {}),
      };
    },
  };
}

/**
 * Wraps a live transport and captures every exchange for writing a recording.
 * `shareable` maps each request URL to the form stored in the recording and
 * used for its key (shareableUrlMapper); without it, URLs are only redacted.
 */
export class RecordingTransport implements Transport {
  readonly exchanges: FixtureFile['exchanges'] = {};
  constructor(private inner: Transport, private shareable: (url: string) => string = redactUrl) {}

  async send(req: TransportRequest): Promise<TransportResponse> {
    const res = await this.inner.send(req);
    const url = this.shareable(req.url);
    this.exchanges[fixtureRequestKey({ ...req, url })] = {
      kind: req.kind, provider: req.provider, method: req.method, url,
      ...(req.body === undefined ? {} : { body: req.body }),
      httpStatus: res.httpStatus, retrievedAt: res.retrievedAt, ...(res.failure ? { failure: res.failure } : {}), text: res.text,
    };
    return res;
  }
}

/**
 * Decides whether a live response may be reused from the cache.
 *
 * RPC: only well-formed JSON-RPC success envelopes with a non-null result for
 * requests whose answer cannot change once it exists:
 *   - eth_getTransactionByHash: only once the transaction is mined (blockNumber set)
 *   - eth_getTransactionReceipt: only a non-null receipt
 *   - eth_getBlockByNumber / eth_call / eth_getCode: only at an explicit block
 *     number, never at a moving tag such as "latest" or "pending"
 *   - eth_chainId
 * Null results (not found / pending), error envelopes and malformed bodies are
 * never cached, so a later retry can see a newly mined transaction.
 *
 * Explorer: only valid JSON objects. A transaction object without a block number
 * (pending at the explorer) is not cached. List endpoints are cached for the
 * cache TTL because the explorer's indexing of a mined transaction is treated
 * as settled; this is a freshness trade-off, not a reorg-safety guarantee.
 */
export function isCacheableResponse(req: TransportRequest, res: TransportResponse): boolean {
  if (!res.ok || res.failure || res.httpStatus < 200 || res.httpStatus >= 300) return false;
  let json: unknown;
  try { json = JSON.parse(res.text); } catch { return false; }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return false;
  const obj = json as Record<string, unknown>;
  if (req.kind === 'explorer') {
    const path = (() => { try { return new URL(req.url).pathname; } catch { return ''; } })();
    if (/\/transactions\/0x[0-9a-fA-F]{64}$/.test(path)) return obj.block_number !== null && obj.block_number !== undefined;
    return true;
  }
  if (obj.jsonrpc !== '2.0' || 'error' in obj || !('result' in obj)) return false;
  const result = obj.result;
  if (result === null || result === undefined) return false;
  const body = req.body as { method?: unknown; params?: unknown } | undefined;
  const method = typeof body?.method === 'string' ? body.method : '';
  const params = Array.isArray(body?.params) ? body!.params as unknown[] : [];
  const explicitBlock = (v: unknown) => typeof v === 'string' && /^0x[0-9a-fA-F]+$/.test(v);
  switch (method) {
    case 'eth_getTransactionByHash':
      return typeof result === 'object' && result !== null && explicitBlock((result as Record<string, unknown>).blockNumber);
    case 'eth_getTransactionReceipt':
      return typeof result === 'object';
    case 'eth_getBlockByNumber':
      return explicitBlock(params[0]);
    case 'eth_call':
    case 'eth_getCode':
      return explicitBlock(params[params.length - 1]);
    case 'eth_chainId':
      return true;
    default:
      return false;
  }
}

/**
 * Short-lived cache of reusable live responses (see isCacheableResponse), keyed
 * by the private request identity. Lets the full-stage story reuse the fast
 * stage's RPC responses.
 *
 * Identical requests that are in flight at the same moment are coalesced: they
 * would receive the same upstream answer anyway. The key is the full private
 * identity, so different resources or endpoints are never coalesced.
 */
export class CachingTransport implements Transport {
  private cache = new Map<string, { at: number; res: TransportResponse; bytes: number }>();
  private inflight = new Map<string, Promise<TransportResponse>>();
  private totalBytes = 0;
  constructor(
    private inner: Transport,
    private ttlMs: number,
    private maxEntries = 2000,
    private now: () => number = Date.now,
    private cacheable: (req: TransportRequest, res: TransportResponse) => boolean = isCacheableResponse,
    /** Upper bound on cached response text (approximate bytes). */
    private maxBytes = 64 * 1024 * 1024,
  ) {}

  get cachedBytes(): number { return this.totalBytes; }

  private evict(key: string): void {
    const e = this.cache.get(key);
    if (!e) return;
    this.totalBytes -= e.bytes;
    this.cache.delete(key);
  }

  async send(req: TransportRequest): Promise<TransportResponse> {
    const key = privateRequestKey(req);
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < this.ttlMs) return hit.res;
    if (hit) this.evict(key);
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const p = this.inner.send(req).then((res) => {
      const bytes = res.text.length * 2; // UTF-16 in memory
      if (this.cacheable(req, res) && bytes <= this.maxBytes / 4) {
        this.evict(key);
        this.cache.set(key, { at: this.now(), res, bytes });
        this.totalBytes += bytes;
        while (this.cache.size > this.maxEntries || this.totalBytes > this.maxBytes) {
          const oldest = this.cache.keys().next().value;
          if (oldest === undefined) break;
          this.evict(oldest);
        }
      }
      return res;
    }).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }
}

/**
 * Removes known secret fragments (see secretFragments) from provider error
 * responses before anything reads or records them. Classification follows how
 * the analysis reads responses, not a text search:
 *
 * - transport failures: the failure text is scrubbed;
 * - non-2xx responses: a JSON body has its string values scrubbed (keys,
 *   numbers and structure kept); any other body, including malformed JSON, is
 *   scrubbed as plain text;
 * - 2xx RPC responses whose parsed body has a top-level `error` member (what
 *   providers/rpc.ts and providers/trace.ts treat as a JSON-RPC error): only
 *   string values inside `error` are scrubbed; `jsonrpc`, `id`, numeric codes
 *   and everything outside `error` are kept;
 * - every other response, including successful results that contain
 *   error-named fields, successful explorer responses, and malformed 2xx
 *   bodies, is passed through byte-identical.
 *
 * A changed body gets a recomputed digest, so evidence digests describe what
 * was analysed and recorded. Successful response bodies are not inspected and
 * are not claimed to be credential-free.
 */
export function scrubbingTransport(inner: Transport, fragments: readonly string[]): Transport {
  if (!fragments.length) return inner;
  const scrubText = (text: string) => fragments.reduce((acc, f) => acc.split(f).join('REDACTED'), text);
  const scrubStrings = (v: unknown): unknown => {
    if (typeof v === 'string') return scrubText(v);
    if (Array.isArray(v)) return v.map(scrubStrings);
    if (v !== null && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrubStrings(x)]));
    return v;
  };
  const parse = (text: string): unknown => { try { return JSON.parse(text); } catch { return undefined; } };
  const sanitizeBody = (req: TransportRequest, res: TransportResponse): string => {
    if (!res.text) return res.text;
    const json = parse(res.text);
    if (!res.ok || res.httpStatus < 200 || res.httpStatus >= 300) {
      if (json === undefined) return scrubText(res.text);
      const cleaned = scrubStrings(json);
      return JSON.stringify(cleaned) === JSON.stringify(json) ? res.text : JSON.stringify(cleaned);
    }
    if (req.kind === 'rpc' && json !== null && typeof json === 'object' && !Array.isArray(json) && Object.prototype.hasOwnProperty.call(json, 'error')) {
      const obj = json as Record<string, unknown>;
      const cleaned = scrubStrings(obj.error);
      return JSON.stringify(cleaned) === JSON.stringify(obj.error) ? res.text : JSON.stringify({ ...obj, error: cleaned });
    }
    return res.text;
  };
  return {
    send: async (req) => {
      const res = await inner.send(req);
      const text = sanitizeBody(req, res);
      const failure = res.failure === undefined ? undefined : scrubText(res.failure);
      if (text === res.text && failure === res.failure) return res;
      return { ...res, text, sha256: text === res.text ? res.sha256 : sha256Hex(text), ...(failure === undefined ? {} : { failure }) };
    },
  };
}

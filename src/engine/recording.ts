/**
 * Recordings: the reproducible-analysis format (fixtures and bundles are the
 * same thing). A recording contains the ACTUAL provider responses an analysis
 * used, so the analysis can be rebuilt offline:
 *
 *  - exchanges: every request (credential-redacted URL + body) and the full
 *    response body, HTTP status, retrieval time and failure, keyed by request.
 *  - endpoints/options/config: what the engine needs to issue the same requests
 *    (redacted endpoint URLs, trace mode, page caps, whether an API key was used).
 *  - network: the network definition for custom (chain-file) networks.
 *  - output: digests of the story produced at recording time (normalised output
 *    and provider evidence). The full story is embedded only on request
 *    (`embedStory`), because replay re-derives it.
 *
 * Replay NEVER uses the network: a request that is not in the recording gets a
 * "not present in recording" failure, which shows up as missing data.
 *
 * Browser-safe: no Node built-ins. Reading and writing recording files is in
 * fixture-files.ts.
 *
 * Schema history: v1 (keys erased hashes; read-only compatibility), v2 (keys
 * keep hashes), v3 (adds endpoints, options, config, engine, network, output).
 */
import { BUILTIN_CHAIN_KEYS, isChainKey, parseChainFile, registerChain, CHAINS, CHAIN_KEY_PATTERN, type ChainInfo } from '../core/chains.js';
import { isTxHash } from '../core/hex.js';
import type { Story } from '../core/types.js';
import { assembleStory, type AssembleOptions, type StoryResult } from './analyze.js';
import { ENGINE_VERSION, recordingEndpoints, redactUrl, type ChainEndpoints, type EngineConfig } from './defaults.js';
import { FIXTURE_SCHEMA_V1, FIXTURE_SCHEMA_V2, NOT_RECORDED, RecordingTransport, replayTransport, sha256Hex, type FixtureFile, type Transport, type TransportRequest } from './transport.js';

export const RECORDING_SCHEMA_V3 = 'txstory-fixture-v3';
export const MAX_RECORDING_BYTES = 64 * 1024 * 1024;
const MAX_EXCHANGES = 10_000;
/** A recording's own structure is shallow; exchange bodies are strings and are not counted. */
const MAX_STRUCTURE_DEPTH = 64;
const MAX_LABEL_CHARS = 2_000;
const MAX_URL_CHARS = 2_048;
const MAX_ENDPOINTS = 20;

/** Deepest nesting of arrays/objects, computed without recursion; stops once past `limit`. */
function depthExceeds(value: unknown, limit: number): boolean {
  const stack: Array<[unknown, number]> = [[value, 1]];
  while (stack.length) {
    const [v, d] = stack.pop()!;
    if (v === null || typeof v !== 'object') continue;
    if (d > limit) return true;
    for (const child of Object.values(v as Record<string, unknown>)) if (child !== null && typeof child === 'object') stack.push([child, d + 1]);
  }
  return false;
}

export interface Recording extends Omit<FixtureFile, 'schema'> {
  schema: typeof FIXTURE_SCHEMA_V1 | typeof FIXTURE_SCHEMA_V2 | typeof RECORDING_SCHEMA_V3;
  engine?: { name: 'txstory'; version: string; storySchema: number };
  endpoints?: { rpcs: Array<{ url: string; provider: string }>; explorerApi: string | null };
  config?: { maxExplorerPages: number; maxTokenMetadataCalls: number; explorerApiKeyUsed: boolean };
  network?: Omit<ChainInfo, 'builtin'> & { builtin?: boolean };
  output?: { stage: 'fast' | 'full'; kind: StoryResult['kind']; storySha256: string | null; evidenceSha256?: string | null; story?: Story };
}

/** Deterministic view of a story: drops build time and live/recorded mode labels. */
export function normalizedStory(story: Story): unknown {
  return { ...story, generatedAt: null, mode: null, sources: story.sources.map((s) => ({ ...s, mode: null })) };
}

function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

export function storyDigest(story: Story): string {
  return sha256Hex(canonicalJson(normalizedStory(story)));
}

/** Digest of the provider evidence a story used (response bodies by source). */
export function evidenceDigest(story: Story): string {
  return sha256Hex(story.sources.map((s) => `${s.kind}|${s.method}|${s.url}|${s.httpStatus ?? ''}|${s.sha256 ?? ''}`).sort().join('\n'));
}

/** Record an analysis: run it through a RecordingTransport and capture everything needed to replay it. */
export async function recordAnalysis(chain: string, hash: string, live: Transport, config: EngineConfig, opts: AssembleOptions & { description?: string; embedStory?: boolean; origin?: NonNullable<Recording['origin']>; recorder?: string } = {}): Promise<{ result: StoryResult; recording: Recording }> {
  const recorder = new RecordingTransport(live);
  const result = await assembleStory(chain, hash, recorder, config, opts);
  const ep = config.endpoints[chain]!;
  const net = CHAINS[chain]!;
  const recording: Recording = {
    schema: RECORDING_SCHEMA_V3,
    chain, hash: hash.toLowerCase(), description: opts.description ?? '', recordedAt: new Date().toISOString(),
    recorder: opts.recorder ?? `txstory ${ENGINE_VERSION}`,
    origin: opts.origin ?? 'captured',
    engine: { name: 'txstory', version: ENGINE_VERSION, storySchema: result.kind === 'ok' ? result.story.schemaVersion : 3 },
    endpoints: { rpcs: ep.rpcs.map((r) => ({ url: redactUrl(r.url), provider: r.provider })), explorerApi: ep.explorerApi ? redactUrl(ep.explorerApi) : null },
    options: { trace: opts.trace ?? config.trace },
    config: { maxExplorerPages: config.maxExplorerPages, maxTokenMetadataCalls: config.maxTokenMetadataCalls, explorerApiKeyUsed: !!config.explorerApiKey },
    ...(net.builtin ? {} : { network: { ...net } }),
    output: {
      stage: opts.stage ?? 'full', kind: result.kind,
      storySha256: result.kind === 'ok' ? storyDigest(result.story) : null,
      evidenceSha256: result.kind === 'ok' ? evidenceDigest(result.story) : null,
      ...(result.kind === 'ok' && opts.embedStory ? { story: result.story } : {}),
    },
    exchanges: recorder.exchanges,
  };
  return { result, recording };
}

/** Parse and validate recording text (bounded size, strict shape). Used for files and browser imports. */
export function parseRecording(text: string): Recording {
  if (text.length > MAX_RECORDING_BYTES) throw new Error(`recording is larger than ${MAX_RECORDING_BYTES} bytes`);
  let json: unknown;
  try { json = JSON.parse(text); } catch (e) { throw new Error(`recording is not valid JSON (${e instanceof Error ? e.message : 'parse error'})`); }
  return validateRecording(json);
}

export function validateRecording(json: unknown): Recording {
  const fail = (m: string): never => { throw new Error(`invalid recording: ${m}`); };
  // Accept the API envelope ({ok, recording}) as downloaded from /api/recording.
  if (typeof json === 'object' && json !== null && !('schema' in json) && 'recording' in json) json = (json as { recording: unknown }).recording;
  if (typeof json !== 'object' || json === null || Array.isArray(json)) fail('not an object');
  if (depthExceeds(json, MAX_STRUCTURE_DEPTH)) fail(`nested deeper than ${MAX_STRUCTURE_DEPTH} levels`);
  const r = json as Record<string, unknown>;
  const str = (v: unknown, max: number) => typeof v === 'string' && v.length <= max;
  const optStr = (v: unknown, max: number) => v === undefined || str(v, max);
  if (r.schema !== FIXTURE_SCHEMA_V1 && r.schema !== FIXTURE_SCHEMA_V2 && r.schema !== RECORDING_SCHEMA_V3) fail(`unknown schema ${JSON.stringify(r.schema)}`);
  if (typeof r.chain !== 'string' || !CHAIN_KEY_PATTERN.test(r.chain)) fail('chain');
  if (!isTxHash(r.hash)) fail('hash');
  if (typeof r.exchanges !== 'object' || r.exchanges === null || Array.isArray(r.exchanges)) fail('exchanges');
  const ex = Object.entries(r.exchanges as Record<string, unknown>);
  if (ex.length > MAX_EXCHANGES) fail('too many exchanges');
  for (const [k, v] of ex) {
    const e = v as Record<string, unknown>;
    if (!/^[0-9a-f]{24,64}$/.test(k) || typeof e !== 'object' || e === null) fail(`exchange key ${k.slice(0, 20)}`);
    if ((e.kind !== 'rpc' && e.kind !== 'explorer') || !str(e.url, MAX_URL_CHARS) || typeof e.text !== 'string' || !Number.isInteger(e.httpStatus) || !str(e.retrievedAt, 64)) fail(`exchange ${k.slice(0, 12)} fields`);
    if (!optStr(e.provider, 200) || !optStr(e.method, MAX_LABEL_CHARS) || !optStr(e.failure, MAX_LABEL_CHARS)) fail(`exchange ${k.slice(0, 12)} labels`);
  }
  // Older hand-made files may omit it; it is then reported as unknown rather than invented.
  if (r.recordedAt === undefined) r.recordedAt = 'unknown';
  if (!str(r.recordedAt, 64)) fail('recordedAt');
  if (!optStr(r.description, MAX_LABEL_CHARS) || !optStr(r.recorder, 200)) fail('description or recorder');
  if (r.engine !== undefined) {
    const en = r.engine as Record<string, unknown>;
    if (typeof en !== 'object' || en === null || !str(en.version, 40) || !Number.isInteger(en.storySchema)) fail('engine');
  }
  if (r.endpoints !== undefined) {
    const ep = r.endpoints as Record<string, unknown>;
    if (typeof ep !== 'object' || ep === null || !Array.isArray(ep.rpcs) || ep.rpcs.length > MAX_ENDPOINTS) fail('endpoints');
    for (const x of ep.rpcs as unknown[]) {
      const o = x as Record<string, unknown>;
      if (typeof o !== 'object' || o === null || !str(o.url, MAX_URL_CHARS) || !str(o.provider, 200)) fail('endpoints.rpcs');
    }
    if (ep.explorerApi !== null && !str(ep.explorerApi, MAX_URL_CHARS)) fail('endpoints.explorerApi');
  }
  if (r.options !== undefined) {
    const o = r.options as Record<string, unknown>;
    if (typeof o !== 'object' || o === null || (o.trace !== undefined && o.trace !== 'auto' && o.trace !== 'off')) fail('options');
  }
  if (r.config !== undefined) {
    // Same bounds as the environment settings, so a recording cannot ask for unbounded work.
    const c = r.config as Record<string, unknown>;
    const intIn = (v: unknown, lo: number, hi: number) => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
    if (typeof c !== 'object' || c === null || !intIn(c.maxExplorerPages, 1, 50) || !intIn(c.maxTokenMetadataCalls, 0, 200) || typeof c.explorerApiKeyUsed !== 'boolean') fail('config');
  }
  if (r.output !== undefined) {
    const o = r.output as Record<string, unknown>;
    const digest = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && /^[0-9a-f]{64}$/.test(v));
    if (typeof o !== 'object' || o === null || (o.stage !== 'fast' && o.stage !== 'full') || typeof o.kind !== 'string' || !digest(o.storySha256) || !digest(o.evidenceSha256)) fail('output');
    if (o.story !== undefined) {
      const st = o.story as Record<string, unknown>;
      if (typeof st !== 'object' || st === null || !Array.isArray(st.ledger) || !Array.isArray(st.sources) || !Array.isArray(st.movements)) fail('output.story');
    }
  }
  if (r.origin !== undefined && r.origin !== 'captured' && r.origin !== 'local-devnet' && r.origin !== 'synthetic') fail('origin');
  if (r.network !== undefined) {
    const n = r.network as Record<string, unknown>;
    if (BUILTIN_CHAIN_KEYS.includes(String(n.key))) fail('network: built-in networks are not redefined by recordings');
    // Reuse the chain-file validator (data only).
    parseChainFile({ chains: [{ key: n.key, chainId: n.chainId, name: n.name, nativeSymbol: n.nativeSymbol, feeModel: n.feeModel, rpc: ['http://replay.invalid'], explorerUi: n.explorerUi ?? null, wrappedNative: n.wrappedNative ?? [] }] });
    if (n.key !== r.chain) fail('network.key differs from chain');
  }
  return json as Recording;
}

/**
 * Register the network a recording embeds (custom networks only), validated
 * with the chain-file rules. Built-in networks are never redefined.
 */
export function registerRecordingNetwork(rec: Recording): void {
  if (!rec.network || isChainKey(rec.chain)) return;
  const n = rec.network;
  const [entry] = parseChainFile({ chains: [{ key: n.key, chainId: n.chainId, name: n.name, nativeSymbol: n.nativeSymbol, feeModel: n.feeModel, rpc: ['http://replay.invalid'], explorerUi: n.explorerUi ?? null, wrappedNative: n.wrappedNative ?? [] }] });
  if (entry) registerChain(entry.info);
}

/** Replay a recording offline. Never contacts the network. */
export interface ReplayOptions extends Pick<AssembleOptions, 'userAbi' | 'stage'> {
  /** Called for every request the analysis makes; `recorded` is false when the recording has no answer for it. */
  onRequest?: (req: TransportRequest, recorded: boolean) => void;
}

export async function replayRecording(rec: Recording, base: EngineConfig, opts: ReplayOptions = {}): Promise<StoryResult> {
  registerRecordingNetwork(rec);
  if (!isChainKey(rec.chain)) throw new Error(`recording is for unknown network "${rec.chain}" (load its chain file, or use a v3 recording that embeds it)`);
  const endpoints: ChainEndpoints = rec.endpoints
    ? { rpcs: rec.endpoints.rpcs.map((x) => ({ ...x })), explorerApi: rec.endpoints.explorerApi, explorerProvider: 'Blockscout' }
    : recordingEndpoints()[rec.chain] ?? (() => { throw new Error(`no recording endpoints for ${rec.chain}`); })();
  const config: EngineConfig = {
    ...base,
    endpoints: { ...base.endpoints, [rec.chain]: endpoints },
    explorerApiKey: rec.config?.explorerApiKeyUsed ? 'REDACTED' : null,
    maxExplorerPages: rec.config?.maxExplorerPages ?? base.maxExplorerPages,
    maxTokenMetadataCalls: rec.config?.maxTokenMetadataCalls ?? base.maxTokenMetadataCalls,
  };
  const replay = replayTransport(rec);
  const observe = opts.onRequest;
  const transport: Transport = observe
    ? { send: async (req) => { const res = await replay.send(req); observe(req, res.failure !== NOT_RECORDED); return res; } }
    : replay;
  return assembleStory(rec.chain, rec.hash, transport, config, {
    stage: opts.stage ?? rec.output?.stage ?? 'full',
    trace: rec.options?.trace ?? 'off',
    ...(opts.userAbi ? { userAbi: opts.userAbi } : {}),
  });
}

export interface ReplayCheck {
  /** Same provider evidence (every source's response digest) as the recorded output. */
  sameEvidence: boolean | null;
  /** Identical normalised output (deterministic rebuild). */
  sameOutput: boolean | null;
  recordedDigest: string | null;
  replayDigest: string | null;
  engineVersionAtRecording: string | null;
}

export function checkReplay(rec: Recording, replayed: StoryResult): ReplayCheck {
  const recordedEvidence = rec.output?.evidenceSha256 ?? (rec.output?.story ? evidenceDigest(rec.output.story) : null);
  return {
    sameEvidence: recordedEvidence && replayed.kind === 'ok' ? recordedEvidence === evidenceDigest(replayed.story) : null,
    sameOutput: rec.output?.storySha256 && replayed.kind === 'ok' ? rec.output.storySha256 === storyDigest(replayed.story) : null,
    recordedDigest: rec.output?.storySha256 ?? null,
    replayDigest: replayed.kind === 'ok' ? storyDigest(replayed.story) : null,
    engineVersionAtRecording: rec.engine?.version ?? null,
  };
}

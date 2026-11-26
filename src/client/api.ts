import { BUILTIN_CHAIN_KEYS, CHAINS, type ChainKey } from '../core/chains.js';
import type { SourceRecord, Story } from '../core/types.js';

export interface ChainSummary {
  key: ChainKey; name: string; chainId: number; nativeSymbol: string; explorerUi: string | null; builtin: boolean;
  rpcProviders: string[]; explorerConfigured: boolean;
}

/** Networks the server reported (built-ins until /api/chains answers). */
let knownNetworks: Array<{ key: ChainKey; name: string }> = BUILTIN_CHAIN_KEYS.map((k) => ({ key: k, name: CHAINS[k]!.name }));
export const networks = () => knownNetworks;
export const networkName = (key: ChainKey) => knownNetworks.find((n) => n.key === key)?.name ?? CHAINS[key]?.name ?? key;
export interface Example { chain: ChainKey; hash: string; description: string; recordedAt: string; origin: 'captured' | 'local-devnet' | 'synthetic' }

export type ApiErrorCode =
  | 'invalid-chain' | 'invalid-hash' | 'not-found' | 'pending' | 'rpc-unavailable' | 'unsupported'
  | 'rate-limited' | 'busy' | 'internal' | 'network' | 'unknown-route' | 'bad-response';

export class ApiError extends Error {
  constructor(public code: ApiErrorCode, message: string, public sources: SourceRecord[] = [], public retryAfter: number | null = null) {
    super(message);
  }
}

async function getJson(path: string, signal?: AbortSignal): Promise<{ status: number; body: Record<string, unknown>; retryAfter: number | null }> {
  let res: Response;
  try {
    res = await fetch(path, { signal, headers: { accept: 'application/json' } });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError('network', 'Could not reach the TxStory server. Check your connection and try again.');
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ApiError('bad-response', `The server returned an unreadable response (HTTP ${res.status}).`);
  }
  const ra = res.headers.get('retry-after');
  return { status: res.status, body: (body ?? {}) as Record<string, unknown>, retryAfter: ra && /^\d+$/.test(ra) ? Number(ra) : null };
}

export async function fetchStory(chain: ChainKey, hash: string, opts: { stage: 'fast' | 'full'; example: boolean; signal?: AbortSignal }): Promise<Story> {
  const base = opts.example ? '/api/example' : '/api/story';
  const { body, retryAfter } = await getJson(`${base}/${chain}/${hash}?stage=${opts.stage}`, opts.signal);
  if (body.ok === true && body.story) return body.story as Story;
  throw new ApiError((body.code as ApiErrorCode) ?? 'internal', typeof body.message === 'string' ? body.message : 'Request failed.', Array.isArray(body.sources) ? (body.sources as SourceRecord[]) : [], retryAfter);
}

export async function fetchChains(signal?: AbortSignal): Promise<{ mode: 'live' | 'recorded'; chains: ChainSummary[] }> {
  const { body } = await getJson('/api/chains', signal);
  const chains = (body.chains as ChainSummary[]) ?? [];
  if (chains.length) knownNetworks = chains.map((c) => ({ key: c.key, name: c.name }));
  return { mode: body.mode === 'recorded' ? 'recorded' : 'live', chains };
}

export async function fetchExamples(signal?: AbortSignal): Promise<Example[]> {
  const { body } = await getJson('/api/examples', signal);
  return (body.examples as Example[]) ?? [];
}

/** Examples shipped with the static site (written by scripts/build-site.ts). */
export async function fetchShippedExamples(signal?: AbortSignal): Promise<Example[]> {
  const { status, body } = await getJson('/recordings/index.json', signal);
  if (status !== 200 || !Array.isArray(body.examples)) throw new ApiError('bad-response', 'The example list could not be read.');
  return body.examples as Example[];
}

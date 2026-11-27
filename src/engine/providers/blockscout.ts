/**
 * Blockscout v2 API adapter. Everything returned here is explorer-reported
 * (provenance "explorer"): labels, token metadata, internal transactions and
 * state changes come from the explorer's own indexing and tracing.
 */
import type {
  ExplorerAddressInput, ExplorerInput, ExplorerInternalInput, ExplorerSection, ExplorerStateChangeInput, TokenMetaInput,
} from '../../core/inputs.js';
import { normalizeAddress, type Address } from '../../core/hex.js';
import { parseDecimals } from '../../core/amounts.js';
import type { SourceRecord } from '../../core/types.js';
import { redactUrl } from '../defaults.js';
import { NOT_RECORDED, type Transport } from '../transport.js';
import { arr, bool, get, intString, isObj, parseJson, str, type Json } from './json.js';

export interface BlockscoutResult {
  explorer: ExplorerInput;
  tokens: Record<string, TokenMetaInput>;
  sources: SourceRecord[];
}

interface PageResult { items: Json[]; status: 'complete' | 'partial' | 'unavailable'; sourceIds: string[]; note?: string }

export class BlockscoutClient {
  private sources: SourceRecord[] = [];
  constructor(
    private transport: Transport,
    private base: string,
    private apiKey: string | null,
    private maxPages: number,
    /** Longer timeout for endpoints the explorer computes slowly (measured 12 to 20 s). */
    private slowTimeoutMs?: number,
  ) {}

  private url(path: string, params: Record<string, string> = {}): string {
    const u = new URL(this.base.replace(/\/$/, '') + path);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    if (this.apiKey) u.searchParams.set('apikey', this.apiKey);
    return u.toString();
  }

  /**
   * Source ids are derived from the endpoint and page (not from completion
   * order), so the same evidence always yields the same ids and order.
   */
  private async get(path: string, params: Record<string, string> = {}, timeoutMs?: number, page = 0): Promise<{ json: Json | undefined; sourceId: string; httpStatus: number; failure?: string; note?: string }> {
    const url = this.url(path, params);
    const method = `GET ${path}`;
    const tail = path.split('/').pop()!;
    const sourceId = `explorer:${/^0x[0-9a-fA-F]{64}$/.test(tail) ? 'transaction' : tail}${page > 0 ? `:p${page + 1}` : ''}`;
    const res = await this.transport.send({ kind: 'explorer', provider: 'Blockscout', method, url, ...(timeoutMs ? { timeoutMs } : {}) });
    const json = res.ok ? parseJson(res.text) : undefined;
    const notCaptured = res.mode !== 'live' && res.failure === NOT_RECORDED;
    const status: SourceRecord['status'] = notCaptured ? 'empty' : res.failure ? 'error' : !res.ok ? (res.httpStatus === 404 ? 'empty' : 'error') : json === undefined ? 'error' : 'ok';
    const note = notCaptured ? 'not captured in this recording (endpoint added after the fixture was recorded)' : res.failure ?? (res.httpStatus === 403 ? 'HTTP 403: the explorer refused this client (bot protection or access policy)' : res.httpStatus === 429 ? 'HTTP 429: rate limited' : !res.ok ? `HTTP ${res.httpStatus}` : json === undefined ? 'response was not valid JSON' : undefined);
    this.sources.push({
      id: sourceId, kind: 'explorer', provider: 'Blockscout', url: redactUrl(url), method, retrievedAt: res.retrievedAt,
      status, mode: res.mode, sha256: res.sha256, httpStatus: res.httpStatus, ...(note ? { note } : {}),
    });
    // Return this request's own note: concurrent requests make `this.sources.at(-1)` unreliable.
    return { json, sourceId, httpStatus: res.httpStatus, ...(res.failure ? { failure: res.failure } : {}), ...(note ? { note } : {}) };
  }

  private ordered(): SourceRecord[] {
    const rank = (id: string) => ['transaction', 'summary', 'internal-transactions', 'state-changes', 'token-transfers', 'logs'].indexOf(id.split(':')[1] ?? '');
    const page = (id: string) => Number(/:p(\d+)$/.exec(id)?.[1] ?? 1);
    return [...this.sources].sort((a, b) => rank(a.id) - rank(b.id) || page(a.id) - page(b.id));
  }

  private async pages(path: string, timeoutMs?: number): Promise<PageResult> {
    const items: Json[] = [];
    const sourceIds: string[] = [];
    let params: Record<string, string> = {};
    for (let page = 0; page < this.maxPages; page++) {
      const r = await this.get(path, params, timeoutMs, page);
      sourceIds.push(r.sourceId);
      if (!isObj(r.json)) {
        return page === 0
          ? { items, status: 'unavailable', sourceIds, note: r.note ?? 'request failed' }
          : { items, status: 'partial', sourceIds, note: `page ${page + 1} failed: ${r.note ?? 'request failed'}` };
      }
      items.push(...arr(r.json.items));
      const next = r.json.next_page_params;
      if (!isObj(next)) return { items, status: 'complete', sourceIds };
      params = Object.fromEntries(Object.entries(next).filter(([, v]) => typeof v === 'string' || typeof v === 'number').map(([k, v]) => [k, String(v)]));
    }
    return { items, status: 'partial', sourceIds, note: `stopped after ${this.maxPages} pages` };
  }

  async fetchAll(hash: string, opts: { stateChanges?: boolean } = {}): Promise<BlockscoutResult> {
    const wantStateChanges = opts.stateChanges !== false;
    const base = `/api/v2/transactions/${hash}`;
    const txRes = await this.get(base);
    if (!isObj(txRes.json)) {
      const reason = txRes.httpStatus === 404 ? 'The explorer has not indexed this transaction (HTTP 404).' : `Explorer unavailable: ${txRes.note ?? 'request failed'}.`;
      return { explorer: emptyExplorer(reason), tokens: {}, sources: this.ordered() };
    }
    const tx = txRes.json;
    const summaryPromise = this.get(`${base}/summary`);
    const [internal, stateChanges, transfers, logs] = await Promise.all([
      this.pages(`${base}/internal-transactions`, this.slowTimeoutMs),
      wantStateChanges ? this.pages(`${base}/state-changes`, this.slowTimeoutMs) : Promise.resolve<PageResult>({ items: [], status: 'unavailable', sourceIds: [], note: 'not requested in the fast stage' }),
      this.pages(`${base}/token-transfers`),
      this.pages(`${base}/logs`),
    ]);

    const addresses: Record<string, ExplorerAddressInput> = {};
    const tokens: Record<string, TokenMetaInput> = {};
    const noteAddress = (v: Json) => {
      const a = parseAddressObject(v);
      if (a && !addresses[a.address]) addresses[a.address] = a;
    };
    noteAddress(tx.from); noteAddress(tx.to); noteAddress(get(tx, 'created_contract'));

    const internalItems: ExplorerInternalInput[] = internal.items.flatMap((it) => {
      if (!isObj(it)) return [];
      noteAddress(it.from); noteAddress(it.to); noteAddress(it.created_contract);
      const from = normalizeAddress(get(it, 'from', 'hash'));
      const index = intString(it.index);
      const value = intString(it.value) ?? '0';
      if (!from || index === null) return [];
      return [{
        index: Number(index), type: str(it.type) ?? 'call', from,
        to: normalizeAddress(get(it, 'to', 'hash')), createdContract: normalizeAddress(get(it, 'created_contract', 'hash')),
        value, success: bool(it.success) ?? (it.error == null),
      }];
    });

    const stateItems: ExplorerStateChangeInput[] = stateChanges.items.flatMap((sc) => {
      if (!isObj(sc)) return [];
      noteAddress(sc.address);
      const address = normalizeAddress(get(sc, 'address', 'hash'));
      if (!address) return [];
      const isCoin = sc.type === 'coin';
      const token = normalizeAddress(get(sc, 'token', 'address_hash') ?? get(sc, 'token', 'address'));
      const tokenType = str(get(sc, 'token', 'type'));
      if (token) noteToken(tokens, get(sc, 'token'));
      const raw = sc.change;
      let change: ExplorerStateChangeInput['change'] = { kind: 'unknown' };
      if (intString(raw) !== null) change = { kind: 'amount', delta: intString(raw)! };
      else if (Array.isArray(raw)) {
        const tin: string[] = []; const tout: string[] = [];
        for (const c of raw) {
          const id = intString(get(c, 'total', 'token_id')) ?? intString(get(c, 'token_id'));
          if (!id) continue;
          if (get(c, 'direction') === 'to') tin.push(id); else if (get(c, 'direction') === 'from') tout.push(id);
        }
        change = { kind: 'nft', tokenIdsIn: tin, tokenIdsOut: tout };
      }
      return [{
        address, isCoin, token, tokenType, tokenId: intString(sc.token_id) ?? intString(get(sc, 'total', 'token_id')),
        isMiner: sc.is_miner === true, change,
      }];
    });

    const transferItems = transfers.items.flatMap((t) => {
      if (!isObj(t)) return [];
      noteAddress(t.from); noteAddress(t.to);
      noteToken(tokens, t.token);
      const li = intString(t.log_index);
      return [{ logIndex: li === null ? null : Number(li), contract: normalizeAddress(get(t, 'token', 'address_hash') ?? get(t, 'token', 'address')) }];
    });

    const logNames: Record<number, string> = {};
    for (const l of logs.items) {
      const idx = intString(get(l, 'index'));
      const name = str(get(l, 'decoded', 'method_call'));
      if (idx !== null && name) logNames[Number(idx)] = name;
    }

    const summaryRes = await summaryPromise;
    const summaries = arr(get(summaryRes.json, 'data', 'summaries')).flatMap((sm) => {
      const text = renderSummary(sm);
      return text ? [text] : [];
    });
    const decoded = get(tx, 'decoded_input');
    const revert = get(tx, 'revert_reason');
    const explorer: ExplorerInput = {
      available: true,
      txSourceId: txRes.sourceId,
      method: str(tx.method),
      decodedInput: isObj(decoded) && str(decoded.method_call)
        ? {
            call: str(decoded.method_call)!,
            parameters: arr(decoded.parameters).flatMap((p) => isObj(p)
              ? [{ name: str(p.name) ?? '', type: str(p.type) ?? '', value: stringifyParam(p.value) }]
              : []),
          }
        : null,
      revertReason: str(revert) ?? str(get(revert, 'raw')) ?? str(get(tx, 'result')) ?? null,
      addresses,
      internal: section(internal, internalItems),
      stateChanges: section(stateChanges, stateItems),
      tokenTransfers: section(transfers, transferItems),
      logNames,
      summaries,
      summarySourceId: summaries.length ? summaryRes.sourceId : null,
    };
    return { explorer, tokens, sources: this.ordered() };
  }
}

function section<T>(p: PageResult, items: T[]): ExplorerSection<T> {
  return { status: p.status, items, sourceIds: p.sourceIds, ...(p.note ? { note: p.note } : {}) };
}

function emptyExplorer(reason: string): ExplorerInput {
  const empty = { status: 'unavailable' as const, items: [], sourceIds: [] };
  return {
    available: false, reason, txSourceId: null, method: null, decodedInput: null, revertReason: null, addresses: {},
    internal: empty, stateChanges: empty, tokenTransfers: empty, logNames: {}, summaries: [], summarySourceId: null,
  };
}

function parseAddressObject(v: Json): ExplorerAddressInput | null {
  if (!isObj(v)) return null;
  const address = normalizeAddress(v.hash);
  if (!address) return null;
  const tags: string[] = [];
  for (const t of [...arr(get(v, 'public_tags')), ...arr(get(v, 'metadata', 'tags'))]) {
    const label = str(get(t, 'display_name')) ?? str(get(t, 'name'));
    if (label && !tags.includes(label)) tags.push(label);
  }
  const flags: string[] = [];
  if (v.is_scam === true) flags.push('Explorer flags this address as a scam (explorer opinion, not verified)');
  if (str(v.reputation) && v.reputation !== 'ok') flags.push(`Explorer reputation: ${String(v.reputation).slice(0, 24)}`);
  if (v.is_verified === true) flags.push('Explorer reports verified contract source code');
  return {
    address, name: str(v.name), ens: str(v.ens_domain_name), isContract: bool(v.is_contract),
    isVerified: bool(v.is_verified), tags: tags.slice(0, 6), flags,
  };
}

function noteToken(tokens: Record<string, TokenMetaInput>, v: Json) {
  if (!isObj(v)) return;
  const contract = normalizeAddress(v.address_hash ?? v.address);
  if (!contract || tokens[contract]) return;
  const type = str(v.type);
  tokens[contract] = {
    contract, symbol: str(v.symbol), name: str(v.name), decimals: parseDecimals(v.decimals),
    standard: type === 'ERC-20' ? 'erc20' : type === 'ERC-721' ? 'erc721' : type === 'ERC-1155' ? 'erc1155' : null,
    source: 'explorer',
  };
}

/** Render a Blockscout summary template with its variables (values are untrusted text). */
export function renderSummary(sm: Json): string | null {
  const template = str(get(sm, 'summary_template'));
  const vars = get(sm, 'summary_template_variables');
  if (!template || !isObj(vars)) return null;
  let missing = false;
  const text = template.replace(/\{([a-z_]+)\}/g, (_, name: string) => {
    const v = vars[name];
    const value = get(v, 'value');
    const type = str(get(v, 'type'));
    const rendered = type === 'token' ? str(get(value, 'symbol')) ?? str(get(value, 'name'))
      : type === 'dexTag' ? str(get(value, 'name'))
      : type === 'address' ? str(get(value, 'hash'))
      : typeof value === 'string' || typeof value === 'number' ? String(value) : null;
    if (rendered === null) { missing = true; return '?'; }
    return rendered;
  });
  return missing ? null : text;
}

function stringifyParam(v: Json): string {
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return '[unrepresentable]';
  }
}

export type { Address };

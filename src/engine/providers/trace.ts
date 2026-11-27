/**
 * Call-trace acquisition: `debug_traceTransaction` with the callTracer.
 * Many public RPCs do not offer the debug namespace; each configured endpoint
 * is tried in order and the reason for every skip is recorded.
 */
import type { SourceRecord } from '../../core/types.js';
import { redactUrl, type RpcEndpoint } from '../defaults.js';
import type { Transport } from '../transport.js';
import { parseJson } from './json.js';

export interface TraceFetch {
  status: 'complete' | 'unavailable';
  raw?: unknown;
  provider: string | null;
  sources: SourceRecord[];
  note?: string;
}

const UNSUPPORTED = /not (available|supported|whitelisted|allowed|found)|does not exist|method not found|unsupported|disabled|unknown method|not enabled|-32601/i;

export async function fetchCallTrace(transport: Transport, endpoints: RpcEndpoint[], hash: string, timeoutMs: number, shareable: (url: string) => string = redactUrl): Promise<TraceFetch> {
  const sources: SourceRecord[] = [];
  const reasons: string[] = [];
  let n = 0;
  for (const ep of endpoints) {
    const body = { jsonrpc: '2.0', id: 1, method: 'debug_traceTransaction', params: [hash, { tracer: 'callTracer', tracerConfig: { onlyTopCall: false }, timeout: `${Math.max(1, Math.floor(timeoutMs / 1000))}s` }] };
    const res = await transport.send({ kind: 'rpc', provider: ep.provider, method: 'debug_traceTransaction', url: ep.url, body, timeoutMs });
    const id = `trace:${++n}`;
    let status: SourceRecord['status'] = 'error';
    let note: string | undefined;
    let raw: unknown;
    if (res.failure) note = res.failure;
    else if (!res.ok) note = `HTTP ${res.httpStatus}`;
    else {
      const json = parseJson(res.text) as { result?: unknown; error?: { code?: number; message?: string } } | undefined;
      if (json && typeof json === 'object' && json.error) {
        const msg = `${json.error.code ?? ''} ${String(json.error.message ?? '')}`.trim().slice(0, 160);
        note = UNSUPPORTED.test(msg) ? `method not offered by this endpoint (${msg})` : `RPC error: ${msg}`;
        status = UNSUPPORTED.test(msg) ? 'unavailable' : 'error';
      } else if (json && typeof json === 'object' && json.result && typeof json.result === 'object') {
        status = 'ok'; raw = json.result;
      } else note = 'empty or invalid trace response';
    }
    sources.push({ id, kind: 'rpc', provider: ep.provider, url: shareable(ep.url), method: 'debug_traceTransaction (callTracer)', retrievedAt: res.retrievedAt, status, mode: res.mode, sha256: res.sha256, httpStatus: res.httpStatus, ...(note ? { note } : {}) });
    if (status === 'ok') return { status: 'complete', raw, provider: ep.provider, sources, ...(reasons.length ? { note: `Skipped: ${reasons.join('; ')}` } : {}) };
    reasons.push(`${ep.provider}: ${note}`);
  }
  return { status: 'unavailable', provider: null, sources, note: `No configured RPC endpoint returned a call trace (${reasons.join('; ') || 'none configured'}).` };
}

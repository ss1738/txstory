import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import type { RpcBlockInput, RpcReceiptInput, RpcTxInput } from '../../core/inputs.js';
import { isAddress } from '../../core/hex.js';
import { cleanUntrusted } from '../../core/text.js';
import type { Transport, TransportResponse } from '../transport.js';
import type { RpcEndpoint } from '../defaults.js';
import { arr, get, isObj, parseJson, str, type Json } from './json.js';

export interface RpcCall<T> {
  value: T | null;
  response: TransportResponse;
  /** The endpoint that produced `response`. */
  endpoint: RpcEndpoint;
  /** Endpoints tried before this one, with the reason each was skipped. */
  failedAttempts: string[];
  error?: string;
}

/** A failure that justifies trying another endpoint (transport-level, not a JSON-RPC error). */
const retryable = (r: TransportResponse) => !!r.failure || r.httpStatus === 403 || r.httpStatus === 429 || r.httpStatus >= 500 || r.httpStatus === 0;

export class RpcClient {
  private id = 1;
  constructor(private transport: Transport, private endpoints: RpcEndpoint[]) {
    if (!endpoints.length) throw new Error('RpcClient needs at least one endpoint');
  }

  /**
   * Try endpoints in order. `retryOnNull` additionally moves on when a node
   * returns null (e.g. a lagging node that has not seen the transaction yet).
   */
  async call(method: string, params: unknown[], opts: { retryOnNull?: boolean } = {}): Promise<RpcCall<Json>> {
    const failedAttempts: string[] = [];
    let last: RpcCall<Json> | null = null;
    // A well-formed null answer from a working node beats transport failures elsewhere:
    // it is the most informative outcome (not found / pending) we observed.
    let firstNull: RpcCall<Json> | null = null;
    for (const endpoint of this.endpoints) {
      const one = await this.callOne(endpoint, method, params);
      one.failedAttempts = [...failedAttempts];
      last = one;
      const transportProblem = one.error !== undefined && retryable(one.response);
      const nullProblem = opts.retryOnNull && one.error === undefined && one.value === null;
      if (!transportProblem && !nullProblem) return one;
      if (nullProblem && !firstNull) firstNull = one;
      failedAttempts.push(`${endpoint.provider}: ${one.error ?? 'returned null'}`);
    }
    if (firstNull) {
      firstNull.failedAttempts = failedAttempts.filter((f) => !f.startsWith(`${firstNull!.endpoint.provider}:`));
      return firstNull;
    }
    return last!;
  }

  private async callOne(endpoint: RpcEndpoint, method: string, params: unknown[]): Promise<RpcCall<Json>> {
    const body = { jsonrpc: '2.0', id: this.id++, method, params };
    const response = await this.transport.send({ kind: 'rpc', provider: endpoint.provider, method, url: endpoint.url, body });
    const base = { response, endpoint, failedAttempts: [] as string[] };
    if (response.failure) return { ...base, value: null, error: response.failure };
    if (!response.ok) return { ...base, value: null, error: response.httpStatus === 429 ? 'rate limited (HTTP 429)' : `HTTP ${response.httpStatus}` };
    const json = parseJson(response.text);
    if (!isObj(json)) return { ...base, value: null, error: 'invalid JSON-RPC response' };
    if (json.error !== undefined) {
      const msg = str(get(json, 'error', 'message')) ?? 'unknown error';
      return { ...base, value: null, error: `RPC error: ${cleanUntrusted(msg, 160)?.text ?? 'unknown'}` };
    }
    return { ...base, value: json.result ?? null };
  }
}

const HEXQ = /^0x[0-9a-fA-F]*$/;
const hexq = (v: Json): string | null => (typeof v === 'string' && HEXQ.test(v) ? v : null);

export function parseTx(v: Json): RpcTxInput | null {
  if (!isObj(v)) return null;
  const hash = hexq(v.hash); const from = str(v.from); const value = hexq(v.value); const nonce = hexq(v.nonce);
  if (!hash || !from || !isAddress(from) || !value || !nonce) return null;
  const to = str(v.to);
  return {
    hash, from, to: to && isAddress(to) ? to : null, value, nonce,
    input: hexq(v.input) ?? '0x', type: hexq(v.type) ?? '0x0',
    blockNumber: hexq(v.blockNumber), blockHash: hexq(v.blockHash),
  };
}

export function parseReceipt(v: Json): RpcReceiptInput | null {
  if (!isObj(v)) return null;
  const gasUsed = hexq(v.gasUsed);
  if (!gasUsed) return null;
  const logs = arr(v.logs).flatMap((l) => {
    if (!isObj(l)) return [];
    const address = str(l.address); const data = hexq(l.data); const logIndex = hexq(l.logIndex);
    const topics = arr(l.topics).map(hexq).filter((t): t is string => !!t);
    if (!address || !isAddress(address) || data === null || !logIndex) return [];
    return [{ address, topics, data, logIndex, removed: l.removed === true }];
  });
  return {
    status: hexq(v.status) ?? undefined,
    gasUsed,
    effectiveGasPrice: hexq(v.effectiveGasPrice) ?? undefined,
    logs,
    contractAddress: str(v.contractAddress),
    l1Fee: hexq(v.l1Fee),
    blobGasUsed: hexq(v.blobGasUsed),
    blobGasPrice: hexq(v.blobGasPrice),
    operatorFeeScalar: hexq(v.operatorFeeScalar),
    operatorFeeConstant: hexq(v.operatorFeeConstant),
  };
}

export function parseBlock(v: Json): RpcBlockInput | null {
  if (!isObj(v)) return null;
  const number = hexq(v.number); const hash = hexq(v.hash); const timestamp = hexq(v.timestamp);
  if (!number || !hash || !timestamp) return null;
  return { number, hash, timestamp, baseFeePerGas: hexq(v.baseFeePerGas), miner: str(v.miner) };
}

/** Decode an ABI-encoded `string` return value, or a bytes32 fallback (older tokens). */
export function decodeAbiString(hex: string): string | null {
  const clean = hex.replace(/^0x/, '');
  if (!clean || clean.length % 64 !== 0) return null;
  if (!/^[0-9a-fA-F]*$/.test(clean)) return null;
  const buf = hexToBytes(clean);
  const utf8 = (b: Uint8Array) => new TextDecoder('utf-8').decode(b);
  if (buf.length === 32) {
    const nul = buf.indexOf(0);
    return utf8(buf.subarray(0, nul === -1 ? 32 : nul)) || null;
  }
  if (buf.length < 64) return null;
  const offset = Number(BigInt('0x' + bytesToHex(buf.subarray(0, 32))));
  if (!Number.isSafeInteger(offset) || offset + 32 > buf.length) return null;
  const len = Number(BigInt('0x' + bytesToHex(buf.subarray(offset, offset + 32))));
  if (!Number.isSafeInteger(len) || len > 1024 || offset + 32 + len > buf.length) return null;
  return utf8(buf.subarray(offset + 32, offset + 32 + len));
}

export function decodeUint8(hex: string): number | null {
  const clean = hex.replace(/^0x/, '');
  if (clean.length !== 64) return null;
  const n = BigInt('0x' + clean);
  return n <= 255n ? Number(n) : null;
}

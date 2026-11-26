/**
 * ABI decoding vs Blockscout's own decodings in CAPTURED mainnet recordings
 * (decoded_input of each transaction; each log's verified ABI item and
 * decoded parameters). Opt-in: npm run test:captured.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AbiLibrary, decodeCalldata, decodeEventLog, type AbiValue } from '../../src/core/abi.js';
import { capturedDir } from './dir.js';

const DIR = capturedDir();
const values = (params: Array<{ value: AbiValue }> | undefined) => (params ?? []).map((p) => p.value);

// ---------------------------------------------------------------- Blockscout cross-check
type BsParam = { name: string; type: string; value: unknown; indexed?: boolean };
/** Blockscout shows tuples as arrays and numbers as strings; normalise both sides to compare. */
function norm(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === 'object') return Object.values(v as Record<string, unknown>).map(norm);
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return v.toLowerCase();
  return v;
}
const fixtures = readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8')) as {
  hash: string; exchanges: Record<string, { kind: string; method: string; httpStatus: number; text: string }>;
});
const explorerJson = (fx: (typeof fixtures)[number], suffix: string) => {
  const e = Object.values(fx.exchanges).find((x) => x.kind === 'explorer' && x.httpStatus === 200 && x.method === `GET /api/v2/transactions/${fx.hash}${suffix}`);
  return e ? JSON.parse(e.text) : null;
};
const rpcJson = (fx: (typeof fixtures)[number], method: string) => {
  const e = Object.values(fx.exchanges).find((x) => x.kind === 'rpc' && x.method === method && x.httpStatus === 200);
  return e ? JSON.parse(e.text).result : null;
};

describe('ABI decoding vs Blockscout decodings in recorded fixtures', () => {
  let callsChecked = 0; let logsChecked = 0;
  for (const fx of fixtures) {
    const tx = explorerJson(fx, '');
    const rpcTx = rpcJson(fx, 'eth_getTransactionByHash');
    if (tx?.decoded_input && rpcTx?.input) {
      it(`calldata of ${fx.hash.slice(0, 10)}: ${String(tx.decoded_input.method_call).slice(0, 60)}`, () => {
        const di = tx.decoded_input as { method_call: string; method_id: string; parameters: BsParam[] };
        const name = di.method_call.slice(0, di.method_call.indexOf('('));
        const lib = new AbiLibrary();
        lib.addJson([`function ${name}(${di.parameters.map((p) => `${p.type} ${p.name}`).join(', ')})`], 'user', 'from Blockscout types');
        const r = decodeCalldata(rpcTx.input, lib);
        expect(r.id).toBe(di.method_id.startsWith('0x') ? di.method_id : `0x${di.method_id}`);
        expect(r.status).toBe('decoded');
        expect(values(r.candidates[0]!.params).map(norm)).toEqual(di.parameters.map((p) => norm(p.value)));
        callsChecked++;
      });
    }
    const logs = explorerJson(fx, '/logs');
    const receipt = rpcJson(fx, 'eth_getTransactionReceipt');
    const decodedLogs = ((logs?.items ?? []) as Array<{ index: number; decoded: { abi?: Record<string, unknown>; parameters: BsParam[] } | null }>).filter((l) => l.decoded?.abi).slice(0, 40);
    if (decodedLogs.length && receipt) {
      it(`${decodedLogs.length} explorer-decoded logs of ${fx.hash.slice(0, 10)}`, () => {
        for (const l of decodedLogs) {
          const raw = (receipt.logs as Array<{ logIndex: string; topics: string[]; data: string }>).find((x) => Number(x.logIndex) === l.index)!;
          const lib = new AbiLibrary();
          lib.addJson([l.decoded!.abi], 'user', 'Blockscout verified ABI item');
          const r = decodeEventLog(raw, lib);
          expect(r.status, `log ${l.index}`).toBe('decoded');
          expect(values(r.candidates[0]!.params).map(norm), `log ${l.index}`).toEqual(l.decoded!.parameters.map((p) => norm(p.value)));
          logsChecked++;
        }
      });
    }
  }
  it('covered a meaningful number of real calls and logs', () => {
    expect(callsChecked).toBeGreaterThanOrEqual(8);
    expect(logsChecked).toBeGreaterThanOrEqual(50);
  });
});

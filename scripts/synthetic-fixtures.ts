/**
 * Generate fixtures/synthetic/*.json: SYNTHETIC recordings (origin "synthetic").
 *
 *   npx tsx scripts/synthetic-fixtures.ts
 *
 * A fake provider answers JSON-RPC and Blockscout-style requests ONLY from the
 * case definitions in tests/synthetic/cases.ts. The normal recorder captures
 * the requests TxStory makes and the fake answers, so replay works exactly
 * like replay of a captured recording. Nothing here contacts a network or
 * contains data captured from a real provider. Output is deterministic.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { keccakHex } from '../src/core/hex.js';
import { engineConfigFromEnv, type EngineConfig } from '../src/engine/config.js';
import { recordAnalysis, writeRecording } from '../src/engine/recording.js';
import type { Transport, TransportRequest, TransportResponse } from '../src/engine/transport.js';
import { allCases, hexQ, word, type SyntheticCase } from '../tests/synthetic/cases.js';

const OUT = 'fixtures/synthetic';
const RETRIEVED_AT = '2026-11-26T00:00:00.000Z';
const RECORDER = 'scripts/synthetic-fixtures.ts (synthetic data, not captured from any provider)';

const respond = (httpStatus: number, body: unknown): TransportResponse => {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return { ok: httpStatus >= 200 && httpStatus < 300, httpStatus, text, sha256: createHash('sha256').update(text).digest('hex'), retrievedAt: RETRIEVED_AT, mode: 'live' };
};
const rpcResult = (id: unknown, result: unknown) => respond(200, { jsonrpc: '2.0', id, result });
const rpcError = (id: unknown, code: number, message: string) => respond(200, { jsonrpc: '2.0', id, error: { code, message } });

/** ABI-encode a string return value (offset, length, padded bytes). */
function abiString(s: string): string {
  const bytes = Buffer.from(s, 'utf8');
  const padded = bytes.toString('hex').padEnd(Math.ceil(bytes.length / 32) * 64, '0');
  return '0x' + word(32n) + word(BigInt(bytes.length)) + padded;
}

export class SyntheticProvider implements Transport {
  constructor(private c: SyntheticCase) {}

  async send(req: TransportRequest): Promise<TransportResponse> {
    return req.kind === 'rpc' ? this.rpc(req.body as { id: unknown; method: string; params: unknown[] }) : this.explorer(new URL(req.url));
  }

  private rpc(body: { id: unknown; method: string; params: unknown[] }): TransportResponse {
    const { id, method, params } = body;
    const c = this.c;
    const blockHash = c.block ? keccakHex(`synthetic-block:${c.network}:${c.block.number}`) : null;
    const ours = typeof params[0] === 'string' && params[0].toLowerCase() === c.hash;
    switch (method) {
      case 'eth_getTransactionByHash':
        return rpcResult(id, ours ? {
          hash: c.hash, from: c.tx.from, to: c.tx.to, value: hexQ(c.tx.value), input: c.tx.input, nonce: hexQ(c.tx.nonce), type: hexQ(c.tx.type),
          gas: hexQ(c.receipt?.gasUsed ?? 21_000n), blockNumber: c.block ? hexQ(c.block.number) : null, blockHash, transactionIndex: c.block ? '0x0' : null,
        } : null);
      case 'eth_getTransactionReceipt': {
        if (!ours || !c.block || !c.receipt) return rpcResult(id, null);
        const r = c.receipt;
        return rpcResult(id, {
          transactionHash: c.hash, blockNumber: hexQ(c.block.number), blockHash, from: c.tx.from, to: c.tx.to, status: hexQ(r.status),
          gasUsed: hexQ(r.gasUsed), effectiveGasPrice: hexQ(r.effectiveGasPrice), contractAddress: r.contractAddress ?? null,
          logs: r.logs.map((l, i) => ({ ...l, logIndex: hexQ(i), transactionHash: c.hash, blockNumber: hexQ(c.block!.number), removed: false })),
          ...(r.l1Fee !== undefined ? { l1Fee: hexQ(r.l1Fee) } : {}),
        });
      }
      case 'eth_getBlockByNumber':
        if (!c.block || params[0] !== hexQ(c.block.number)) return rpcResult(id, null);
        return rpcResult(id, { number: hexQ(c.block.number), hash: blockHash, timestamp: hexQ(c.block.timestamp), miner: c.block.miner, ...(c.block.baseFee !== null ? { baseFeePerGas: hexQ(c.block.baseFee) } : {}) });
      case 'eth_call': {
        const call = params[0] as { to: string; data: string };
        const meta = c.tokens?.[call.to.toLowerCase()];
        if (!meta) return rpcError(id, -32000, 'execution reverted');
        if (call.data === '0x95d89b41') return rpcResult(id, abiString(meta.symbol));
        if (call.data === '0x06fdde03') return rpcResult(id, abiString(meta.name));
        if (call.data === '0x313ce567' && meta.decimals !== null) return rpcResult(id, '0x' + word(BigInt(meta.decimals)));
        return rpcError(id, -32000, 'execution reverted');
      }
      case 'eth_getCode':
        return rpcResult(id, c.contracts?.includes(String(params[0]).toLowerCase()) ? '0x6080604052' : '0x');
      default:
        return rpcError(id, -32601, `the method ${method} does not exist/is not available`);
    }
  }

  private explorer(url: URL): TransportResponse {
    const c = this.c; const e = c.explorer;
    const m = /\/api\/v2\/transactions\/(0x[0-9a-f]{64})(?:\/([a-z-]+))?$/.exec(url.pathname);
    if (!m || m[1] !== c.hash) return respond(404, { message: 'Not found' });
    if (e.kind === 'status') return respond(e.httpStatus, e.httpStatus === 403 ? '<html>Forbidden</html>' : { message: 'Not found' });
    const page = (items: unknown[], size = items.length || 1) => {
      const start = Number(url.searchParams.get('index') ?? 0);
      const slice = items.slice(start, start + size);
      const next = start + size < items.length ? { block_number: Number(c.block?.number ?? 0), index: start + size } : null;
      return respond(200, { items: slice, next_page_params: next });
    };
    switch (m[2]) {
      case undefined: return respond(200, e.tx);
      case 'summary': return e.summaries ? respond(200, { data: { summaries: e.summaries } }) : respond(404, { message: 'Not found' });
      case 'internal-transactions':
        if (e.internalFailure) return { ...respond(0, ''), ok: false, failure: e.internalFailure };
        return page(e.internal ?? []);
      case 'state-changes': return page(e.stateChanges);
      case 'token-transfers': return page(e.transfers, e.transfersPageSize);
      case 'logs': return page(Object.entries(e.logNames ?? {}).map(([index, call]) => ({ index: Number(index), decoded: { method_call: call } })));
      default: return respond(404, { message: 'Not found' });
    }
  }
}

/** Engine configuration whose endpoints are clearly synthetic. */
export function syntheticConfig(): EngineConfig {
  const base = engineConfigFromEnv({});
  const endpoints = { ...base.endpoints };
  for (const network of ['ethereum', 'optimism', 'base', 'arbitrum']) {
    endpoints[network] = { rpcs: [{ url: `https://rpc.synthetic.invalid/${network}`, provider: 'Synthetic RPC (not a real provider)' }], explorerApi: `https://explorer.synthetic.invalid/${network}`, explorerProvider: 'Blockscout' };
  }
  return { ...base, endpoints, trace: 'auto' };
}

if (process.argv[1]?.endsWith('synthetic-fixtures.ts')) {
  const vectors = JSON.parse(readFileSync('tests/vectors/abi-cast.json', 'utf8'));
  mkdirSync(OUT, { recursive: true });
  for (const c of allCases(vectors)) {
    const { result, recording } = await recordAnalysis(c.network, c.hash, new SyntheticProvider(c), syntheticConfig(), {
      description: c.description, origin: 'synthetic', recorder: RECORDER,
    });
    recording.recordedAt = RETRIEVED_AT;
    await writeRecording(`${OUT}/${c.network}-${c.hash}.json`, recording);
    console.log(`${c.id.padEnd(24)} ${c.network.padEnd(9)} ${result.kind}`);
  }
}

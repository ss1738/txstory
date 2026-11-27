import { buildStory, BuildError } from '../core/build.js';
import { getChain, isChainKey, type ChainInfo, type ChainKey } from '../core/chains.js';
import { decodeLog, decodeTransferBatch, TOPICS } from '../core/events.js';
import { normalizeAddress, type Address } from '../core/hex.js';
import type { BuildInput, ExplorerInput, TokenMetaInput } from '../core/inputs.js';
import type { SourceRecord, Story } from '../core/types.js';
import { secretFragments, shareableUrlMapper, type EngineConfig, type TraceMode } from './defaults.js';
import { fetchCallTrace, type TraceFetch } from './providers/trace.js';
import { BlockscoutClient } from './providers/blockscout.js';
import { decodeAbiString, decodeUint8, parseBlock, parseReceipt, parseTx, RpcClient, type RpcCall } from './providers/rpc.js';
import { scrubbingTransport, type Transport } from './transport.js';

export type StoryResult =
  | { kind: 'ok'; story: Story }
  | { kind: 'not-found' | 'pending' | 'rpc-unavailable' | 'unsupported'; message: string; sources: SourceRecord[] };

const SELECTOR = { symbol: '0x95d89b41', name: '0x06fdde03', decimals: '0x313ce567' } as const;

export interface AssembleOptions {
  /** Fast stage: RPC only (no explorer, no trace). Full stage adds both. */
  stage?: 'fast' | 'full';
  /** Extra ABIs to decode calldata, logs, trace frames and revert data (provenance "user"). */
  userAbi?: BuildInput['userAbi'];
  /** Override config.trace for this analysis. */
  trace?: TraceMode;
  /**
   * The network definition to analyse with. Replay passes the recording's own
   * validated definition; otherwise the registered definition for `chain` is used.
   */
  network?: ChainInfo;
}

export async function assembleStory(chain: ChainKey, hash: string, transport: Transport, config: EngineConfig, opts: AssembleOptions = {}): Promise<StoryResult> {
  const stage = opts.stage ?? 'full';
  const network = opts.network ?? (isChainKey(chain) ? getChain(chain) : null);
  if (!network) return { kind: 'unsupported', message: `Unknown network "${chain}".`, sources: [] };
  if (network.key !== chain) return { kind: 'unsupported', message: `The network definition "${network.key}" does not match "${chain}".`, sources: [] };
  const ep = config.endpoints[chain];
  if (!ep) return { kind: 'unsupported', message: `No endpoints are configured for network "${chain}".`, sources: [] };
  // Provider error text can echo a credential: remove known fragments before anything reads it.
  transport = scrubbingTransport(transport, secretFragments(ep, config.explorerApiKey));
  const shareable = shareableUrlMapper(ep);
  const rpc = new RpcClient(transport, ep.rpcs);
  const sources: SourceRecord[] = [];
  let n = 0;
  const record = (label: string, call: RpcCall<unknown>, empty: boolean): string => {
    const id = `rpc:${++n}:${label}`;
    const r = call.response;
    const notes = [...(call.failedAttempts.length ? [`fell back after: ${call.failedAttempts.join('; ')}`] : []), ...(call.error ? [call.error] : [])];
    sources.push({
      id, kind: 'rpc', provider: call.endpoint.provider, url: shareable(call.endpoint.url), method: label, retrievedAt: r.retrievedAt,
      status: call.error ? 'error' : empty ? 'empty' : 'ok', mode: r.mode, sha256: r.sha256, httpStatus: r.httpStatus,
      ...(notes.length ? { note: notes.join(' · ') } : {}),
    });
    return id;
  };

  const [txCall, rcCall] = await Promise.all([
    rpc.call('eth_getTransactionByHash', [hash], { retryOnNull: true }),
    rpc.call('eth_getTransactionReceipt', [hash], { retryOnNull: true }),
  ]);
  const txId = record('eth_getTransactionByHash', txCall, txCall.value === null);
  const rcId = record('eth_getTransactionReceipt', rcCall, rcCall.value === null);

  if (txCall.error || rcCall.error) {
    return { kind: 'rpc-unavailable', message: `The ${network.name} RPC endpoint did not answer (${txCall.error ?? rcCall.error}). Try again shortly.`, sources };
  }
  const tx = parseTx(txCall.value);
  // A null from one node is reported, but not as conclusive while other configured nodes could not answer.
  const unanswered = (call: RpcCall<unknown>) => (call.unanswered.length
    ? ` Not conclusive: ${call.unanswered.length} other configured endpoint(s) could not answer (${call.unanswered.join('; ')}).`
    : '');
  if (!tx) {
    if (txCall.value === null) return { kind: 'not-found', message: `No transaction with this hash was found on ${network.name} by ${txCall.endpoint.provider}. It may be on another network, not yet propagated, or dropped.${unanswered(txCall)}`, sources };
    return { kind: 'rpc-unavailable', message: 'The RPC returned a transaction object TxStory could not parse.', sources };
  }
  const receipt = parseReceipt(rcCall.value);
  if (!receipt || !tx.blockNumber) {
    return { kind: 'pending', message: `The transaction is known to the RPC node but has no receipt yet (pending or not yet included). Story generation needs a mined transaction.${rcCall.value === null ? unanswered(rcCall) : ''}`, sources };
  }

  // Fast stage is RPC-only so the first render never waits on the explorer.
  const explorerPromise: Promise<{ explorer: ExplorerInput | null; tokens: Record<string, TokenMetaInput>; sources: SourceRecord[] }> = ep.explorerApi && stage === 'full'
    ? new BlockscoutClient(transport, ep.explorerApi, config.explorerApiKey, config.maxExplorerPages, config.slowExplorerTimeoutMs, shareable).fetchAll(hash)
    : Promise.resolve({ explorer: null, tokens: {}, sources: [] });
  const traceMode = opts.trace ?? config.trace;
  const tracePromise: Promise<TraceFetch | null> = stage === 'full' && traceMode === 'auto'
    ? fetchCallTrace(transport, ep.rpcs, hash, config.slowExplorerTimeoutMs, shareable)
    : Promise.resolve(null);
  const [blockCall, ex, traceFetch] = await Promise.all([rpc.call('eth_getBlockByNumber', [tx.blockNumber, false]), explorerPromise, tracePromise]);
  const blockId = record('eth_getBlockByNumber', blockCall, blockCall.value === null);
  const block = parseBlock(blockCall.value);
  if (!block) {
    return { kind: 'rpc-unavailable', message: `Could not load the block containing this transaction (${blockCall.error ?? 'unparseable block'}).`, sources: [...sources, ...ex.sources] };
  }

  // ---- token metadata fallback via eth_call ------------------------------
  const tokens: Record<string, TokenMetaInput> = { ...ex.tokens };
  const tokenContracts = new Map<Address, 'erc20' | 'erc721' | 'erc1155'>();
  for (const l of receipt.logs) {
    const log = { address: l.address, topics: l.topics, data: l.data, logIndex: 0 };
    if (l.topics[0]?.toLowerCase() === TOPICS.TransferBatch) {
      const b = decodeTransferBatch(log);
      if (Array.isArray(b)) tokenContracts.set(l.address.toLowerCase() as Address, 'erc1155');
      continue;
    }
    const e = decodeLog(log).event;
    if (!e) continue;
    if (e.kind === 'transfer' || e.kind === 'approval') tokenContracts.set(e.contract, e.standard);
    if (e.kind === 'wrap-deposit' || e.kind === 'wrap-withdrawal') tokenContracts.set(e.contract, 'erc20');
  }
  const missing = [...tokenContracts.entries()].filter(([c, std]) => !tokens[c] || (std === 'erc20' && tokens[c]!.decimals === null));
  const toQuery = missing.slice(0, config.maxTokenMetadataCalls);
  await mapLimit(toQuery, 4, async ([contract, std]) => {
    const calls = std === 'erc20' ? (['symbol', 'name', 'decimals'] as const) : (['symbol', 'name'] as const);
    const results: Partial<Record<'symbol' | 'name' | 'decimals', string | number | null>> = {};
    await Promise.all(calls.map(async (fn) => {
      const c = await rpc.call('eth_call', [{ to: contract, data: SELECTOR[fn] }, block.number]);
      record(`eth_call ${fn}() @ ${contract}`, c, c.value === null);
      const hex = typeof c.value === 'string' ? c.value : null;
      results[fn] = hex ? (fn === 'decimals' ? decodeUint8(hex) : decodeAbiString(hex)) : null;
    }));
    const prev = tokens[contract];
    tokens[contract] = {
      contract,
      symbol: prev?.symbol ?? (results.symbol as string | null) ?? null,
      name: prev?.name ?? (results.name as string | null) ?? null,
      decimals: prev?.decimals ?? (typeof results.decimals === 'number' ? results.decimals : null),
      standard: std,
      source: prev ? prev.source : 'rpc-call',
    };
  });
  const lackingDecimals = [...tokenContracts.entries()].filter(([c, std]) => !tokens[c] || (std === 'erc20' && tokens[c]!.decimals === null));
  const tokenMetadataStatus: BuildInput['tokenMetadataStatus'] = tokenContracts.size === 0 ? 'complete'
    : lackingDecimals.length === 0 ? 'complete' : lackingDecimals.length === tokenContracts.size ? 'unavailable' : 'partial';

  // ---- contract-ness via eth_getCode when the explorer gave nothing -------
  const codeAt: Record<string, boolean> = {};
  if (!ex.explorer?.available && stage === 'full') {
    const candidates = new Set<Address>();
    const add = (a: string | null | undefined) => { const n2 = a ? normalizeAddress(a) : null; if (n2) candidates.add(n2); };
    add(tx.to); add(receipt.contractAddress);
    for (const l of receipt.logs) {
      const e = decodeLog({ address: l.address, topics: l.topics, data: l.data, logIndex: 0 }).event;
      if (e?.kind === 'transfer') { add(e.from); add(e.to); }
    }
    await mapLimit([...candidates].slice(0, 16), 8, async (address) => {
      const c = await rpc.call('eth_getCode', [address, block.number]);
      record(`eth_getCode @ ${address}`, c, c.value === null);
      if (typeof c.value === 'string') codeAt[address] = c.value !== '0x' && c.value !== '0x0';
    });
  }

  // Token-metadata and getCode calls run concurrently, so their completion order
  // varies between runs. Sort them by request and renumber, so the same evidence
  // always yields the same story. (Only tx/receipt/block ids are referenced.)
  const referenced = new Set([txId, rcId, blockId]);
  const fixed = sources.filter((x) => referenced.has(x.id));
  const concurrent = sources.filter((x) => !referenced.has(x.id)).sort((a, b) => a.method.localeCompare(b.method));
  concurrent.forEach((x, i) => { x.id = `rpc:${fixed.length + i + 1}:${x.method}`; });
  const allSources = [...fixed, ...concurrent, ...ex.sources, ...(traceFetch?.sources ?? [])];
  const modes = new Set(allSources.map((s) => s.mode));
  const input: BuildInput = {
    chain, network, hash,
    rpc: { tx, receipt, block, sourceIds: { tx: txId, receipt: rcId, block: blockId } },
    tokens, tokenMetadataStatus, codeAt, explorer: ex.explorer,
    sources: allSources,
    generatedAt: new Date().toISOString(),
    mode: modes.size > 1 ? 'mixed' : ([...modes][0] ?? 'live'),
    stage,
    trace: traceFetch
      ? { status: traceFetch.status, raw: traceFetch.raw, provider: traceFetch.provider, sourceIds: traceFetch.sources.filter((x) => x.status === 'ok').map((x) => x.id), ...(traceFetch.note ? { note: traceFetch.note } : {}) }
      : { status: 'not-requested', provider: null, sourceIds: [], note: stage === 'fast' ? 'Traces are requested in the full stage.' : 'Trace requests are switched off for this analysis.' },
    ...(opts.userAbi ? { userAbi: opts.userAbi } : {}),
  };
  if (missing.length > toQuery.length) {
    // Recorded as a source note so the UI can explain partial metadata.
    allSources.push({ id: 'note:token-metadata-limit', kind: 'rpc', provider: 'TxStory', url: 'about:token-metadata-limit', method: 'token metadata', retrievedAt: input.generatedAt, status: 'partial', mode: 'live', note: `Token metadata lookups capped at ${config.maxTokenMetadataCalls}; ${missing.length - toQuery.length} token(s) shown without metadata.` });
  }
  try {
    return { kind: 'ok', story: buildStory(input) };
  } catch (err) {
    if (err instanceof BuildError) return { kind: 'unsupported', message: err.message, sources: allSources };
    throw err;
  }
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++]!;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

/** Public name for the engine's analysis entry point (same function). */
export const analyzeTransaction = assembleStory;

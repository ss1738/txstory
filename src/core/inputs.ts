import type { AbiLibrary } from './abi.js';
/**
 * Provider-normalized inputs to the story builder. Server provider adapters are
 * responsible for converting raw JSON into these shapes, defensively.
 */
import type { Address } from './hex.js';
import type { ChainKey, ChainInfo } from './chains.js';
import type { DataMode, SourceRecord } from './types.js';

export interface RpcLogInput {
  address: string;
  topics: string[];
  data: string;
  logIndex: string; // hex quantity
  removed?: boolean;
}

export interface RpcTxInput {
  hash: string;
  from: string;
  to: string | null;
  value: string;
  input: string;
  nonce: string;
  type?: string;
  blockNumber: string | null;
  blockHash: string | null;
}

export interface RpcReceiptInput {
  status?: string;
  gasUsed: string;
  effectiveGasPrice?: string;
  logs: RpcLogInput[];
  contractAddress?: string | null;
  l1Fee?: string | null;
  blobGasUsed?: string | null;
  blobGasPrice?: string | null;
  operatorFeeScalar?: string | null;
  operatorFeeConstant?: string | null;
}

export interface RpcBlockInput {
  number: string;
  hash: string;
  timestamp: string;
  baseFeePerGas?: string | null;
  miner?: string | null;
}

export interface TokenMetaInput {
  contract: Address;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  standard: 'erc20' | 'erc721' | 'erc1155' | null;
  source: 'explorer' | 'rpc-call';
}

export interface ExplorerAddressInput {
  address: Address;
  name: string | null;
  ens: string | null;
  isContract: boolean | null;
  isVerified: boolean | null;
  tags: string[];
  flags: string[];
}

export interface ExplorerInternalInput {
  index: number;
  type: string;
  from: Address;
  to: Address | null;
  createdContract: Address | null;
  value: string;
  success: boolean;
}

export type ExplorerStateChangeValue =
  | { kind: 'amount'; delta: string }
  | { kind: 'nft'; tokenIdsIn: string[]; tokenIdsOut: string[] }
  | { kind: 'unknown' };

export interface ExplorerStateChangeInput {
  address: Address;
  isCoin: boolean;
  token: Address | null;
  tokenType: string | null;
  tokenId: string | null;
  isMiner: boolean;
  change: ExplorerStateChangeValue;
}

export interface ExplorerSection<T> {
  status: 'complete' | 'partial' | 'unavailable';
  items: T[];
  sourceIds: string[];
  note?: string;
}

export interface ExplorerInput {
  available: boolean;
  reason?: string;
  txSourceId: string | null;
  method: string | null;
  decodedInput: { call: string; parameters: Array<{ name: string; type: string; value: string }> } | null;
  revertReason: string | null;
  addresses: Record<string, ExplorerAddressInput>;
  internal: ExplorerSection<ExplorerInternalInput>;
  stateChanges: ExplorerSection<ExplorerStateChangeInput>;
  tokenTransfers: ExplorerSection<{ logIndex: number | null; contract: Address | null }>;
  /** Explorer-decoded event names keyed by log index (explorer provenance). */
  logNames: Record<number, string>;
  /** The explorer's own human-readable summaries, already rendered from its templates. */
  summaries: string[];
  summarySourceId: string | null;
}

export interface BuildInput {
  chain: ChainKey;
  /** The network this analysis is for. Passed explicitly so concurrent analyses never share a definition. */
  network: ChainInfo;
  hash: string;
  rpc: {
    tx: RpcTxInput;
    receipt: RpcReceiptInput;
    block: RpcBlockInput;
    sourceIds: { tx: string; receipt: string; block: string };
  };
  tokens: Record<string, TokenMetaInput>;
  tokenMetadataStatus: 'complete' | 'partial' | 'unavailable';
  /** Contract-ness from eth_getCode for addresses the explorer did not describe. */
  codeAt: Record<string, boolean>;
  explorer: ExplorerInput | null;
  sources: SourceRecord[];
  generatedAt: string;
  mode: DataMode | 'mixed';
  stage: 'fast' | 'full';
  /** Call trace (full stage, when requested). */
  trace?: TraceInput;
  /** Extra ABIs supplied by the caller (provenance "user"). */
  userAbi?: { library: AbiLibrary; labels: Array<{ label: string; entries: number }> };
}

export interface TraceInput {
  status: 'complete' | 'unavailable' | 'not-requested';
  /** Raw callTracer JSON (untrusted; validated by core/trace.ts). */
  raw?: unknown;
  provider: string | null;
  sourceIds: string[];
  note?: string;
}

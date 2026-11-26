/**
 * The Story data model. Every user-facing fact carries its provenance so the UI
 * can distinguish chain observations, explorer interpretations, values derived
 * deterministically by TxStory, and heuristic interpretations.
 */
import type { Address, Hex } from './hex.js';
import type { ChainKey, NetworkDescriptor } from './chains.js';
import type { AbiSource, Candidate, DecodeStatus } from './abi.js';
import type { CallFrame, FrameType } from './trace.js';

/**
 * 2: cross-check rows carry a comparison `scope` and ERC-721 token-id sets;
 *    an ERC-721 "match" now requires identical token ids, not just equal counts.
 */
export const STORY_SCHEMA_VERSION = 3;

/*
 * Story schema history (see docs/formats.md):
 *  3: `network` descriptor (custom networks), optional `trace` (call tree from
 *     debug_traceTransaction), optional `revert` (decoded revert data), optional
 *     `abiDecoding` (user/known ABI decoding with candidates), `completeness.trace`.
 *  2: cross-check `scope` and ERC-721 token-id sets.
 */

/**
 * chain:     reported by a JSON-RPC node (we trust the node; nothing is cryptographically verified)
 * explorer:  reported or interpreted by a block explorer (Blockscout)
 * derived:   computed deterministically by TxStory from chain-reported data
 * heuristic: a pattern-based interpretation that may be wrong
 */
export type Provenance = 'chain' | 'explorer' | 'derived' | 'heuristic';

/**
 * Where the provider responses behind a source came from:
 * live (fetched now), recorded (replayed from a recording of real responses),
 * synthetic (replayed from responses written by hand or by a generator; not real provider data).
 */
export type DataMode = 'live' | 'recorded' | 'synthetic';

export interface SourceRecord {
  id: string;
  kind: 'rpc' | 'explorer';
  provider: string;
  /** Request target with any credentials removed. */
  url: string;
  method: string;
  retrievedAt: string;
  status: 'ok' | 'empty' | 'error' | 'unavailable' | 'partial';
  mode: DataMode;
  sha256?: string;
  httpStatus?: number;
  note?: string;
}

export type AssetKind = 'native' | 'erc20' | 'erc721' | 'erc1155';

export interface Asset {
  key: string; // 'native' | '<contract>' | '<contract>#<tokenId>' for 1155
  kind: AssetKind;
  contract: Address | null;
  tokenId: string | null;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  metadataSource: 'chain-config' | 'explorer' | 'rpc-call' | 'none';
  /** Display strings were altered by sanitisation (possible spoofing attempt). */
  metadataAltered?: boolean;
}

export type MovementKind =
  | 'token-transfer'
  | 'wrap-mint'
  | 'unwrap-burn'
  | 'native-call-value'
  | 'native-internal'
  | 'fee-burn'
  | 'fee-tip'
  | 'fee-execution'
  | 'fee-l1-data'
  | 'fee-blob';

export interface Movement {
  id: string;
  kind: MovementKind;
  /** Position used for replay. Token events by logIndex; see orderNote. */
  sequence: number;
  /** null means the asset leaves circulation or a fee sink not itemised. */
  from: Address | null;
  to: Address | null;
  assetKey: string;
  /** Exact integer amount in base units (ERC-721: "1"). */
  amount: string;
  tokenId?: string;
  logIndex?: number;
  provenance: Provenance;
  sourceIds: string[];
  label: string;
  note?: string;
}

export interface BalanceChange {
  address: Address;
  assetKey: string;
  /** Signed exact integer delta in base units. */
  delta: string;
  /** ERC-721 token ids gained (+) or lost (-). */
  tokenIdsIn?: string[];
  tokenIdsOut?: string[];
  movementIds: string[];
  /** True if any component came from the explorer rather than chain-derived data. */
  usesExplorerData: boolean;
}

export type CrossCheckStatus = 'match' | 'mismatch' | 'only-txstory' | 'only-explorer' | 'not-comparable';

/** What a cross-check row actually compared. */
export type CrossCheckScope = 'amount' | 'token-ids' | 'count' | 'none';

export interface CrossCheckRow {
  address: Address;
  assetKey: string;
  /** Signed net delta (for ERC-721: net count). */
  txstory: string | null;
  explorer: string | null;
  status: CrossCheckStatus;
  scope: CrossCheckScope;
  /** ERC-721 net token ids (sorted, de-duplicated, pass-throughs cancelled). */
  txstoryTokenIds?: { in: string[]; out: string[] };
  explorerTokenIds?: { in: string[]; out: string[] };
  note?: string;
}

export interface CrossCheck {
  available: boolean;
  reason?: string;
  complete: boolean;
  rows: CrossCheckRow[];
  summary: { match: number; mismatch: number; onlyTxStory: number; onlyExplorer: number; notComparable: number };
}

export interface LogEntry {
  logIndex: number;
  contract: Address;
  topic0: string | null;
  label: string | null;
  /** Explorer-decoded name, when available (explorer provenance). */
  explorerName?: string | null;
  decoded: boolean;
  problem?: string;
  summary?: string;
  raw: { topics: string[]; data: string };
}

export interface Participant {
  address: Address;
  roles: string[];
  /** Explorer-provided labels; NOT verified identity. */
  labels: Array<{ text: string; source: 'explorer'; altered?: boolean }>;
  ens: string | null;
  isContract: boolean | null;
  isContractSource: 'explorer' | 'rpc' | 'unknown';
  explorerFlags: string[];
}

export interface Interpretation {
  id: string;
  kind: 'protocol' | 'explorer-summary' | 'failed' | 'native-transfer' | 'contract-creation' | 'wrap' | 'unwrap' | 'swap' | 'mint' | 'burn' | 'nft-transfer' | 'approval' | 'fee-on-transfer' | 'generic';
  /** decoded: from receipt facts; heuristic: TxStory pattern; explorer: the explorer's own interpretation. */
  confidence: 'decoded' | 'heuristic' | 'explorer';
  headline: string;
  detail: string;
  evidence: string[]; // movement ids / 'log:N' / 'ledger:<address>:<asset>'
  caveats: string[];
}

export interface Completeness {
  logs: 'complete';
  tokenTransfers: 'complete';
  nativeInternal: 'complete' | 'partial' | 'unavailable';
  explorerTokenTransfers: 'complete' | 'partial' | 'unavailable';
  stateChanges: 'complete' | 'partial' | 'unavailable';
  tokenMetadata: 'complete' | 'partial' | 'unavailable';
  /** Call trace from debug_traceTransaction (see Story.trace). */
  trace: 'complete' | 'partial' | 'unavailable' | 'not-requested';
}

/** A decode outcome as stored in a story (parameter values may be shortened for size). */
export interface StoredDecode {
  status: DecodeStatus;
  id: string | null;
  candidates: Candidate[];
  note?: string;
}

export interface TraceFrameView extends CallFrame {
  /** Calldata decoded with the ABI library (signature only; see abiDecoding for values). */
  call?: { status: DecodeStatus; signatures: string[] };
  /** Revert data of a failed frame, decoded (Error(string), Panic, custom errors). */
  revert?: { status: DecodeStatus; summary: string };
}

export interface TraceSection {
  status: Completeness['trace'];
  /** Provider that answered, or null. */
  provider: string | null;
  sourceIds: string[];
  note?: string;
  frameCount: number;
  maxDepth: number;
  /** Frames that failed (their subtree was rolled back). */
  revertedFrames: number;
  /** Pre-order frames (bounded; see note when truncated). */
  frames: TraceFrameView[];
  /** Native value transfers inside execution, committed or rolled back. */
  valueMoves: Array<{ frameId: string; type: FrameType; from: Address; to: Address; value: string; committed: boolean }>;
}

export interface AbiDecodingSection {
  /** ABI libraries used, with provenance. Built-in modules are listed as "builtin". */
  libraries: Array<{ label: string; source: AbiSource; entries: number }>;
  call: StoredDecode | null;
  /** Logs for which at least one ABI entry matched topic 0. */
  logs: Array<{ logIndex: number } & StoredDecode>;
  unmatchedLogs: number;
}

export interface RevertSection {
  source: 'trace';
  frameId: string;
  data: string;
  decoded: StoredDecode & { panic?: string };
  summary: string;
}

export interface Story {
  schemaVersion: typeof STORY_SCHEMA_VERSION;
  chain: ChainKey;
  /** The network as configured when the story was built (no registry needed to display it). */
  network: NetworkDescriptor;
  hash: Hex;
  outcome: 'success' | 'reverted';
  tx: {
    from: Address;
    to: Address | null;
    createdContract: Address | null;
    nonce: string;
    value: string;
    type: string;
    inputSelector: string | null;
    inputBytes: number;
    method: { name: string; source: 'explorer' } | null;
    decodedInput: { call: string; parameters: Array<{ name: string; type: string; value: string }>; source: 'explorer' } | null;
    revertReason: { text: string; source: 'explorer' } | null;
  };
  block: { number: string; hash: string; timestamp: string | null; baseFeePerGas: string | null; feeRecipient: Address | null };
  fees: {
    total: string;
    gasUsed: string;
    effectiveGasPrice: string;
    components: Array<{ kind: MovementKind; amount: string; label: string }>;
    notes: string[];
  };
  assets: Record<string, Asset>;
  participants: Record<string, Participant>;
  movements: Movement[];
  ledger: BalanceChange[];
  crossCheck: CrossCheck;
  logs: LogEntry[];
  interpretations: Interpretation[];
  /** Explorer-written summaries (explorer provenance), sanitised. */
  explorerSummaries?: string[];
  completeness: Completeness;
  /** Call tree and value flow from the node's trace (status explains availability). */
  trace: TraceSection;
  /** Decoded revert data of the failed top-level call, when a trace provided it. */
  revert: RevertSection | null;
  /** ABI decoding of calldata and logs (built-in modules plus any user-supplied ABIs). */
  abiDecoding: AbiDecodingSection;
  warnings: string[];
  sources: SourceRecord[];
  generatedAt: string;
  mode: DataMode | 'mixed';
  /** 'fast' stories omit the explorer cross-check; a 'full' story follows. */
  stage: 'fast' | 'full';
}

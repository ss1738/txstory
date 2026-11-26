/**
 * Local decoding of receipt logs for a small set of widely used standard and
 * protocol events. Topic hashes are derived from signatures at load time.
 *
 * Decoding a log only establishes that a contract EMITTED an event with this
 * shape. It does not prove the contract implements the standard faithfully
 * (e.g. fee-on-transfer, rebasing, or malicious tokens).
 */
import { dataWords, keccakHex, wordToAddress, wordToInt, wordToUint, type Address, type Hex } from './hex.js';

export interface RawLog {
  address: string;
  topics: string[];
  data: string;
  logIndex: number;
}

export type EventName =
  | 'Transfer' | 'Approval' | 'ApprovalForAll' | 'TransferSingle' | 'TransferBatch'
  | 'Deposit' | 'Withdrawal' | 'UniswapV2Swap' | 'UniswapV2Sync' | 'UniswapV3Swap' | 'UniswapV4Swap';

interface EventSpec {
  name: EventName;
  signature: string;
  label: string;
}

const SPECS: EventSpec[] = [
  { name: 'Transfer', signature: 'Transfer(address,address,uint256)', label: 'Transfer' },
  { name: 'Approval', signature: 'Approval(address,address,uint256)', label: 'Approval' },
  { name: 'ApprovalForAll', signature: 'ApprovalForAll(address,address,bool)', label: 'ApprovalForAll' },
  { name: 'TransferSingle', signature: 'TransferSingle(address,address,address,uint256,uint256)', label: 'ERC-1155 TransferSingle' },
  { name: 'TransferBatch', signature: 'TransferBatch(address,address,address,uint256[],uint256[])', label: 'ERC-1155 TransferBatch' },
  { name: 'Deposit', signature: 'Deposit(address,uint256)', label: 'Deposit (WETH-style)' },
  { name: 'Withdrawal', signature: 'Withdrawal(address,uint256)', label: 'Withdrawal (WETH-style)' },
  { name: 'UniswapV2Swap', signature: 'Swap(address,uint256,uint256,uint256,uint256,address)', label: 'Uniswap V2-style Swap' },
  { name: 'UniswapV2Sync', signature: 'Sync(uint112,uint112)', label: 'Uniswap V2-style Sync' },
  { name: 'UniswapV3Swap', signature: 'Swap(address,address,int256,int256,uint160,uint128,int24)', label: 'Uniswap V3-style Swap' },
  { name: 'UniswapV4Swap', signature: 'Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)', label: 'Uniswap V4-style Swap' },
];

export const TOPICS: Record<EventName, Hex> = Object.fromEntries(
  SPECS.map((s) => [s.name, keccakHex(s.signature)]),
) as Record<EventName, Hex>;

const BY_TOPIC = new Map<string, EventSpec>(SPECS.map((s) => [TOPICS[s.name], s]));

export type TokenStandardGuess = 'erc20' | 'erc721' | 'erc1155' | 'unknown';

export type DecodedEvent =
  | { kind: 'transfer'; standard: 'erc20'; logIndex: number; contract: Address; from: Address; to: Address; amount: string }
  | { kind: 'transfer'; standard: 'erc721'; logIndex: number; contract: Address; from: Address; to: Address; tokenId: string }
  | { kind: 'transfer'; standard: 'erc1155'; logIndex: number; contract: Address; operator: Address; from: Address; to: Address; tokenId: string; amount: string; batchIndex?: number }
  | { kind: 'approval'; standard: 'erc20' | 'erc721'; logIndex: number; contract: Address; owner: Address; spender: Address; value: string }
  | { kind: 'approval-for-all'; logIndex: number; contract: Address; owner: Address; operator: Address; approved: boolean }
  | { kind: 'wrap-deposit'; logIndex: number; contract: Address; account: Address; amount: string }
  | { kind: 'wrap-withdrawal'; logIndex: number; contract: Address; account: Address; amount: string }
  | { kind: 'swap'; protocol: 'uniswap-v2' | 'uniswap-v3' | 'uniswap-v4'; logIndex: number; contract: Address; detail: Record<string, string> }
  | { kind: 'sync'; logIndex: number; contract: Address; reserve0: string; reserve1: string };

export interface DecodeResult {
  event: DecodedEvent | null;
  /** Human-readable name of the matched signature, if any. */
  label: string | null;
  /** Why a log matching a known topic could not be decoded (malformed or non-standard). */
  problem?: string;
}

function addr(word: string | undefined): Address | null {
  return word ? wordToAddress(word) : null;
}

export function decodeLog(log: RawLog): DecodeResult {
  const topic0 = log.topics[0]?.toLowerCase();
  const contract = (log.address || '').toLowerCase() as Address;
  if (!topic0) return { event: null, label: null, problem: 'anonymous event (no topics)' };
  const spec = BY_TOPIC.get(topic0);
  if (!spec) return { event: null, label: null };
  const words = dataWords(log.data);
  if (!words) return { event: null, label: spec.label, problem: 'malformed data length' };
  const t = log.topics;
  const fail = (problem: string): DecodeResult => ({ event: null, label: spec.label, problem });

  switch (spec.name) {
    case 'Transfer': {
      // ERC-20: 3 topics + 1 data word. ERC-721: 4 topics + no data.
      if (t.length === 3 && words.length === 1) {
        const from = addr(t[1]); const to = addr(t[2]);
        if (!from || !to) return fail('non-canonical address topic');
        return { label: 'ERC-20 Transfer', event: { kind: 'transfer', standard: 'erc20', logIndex: log.logIndex, contract, from, to, amount: wordToUint(words[0]!).toString() } };
      }
      if (t.length === 4 && words.length === 0) {
        const from = addr(t[1]); const to = addr(t[2]);
        if (!from || !to) return fail('non-canonical address topic');
        return { label: 'ERC-721 Transfer', event: { kind: 'transfer', standard: 'erc721', logIndex: log.logIndex, contract, from, to, tokenId: wordToUint(t[3]!).toString() } };
      }
      return fail(`Transfer with ${t.length} topics and ${words.length} data words (non-standard layout)`);
    }
    case 'Approval': {
      if (t.length === 3 && words.length === 1) {
        const owner = addr(t[1]); const spender = addr(t[2]);
        if (!owner || !spender) return fail('non-canonical address topic');
        return { label: 'ERC-20 Approval', event: { kind: 'approval', standard: 'erc20', logIndex: log.logIndex, contract, owner, spender, value: wordToUint(words[0]!).toString() } };
      }
      if (t.length === 4 && words.length === 0) {
        const owner = addr(t[1]); const spender = addr(t[2]);
        if (!owner || !spender) return fail('non-canonical address topic');
        return { label: 'ERC-721 Approval', event: { kind: 'approval', standard: 'erc721', logIndex: log.logIndex, contract, owner, spender, value: wordToUint(t[3]!).toString() } };
      }
      return fail('non-standard Approval layout');
    }
    case 'ApprovalForAll': {
      if (t.length !== 3 || words.length !== 1) return fail('non-standard ApprovalForAll layout');
      const owner = addr(t[1]); const operator = addr(t[2]);
      if (!owner || !operator) return fail('non-canonical address topic');
      return { label: spec.label, event: { kind: 'approval-for-all', logIndex: log.logIndex, contract, owner, operator, approved: wordToUint(words[0]!) !== 0n } };
    }
    case 'TransferSingle': {
      if (t.length !== 4 || words.length !== 2) return fail('non-standard TransferSingle layout');
      const operator = addr(t[1]); const from = addr(t[2]); const to = addr(t[3]);
      if (!operator || !from || !to) return fail('non-canonical address topic');
      return { label: spec.label, event: { kind: 'transfer', standard: 'erc1155', logIndex: log.logIndex, contract, operator, from, to, tokenId: wordToUint(words[0]!).toString(), amount: wordToUint(words[1]!).toString() } };
    }
    case 'TransferBatch': {
      // Batch events produce multiple movements; callers use decodeTransferBatch.
      return { label: spec.label, event: null, problem: 'batch (use decodeTransferBatch)' };
    }
    case 'Deposit':
    case 'Withdrawal': {
      if (t.length !== 2 || words.length !== 1) return fail(`non-standard ${spec.name} layout`);
      const account = addr(t[1]);
      if (!account) return fail('non-canonical address topic');
      const amount = wordToUint(words[0]!).toString();
      return spec.name === 'Deposit'
        ? { label: spec.label, event: { kind: 'wrap-deposit', logIndex: log.logIndex, contract, account, amount } }
        : { label: spec.label, event: { kind: 'wrap-withdrawal', logIndex: log.logIndex, contract, account, amount } };
    }
    case 'UniswapV2Swap': {
      if (t.length !== 3 || words.length !== 4) return fail('non-standard V2 Swap layout');
      return { label: spec.label, event: { kind: 'swap', protocol: 'uniswap-v2', logIndex: log.logIndex, contract, detail: {
        sender: addr(t[1]) ?? '?', to: addr(t[2]) ?? '?',
        amount0In: wordToUint(words[0]!).toString(), amount1In: wordToUint(words[1]!).toString(),
        amount0Out: wordToUint(words[2]!).toString(), amount1Out: wordToUint(words[3]!).toString(),
      } } };
    }
    case 'UniswapV2Sync': {
      if (t.length !== 1 || words.length !== 2) return fail('non-standard Sync layout');
      return { label: spec.label, event: { kind: 'sync', logIndex: log.logIndex, contract, reserve0: wordToUint(words[0]!).toString(), reserve1: wordToUint(words[1]!).toString() } };
    }
    case 'UniswapV3Swap': {
      if (t.length !== 3 || words.length !== 5) return fail('non-standard V3 Swap layout');
      return { label: spec.label, event: { kind: 'swap', protocol: 'uniswap-v3', logIndex: log.logIndex, contract, detail: {
        sender: addr(t[1]) ?? '?', recipient: addr(t[2]) ?? '?',
        amount0: wordToInt(words[0]!).toString(), amount1: wordToInt(words[1]!).toString(),
      } } };
    }
    case 'UniswapV4Swap': {
      if (t.length !== 3 || words.length !== 6) return fail('non-standard V4 Swap layout');
      return { label: spec.label, event: { kind: 'swap', protocol: 'uniswap-v4', logIndex: log.logIndex, contract, detail: {
        poolId: t[1] ?? '?', sender: addr(t[2]) ?? '?',
        amount0: wordToInt(words[0]!).toString(), amount1: wordToInt(words[1]!).toString(),
      } } };
    }
  }
}

/** Decode an ERC-1155 TransferBatch into one entry per (id, value). */
export function decodeTransferBatch(log: RawLog): DecodedEvent[] | { problem: string } {
  const t = log.topics;
  if (t[0]?.toLowerCase() !== TOPICS.TransferBatch) return { problem: 'not a TransferBatch' };
  if (t.length !== 4) return { problem: 'non-standard TransferBatch topics' };
  const operator = addr(t[1]); const from = addr(t[2]); const to = addr(t[3]);
  if (!operator || !from || !to) return { problem: 'non-canonical address topic' };
  const words = dataWords(log.data);
  if (!words || words.length < 4) return { problem: 'malformed TransferBatch data' };
  const readArray = (offsetWord: string): bigint[] | null => {
    const off = wordToUint(offsetWord);
    if (off % 32n !== 0n) return null;
    const start = Number(off / 32n);
    if (!Number.isSafeInteger(start) || start >= words.length) return null;
    const len = wordToUint(words[start]!);
    if (len > BigInt(words.length)) return null;
    const n = Number(len);
    if (start + 1 + n > words.length) return null;
    return words.slice(start + 1, start + 1 + n).map(wordToUint);
  };
  const ids = readArray(words[0]!);
  const values = readArray(words[1]!);
  if (!ids || !values || ids.length !== values.length) return { problem: 'TransferBatch arrays malformed or length mismatch' };
  const contract = log.address.toLowerCase() as Address;
  return ids.map((id, i) => ({
    kind: 'transfer', standard: 'erc1155', logIndex: log.logIndex, contract, operator, from, to,
    tokenId: id.toString(), amount: values[i]!.toString(), batchIndex: i,
  }));
}

export function eventLabelForTopic(topic0: string | undefined): string | null {
  return topic0 ? BY_TOPIC.get(topic0.toLowerCase())?.label ?? null : null;
}

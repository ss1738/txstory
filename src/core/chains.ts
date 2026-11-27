/**
 * Network registry. Built-in networks are defined here; more can be added at
 * runtime from a JSON chain file (data only, validated by `parseChainFile`),
 * e.g. a local devnet. Built-ins cannot be overridden.
 */
import type { Address } from './hex.js';

/** A registered network key, e.g. "ethereum" or a custom "anvil". */
export type ChainKey = string;

export type FeeModel =
  /** EIP-1559 L1: base fee burned, priority fee to block fee recipient. */
  | 'ethereum-l1'
  /** OP Stack: L2 execution fee + L1 data fee (receipt.l1Fee) to fee vaults. */
  | 'op-stack'
  /** Arbitrum: single effective gas price; fees to network fee accounts. */
  | 'arbitrum';

export const FEE_MODELS: readonly FeeModel[] = ['ethereum-l1', 'op-stack', 'arbitrum'];

export interface ChainInfo {
  key: ChainKey;
  chainId: number;
  name: string;
  nativeSymbol: string;
  nativeDecimals: 18;
  feeModel: FeeModel;
  /** Explorer UI base for outbound links, or null when there is none (e.g. a devnet). */
  explorerUi: string | null;
  /**
   * Wrapped-native contracts whose Deposit/Withdrawal events represent token
   * mint/burn without a Transfer event (WETH9 behaviour).
   */
  wrappedNative: Address[];
  /** true for networks shipped with TxStory; false for chain-file networks. */
  builtin: boolean;
}

const BUILTIN: ChainInfo[] = [
  {
    key: 'ethereum', chainId: 1, name: 'Ethereum', nativeSymbol: 'ETH', nativeDecimals: 18,
    feeModel: 'ethereum-l1', explorerUi: 'https://eth.blockscout.com',
    wrappedNative: ['0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'], builtin: true,
  },
  {
    key: 'optimism', chainId: 10, name: 'OP Mainnet', nativeSymbol: 'ETH', nativeDecimals: 18,
    feeModel: 'op-stack', explorerUi: 'https://explorer.optimism.io',
    wrappedNative: ['0x4200000000000000000000000000000000000006'], builtin: true,
  },
  {
    key: 'base', chainId: 8453, name: 'Base', nativeSymbol: 'ETH', nativeDecimals: 18,
    feeModel: 'op-stack', explorerUi: 'https://base.blockscout.com',
    wrappedNative: ['0x4200000000000000000000000000000000000006'], builtin: true,
  },
  {
    key: 'arbitrum', chainId: 42161, name: 'Arbitrum One', nativeSymbol: 'ETH', nativeDecimals: 18,
    feeModel: 'arbitrum', explorerUi: 'https://arbitrum.blockscout.com',
    wrappedNative: ['0x82af49447d8a07e3bd95bd0d56f35241523fbab1'], builtin: true,
  },
];

/** Live registry. Read it through the helpers; mutate only via registerChain. */
export const CHAINS: Record<ChainKey, ChainInfo> = Object.fromEntries(BUILTIN.map((c) => [c.key, c]));

export const BUILTIN_CHAIN_KEYS: readonly ChainKey[] = BUILTIN.map((c) => c.key);

/** All currently registered keys (built-ins first). */
export function chainKeys(): ChainKey[] {
  return Object.keys(CHAINS);
}

export function isChainKey(value: unknown): value is ChainKey {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CHAINS, value);
}

export function getChain(key: ChainKey): ChainInfo {
  const c = CHAINS[key];
  if (!c) throw new Error(`Unknown network "${key}"`);
  return c;
}

export const CHAIN_KEY_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;

/** A custom network as written in a chain file, plus its default endpoints. */
export interface ChainFileEntry {
  info: ChainInfo;
  rpc: string[];
  explorerApi: string | null;
}

/**
 * Validate a chain file: `{ "chains": [ { key, chainId, name, nativeSymbol,
 * feeModel, rpc: [urls], explorerApi?, explorerUi?, wrappedNative? } ] }`.
 * Throws with a precise message; never evaluates anything.
 */
export function parseChainFile(json: unknown): ChainFileEntry[] {
  const fail = (msg: string): never => { throw new Error(`chain file: ${msg}`); };
  if (typeof json !== 'object' || json === null || !Array.isArray((json as { chains?: unknown }).chains)) fail('expected {"chains": [...]}');
  const list = (json as { chains: unknown[] }).chains;
  if (list.length > 64) fail('at most 64 chains');
  const seen = new Set<string>();
  return list.map((raw, i) => {
    const at = `chains[${i}]`;
    if (typeof raw !== 'object' || raw === null) return fail(`${at} must be an object`);
    const c = raw as Record<string, unknown>;
    const allowed = new Set(['key', 'chainId', 'name', 'nativeSymbol', 'feeModel', 'rpc', 'explorerApi', 'explorerUi', 'wrappedNative']);
    for (const k of Object.keys(c)) if (!allowed.has(k)) fail(`${at}: unknown field "${k}"`);
    const key = c.key;
    if (typeof key !== 'string' || !CHAIN_KEY_PATTERN.test(key)) fail(`${at}.key must match ${CHAIN_KEY_PATTERN}`);
    if (seen.has(key as string)) fail(`${at}.key "${key}" is duplicated`);
    if (BUILTIN_CHAIN_KEYS.includes(key as string)) fail(`${at}.key "${key}" is a built-in network and cannot be redefined`);
    seen.add(key as string);
    if (!Number.isSafeInteger(c.chainId) || (c.chainId as number) <= 0) fail(`${at}.chainId must be a positive integer`);
    if (typeof c.name !== 'string' || !c.name.trim() || c.name.length > 64) fail(`${at}.name must be 1 to 64 characters`);
    const nativeSymbol = c.nativeSymbol ?? 'ETH';
    if (typeof nativeSymbol !== 'string' || !/^[A-Za-z0-9.]{1,12}$/.test(nativeSymbol)) fail(`${at}.nativeSymbol must be 1 to 12 letters or digits`);
    const feeModel = c.feeModel ?? 'ethereum-l1';
    if (!FEE_MODELS.includes(feeModel as FeeModel)) fail(`${at}.feeModel must be one of ${FEE_MODELS.join(', ')}`);
    const urlOk = (u: unknown) => {
      if (typeof u !== 'string') return false;
      try { const p = new URL(u); return p.protocol === 'https:' || p.protocol === 'http:'; } catch { return false; }
    };
    if (!Array.isArray(c.rpc) || c.rpc.length === 0 || c.rpc.length > 8 || !c.rpc.every(urlOk)) fail(`${at}.rpc must be 1 to 8 http(s) URLs`);
    const explorerApi = c.explorerApi ?? null;
    if (explorerApi !== null && !urlOk(explorerApi)) fail(`${at}.explorerApi must be an http(s) URL or null`);
    const explorerUi = c.explorerUi ?? null;
    if (explorerUi !== null && !urlOk(explorerUi)) fail(`${at}.explorerUi must be an http(s) URL or null`);
    const wrapped = c.wrappedNative ?? [];
    if (!Array.isArray(wrapped) || wrapped.length > 8 || !wrapped.every((a) => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a))) fail(`${at}.wrappedNative must be a list of addresses`);
    return {
      info: {
        key: key as string, chainId: c.chainId as number, name: (c.name as string).trim(), nativeSymbol: nativeSymbol as string, nativeDecimals: 18,
        feeModel: feeModel as FeeModel, explorerUi: explorerUi as string | null,
        wrappedNative: (wrapped as string[]).map((a) => a.toLowerCase() as Address), builtin: false,
      },
      rpc: c.rpc as string[],
      explorerApi: explorerApi as string | null,
    };
  });
}

/** Add a validated custom network. Re-registering the same custom key replaces it. */
export function registerChain(info: ChainInfo): void {
  if (BUILTIN_CHAIN_KEYS.includes(info.key)) throw new Error(`"${info.key}" is a built-in network`);
  if (!CHAIN_KEY_PATTERN.test(info.key)) throw new Error(`invalid network key "${info.key}"`);
  CHAINS[info.key] = { ...info, builtin: false };
}

/** Public description of a network, embedded in stories so consumers need no registry. */
export interface NetworkDescriptor {
  key: ChainKey;
  chainId: number;
  name: string;
  nativeSymbol: string;
  explorerUi: string | null;
  builtin: boolean;
}

export function describeNetwork(key: ChainKey): NetworkDescriptor {
  return networkDescriptor(getChain(key));
}

/** The descriptor of an explicit network definition (no registry lookup). */
export function networkDescriptor(c: ChainInfo): NetworkDescriptor {
  return { key: c.key, chainId: c.chainId, name: c.name, nativeSymbol: c.nativeSymbol, explorerUi: c.explorerUi, builtin: c.builtin };
}

/** Whether two network definitions describe the same network in every field the analysis uses. */
export function sameNetwork(a: ChainInfo, b: ChainInfo): boolean {
  return a.key === b.key && a.chainId === b.chainId && a.name === b.name && a.nativeSymbol === b.nativeSymbol
    && a.nativeDecimals === b.nativeDecimals && a.feeModel === b.feeModel && a.explorerUi === b.explorerUi
    && a.wrappedNative.length === b.wrappedNative.length && a.wrappedNative.every((w, i) => w === b.wrappedNative[i]);
}

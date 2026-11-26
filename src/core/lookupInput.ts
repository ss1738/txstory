import type { ChainKey } from './chains.js';

export type ParsedInput =
  | { ok: true; hash: string; chain: ChainKey | null; from: 'hash' | 'url' }
  | { ok: false; message: string };

/**
 * Hostnames of common explorers → chain. Used only to pre-select a network
 * from a pasted link; the URL itself is never fetched.
 */
const HOSTS: Array<[RegExp, ChainKey]> = [
  [/^(www\.)?etherscan\.io$/, 'ethereum'],
  [/^eth\.blockscout\.com$/, 'ethereum'],
  [/^(www\.)?basescan\.org$/, 'base'],
  [/^base\.blockscout\.com$/, 'base'],
  [/^optimistic\.etherscan\.io$/, 'optimism'],
  [/^(optimism\.blockscout\.com|explorer\.optimism\.io)$/, 'optimism'],
  [/^(www\.)?arbiscan\.io$/, 'arbitrum'],
  [/^arbitrum\.blockscout\.com$/, 'arbitrum'],
];

const HASH = /0x[0-9a-fA-F]{64}/;

export function parseLookupInput(raw: string): ParsedInput {
  const value = raw.trim();
  if (!value) return { ok: false, message: 'Paste a transaction hash or an explorer link.' };
  if (/^0x[0-9a-fA-F]{64}$/.test(value)) return { ok: true, hash: value.toLowerCase(), chain: null, from: 'hash' };
  if (/^0x[0-9a-fA-F]{40}$/.test(value)) {
    return { ok: false, message: 'That looks like an address (40 hex characters). TxStory explains transactions, which have 64 hex characters.' };
  }
  if (/^[0-9a-fA-F]{64}$/.test(value)) return { ok: true, hash: '0x' + value.toLowerCase(), chain: null, from: 'hash' };
  let url: URL | null = null;
  try {
    url = new URL(value.includes('://') ? value : `https://${value}`);
  } catch {
    url = null;
  }
  if (url && (url.protocol === 'https:' || url.protocol === 'http:')) {
    const m = HASH.exec(url.pathname);
    if (m && /\/tx\//.test(url.pathname)) {
      const host = url.hostname.toLowerCase();
      const chain = HOSTS.find(([re]) => re.test(host))?.[1] ?? null;
      return { ok: true, hash: m[0].toLowerCase(), chain, from: 'url' };
    }
    if (/\/(address|token)\//.test(url.pathname)) return { ok: false, message: 'That link points to an address or token page. Paste a transaction link (…/tx/0x…).' };
  }
  if (/^0x[0-9a-fA-F]*$/.test(value)) {
    return { ok: false, message: `A transaction hash has 64 hex characters after 0x; this has ${value.length - 2}.` };
  }
  return { ok: false, message: 'Not a transaction hash or a transaction link.' };
}

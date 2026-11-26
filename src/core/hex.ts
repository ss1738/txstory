import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

export type Hex = `0x${string}`;
export type Address = `0x${string}`; // always stored lowercase internally

export const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000';

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function isTxHash(value: unknown): value is Hex {
  return typeof value === 'string' && TX_HASH.test(value);
}

export function isAddress(value: unknown): value is string {
  return typeof value === 'string' && ADDRESS.test(value);
}

export function normalizeAddress(value: unknown): Address | null {
  return isAddress(value) ? (value.toLowerCase() as Address) : null;
}

export function keccakHex(text: string): Hex {
  return ('0x' + bytesToHex(keccak_256(utf8ToBytes(text)))) as Hex;
}

/** EIP-55 mixed-case checksum display form. */
export function checksumAddress(address: string): string {
  const lower = address.toLowerCase().replace(/^0x/, '');
  const hash = bytesToHex(keccak_256(utf8ToBytes(lower)));
  let out = '0x';
  for (let i = 0; i < lower.length; i++) {
    const c = lower[i]!;
    out += parseInt(hash[i]!, 16) >= 8 ? c.toUpperCase() : c;
  }
  return out;
}

export function shortAddress(address: string): string {
  const a = checksumAddress(address);
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

/** Extract an address from a 32-byte topic/word (left-padded). */
export function wordToAddress(word: string): Address | null {
  const clean = word.replace(/^0x/, '');
  if (clean.length !== 64 || !/^[0-9a-fA-F]+$/.test(clean)) return null;
  // Upper 12 bytes must be zero for a canonical address encoding.
  if (!/^0{24}$/.test(clean.slice(0, 24))) return null;
  return ('0x' + clean.slice(24).toLowerCase()) as Address;
}

/** Split ABI data into 32-byte words. Returns null if length is not a multiple of 32 bytes. */
export function dataWords(data: string): string[] | null {
  const clean = data.replace(/^0x/, '');
  if (clean.length % 64 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) return null;
  const words: string[] = [];
  for (let i = 0; i < clean.length; i += 64) words.push(clean.slice(i, i + 64));
  return words;
}

export function wordToUint(word: string): bigint {
  return BigInt('0x' + (word.replace(/^0x/, '') || '0'));
}

/** Two's-complement signed interpretation of a 256-bit word. */
export function wordToInt(word: string): bigint {
  const u = wordToUint(word);
  return u >= 1n << 255n ? u - (1n << 256n) : u;
}

/** Signed interpretation of a word holding an intN (sign-extended to 256 bits by ABI). */
export const wordToSignedInt = wordToInt;

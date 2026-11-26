/**
 * ABI decoding for calldata, event logs and revert data.
 *
 * Trust model:
 *  - ABIs are DATA. Nothing is fetched or executed. Each entry records where it
 *    came from: `user` (supplied by the person running TxStory), `builtin`
 *    (shipped with TxStory), or `signature` (a bare text signature without
 *    verified parameter names).
 *  - A successful decode shows that the bytes are CONSISTENT with an ABI. It is
 *    not proof of what the contract does, nor that the contract really has this
 *    interface (selectors and event topics can collide).
 *  - When several distinct signatures fit, every one is reported (`ambiguous`);
 *    nothing is chosen silently. Strict checks (padding, ranges, offsets) reject
 *    candidates whose encoding is impossible for the declared types.
 *
 * Values are JSON-safe: integers are decimal strings (no precision loss),
 * addresses lowercase hex, bytes hex, strings sanitised for display.
 */
import { keccakHex } from './hex.js';
import { cleanUntrusted } from './text.js';

// ---------------------------------------------------------------- types

export type AbiSource = 'user' | 'builtin' | 'signature';

export interface AbiParam {
  name?: string;
  type: string;
  components?: AbiParam[];
  indexed?: boolean;
}

export interface AbiEntry {
  kind: 'function' | 'event' | 'error';
  name: string;
  inputs: AbiParam[];
  /** Canonical signature, e.g. `transfer(address,uint256)`. */
  signature: string;
  /** 4-byte selector (function/error) or 32-byte topic (event), lowercase hex. */
  id: string;
  anonymous?: boolean;
  source: AbiSource;
  /** Human label for the origin, e.g. a file name or "ERC-20 (built-in)". */
  sourceLabel: string;
}

export type AbiValue = string | boolean | AbiValue[] | { [key: string]: AbiValue };

export interface DecodedParam {
  name: string | null;
  type: string;
  value: AbiValue;
  /** Indexed dynamic event parameters are stored as a keccak hash only. */
  indexedHashOnly?: boolean;
}

export interface Candidate {
  signature: string;
  name: string;
  kind: AbiEntry['kind'];
  sources: Array<{ source: AbiSource; label: string }>;
  ok: boolean;
  params?: DecodedParam[];
  /** Why this candidate was rejected (ok=false). */
  error?: string;
  /** Non-fatal observations (non-canonical encoding, trailing bytes). */
  notes: string[];
}

export type DecodeStatus = 'decoded' | 'ambiguous' | 'no-match' | 'no-valid-candidate' | 'empty' | 'malformed';

export interface DecodeResult {
  status: DecodeStatus;
  /** The selector or topic that was looked up. */
  id: string | null;
  candidates: Candidate[];
  note?: string;
}

// ---------------------------------------------------------------- type grammar

type T =
  | { k: 'uint'; bits: number }
  | { k: 'int'; bits: number }
  | { k: 'address' }
  | { k: 'bool' }
  | { k: 'fbytes'; size: number }
  | { k: 'bytes' }
  | { k: 'string' }
  | { k: 'array'; of: T; len: number | null }
  | { k: 'tuple'; items: Array<{ name: string | null; t: T }> };

const MAX_DEPTH = 8;

export class AbiError extends Error {}

function parseType(p: AbiParam, depth = 0): T {
  if (depth > MAX_DEPTH) throw new AbiError('type nesting too deep');
  const m = /^(.*?)((?:\[\d*\])*)$/.exec(p.type.trim());
  if (!m) throw new AbiError(`invalid type "${p.type}"`);
  const base = m[1]!;
  const dims = [...m[2]!.matchAll(/\[(\d*)\]/g)].map((d) => (d[1] === '' ? null : Number(d[1])));
  let t: T;
  if (base === 'tuple') {
    if (!Array.isArray(p.components)) throw new AbiError('tuple without components');
    if (p.components.length > 64) throw new AbiError('tuple too wide');
    t = { k: 'tuple', items: p.components.map((c) => ({ name: c.name || null, t: parseType(c, depth + 1) })) };
  } else {
    t = parseElementary(base);
  }
  for (const len of dims) {
    if (len !== null && (!Number.isSafeInteger(len) || len < 1 || len > 4096)) throw new AbiError(`invalid fixed array length in "${p.type}"`);
    t = { k: 'array', of: t, len };
  }
  return t;
}

function parseElementary(base: string): T {
  if (base === 'address') return { k: 'address' };
  if (base === 'bool') return { k: 'bool' };
  if (base === 'string') return { k: 'string' };
  if (base === 'bytes') return { k: 'bytes' };
  if (base === 'function') return { k: 'fbytes', size: 24 };
  let m = /^(u?)int(\d*)$/.exec(base);
  if (m) {
    const bits = m[2] === '' ? 256 : Number(m[2]);
    if (bits < 8 || bits > 256 || bits % 8 !== 0) throw new AbiError(`invalid integer type "${base}"`);
    return m[1] ? { k: 'uint', bits } : { k: 'int', bits };
  }
  m = /^bytes(\d+)$/.exec(base);
  if (m) {
    const size = Number(m[1]);
    if (size < 1 || size > 32) throw new AbiError(`invalid type "${base}"`);
    return { k: 'fbytes', size };
  }
  throw new AbiError(`unsupported type "${base}"`);
}

function canonical(t: T): string {
  switch (t.k) {
    case 'uint': return `uint${t.bits}`;
    case 'int': return `int${t.bits}`;
    case 'fbytes': return `bytes${t.size}`;
    case 'array': return `${canonical(t.of)}[${t.len ?? ''}]`;
    case 'tuple': return `(${t.items.map((i) => canonical(i.t)).join(',')})`;
    default: return t.k;
  }
}

function isDynamic(t: T): boolean {
  if (t.k === 'bytes' || t.k === 'string') return true;
  if (t.k === 'array') return t.len === null || isDynamic(t.of);
  if (t.k === 'tuple') return t.items.some((i) => isDynamic(i.t));
  return false;
}

function headSize(t: T): number {
  if (isDynamic(t)) return 32;
  if (t.k === 'array') return t.len! * headSize(t.of);
  if (t.k === 'tuple') return t.items.reduce((n, i) => n + headSize(i.t), 0);
  return 32;
}

// ---------------------------------------------------------------- library

function entryFromItem(item: Record<string, unknown>, source: AbiSource, sourceLabel: string): AbiEntry | null {
  const kind = item.type;
  if (kind !== 'function' && kind !== 'event' && kind !== 'error') return null; // constructor/fallback/receive carry no selector
  if (typeof item.name !== 'string' || !/^[A-Za-z_$][A-Za-z0-9_$]{0,127}$/.test(item.name)) throw new AbiError('entry name missing or invalid');
  const inputs = (item.inputs ?? []) as AbiParam[];
  if (!Array.isArray(inputs) || inputs.length > 64) throw new AbiError(`${item.name}: inputs must be a list (≤64)`);
  for (const p of inputs) if (typeof p !== 'object' || p === null || typeof p.type !== 'string') throw new AbiError(`${item.name}: every input needs a type`);
  const types = inputs.map((p) => canonical(parseType(p)));
  const signature = `${item.name}(${types.join(',')})`;
  const hash = keccakHex(signature);
  return {
    kind, name: item.name, inputs, signature,
    id: kind === 'event' ? hash : hash.slice(0, 10),
    ...(kind === 'event' ? { anonymous: item.anonymous === true } : {}),
    source, sourceLabel,
  };
}

/** Parse "function f(uint256 a, (address,bool)[] b)", "event E(address indexed x)", "error X()" or a bare "f(uint256)". */
export function parseSignatureLine(line: string): Record<string, unknown> {
  const text = line.trim().replace(/;$/, '');
  const m = /^(?:(function|event|error)\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s*\((.*)\)\s*(anonymous)?[^()]*$/s.exec(text);
  if (!m) throw new AbiError(`cannot parse signature "${line.slice(0, 80)}"`);
  const [, kind = 'function', name, body, anon] = m;
  return { type: kind, name, inputs: splitParams(body!).map(parseParamText), ...(anon ? { anonymous: true } : {}) };
}

function splitParams(body: string): string[] {
  const out: string[] = []; let depth = 0; let cur = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (depth < 0) throw new AbiError('unbalanced parentheses');
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  if (depth !== 0) throw new AbiError('unbalanced parentheses');
  if (cur.trim()) out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

function parseParamText(text: string): AbiParam {
  if (text.startsWith('(') || text.startsWith('tuple(')) {
    const open = text.indexOf('(');
    let depth = 0; let close = -1;
    for (let i = open; i < text.length; i++) {
      if (text[i] === '(') depth++;
      if (text[i] === ')') { depth--; if (depth === 0) { close = i; break; } }
    }
    if (close < 0) throw new AbiError('unbalanced tuple');
    const rest = text.slice(close + 1).trim();
    const dims = /^((?:\[\d*\])*)/.exec(rest)![1]!;
    const tail = rest.slice(dims.length).trim().split(/\s+/).filter(Boolean);
    const indexed = tail[0] === 'indexed';
    const name = indexed ? tail[1] : tail[0];
    return { type: `tuple${dims}`, components: splitParams(text.slice(open + 1, close)).map(parseParamText), ...(name ? { name } : {}), ...(indexed ? { indexed } : {}) };
  }
  const parts = text.split(/\s+/);
  const type = parts[0]!;
  const indexed = parts[1] === 'indexed';
  const name = indexed ? parts[2] : parts[1];
  for (const loc of ['memory', 'calldata', 'storage']) if (name === loc) return { type, ...(indexed ? { indexed } : {}) };
  return { type, ...(name ? { name } : {}), ...(indexed ? { indexed } : {}) };
}

export class AbiLibrary {
  private functions = new Map<string, AbiEntry[]>();
  private events = new Map<string, AbiEntry[]>();
  private errors = new Map<string, AbiEntry[]>();
  private count = 0;

  get size(): number { return this.count; }

  /**
   * Add a JSON ABI (array of items, or {abi: [...]}) or a list of text
   * signatures. Invalid entries throw with their position; nothing is executed.
   */
  addJson(json: unknown, source: AbiSource, sourceLabel: string): number {
    const items = Array.isArray(json) ? json : (typeof json === 'object' && json !== null && Array.isArray((json as { abi?: unknown }).abi) ? (json as { abi: unknown[] }).abi : null);
    if (!items) throw new AbiError(`${sourceLabel}: expected a JSON ABI array or {"abi": [...]}`);
    if (items.length > 5000) throw new AbiError(`${sourceLabel}: more than 5000 ABI entries`);
    let added = 0;
    items.forEach((raw, i) => {
      let item: Record<string, unknown>;
      if (typeof raw === 'string') item = parseSignatureLine(raw);
      else if (typeof raw === 'object' && raw !== null) item = raw as Record<string, unknown>;
      else throw new AbiError(`${sourceLabel}[${i}]: not an ABI item`);
      try {
        const e = entryFromItem(item, typeof raw === 'string' && !/\s\w+\s*[,)]/.test(raw) ? 'signature' : source, sourceLabel);
        if (e) { this.add(e); added++; }
      } catch (err) {
        throw new AbiError(`${sourceLabel}[${i}]: ${err instanceof Error ? err.message : 'invalid entry'}`);
      }
    });
    return added;
  }

  add(e: AbiEntry): void {
    const map = e.kind === 'function' ? this.functions : e.kind === 'event' ? this.events : this.errors;
    const list = map.get(e.id) ?? [];
    list.push(e);
    map.set(e.id, list);
    this.count++;
  }

  functionsFor(selector: string): AbiEntry[] { return this.functions.get(selector.toLowerCase()) ?? []; }
  eventsFor(topic0: string): AbiEntry[] { return this.events.get(topic0.toLowerCase()) ?? []; }
  errorsFor(selector: string): AbiEntry[] { return this.errors.get(selector.toLowerCase()) ?? []; }

  merge(other: AbiLibrary): AbiLibrary {
    const out = new AbiLibrary();
    for (const lib of [this, other]) for (const map of [lib.functions, lib.events, lib.errors]) for (const list of map.values()) for (const e of list) out.add(e);
    return out;
  }
}

// ---------------------------------------------------------------- decoding

class Reader {
  notes = new Set<string>();
  elements = 0;
  constructor(readonly buf: Uint8Array) {}

  word(at: number): Uint8Array {
    if (at < 0 || at + 32 > this.buf.length) throw new AbiError(`read past end of data at byte ${at}`);
    return this.buf.subarray(at, at + 32);
  }
  uint(at: number): bigint {
    let v = 0n;
    for (const b of this.word(at)) v = (v << 8n) | BigInt(b);
    return v;
  }
  offset(at: number, base: number): number {
    const v = this.uint(at);
    if (v > BigInt(this.buf.length)) throw new AbiError(`offset ${v} beyond data (${this.buf.length} bytes)`);
    if (v % 32n !== 0n) this.notes.add('non-canonical (unaligned) offset');
    return base + Number(v);
  }
  count(n: number) {
    this.elements += n;
    if (this.elements > 50_000) throw new AbiError('too many elements');
  }
}

const hex = (b: Uint8Array) => '0x' + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

function decodeAt(r: Reader, t: T, at: number, base: number, depth: number): AbiValue {
  if (depth > MAX_DEPTH) throw new AbiError('value nesting too deep');
  // Dynamic types are referenced by an offset (relative to `base`) stored at `at`.
  if (isDynamic(t)) {
    const loc = r.offset(at, base);
    return decodeTail(r, t, loc, depth);
  }
  return decodeStatic(r, t, at, depth);
}

function decodeStatic(r: Reader, t: T, at: number, depth: number): AbiValue {
  switch (t.k) {
    case 'uint': {
      const v = r.uint(at);
      if (v >> BigInt(t.bits) !== 0n) throw new AbiError(`value does not fit uint${t.bits}`);
      return v.toString();
    }
    case 'int': {
      const raw = r.uint(at);
      const v = BigInt.asIntN(256, raw);
      if (BigInt.asIntN(t.bits, v) !== v) throw new AbiError(`value does not fit int${t.bits}`);
      return v.toString();
    }
    case 'address': {
      const w = r.word(at);
      if (w.subarray(0, 12).some((b) => b !== 0)) throw new AbiError('address with non-zero high bytes');
      return hex(w.subarray(12));
    }
    case 'bool': {
      const v = r.uint(at);
      if (v > 1n) throw new AbiError('bool other than 0 or 1');
      return v === 1n;
    }
    case 'fbytes': {
      const w = r.word(at);
      if (w.subarray(t.size).some((b) => b !== 0)) throw new AbiError(`bytes${t.size} with non-zero padding`);
      return hex(w.subarray(0, t.size));
    }
    case 'array': {
      r.count(t.len!);
      const out: AbiValue[] = [];
      for (let i = 0; i < t.len!; i++) out.push(decodeStatic(r, t.of, at + i * headSize(t.of), depth + 1));
      return out;
    }
    case 'tuple': return decodeTupleItems(r, t.items, at, depth + 1);
    default: throw new AbiError('unexpected dynamic type');
  }
}

function decodeTail(r: Reader, t: T, loc: number, depth: number): AbiValue {
  switch (t.k) {
    case 'bytes':
    case 'string': {
      const len = r.uint(loc);
      if (len > BigInt(r.buf.length - loc - 32)) throw new AbiError(`${t.k} length beyond data`);
      const n = Number(len);
      const data = r.buf.subarray(loc + 32, loc + 32 + n);
      const padded = Math.ceil(n / 32) * 32;
      if (loc + 32 + padded > r.buf.length) r.notes.add('non-canonical (unpadded) dynamic data');
      else if (r.buf.subarray(loc + 32 + n, loc + 32 + padded).some((b) => b !== 0)) r.notes.add('non-zero padding after dynamic data');
      if (t.k === 'bytes') return hex(data);
      let text: string;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(data); } catch { r.notes.add('string is not valid UTF-8; shown as hex'); return hex(data); }
      const clean = cleanUntrusted(text, 4000);
      if (clean?.altered) r.notes.add('string contained hidden/direction-control characters (removed for display)');
      return clean?.text ?? '';
    }
    case 'array': {
      let n: number; let start: number;
      if (t.len === null) {
        const len = r.uint(loc);
        // Each element occupies at least one 32-byte head word, so the data bounds the length.
        if (len > BigInt(Math.max(0, Math.floor((r.buf.length - loc - 32) / 32)))) throw new AbiError('array length beyond data');
        n = Number(len); start = loc + 32;
      } else { n = t.len; start = loc; }
      r.count(n);
      const out: AbiValue[] = [];
      const step = headSize(t.of);
      for (let i = 0; i < n; i++) out.push(decodeAt(r, t.of, start + i * step, start, depth + 1));
      return out;
    }
    case 'tuple': return decodeTupleItems(r, t.items, loc, depth + 1);
    default: return decodeStatic(r, t, loc, depth);
  }
}

function decodeTupleItems(r: Reader, items: Array<{ name: string | null; t: T }>, start: number, depth: number): AbiValue {
  const out: Record<string, AbiValue> = {};
  let cursor = start;
  items.forEach((it, i) => {
    out[it.name ?? String(i)] = decodeAt(r, it.t, cursor, start, depth);
    cursor += headSize(it.t);
  });
  return out;
}

function toBytes(data: string): Uint8Array | null {
  if (!/^0x([0-9a-fA-F]{2})*$/.test(data)) return null;
  const out = new Uint8Array((data.length - 2) / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(data.slice(2 + i * 2, 4 + i * 2), 16);
  return out;
}

const MAX_DATA_BYTES = 1_048_576;

/** Decode a parameter list (the bytes after a selector, or event data). */
function decodeParams(params: AbiParam[], data: Uint8Array): { params: DecodedParam[]; notes: string[] } {
  const r = new Reader(data);
  const types = params.map((p) => parseType(p));
  let cursor = 0;
  const out: DecodedParam[] = types.map((t, i) => {
    const value = decodeAt(r, t, cursor, 0, 0);
    cursor += headSize(t);
    return { name: params[i]!.name || null, type: canonical(t), value };
  });
  if (cursor < data.length && types.every((t) => !isDynamic(t))) r.notes.add(`${data.length - cursor} trailing byte(s) after the parameters`);
  return { params: out, notes: [...r.notes] };
}

function group(entries: AbiEntry[]): Array<{ entry: AbiEntry; sources: Candidate['sources'] }> {
  const by = new Map<string, { entry: AbiEntry; sources: Candidate['sources'] }>();
  for (const e of entries) {
    // Same signature AND same indexed layout = same decoding; keep every source.
    // (Parameter names may differ between sources; the first source's names are used.)
    const key = `${e.signature}|${e.inputs.map((p) => (p.indexed ? 'i' : '-')).join('')}`;
    const g = by.get(key);
    if (g) { if (!g.sources.some((s) => s.label === e.sourceLabel)) g.sources.push({ source: e.source, label: e.sourceLabel }); } else by.set(key, { entry: e, sources: [{ source: e.source, label: e.sourceLabel }] });
  }
  return [...by.values()];
}

function settle(id: string, candidates: Candidate[]): DecodeResult {
  if (candidates.length === 0) return { status: 'no-match', id, candidates };
  const ok = candidates.filter((c) => c.ok);
  const distinct = new Set(ok.map((c) => c.signature));
  if (ok.length === 0) return { status: 'no-valid-candidate', id, candidates };
  if (distinct.size > 1) return { status: 'ambiguous', id, candidates, note: 'More than one signature fits these bytes; TxStory does not choose between them.' };
  return { status: 'decoded', id, candidates };
}

/** Decode transaction input (calldata). */
export function decodeCalldata(input: string, lib: AbiLibrary): DecodeResult {
  const bytes = toBytes(input);
  if (!bytes) return { status: 'malformed', id: null, candidates: [], note: 'input is not hex' };
  if (bytes.length === 0) return { status: 'empty', id: null, candidates: [], note: 'no calldata (plain value transfer or fallback)' };
  if (bytes.length < 4) return { status: 'malformed', id: null, candidates: [], note: 'calldata shorter than a 4-byte selector' };
  if (bytes.length > MAX_DATA_BYTES + 4) return { status: 'malformed', id: null, candidates: [], note: 'calldata too large to decode' };
  const selector = hex(bytes.subarray(0, 4));
  return settle(selector, decodeWithEntries(group(lib.functionsFor(selector)), bytes.subarray(4)));
}

function decodeWithEntries(groups: Array<{ entry: AbiEntry; sources: Candidate['sources'] }>, body: Uint8Array): Candidate[] {
  return groups.map(({ entry, sources }) => {
    const base = { signature: entry.signature, name: entry.name, kind: entry.kind, sources };
    try {
      const { params, notes } = decodeParams(entry.inputs, body);
      return { ...base, ok: true, params, notes };
    } catch (err) {
      return { ...base, ok: false, error: err instanceof Error ? err.message : 'decode failed', notes: [] };
    }
  });
}

/** Revert data: Error(string), Panic(uint256), or a custom error from the library. */
export const PANIC_CODES: Record<string, string> = {
  '0': 'generic compiler-inserted panic', '1': 'assert(false) / internal error', '17': 'arithmetic overflow or underflow',
  '18': 'division or modulo by zero', '33': 'invalid enum value', '34': 'invalid storage byte array encoding',
  '49': 'pop() on an empty array', '50': 'array index out of bounds', '65': 'memory allocation too large', '81': 'call to an uninitialised function pointer',
};
const BUILTIN_ERRORS = (() => {
  const lib = new AbiLibrary();
  lib.addJson([{ type: 'error', name: 'Error', inputs: [{ name: 'message', type: 'string' }] }, { type: 'error', name: 'Panic', inputs: [{ name: 'code', type: 'uint256' }] }], 'builtin', 'Solidity built-in errors');
  return lib;
})();

export function decodeRevertData(data: string, lib: AbiLibrary): DecodeResult & { panic?: string } {
  const bytes = toBytes(data);
  if (!bytes) return { status: 'malformed', id: null, candidates: [], note: 'revert data is not hex' };
  if (bytes.length === 0) return { status: 'empty', id: null, candidates: [], note: 'no revert data (e.g. require without message, out of gas, or invalid opcode)' };
  if (bytes.length < 4) return { status: 'malformed', id: null, candidates: [], note: 'revert data shorter than a selector' };
  const selector = hex(bytes.subarray(0, 4));
  const entries = [...BUILTIN_ERRORS.errorsFor(selector), ...lib.errorsFor(selector)];
  const res = settle(selector, decodeWithEntries(group(entries), bytes.subarray(4)));
  const only = res.status === 'decoded' ? res.candidates.find((c) => c.ok) : undefined;
  if (only?.name === 'Panic' && only.signature === 'Panic(uint256)') {
    const code = String(only.params?.[0]?.value);
    return { ...res, panic: PANIC_CODES[code] ?? `panic code ${code}` };
  }
  return res;
}

/** Decode an event log. Topic 0 selects candidates; the indexed layout must fit the topics. */
export function decodeEventLog(log: { topics: string[]; data: string }, lib: AbiLibrary): DecodeResult {
  const topic0 = log.topics[0]?.toLowerCase();
  if (!topic0) return { status: 'no-match', id: null, candidates: [], note: 'anonymous event (no topics); not decoded' };
  const data = toBytes(log.data);
  if (!data) return { status: 'malformed', id: topic0, candidates: [], note: 'log data is not hex' };
  if (data.length > MAX_DATA_BYTES) return { status: 'malformed', id: topic0, candidates: [], note: 'log data too large to decode' };
  const groups = group(lib.eventsFor(topic0).filter((e) => !e.anonymous));
  const candidates: Candidate[] = groups.map(({ entry, sources }) => {
    const base = { signature: entry.signature, name: entry.name, kind: entry.kind, sources };
    const indexed = entry.inputs.filter((p) => p.indexed);
    if (indexed.length !== log.topics.length - 1) {
      return { ...base, ok: false, error: `expects ${indexed.length} indexed parameter(s), log has ${log.topics.length - 1}`, notes: [] };
    }
    try {
      const nonIndexed = entry.inputs.filter((p) => !p.indexed);
      const { params: dataParams, notes } = decodeParams(nonIndexed, data);
      let ti = 1; let di = 0;
      const params: DecodedParam[] = entry.inputs.map((p) => {
        if (!p.indexed) return dataParams[di++]!;
        const topic = log.topics[ti++]!;
        const t = parseType(p);
        if (isDynamic(t) || t.k === 'tuple' || t.k === 'array') return { name: p.name || null, type: canonical(t), value: topic.toLowerCase(), indexedHashOnly: true };
        const w = toBytes(topic);
        if (!w || w.length !== 32) throw new AbiError('topic is not 32 bytes');
        return { name: p.name || null, type: canonical(t), value: decodeStatic(new Reader(w), t, 0, 0) };
      });
      return { ...base, ok: true, params, notes };
    } catch (err) {
      return { ...base, ok: false, error: err instanceof Error ? err.message : 'decode failed', notes: [] };
    }
  });
  return settle(topic0, candidates);
}

/** Selector/topic for a signature string, for tooling and docs. */
export function idOf(kind: 'function' | 'event' | 'error', signatureLine: string): { signature: string; id: string } {
  const e = entryFromItem({ ...parseSignatureLine(signatureLine), type: kind }, 'signature', 'cli');
  if (!e) throw new AbiError('not a function, event or error');
  return { signature: e.signature, id: e.id };
}

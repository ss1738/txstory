/**
 * ABI decoding checked against an INDEPENDENT encoder: Foundry `cast`
 * (tests/vectors/abi-cast.json, regenerate with `node scripts/gen-abi-vectors.mjs`).
 * Decoding must recover the arguments cast encoded. A second comparison, with
 * Blockscout's own decodings of captured mainnet data, lives in the opt-in
 * captured suite (tests/captured/blockscout-decodings.test.ts).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AbiLibrary, decodeCalldata, decodeEventLog, decodeRevertData, idOf, parseSignatureLine, type AbiValue } from '../../src/core/abi.js';

const vectors = JSON.parse(readFileSync('tests/vectors/abi-cast.json', 'utf8')) as {
  calldata: Array<{ kind: 'function' | 'error'; signature: string; selector: string; data: string; expect: unknown[] }>;
  events: Array<{ abi: string; topics: string[]; data: string; expect: Record<string, unknown> }>;
};
const values = (params: Array<{ value: AbiValue }> | undefined) => (params ?? []).map((p) => p.value);

describe('ABI decoding vs cast (independent encoder)', () => {
  for (const v of vectors.calldata) {
    it(`${v.kind} ${v.signature}`, () => {
      const lib = new AbiLibrary();
      lib.addJson([`${v.kind} ${v.signature}`], 'user', 'vector');
      expect(idOf(v.kind, v.signature).id).toBe(v.selector);
      const r = v.kind === 'error' ? decodeRevertData(v.data, lib) : decodeCalldata(v.data, lib);
      expect(r.status).toBe('decoded');
      const ok = r.candidates.find((c) => c.ok)!;
      expect(values(ok.params)).toEqual(v.expect);
    });
  }
  it('decodes an event with nested tuple arrays (Seaport OrderFulfilled)', () => {
    const e = vectors.events.find((x) => x.abi.startsWith('event OrderFulfilled'))!;
    const lib = new AbiLibrary();
    lib.addJson([e.abi], 'user', 'vector');
    const r = decodeEventLog({ topics: e.topics, data: e.data }, lib);
    expect(r.status).toBe('decoded');
    const got = Object.fromEntries(r.candidates[0]!.params!.map((p) => [p.name, p.value]));
    expect({ orderHash: got.orderHash, offerer: got.offerer, zone: got.zone, recipient: got.recipient }).toEqual(e.expect);
    expect((got.consideration as Array<Record<string, string>>)[0]).toEqual({ itemType: '3', token: '0x1155115511551155115511551155115511551155', identifier: '10933', amount: '1', recipient: '0x5e11e75e11e75e11e75e11e75e11e75e11e75e11' });
  });
  it('decodes an event with indexed and dynamic data', () => {
    const e = vectors.events[0]!;
    const lib = new AbiLibrary();
    lib.addJson([e.abi], 'user', 'vector');
    const r = decodeEventLog({ topics: e.topics, data: e.data }, lib);
    expect(r.status).toBe('decoded');
    const got = Object.fromEntries(r.candidates[0]!.params!.map((p) => [p.name, p.value]));
    expect(got).toEqual(e.expect);
  });
  it('names Solidity panics', () => {
    const v = vectors.calldata.find((c) => c.signature === 'Panic(uint256)')!;
    expect(decodeRevertData(v.data, new AbiLibrary()).panic).toBe('arithmetic overflow or underflow');
  });
});

describe('ambiguity and strictness', () => {
  const collision = () => {
    const lib = new AbiLibrary();
    lib.addJson(['function burn(uint256 amount)'], 'user', 'token.json');
    lib.addJson(['function collate_propagate_storage(bytes16 x)'], 'user', 'other.json');
    return lib;
  };
  it('rejects a colliding candidate whose encoding is impossible for its types', () => {
    const v = vectors.calldata.find((c) => c.signature === 'burn(uint256)' && c.expect[0] === '1')!;
    const r = decodeCalldata(v.data, collision());
    expect(r.status).toBe('decoded');
    expect(r.candidates).toHaveLength(2);
    const bad = r.candidates.find((c) => !c.ok)!;
    expect(bad.signature).toBe('collate_propagate_storage(bytes16)');
    expect(bad.error).toMatch(/padding/);
  });
  it('reports both signatures when both fit, without choosing', () => {
    const v = vectors.calldata.find((c) => c.signature === 'burn(uint256)' && c.expect[0] !== '1')!;
    const r = decodeCalldata(v.data, collision());
    expect(r.status).toBe('ambiguous');
    expect(r.candidates.filter((c) => c.ok).map((c) => c.signature).sort()).toEqual(['burn(uint256)', 'collate_propagate_storage(bytes16)']);
  });
  it('tells ERC-20 from ERC-721 Transfer by the indexed layout', () => {
    const lib = new AbiLibrary();
    lib.addJson(['event Transfer(address indexed from, address indexed to, uint256 value)'], 'builtin', 'ERC-20');
    lib.addJson(['event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)'], 'builtin', 'ERC-721');
    const topic = idOf('event', 'Transfer(address,address,uint256)').id;
    const a = '0x' + '0'.repeat(24) + '11'.repeat(20);
    const r = decodeEventLog({ topics: [topic, a, a, '0x' + '0'.repeat(63) + '7'], data: '0x' }, lib);
    expect(r.status).toBe('decoded');
    expect(r.candidates.find((c) => c.ok)!.sources[0]!.label).toBe('ERC-721');
  });
  it('rejects malformed encodings instead of guessing', () => {
    const lib = new AbiLibrary();
    lib.addJson(['function f(address a)', 'function g(bool b)', 'function h(bytes b)'], 'user', 'x');
    const sel = (s: string) => idOf('function', s).id;
    expect(decodeCalldata(sel('f(address)') + 'ff'.repeat(32), lib).status).toBe('no-valid-candidate');
    expect(decodeCalldata(sel('g(bool)') + '0'.repeat(63) + '2', lib).status).toBe('no-valid-candidate');
    // Offset pointing beyond the data and an absurd length are rejected quickly.
    expect(decodeCalldata(sel('h(bytes)') + 'f'.repeat(64), lib).status).toBe('no-valid-candidate');
    expect(decodeCalldata(sel('h(bytes)') + '0'.repeat(62) + '20' + 'f'.repeat(64), lib).status).toBe('no-valid-candidate');
    expect(decodeCalldata('0x12', lib).status).toBe('malformed');
    expect(decodeCalldata('0x', lib).status).toBe('empty');
    expect(decodeCalldata('0x12345678', lib).status).toBe('no-match');
  });
  it('bounds array sizes', () => {
    const lib = new AbiLibrary();
    lib.addJson(['function k(uint256[] xs)'], 'user', 'x');
    const huge = idOf('function', 'k(uint256[])').id + '0'.repeat(62) + '20' + 'f'.repeat(64);
    const t0 = Date.now();
    expect(decodeCalldata(huge, lib).status).toBe('no-valid-candidate');
    expect(Date.now() - t0).toBeLessThan(200);
  });
  it('parses human-readable signatures with tuples, arrays and indexed', () => {
    expect(parseSignatureLine('event E((uint8 a, address[] b)[2] indexed s, string memo)')).toEqual({
      type: 'event', name: 'E', inputs: [
        { type: 'tuple[2]', components: [{ type: 'uint8', name: 'a' }, { type: 'address[]', name: 'b' }], name: 's', indexed: true },
        { type: 'string', name: 'memo' },
      ],
    });
    expect(() => new AbiLibrary().addJson(['function bad(fixed128x18 x)'], 'user', 'x')).toThrow(/unsupported type/);
    expect(() => new AbiLibrary().addJson({ nope: 1 }, 'user', 'x')).toThrow(/expected a JSON ABI/);
  });
});

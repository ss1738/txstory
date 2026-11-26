/**
 * Reconstruction from recordings (src/engine/reconstruct.ts), used by both
 * `txstory replay` and the browser's "Open a recording".
 *
 * These tests rebuild stories from raw recorded responses and compare digests;
 * they do not read the stored output to produce the story. Tampered copies are
 * made in memory from the shipped public-safe recordings.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { build } from 'esbuild';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { engineConfigFromEnv } from '../../src/engine/config.js';
import { parseRecording, type Recording } from '../../src/engine/recording.js';
import { reconstruct, RECONSTRUCTION_SCOPE } from '../../src/engine/reconstruct.js';

const config = engineConfigFromEnv({});
const SHIPPED = ['fixtures/synthetic', 'fixtures/devnet'].flatMap((d) => readdirSync(d).filter((f) => /0x[0-9a-f]{64}\.json$/.test(f)).map((f) => `${d}/${f}`));
const load = (path: string): Recording => parseRecording(readFileSync(path, 'utf8'));
const SWAP = 'fixtures/synthetic/ethereum-0xefb65ab1ab71b94063c0ee8e8c7bdde47b808c19f4e653ed931e3006f4983112.json';
const PENDING = 'fixtures/synthetic/ethereum-0xfbd6ef4b1d90c6e64d9359183593362d5e10d28f28a023c608b796e979c8494f.json';
const DEVNET = 'fixtures/devnet/anvil-0xdce671e4526d6d277669b28b2a9108c3f291951eb893a8d716101d94a2640359.json';

describe('reconstruction never uses the network', () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  beforeEach(() => { calls = 0; globalThis.fetch = (async () => { calls++; throw new Error('network used during reconstruction'); }) as typeof fetch; });
  afterEach(() => { globalThis.fetch = realFetch; });

  it('rebuilds every shipped recording to its stored digests with fetch disabled', async () => {
    expect(SHIPPED.length).toBeGreaterThanOrEqual(21);
    for (const path of SHIPPED) {
      const { report } = await reconstruct(load(path), config);
      if (path === PENDING) {
        expect(report.verdict, path).toBe('no-story');
        expect(report.result.kind).toBe('pending');
      } else {
        expect(report.verdict, path).toBe('reproduced');
        expect(report.check.sameEvidence && report.check.sameOutput, path).toBe(true);
      }
    }
    expect(calls).toBe(0);
  });
});

describe('reconstruction report', () => {
  it('describes what the recording contains and which engine rebuilt it', async () => {
    const { report } = await reconstruct(load(DEVNET), config);
    expect(report.recording).toMatchObject({ network: 'anvil', origin: 'local-devnet', schema: 'txstory-fixture-v3', engineVersion: '0.3.0' });
    expect(report.recording.exchanges.total).toBe(report.recording.exchanges.rpc + report.recording.exchanges.explorer);
    expect(report.engine.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(report.missing).toEqual([]);
    expect(report.notes.at(-1)).toBe(RECONSTRUCTION_SCOPE);
    expect(RECONSTRUCTION_SCOPE).toMatch(/does not re-execute EVM code/);
  });

  it('reports a changed response as different evidence and different output', async () => {
    const rec = load(SWAP);
    const key = Object.keys(rec.exchanges).find((k) => rec.exchanges[k]!.kind === 'rpc' && rec.exchanges[k]!.method === 'eth_getTransactionReceipt')!;
    const ex = rec.exchanges[key]!;
    // Change the receipt's gasUsed: a different response, so different evidence and a different fee.
    const parsed = JSON.parse(ex.text);
    parsed.result.gasUsed = '0x' + (BigInt(parsed.result.gasUsed) + 1n).toString(16);
    ex.text = JSON.stringify(parsed);
    const { report } = await reconstruct(rec, config);
    expect(report.verdict).toBe('differs');
    expect(report.check.sameEvidence).toBe(false);
    expect(report.check.sameOutput).toBe(false);
    expect(report.differences).toBeNull(); // no embedded story to compare with
    expect(report.notes.join(' ')).toMatch(/does not embed its original story/);
  });

  it('lists field-level differences when the recording embeds its original story', async () => {
    const original = load(SWAP);
    const embedded = (await reconstruct(original, config)).result;
    if (embedded.kind !== 'ok') throw new Error('expected a story');
    const rec = load(SWAP);
    rec.output = { ...rec.output!, story: embedded.story };
    const key = Object.keys(rec.exchanges).find((k) => rec.exchanges[k]!.method === 'eth_getTransactionReceipt')!;
    const parsed = JSON.parse(rec.exchanges[key]!.text);
    parsed.result.gasUsed = '0x' + (BigInt(parsed.result.gasUsed) + 1n).toString(16);
    rec.exchanges[key]!.text = JSON.stringify(parsed);
    const { report } = await reconstruct(rec, config);
    expect(report.verdict).toBe('differs');
    expect(report.differences?.factsAgree).toBe(false);
    expect(report.differences?.differences.some((d) => d.area === 'fees')).toBe(true);
  });

  it('lists requests the recording cannot answer instead of fetching them', async () => {
    const rec = load(SWAP);
    const key = Object.keys(rec.exchanges).find((k) => rec.exchanges[k]!.kind === 'explorer')!;
    delete rec.exchanges[key];
    const { report, result } = await reconstruct(rec, config);
    expect(report.missing.length).toBeGreaterThan(0);
    expect(report.missing.every((m) => m.provider && m.method)).toBe(true);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(Object.values(result.story.completeness)).toContain('unavailable');
    expect(report.notes.join(' ')).toMatch(/had no recorded answer/);
  });

  it('attributes a different output to user-supplied ABIs, not to an edited recording', async () => {
    const { AbiLibrary } = await import('../../src/core/abi.js');
    const library = new AbiLibrary();
    const entries = library.addJson(JSON.parse(readFileSync('fixtures/devnet/Demo.abi.json', 'utf8')), 'user', 'Demo.abi.json');
    const rec = load('fixtures/devnet/anvil-0x27dbc58bd2861be2ea7264fd2d03aa97510ebc7ff3e00ab59a0bb114cbbe4aab.json');
    const { report, result } = await reconstruct(rec, config, { userAbi: { library, labels: [{ label: 'Demo.abi.json', entries }] } });
    expect(report.userAbis).toEqual([{ label: 'Demo.abi.json', entries }]);
    expect(report.check.sameEvidence).toBe(true);
    expect(report.check.sameOutput).toBe(false);
    expect(report.notes.join(' ')).toMatch(/decodes with ABIs you supplied \(Demo\.abi\.json\)/);
    expect(report.notes.join(' ')).not.toMatch(/edited recording/);
    if (result.kind !== 'ok') throw new Error('expected a story');
    expect(result.story.revert?.summary).toBe('InsufficientBalance(available="1000000000000000000", required="5")');
  });

  it('says when there is no stored digest to compare with', async () => {
    const rec = load(SWAP);
    delete rec.output;
    const { report } = await reconstruct(rec, config);
    expect(report.verdict).toBe('no-digest');
    expect(report.check.sameOutput).toBeNull();
  });

  it('counts recorded exchanges the engine did not request', async () => {
    const rec = load(SWAP);
    rec.exchanges['f'.repeat(32)] = { kind: 'rpc', provider: 'x', method: 'eth_unused', url: 'https://unused.invalid', httpStatus: 200, retrievedAt: rec.recordedAt, text: '{}' };
    const { report } = await reconstruct(rec, config);
    expect(report.unusedExchanges).toBe(1);
    expect(report.verdict).toBe('reproduced');
  });
});

describe('untrusted recording input', () => {
  const base = () => JSON.parse(readFileSync(SWAP, 'utf8')) as Record<string, unknown>;
  const rejects = (v: unknown, re: RegExp) => expect(() => parseRecording(typeof v === 'string' ? v : JSON.stringify(v))).toThrow(re);

  it('rejects malformed text, wrong types and unknown schemas with a reason', () => {
    rejects('{"schema":', /not valid JSON/);
    rejects('[]', /not an object/);
    rejects({ ...base(), schema: 'txstory-fixture-v99' }, /unknown schema/);
    rejects({ ...base(), hash: '0x1234' }, /hash/);
    rejects({ ...base(), origin: 'mainnet' }, /origin/);
  });

  it('bounds structure depth, labels, endpoints and requested work', () => {
    let deep: unknown = 1;
    for (let i = 0; i < 100; i++) deep = { d: deep };
    rejects({ ...base(), extra: deep }, /nested deeper/);
    rejects({ ...base(), description: 'x'.repeat(5000) }, /description/);
    rejects({ ...base(), endpoints: { rpcs: Array.from({ length: 50 }, () => ({ url: 'https://a.invalid', provider: 'p' })), explorerApi: null } }, /endpoints/);
    rejects({ ...base(), config: { maxExplorerPages: 1_000_000, maxTokenMetadataCalls: 0, explorerApiKeyUsed: false } }, /config/);
    rejects({ ...base(), output: { stage: 'full', kind: 'ok', storySha256: 'not-a-digest' } }, /output/);
    rejects({ ...base(), output: { stage: 'full', kind: 'ok', storySha256: null, story: { ledger: 'x' } } }, /output\.story/);
  });

  it('never redefines a built-in network from a recording', () => {
    rejects({ ...base(), network: { key: 'ethereum', chainId: 1, name: 'Fake', nativeSymbol: 'ETH', feeModel: 'ethereum-l1' } }, /built-in/);
  });

  it('treats embedded URLs as data: a recording pointing at a live host is still answered only from its exchanges', async () => {
    const raw = base();
    (raw as { endpoints: unknown }).endpoints = { rpcs: [{ url: 'https://attacker.invalid/rpc', provider: 'hostile' }], explorerApi: 'https://attacker.invalid' };
    const realFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => { calls++; throw new Error('fetched'); }) as typeof fetch;
    try {
      const { report } = await reconstruct(parseRecording(JSON.stringify(raw)), config);
      // The request URLs change, so nothing in the recording matches: everything is missing, nothing is fetched.
      expect(report.result.kind).not.toBe('ok');
      expect(calls).toBe(0);
    } finally { globalThis.fetch = realFetch; }
  });
});

describe('browser safety', () => {
  it('the reconstruction path bundles for browsers without Node built-ins', async () => {
    const out = await build({ entryPoints: ['src/engine/reconstruct.ts'], bundle: true, platform: 'browser', format: 'esm', write: false, logLevel: 'silent', metafile: true });
    const inputs = Object.keys(out.metafile!.inputs);
    expect(inputs.some((i) => i.includes('node:') || /engine\/(config|fixture-files)\.ts$/.test(i))).toBe(false);
    expect(out.outputFiles[0]!.text).not.toMatch(/\bBuffer\.from\b|require\("node:/);
  });
});

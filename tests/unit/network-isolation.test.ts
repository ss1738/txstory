/**
 * Each reconstruction uses its own recording's validated network definition.
 *
 * Regression: replay used to register a recording's custom network in the
 * shared registry, and skipped registration when the key already existed. A
 * second recording with the same key but a different definition was then
 * analysed with the first one's name, native symbol, chain id and fee model,
 * and the first recording's own verdict depended on which file was opened
 * before it.
 *
 * Expected digests here are the ones stored in the shipped recording; nothing
 * is recomputed to fit the result.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getChain, isChainKey, registerChain } from '../../src/core/chains.js';
import type { Story } from '../../src/core/types.js';
import { assembleStory } from '../../src/engine/analyze.js';
import { engineConfigFromEnv } from '../../src/engine/config.js';
import { parseRecording, recordingNetwork, registerRecordingNetwork, type Recording } from '../../src/engine/recording.js';
import { reconstruct } from '../../src/engine/reconstruct.js';
import { replayTransport, type Transport } from '../../src/engine/transport.js';
import { createApp } from '../../src/server/app.js';
import { loadConfig } from '../../src/server/config.js';

const config = engineConfigFromEnv({});
const PAY = 'fixtures/devnet/anvil-0xdce671e4526d6d277669b28b2a9108c3f291951eb893a8d716101d94a2640359.json';
const SPLIT = 'fixtures/devnet/anvil-0xa4d670d57f77054e10b64484d96899664322ec83582abc1b351a6d85e4946cb1.json';
const PAY_TEXT = readFileSync(PAY, 'utf8');

/** The shipped recording, unchanged. */
const A = (): Recording => parseRecording(PAY_TEXT);
/** The same responses with a conflicting definition of the same custom network key. */
const B = (change: Record<string, unknown> = { name: 'Other devnet', nativeSymbol: 'XYZ', chainId: 4242, feeModel: 'op-stack' }): Recording => {
  const r = JSON.parse(PAY_TEXT);
  r.network = { ...r.network, ...change };
  return parseRecording(JSON.stringify(r));
};
const STORED_A_DIGEST: string = JSON.parse(PAY_TEXT).output.storySha256;

async function run(rec: Recording) {
  const { report, result } = await reconstruct(rec, config);
  if (result.kind !== 'ok') throw new Error(`${result.kind}: ${result.message}`);
  return { report, story: result.story };
}

function expectA(r: { report: Awaited<ReturnType<typeof run>>['report']; story: Story }) {
  expect(r.story.network).toMatchObject({ key: 'anvil', name: 'Anvil devnet', nativeSymbol: 'ETH', chainId: 31337 });
  expect(r.story.assets.native?.symbol).toBe('ETH');
  expect(r.report.verdict).toBe('reproduced');
  expect(r.report.check.replayDigest).toBe(STORED_A_DIGEST);
}

function expectB(r: { report: Awaited<ReturnType<typeof run>>['report']; story: Story }) {
  expect(r.story.network).toMatchObject({ key: 'anvil', name: 'Other devnet', nativeSymbol: 'XYZ', chainId: 4242 });
  expect(r.story.assets.native?.symbol).toBe('XYZ');
  // B's stored digest belongs to A's definition, so B honestly differs.
  expect(r.report.verdict).toBe('differs');
  expect(r.report.check.replayDigest).not.toBe(STORED_A_DIGEST);
}

describe('each reconstruction uses its own network definition', () => {
  it('A then B, and B then A', async () => {
    expectA(await run(A()));
    expectB(await run(B()));
    expectB(await run(B()));
    expectA(await run(A()));
  });

  it('a conflicting fee model changes only the recording that declares it', async () => {
    const a = await run(A());
    const b = await run(B({ feeModel: 'op-stack' }));
    const a2 = await run(A());
    expect(a.story.fees.components.map((c) => c.kind)).toEqual(a2.story.fees.components.map((c) => c.kind));
    expect(b.story.fees).not.toEqual(a.story.fees);
    expect(a2.report.check.replayDigest).toBe(STORED_A_DIGEST);
  });

  it('repeated reconstruction gives the same digest and verdict', async () => {
    const digests = new Set<string | null>();
    for (let i = 0; i < 5; i++) { const r = await run(i % 2 ? A() : A()); digests.add(r.report.check.replayDigest); expect(r.report.verdict).toBe('reproduced'); }
    expect([...digests]).toEqual([STORED_A_DIGEST]);
  });

  it('concurrent reconstructions of conflicting definitions do not affect each other', async () => {
    const jobs = Array.from({ length: 12 }, (_, i) => (i % 2 ? B() : A()));
    const results = await Promise.all(jobs.map(run));
    results.forEach((r, i) => (i % 2 ? expectB(r) : expectA(r)));
  });

  it('interleaved analyses with delayed responses keep their own definitions', async () => {
    const delayed = (t: Transport, ms: () => number): Transport => ({ send: async (req) => { await new Promise((r) => setTimeout(r, ms())); return t.send(req); } });
    const analyse = (rec: Recording) => assembleStory(rec.chain, rec.hash, delayed(replayTransport(rec), () => Math.floor(Math.random() * 8)), {
      ...config, endpoints: { ...config.endpoints, anvil: { rpcs: rec.endpoints!.rpcs, explorerApi: rec.endpoints!.explorerApi, explorerProvider: 'Blockscout' } },
    }, { network: recordingNetwork(rec), stage: 'full', trace: rec.options?.trace ?? 'off' });
    const recs = Array.from({ length: 10 }, (_, i) => (i % 2 ? B() : A()));
    const out = await Promise.all(recs.map(analyse));
    out.forEach((r, i) => {
      if (r.kind !== 'ok') throw new Error(r.kind);
      expect(r.story.network.name).toBe(i % 2 ? 'Other devnet' : 'Anvil devnet');
    });
  });

  it('reconstruction does not register or change networks in the shared registry', async () => {
    const r = JSON.parse(PAY_TEXT);
    r.chain = 'isolated-net'; r.network = { ...r.network, key: 'isolated-net', name: 'Isolated' };
    const rec = parseRecording(JSON.stringify(r));
    const before = isChainKey('anvil') ? { ...getChain('anvil') } : null;
    const { result } = await reconstruct(rec, config);
    expect(result.kind === 'ok' && result.story.network.name).toBe('Isolated');
    expect(isChainKey('isolated-net')).toBe(false);
    expect(isChainKey('anvil') ? getChain('anvil') : null).toEqual(before);
  });

  it('a recording embeds its own definition even when a chain file registered the key differently', async () => {
    registerChain({ ...recordingNetwork(A()), name: 'From a chain file', nativeSymbol: 'CF' });
    try {
      expectA(await run(A()));
      expectB(await run(B()));
    } finally {
      registerChain(recordingNetwork(A()));
    }
  });
});

describe('built-in networks stay protected', () => {
  it('a recording cannot redefine a built-in network, and built-in replays use the built-in definition', async () => {
    const r = JSON.parse(PAY_TEXT);
    expect(() => parseRecording(JSON.stringify({ ...r, chain: 'ethereum', network: { ...r.network, key: 'ethereum' } }))).toThrow(/built-in/);
    expect(() => registerChain({ ...getChain('ethereum'), name: 'Fake' })).toThrow(/built-in/);
    await run(B()); // a conflicting custom definition first
    const swap = parseRecording(readFileSync('fixtures/synthetic/ethereum-0xefb65ab1ab71b94063c0ee8e8c7bdde47b808c19f4e653ed931e3006f4983112.json', 'utf8'));
    const s = await reconstruct(swap, config);
    expect(s.report.verdict).toBe('reproduced');
    expect(s.result.kind === 'ok' && s.result.story.network).toMatchObject({ key: 'ethereum', name: 'Ethereum', chainId: 1, builtin: true });
  });
});

describe('server with conflicting recordings of one network key', () => {
  it('warns at startup and serves each example with its own definition', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'txstory-netconflict-'));
    writeFileSync(join(dir, PAY.split('/').pop()!), PAY_TEXT);
    const split = JSON.parse(readFileSync(SPLIT, 'utf8'));
    split.network = { ...split.network, name: 'Other devnet', nativeSymbol: 'XYZ', chainId: 4242 };
    writeFileSync(join(dir, SPLIT.split('/').pop()!), JSON.stringify(split));
    const warnings: Array<Record<string, unknown>> = [];
    const app = createApp({ config: loadConfig({ mode: 'recorded', fixturesDir: dir, logRequests: false }), warn: (e) => warnings.push(e) });
    expect(warnings.map((w) => w.event)).toEqual(['recording-network-conflict']);
    expect(warnings[0]).toMatchObject({ network: 'anvil' });
    const server = createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const story = async (file: string) => (await (await fetch(`${base}/api/example/anvil/${/0x[0-9a-f]{64}/.exec(file)![0]}?stage=full`)).json()).story as Story;
      const [pay, sp, pay2] = [await story(PAY), await story(SPLIT), await story(PAY)];
      expect(pay.network.name).toBe('Anvil devnet');
      expect(sp.network).toMatchObject({ name: 'Other devnet', nativeSymbol: 'XYZ', chainId: 4242 });
      expect(pay2.network.name).toBe('Anvil devnet');
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('registerRecordingNetwork reports known, registered and conflicting definitions', () => {
    expect(registerRecordingNetwork(A())).toMatch(/^(registered|known)$/);
    expect(registerRecordingNetwork(A())).toBe('known');
    expect(registerRecordingNetwork(B())).toBe('conflict');
    expect(getChain('anvil').name).toBe('Anvil devnet');
  });
});

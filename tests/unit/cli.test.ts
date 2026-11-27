/**
 * CLI behaviour: exit codes, stdout/stderr separation, JSON on stdout, no
 * credential echo, and every offline example in docs/cli.md (no network).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { main } from '../../src/cli/main.js';

async function run(args: string[], env: Record<string, string | undefined> = {}) {
  const out: string[] = []; const err: string[] = [];
  const code = await main(args, { out: (s) => out.push(s), err: (s) => err.push(s), env });
  return { code, stdout: out.join('\n'), stderr: err.join('\n') };
}
const splitArgs = (line: string) => [...line.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]!);

describe('docs/cli.md offline examples', () => {
  const doc = readFileSync('docs/cli.md', 'utf8');
  const examples = [...doc.matchAll(/^\$ txstory (.+?)\s+# exit (\d)$/gm)].map((m) => ({ args: splitArgs(m[1]!), exit: Number(m[2]) }));
  it('found the examples', () => expect(examples.length).toBeGreaterThanOrEqual(10));
  for (const ex of examples) {
    it(`txstory ${ex.args.join(' ').slice(0, 90)} → ${ex.exit}`, async () => {
      const r = await run(ex.args);
      expect(r.code, r.stderr).toBe(ex.exit);
      if (ex.args.includes('--json')) expect(() => JSON.parse(r.stdout)).not.toThrow();
    });
  }
});

describe('CLI conventions', () => {
  const rec = 'fixtures/synthetic/ethereum-0xefb65ab1ab71b94063c0ee8e8c7bdde47b808c19f4e653ed931e3006f4983112.json';
  it('emits one JSON document on stdout, also for errors, with the message on stderr', async () => {
    const ok = await run(['explain', '--recording', rec, '--json']);
    const doc = JSON.parse(ok.stdout);
    expect(doc).toMatchObject({ command: 'explain', ok: true });
    expect(doc.story.ledger.length).toBeGreaterThan(0);
    const bad = await run(['explain', 'ethereum', '0x12', '--json']);
    expect(bad.code).toBe(2);
    expect(JSON.parse(bad.stdout)).toMatchObject({ ok: false, error: { code: 'usage' } });
    expect(bad.stderr).toMatch(/hash/);
  });
  it('keeps exact amounts in human output', async () => {
    const r = await run(['explain', '--recording', rec]);
    expect(r.stdout).toContain('−1,000 TAXT');
    expect(r.stdout).toContain('synthetic data');
    expect(r.stdout).toContain('Cross-check:');
  });
  it('never echoes credentials from provider URLs', async () => {
    const secret = ['sk', 'live', 'abcdefghijklmnopqrstuvwxyz0123'].join('_');
    const r = await run(['networks', '--json', '--rpc', `https://rpc.example/v2/${secret}?apikey=${secret}`], { TXSTORY_RPC_ETHEREUM: `https://user:${secret}@rpc.example/` });
    expect(r.stdout + r.stderr).not.toContain(secret);
    // Configured endpoints are withheld entirely in shareable output, host included.
    expect(r.stdout).toContain('https://rpc-1.withheld.invalid/');
    expect(r.stdout).not.toContain('rpc.example');
  });
  it('rejects unknown options and commands as usage errors', async () => {
    expect((await run(['explain', '--nope'])).code).toBe(2);
    expect((await run(['frobnicate'])).code).toBe(2);
    expect((await run([])).code).toBe(2);
  });
  it('reports invalid input files with exit 5', async () => {
    expect((await run(['explain', '--recording', 'package.json'])).code).toBe(5);
    expect((await run(['decode', 'calldata', '--data', '0x12345678', '--abi', 'package.json'])).code).toBe(5);
    expect((await run(['networks', '--chains', 'package.json'])).code).toBe(5);
  });
  it('compare explains differences and exits 1; identical inputs exit 0', async () => {
    const a = 'fixtures/devnet/anvil-0x27dbc58bd2861be2ea7264fd2d03aa97510ebc7ff3e00ab59a0bb114cbbe4aab.json';
    expect((await run(['compare', a, a])).code).toBe(0);
    const b = 'fixtures/devnet/anvil-0x530d21f512dc5ddfc40326a913dc248092602dbdd151fd92a413123a02ada918.json';
    const r = await run(['compare', a, b, '--json']);
    expect(r.code).toBe(1);
    const c = JSON.parse(r.stdout).comparison;
    expect(c.sameTransaction).toBe(false);
    expect(c.differences[0].area).toBe('identity');
  });
});

describe('replay with --abi', () => {
  const REC = 'fixtures/devnet/anvil-0x27dbc58bd2861be2ea7264fd2d03aa97510ebc7ff3e00ab59a0bb114cbbe4aab.json';
  it('decoding with a supplied ABI is the requested result: exit 0, evidence unchanged, report says why the output changed', async () => {
    const r = await run(['replay', REC, '--abi', 'fixtures/devnet/Demo.abi.json', '--json']);
    expect(r.code).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(j.ok).toBe(true);
    expect(j.report.check).toMatchObject({ sameEvidence: true, sameOutput: false });
    expect(j.report.differsOnlyByUserAbis).toBe(true);
    expect(j.story.revert.summary).toBe('InsufficientBalance(available="1000000000000000000", required="5")');
  });
  it('an edited recording still fails with --abi: changed evidence is never excused', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const rec = JSON.parse(readFileSync(REC, 'utf8'));
    const key = Object.keys(rec.exchanges).find((k) => rec.exchanges[k].method === 'eth_getTransactionReceipt')!;
    const receipt = JSON.parse(rec.exchanges[key].text);
    receipt.result.gasUsed = '0x' + (BigInt(receipt.result.gasUsed) + 1n).toString(16);
    rec.exchanges[key].text = JSON.stringify(receipt);
    const file = `${mkdtempSync(`${tmpdir()}/txstory-abi-`)}/edited.json`;
    writeFileSync(file, JSON.stringify(rec));
    const r = await run(['replay', file, '--abi', 'fixtures/devnet/Demo.abi.json', '--json']);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout).report).toMatchObject({ verdict: 'differs', differsOnlyByUserAbis: false });
  });
});


/**
 * Credentials in configured provider URLs never reach shareable output.
 *
 * All credentials here are synthetic. Responses come from the synthetic swap
 * case (scripts/synthetic-fixtures.ts) served behind custom endpoints whose
 * URLs carry a query key, userinfo, a short path token and hostname tokens,
 * plus an explorer with a path token and an API key. The first RPC node
 * answers every call with a JSON-RPC limit error that echoes several of those
 * secrets (a nested provider error), so the client falls back to the second.
 */
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { SyntheticProvider } from '../../scripts/synthetic-fixtures.js';
import { buildEvidenceBundle } from '../../src/client/lib/exporters.js';
import { main } from '../../src/cli/main.js';
import { engineConfigFromEnv } from '../../src/engine/config.js';
import { parseRecording, recordAnalysis } from '../../src/engine/recording.js';
import { reconstruct } from '../../src/engine/reconstruct.js';
import type { Transport, TransportResponse } from '../../src/engine/transport.js';
import { createApp } from '../../src/server/app.js';
import { loadConfig } from '../../src/server/config.js';
import { allCases, txHash } from '../synthetic/cases.js';

const SECRETS = {
  query: 'Q9q8q7',
  userinfo: 'SYNTHpw4321',
  shortPath: 'AB12cd34',
  hostToken: 'tok9x8y7z6',
  secondHost: 'ab3hostkey',
  explorerPath: 'Ex1pl0rer',
  explorerKey: 'EXPKEY7777',
};
// Hosts are not secret by themselves, but withheld endpoints must not reveal them either.
const HOSTS = ['rpc.example.com', 'second.example', 'explorer.example.org'];
const RPC1 = `https://user:${SECRETS.userinfo}@${SECRETS.hostToken}.rpc.example.com/k/${SECRETS.shortPath}?apikey=${SECRETS.query}`;
const RPC2 = `https://${SECRETS.secondHost}.second.example/`;
const EXPLORER = `https://explorer.example.org/x/${SECRETS.explorerPath}`;
const ENV = { TXSTORY_RPC_ETHEREUM: `${RPC1},${RPC2}`, TXSTORY_EXPLORER_ETHEREUM: EXPLORER, TXSTORY_BLOCKSCOUT_API_KEY: SECRETS.explorerKey, TXSTORY_TRACE: 'off' };

const vectors = JSON.parse(readFileSync('tests/vectors/abi-cast.json', 'utf8'));
const swap = allCases(vectors).find((c) => c.hash === txHash('swap-fee-on-transfer'))!;
const provider = new SyntheticProvider(swap);
const echoed = `limit exceeded for key ${SECRETS.shortPath} on ${SECRETS.hostToken} (user ${SECRETS.userinfo}, apikey ${SECRETS.query})`;
const live: Transport = {
  send: async (req): Promise<TransportResponse> => {
    if (req.kind === 'rpc' && req.url === RPC1) {
      const text = JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32005, message: echoed } });
      return { ok: true, httpStatus: 200, text, sha256: '', retrievedAt: '2026-11-27T00:00:00.000Z', mode: 'live' };
    }
    return provider.send(req);
  },
};

const leaks = (label: string, text: string) => {
  for (const [name, value] of Object.entries(SECRETS)) expect(text, `${label}: ${name}`).not.toContain(value);
  for (const host of HOSTS) expect(text, `${label}: ${host}`).not.toContain(host);
};

describe('credential-bearing endpoints in shareable output', () => {
  it('recordings, stories, evidence exports and replay reports contain no credentials, and still rebuild offline', async () => {
    const config = engineConfigFromEnv(ENV);
    const { result, recording } = await recordAnalysis('ethereum', swap.hash, live, config, { stage: 'full', embedStory: true });
    if (result.kind !== 'ok') throw new Error(`${result.kind}: ${result.message}`);
    const recordingText = JSON.stringify(recording);
    leaks('recording', recordingText);
    leaks('story', JSON.stringify(result.story));
    leaks('evidence bundle', JSON.stringify(buildEvidenceBundle(result.story)));

    // Provenance is kept in withheld form: provider labels, placeholder URLs, and the scrubbed fallback reason.
    expect(recording.endpoints?.rpcs).toEqual([
      { url: 'https://rpc-1.withheld.invalid/', provider: 'custom RPC 1' },
      { url: 'https://rpc-2.withheld.invalid/', provider: 'custom RPC 2' },
    ]);
    expect(recording.endpoints?.explorerApi).toBe('https://explorer.withheld.invalid/');
    const tx = result.story.sources.find((s) => s.method === 'eth_getTransactionByHash')!;
    expect(tx).toMatchObject({ provider: 'custom RPC 2', url: 'https://rpc-2.withheld.invalid/', status: 'ok' });
    expect(tx.note).toContain('custom RPC 1: RPC error: limit exceeded for key REDACTED on REDACTED');
    expect(result.story.sources.some((s) => s.kind === 'explorer' && s.url.startsWith('https://explorer.withheld.invalid/api/v2/transactions/'))).toBe(true);

    // The shareable recording alone rebuilds to the same evidence and output, with no network.
    const { report } = await reconstruct(parseRecording(recordingText), engineConfigFromEnv({}));
    expect(report).toMatchObject({ verdict: 'reproduced', missing: [] });
    leaks('replay report', JSON.stringify(report));
  });

  it('CLI networks output and URL-bearing errors withhold configured endpoints', async () => {
    const out: string[] = [];
    const io = { out: (s: string) => out.push(s), err: (s: string) => out.push(s), env: ENV };
    expect(await main(['networks', '--json'], io)).toBe(0);
    expect(await main(['networks'], io)).toBe(0);
    leaks('networks', out.join('\n'));
    expect(out.join('\n')).toContain('https://rpc-1.withheld.invalid/');
  });

  it('HTTP API story and recording responses contain no credentials', async () => {
    const engine = engineConfigFromEnv(ENV);
    const app = createApp({ config: loadConfig({ mode: 'live', endpoints: engine.endpoints, explorerApiKey: engine.explorerApiKey, trace: 'off', logRequests: false }), liveTransport: live, warn: () => undefined });
    const server = createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      for (const path of [`/api/story/ethereum/${swap.hash}?stage=full`, `/api/recording/ethereum/${swap.hash}`, '/api/chains']) {
        const res = await fetch(base + path);
        expect(res.status, path).toBe(200);
        leaks(path, await res.text());
      }
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});

describe('which provider URLs are shown', () => {
  it('trusts only exact built-in endpoints, explicitly listed endpoints, and bare loopback origins', async () => {
    const { isTrustedEndpointUrl, secretFragments } = await import('../../src/engine/defaults.js');
    expect(isTrustedEndpointUrl('https://ethereum-rpc.publicnode.com')).toBe(true);
    expect(isTrustedEndpointUrl('https://ethereum-rpc.publicnode.com/')).toBe(true);
    expect(isTrustedEndpointUrl('https://eth.blockscout.com')).toBe(true);
    expect(isTrustedEndpointUrl('http://127.0.0.1:8545/')).toBe(true);
    // A trusted host does not approve other paths, queries, userinfo or lookalike hosts.
    expect(isTrustedEndpointUrl('https://ethereum-rpc.publicnode.com/Ab1cD2')).toBe(false);
    expect(isTrustedEndpointUrl('https://ethereum-rpc.publicnode.com/?x=1')).toBe(false);
    expect(isTrustedEndpointUrl('https://user:pw@ethereum-rpc.publicnode.com/')).toBe(false);
    expect(isTrustedEndpointUrl('https://ethereum-rpc.publicnode.com.attacker.example/')).toBe(false);
    expect(isTrustedEndpointUrl('http://127.0.0.1:8545/k/x1')).toBe(false);
    expect(isTrustedEndpointUrl('http://u:p@localhost:8545/')).toBe(false);
    // Reserved domains are not trusted by themselves; the synthetic generator lists its endpoints explicitly.
    expect(isTrustedEndpointUrl('https://rpc.synthetic.invalid/ethereum')).toBe(false);
    expect(isTrustedEndpointUrl('https://rpc.synthetic.invalid/ethereum', ['https://rpc.synthetic.invalid/ethereum'])).toBe(true);
    expect(isTrustedEndpointUrl('https://rpc.synthetic.invalid/ethereum/x1', ['https://rpc.synthetic.invalid/ethereum'])).toBe(false);
    expect(secretFragments({ rpcs: [{ url: 'https://ethereum-rpc.publicnode.com', provider: 'PublicNode' }], explorerApi: null }, null)).toEqual([]);
    expect(secretFragments({ rpcs: [{ url: RPC1, provider: 'x' }], explorerApi: EXPLORER }, SECRETS.explorerKey).sort())
      .toEqual(['user', SECRETS.userinfo, SECRETS.shortPath, SECRETS.query, SECRETS.hostToken, SECRETS.explorerPath, SECRETS.explorerKey].sort());
  });
});

describe('endpoint identity: an approved host does not approve arbitrary path, query or userinfo', () => {
  // Each case: endpoints configured with a synthetic credential that must not reach shareable output.
  const CASES: Array<{ name: string; rpc: string; explorer?: string; secrets: string[] }> = [
    { name: 'built-in public RPC with a short credential path suffix', rpc: 'https://ethereum-rpc.publicnode.com/Ab1cD2', secrets: ['Ab1cD2'] },
    { name: 'built-in public RPC with a credential under an unrecognized query name', rpc: 'https://ethereum-rpc.publicnode.com/?x=Zz9Yy8Ww7', secrets: ['Zz9Yy8Ww7'] },
    { name: 'built-in explorer with a short credential path suffix', rpc: 'https://ethereum-rpc.publicnode.com', explorer: 'https://eth.blockscout.com/e7Xq2', secrets: ['e7Xq2'] },
    { name: 'localhost with userinfo', rpc: 'http://bob:L0calPw9@localhost:8545/', secrets: ['L0calPw9'] },
    { name: 'localhost with a short credential path', rpc: 'http://127.0.0.1:8545/k/Lp4Kq2', secrets: ['Lp4Kq2'] },
    { name: 'localhost with a credential query', rpc: 'http://127.0.0.1:8545/?q=Lq7Zr3', secrets: ['Lq7Zr3'] },
    { name: '.invalid host with userinfo, path and query credentials', rpc: 'https://u:Inv4lidPw@node.example.invalid/t/Iv8Tk2?s=Iv9Qs1', secrets: ['Inv4lidPw', 'Iv8Tk2', 'Iv9Qs1'] },
  ];
  for (const c of CASES) {
    it(c.name, async () => {
      const env = { TXSTORY_RPC_ETHEREUM: c.rpc, TXSTORY_EXPLORER_ETHEREUM: c.explorer ?? 'https://explorer.example.org/x', TXSTORY_TRACE: 'off' };
      const config = engineConfigFromEnv(env);
      const { result, recording } = await recordAnalysis('ethereum', swap.hash, provider, config, { stage: 'full', embedStory: true });
      if (result.kind !== 'ok') throw new Error(`${result.kind}: ${result.message}`);
      const out: string[] = [];
      await main(['networks', '--json'], { out: (s) => out.push(s), err: (s) => out.push(s), env });
      const artifacts = { recording: JSON.stringify(recording), story: JSON.stringify(result.story), evidence: JSON.stringify(buildEvidenceBundle(result.story)), networks: out.join('\n') };
      for (const [name, text] of Object.entries(artifacts)) for (const s of c.secrets) expect(text, `${name} leaks ${s}`).not.toContain(s);
      // The shareable recording still rebuilds offline to the same evidence and output.
      const { report } = await reconstruct(parseRecording(artifacts.recording), engineConfigFromEnv({}));
      expect(report).toMatchObject({ verdict: 'reproduced', missing: [] });
    });
  }

  it('malformed percent encoding in a configured URL does not throw', async () => {
    const config = engineConfigFromEnv({ TXSTORY_RPC_ETHEREUM: 'https://node.example/p%E0%A4%A/Mf5Tk9', TXSTORY_EXPLORER_ETHEREUM: 'off', TXSTORY_TRACE: 'off' });
    const { result, recording } = await recordAnalysis('ethereum', swap.hash, provider, config, { stage: 'fast' });
    expect(result.kind).toBe('ok');
    expect(JSON.stringify(recording)).not.toContain('Mf5Tk9');
  });
});

describe('withheld endpoints keep requests distinct and explorer paths usable', () => {
  it('one recording key per distinct request; explorer resource paths survive under the placeholder base', async () => {
    const sent = new Set<string>();
    const logging: Transport = { send: async (req) => { sent.add(`${req.url}\n${JSON.stringify(req.body ?? null)}`); return live.send(req); } };
    const { recording } = await recordAnalysis('ethereum', swap.hash, logging, engineConfigFromEnv(ENV), { stage: 'full' });
    const exchanges = Object.values(recording.exchanges);
    expect(Object.keys(recording.exchanges)).toHaveLength(sent.size);
    const explorerUrls = exchanges.filter((e) => e.kind === 'explorer').map((e) => e.url);
    expect(new Set(explorerUrls).size).toBe(explorerUrls.length);
    expect(explorerUrls.length).toBeGreaterThanOrEqual(5);
    for (const u of explorerUrls) expect(u).toMatch(new RegExp(`^https://explorer\\.withheld\\.invalid/api/v2/transactions/${swap.hash}(/[a-z-]+)?\\?apikey=REDACTED`));
    // The two withheld RPC endpoints stay distinguishable.
    expect(new Set(exchanges.filter((e) => e.kind === 'rpc').map((e) => e.url))).toEqual(new Set(['https://rpc-1.withheld.invalid/', 'https://rpc-2.withheld.invalid/']));
  });
});

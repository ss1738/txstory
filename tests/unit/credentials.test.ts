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
  it('shows only built-in public endpoints, loopback and .invalid hosts', async () => {
    const { isShareableUrl, secretFragments } = await import('../../src/engine/defaults.js');
    expect(isShareableUrl('https://ethereum-rpc.publicnode.com')).toBe(true);
    expect(isShareableUrl('https://eth.blockscout.com/api/v2/transactions/0x' + '1'.repeat(64))).toBe(true);
    expect(isShareableUrl('http://127.0.0.1:8545/')).toBe(true);
    expect(isShareableUrl('https://rpc.synthetic.invalid/ethereum')).toBe(true);
    // Lookalikes, userinfo on a public host, and arbitrary hosts are withheld.
    expect(isShareableUrl('https://ethereum-rpc.publicnode.com.attacker.example/')).toBe(false);
    expect(isShareableUrl('https://user:pw@ethereum-rpc.publicnode.com/')).toBe(false);
    expect(isShareableUrl('https://ethereum-rpc.publicnode.comx/')).toBe(false);
    expect(isShareableUrl('https://mainnet.example/v3/short1')).toBe(false);
    expect(secretFragments({ rpcs: [{ url: 'https://ethereum-rpc.publicnode.com', provider: 'PublicNode' }], explorerApi: null }, null)).toEqual([]);
    expect(secretFragments({ rpcs: [{ url: RPC1, provider: 'x' }], explorerApi: EXPLORER }, SECRETS.explorerKey).sort())
      .toEqual(['user', SECRETS.userinfo, SECRETS.shortPath, SECRETS.query, SECRETS.hostToken, SECRETS.explorerPath, SECRETS.explorerKey].sort());
  });
});

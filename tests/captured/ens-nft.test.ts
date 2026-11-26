/** Real captured ENS ERC-721 data: rows compare token ids. Opt-in: npm run test:captured. */
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/server/config.js';
import { capturedDir } from './dir.js';

const ENS_CONTRACT = '0x57f1887a8bf19b14fc0df6fd9b2acc9af147ea85';

describe('real captured NFT data', () => {
  it('ENS ERC-721 rows compare token ids; ERC-1155 rows compare amounts', async () => {
    const { RecordedTransport } = await import('../../src/engine/transport.js');
    const config = loadConfig({ mode: 'recorded', fixturesDir: capturedDir() });
    const rt = new RecordedTransport(config.fixturesDir);
    const H = '0x7dd83d861260f2807c22392c021b571f3798e3b2699afcceb0378af64e578dc8';
    const r = await (await import('../../src/engine/recording.js')).replayRecording((await rt.load('ethereum', H))! as never, config);
    if (r.kind !== 'ok') throw new Error(r.kind);
    const ens = r.story.crossCheck.rows.filter((x) => x.assetKey === ENS_CONTRACT);
    expect(ens.length).toBeGreaterThan(0);
    for (const row of ens) {
      expect(row.scope).toBe('token-ids');
      expect(row.status).toBe('match');
    }
    const withIds = ens.filter((x) => (x.txstoryTokenIds?.in.length ?? 0) + (x.txstoryTokenIds?.out.length ?? 0) > 0);
    expect(withIds.length).toBeGreaterThanOrEqual(2); // not vacuous
    for (const row of withIds) expect(row.txstoryTokenIds).toEqual(row.explorerTokenIds);
    const erc1155 = r.story.crossCheck.rows.filter((x) => x.assetKey.includes('#') && x.status !== 'not-comparable');
    for (const row of erc1155) expect(row.scope).toBe('amount');
  });
});


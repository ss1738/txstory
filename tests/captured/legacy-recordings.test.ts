/** Captured v1 recordings replay without requesting traces they never recorded. Opt-in: npm run test:captured. */
import { describe, expect, it } from 'vitest';
import { engineConfigFromEnv } from '../../src/engine/config.js';
import { readRecording, replayRecording } from '../../src/engine/recording.js';
import { capturedDir } from './dir.js';

describe('captured v1 recordings', () => {
  it('replay with traces off; the later /summary endpoint is reported as not captured', async () => {
    const rec = await readRecording(`${capturedDir()}/ethereum-0xf935435dedce77233eb8855ed84277c0ebf4fbbc278f03ad34167f11446a9730.json`);
    expect(rec.schema).toBe('txstory-fixture-v1');
    const r = await replayRecording(rec, engineConfigFromEnv({}));
    if (r.kind !== 'ok') throw new Error(r.kind);
    expect(r.story.trace.status).toBe('not-requested');
    expect(r.story.sources.some((x) => x.method.startsWith('debug_'))).toBe(false);
    expect(r.story.sources.find((x) => x.method.endsWith('/summary'))).toMatchObject({ status: 'empty' });
  });
});

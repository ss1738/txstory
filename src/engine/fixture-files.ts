/**
 * Recording files on disk (Node only). The replay logic itself is
 * browser-safe and lives in transport.ts (replayTransport).
 */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { MAX_RECORDING_BYTES, parseRecording, type Recording } from './recording.js';
import { FIXTURE_SCHEMA_V2, fixturePath, isFixtureFor, replayTransport, type FixtureFile, type RecordingTransport, type Transport, type TransportResponse } from './transport.js';

/** Finds recordings by network and hash in one or more directories. */
export class RecordedTransport implements Transport {
  private cache = new Map<string, FixtureFile | null>();
  private dirs: string[];
  /** One directory, or several separated by commas (searched in order). */
  constructor(dir: string) { this.dirs = dir.split(',').map((d) => d.trim()).filter(Boolean); }

  /**
   * The recording filed under this network and hash, or null when no directory
   * has one or the file is not a valid recording for it. Invalid files are
   * reported once at server startup (see server/app.ts), not here.
   */
  async load(chain: string, hash: string): Promise<FixtureFile | null> {
    const key = `${chain}:${hash.toLowerCase()}`;
    if (this.cache.has(key)) return this.cache.get(key)!;
    let text: string | null = null;
    for (const d of this.dirs) {
      try { text = await readFile(fixturePath(d, chain, hash), 'utf8'); break; } catch { /* not in this directory; try the next */ }
    }
    let f: FixtureFile | null = null;
    if (text !== null) {
      try { f = JSON.parse(text) as FixtureFile; } catch { f = null; }
    }
    const valid = f !== null && isFixtureFor(f, chain, hash) ? f : null;
    this.cache.set(key, valid);
    return valid;
  }

  /** Bound to a single fixture for the duration of a build. */
  forFixture(fixture: FixtureFile): Transport {
    return replayTransport(fixture);
  }

  async send(): Promise<TransportResponse> {
    throw new Error('Use forFixture() to bind a recorded transport to a fixture');
  }
}

/** Write captured exchanges as a schema-v2 fixture file (used by tests of v2 compatibility). */
export async function saveFixtureV2(recorder: RecordingTransport, dir: string, meta: Omit<FixtureFile, 'schema' | 'exchanges'>): Promise<string> {
  await mkdir(dir, { recursive: true });
  const path = fixturePath(dir, meta.chain, meta.hash);
  const file: FixtureFile = { schema: FIXTURE_SCHEMA_V2, ...meta, exchanges: recorder.exchanges };
  await writeFile(path, JSON.stringify(file, null, 1) + '\n');
  return path;
}

export async function writeRecording(path: string, rec: Recording): Promise<void> {
  await writeFile(path, JSON.stringify(rec, null, 1) + '\n');
}

/** Read and validate a recording file (bounded size, strict shape). */
export async function readRecording(path: string): Promise<Recording> {
  const st = await stat(path);
  if (st.size > MAX_RECORDING_BYTES) throw new Error(`recording is larger than ${MAX_RECORDING_BYTES} bytes`);
  return parseRecording(await readFile(path, 'utf8'));
}

/**
 * Rebuild a story in the browser from a recording, with the same engine the
 * CLI and server use. Loaded on demand (it carries the analysis engine).
 *
 * Nothing here sends data anywhere: a file's text is read locally, and the
 * replay transport answers only from the recording's own exchanges. The only
 * fetch is reading a shipped example recording from this site's own origin.
 */
import { MAX_RECORDING_BYTES, parseRecording } from '../../engine/recording.js';
import { reconstruct, type ReconstructionReport } from '../../engine/reconstruct.js';
import { engineConfigFromValues } from '../../engine/defaults.js';
import type { StoryResult } from '../../engine/analyze.js';

export interface Reconstruction { report: ReconstructionReport; result: StoryResult }

export class RecordingInputError extends Error {}

export { MAX_RECORDING_BYTES };

/** Parse, validate and rebuild. Throws RecordingInputError with a readable reason for bad input. */
export async function reconstructText(text: string): Promise<Reconstruction> {
  let rec;
  try { rec = parseRecording(text); } catch (e) { throw new RecordingInputError(e instanceof Error ? e.message : 'invalid recording'); }
  try {
    return await reconstruct(rec, engineConfigFromValues({}));
  } catch (e) {
    throw new RecordingInputError(`the recording could not be rebuilt: ${e instanceof Error ? e.message : 'unknown error'}`);
  }
}

export async function reconstructFile(file: File): Promise<Reconstruction> {
  if (file.size > MAX_RECORDING_BYTES) throw new RecordingInputError(`the file is ${formatBytes(file.size)}; recordings are limited to ${formatBytes(MAX_RECORDING_BYTES)}`);
  if (file.size === 0) throw new RecordingInputError('the file is empty');
  return reconstructText(await file.text());
}

/** A recording shipped with this site (same origin only). */
export async function reconstructShipped(path: string, signal?: AbortSignal): Promise<Reconstruction> {
  if (!path.startsWith('/recordings/')) throw new RecordingInputError('only recordings shipped with this site can be opened by link');
  const res = await fetch(path, { signal, headers: { accept: 'application/json' } });
  // Static hosts and preview servers may answer a missing file with the HTML app shell.
  const isJson = (res.headers.get('content-type') ?? '').includes('json');
  if (res.status === 404 || (res.ok && !isJson)) throw new RecordingInputError('this example recording is not on this site');
  if (!res.ok) throw new RecordingInputError(`the example could not be loaded (HTTP ${res.status})`);
  return reconstructText(await res.text());
}

export function formatBytes(n: number): string {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} bytes`;
}

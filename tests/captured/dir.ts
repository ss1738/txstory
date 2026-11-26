/**
 * Location of CAPTURED recordings (real provider responses). They are not part
 * of the public release because their redistribution terms are unresolved
 * (DATA_PROVENANCE.md). This suite runs only via `npm run test:captured` and
 * fails, rather than skipping, when the directory is not provided.
 */
import { existsSync } from 'node:fs';

export function capturedDir(): string {
  const dir = process.env.TXSTORY_CAPTURED_DIR;
  if (!dir || !existsSync(dir)) {
    throw new Error('Set TXSTORY_CAPTURED_DIR to a directory of captured recordings to run this suite. They are not distributed with the repository; see DATA_PROVENANCE.md.');
  }
  return dir;
}

/**
 * Build the static developer site into dist/site (no server needed):
 *
 *   npm run build:site        # then: npm run site:preview  (http://127.0.0.1:4173)
 *
 * - The client is built with VITE_TXSTORY_STATIC=1: examples are rebuilt in
 *   the browser from recordings, and live lookups point to a local install.
 * - Public-safe recordings (fixtures/synthetic, fixtures/devnet) are validated
 *   and copied to dist/site/recordings/ with an index. Nothing else is copied;
 *   captured provider recordings are never part of the site.
 * - A Content-Security-Policy restricts the page to its own origin, so the
 *   browser itself blocks requests to any other host.
 * - 404.html repeats index.html so static hosts serve deep links.
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'vite';
import { parseRecording, type Recording } from '../src/engine/recording.js';

const OUT = resolve('dist/site');
const SOURCES = ['fixtures/devnet', 'fixtures/synthetic'];
const RECORDING_FILE = /^[a-z][a-z0-9-]{1,31}-0x[0-9a-f]{64}\.json$/;
export const SITE_CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'";

async function main() {
  process.env.VITE_TXSTORY_STATIC = '1';
  await build({ configFile: resolve('vite.config.ts'), build: { outDir: OUT, emptyOutDir: true }, logLevel: 'warn' });

  await mkdir(`${OUT}/recordings`, { recursive: true });
  const examples: Array<{ chain: string; hash: string; description: string; recordedAt: string; origin: NonNullable<Recording['origin']> }> = [];
  for (const dir of SOURCES) {
    for (const f of (await readdir(dir)).filter((x) => RECORDING_FILE.test(x)).sort()) {
      const text = await readFile(`${dir}/${f}`, 'utf8');
      const rec = parseRecording(text);
      if (rec.origin !== 'synthetic' && rec.origin !== 'local-devnet') throw new Error(`${dir}/${f}: origin ${rec.origin ?? 'unspecified'} is not public-safe; the site ships only synthetic and local-devnet recordings`);
      if (f !== `${rec.chain}-${rec.hash}.json`) throw new Error(`${dir}/${f}: file name does not match its network and hash`);
      await writeFile(`${OUT}/recordings/${f}`, text);
      examples.push({ chain: rec.chain, hash: rec.hash, description: rec.description ?? '', recordedAt: rec.recordedAt, origin: rec.origin });
    }
  }
  await writeFile(`${OUT}/recordings/index.json`, JSON.stringify({ ok: true, examples }, null, 1) + '\n');

  const index = await readFile(`${OUT}/index.html`, 'utf8');
  if (!index.includes('<meta charset="UTF-8" />')) throw new Error('index.html: charset meta not found; cannot place the CSP');
  const withCsp = index.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${SITE_CSP}" />`);
  await writeFile(`${OUT}/index.html`, withCsp);
  await writeFile(`${OUT}/404.html`, withCsp);
  console.log(`Static site: ${OUT} (${examples.length} example recordings). Preview: npm run site:preview`);
}

await main();

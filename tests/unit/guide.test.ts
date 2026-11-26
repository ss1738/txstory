/**
 * The "Get started" commands (src/client/lib/guide.ts) must work as shown:
 * offline commands run here; every referenced file, doc and npm script exists;
 * the README quick start uses the same command.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GUIDE, QUICKSTART_RECORDING } from '../../src/client/lib/guide.js';

const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts as Record<string, string>;
const commands = GUIDE.flatMap((s) => s.commands.map((c) => ({ step: s.id, offline: !!s.offline, command: c.replace(/\s+#.*$/, '') })));

describe('get started guide', () => {
  it('references only files, docs and npm scripts that exist', () => {
    for (const s of GUIDE) if (s.doc) expect(existsSync(s.doc), s.doc).toBe(true);
    for (const { command } of commands) {
      for (const path of command.match(/\b(?:fixtures|examples|tests|docs|src|scripts)\/[\w./-]+/g) ?? []) expect(existsSync(path), `${command}: ${path}`).toBe(true);
      const script = /npm run (?:-s )?([\w:-]+)/.exec(command)?.[1];
      if (script) expect(scripts[script], `${command}: npm script ${script}`).toBeDefined();
    }
  });

  it('the README quick start uses the same command as the site', () => {
    expect(readFileSync('README.md', 'utf8')).toContain(`npm run -s txstory -- replay ${QUICKSTART_RECORDING}`);
  });

  it('offline commands run successfully from the repository', () => {
    const runnable = commands.filter((c) => c.offline && !c.command.startsWith('npx vitest'));
    expect(runnable.map((c) => c.step)).toEqual(['try', 'library', 'extend']);
    for (const { command } of runnable) {
      // Commands are fixed strings from guide.ts; run them through the shell exactly as shown.
      const out = execFileSync('/bin/sh', ['-c', command], { encoding: 'utf8', env: { ...process.env, npm_config_loglevel: 'silent' }, timeout: 60_000 });
      expect(out.length, command).toBeGreaterThan(0);
    }
  }, 120_000);
});

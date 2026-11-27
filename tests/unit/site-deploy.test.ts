/** The Cloudflare deployment config (deploy/cloudflare) stays consistent with the site build. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const headers = readFileSync('deploy/cloudflare/_headers', 'utf8');
const buildScript = readFileSync('scripts/build-site.ts', 'utf8');
const wrangler = readFileSync('deploy/cloudflare/wrangler.jsonc', 'utf8').replace(/^\s*\/\/.*$/gm, '');
const deployPkg = JSON.parse(readFileSync('deploy/cloudflare/package.json', 'utf8'));

describe('cloudflare deployment config', () => {
  it('sends the same CSP the build puts in index.html, plus frame-ancestors', () => {
    const siteCsp = /export const SITE_CSP = "([^"]+)"/.exec(buildScript)![1];
    const headerCsp = /Content-Security-Policy: (.+)/.exec(headers)![1]!.trim();
    expect(headerCsp).toBe(`${siteCsp}; frame-ancestors 'none'`);
    expect(headers).toMatch(/^\/\*$/m);
  });

  it('serves assets only: no Worker script, bindings, variables or secrets; SPA fallback; no Wrangler metrics', () => {
    const cfg = JSON.parse(wrangler);
    expect(Object.keys(cfg).sort()).toEqual(['assets', 'compatibility_date', 'name', 'send_metrics', 'workers_dev']);
    expect(cfg.assets).toEqual({ directory: './public', not_found_handling: 'single-page-application', html_handling: 'auto-trailing-slash' });
    expect(cfg.send_metrics).toBe(false);
  });

  it('pins Wrangler to an exact version', () => {
    expect(deployPkg.devDependencies.wrangler).toMatch(/^\d+\.\d+\.\d+$/);
    expect(deployPkg.private).toBe(true);
  });
});

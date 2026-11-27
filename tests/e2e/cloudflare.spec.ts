/**
 * Deployment checks for the Cloudflare build (deploy/cloudflare). Run only by
 * deploy/cloudflare/playwright.config.ts against `wrangler dev`; the default
 * Playwright projects do not include this file.
 */
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const headersFile = readFileSync('deploy/cloudflare/_headers', 'utf8');
const expectedCsp = /Content-Security-Policy: (.+)/.exec(headersFile)![1]!.trim();
const DEVNET = '0xdce671e4526d6d277669b28b2a9108c3f291951eb893a8d716101d94a2640359';

test.describe('cloudflare deployment', () => {
  test('security headers are sent on pages, deep links and data files', async ({ request }) => {
    for (const path of ['/', '/start', `/example/anvil/${DEVNET}`, '/recordings/index.json', `/recordings/anvil-${DEVNET}.json`]) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(200);
      const h = res.headers();
      expect(h['content-security-policy'], path).toBe(expectedCsp);
      expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
      expect(h['content-security-policy']).toContain("connect-src 'self'");
      expect(h['x-content-type-options'], path).toBe('nosniff');
      expect(h['referrer-policy'], path).toBe('no-referrer');
      expect(h['cross-origin-opener-policy'], path).toBe('same-origin');
    }
  });

  test('deep links get the app; data files keep their JSON type', async ({ request }) => {
    for (const path of ['/start', '/open', '/about', `/example/anvil/${DEVNET}`, `/tx/base/${DEVNET}`]) {
      const res = await request.get(path, { headers: { 'sec-fetch-mode': 'navigate' } });
      expect(res.status(), path).toBe(200);
      expect(await res.text(), path).toContain('<div id="root">');
    }
    const rec = await request.get(`/recordings/anvil-${DEVNET}.json`);
    expect(rec.headers()['content-type']).toContain('application/json');
    expect((await rec.json()).origin).toBe('local-devnet');
  });

  test('the headers file is not served and the build names its source commit', async ({ request }) => {
    expect(await (await request.get('/_headers')).text()).not.toContain('Content-Security-Policy:');
    expect((await (await request.get('/source-commit.txt')).text()).trim()).toMatch(/^[0-9a-f]{40}$/);
  });

  test('a missing file gets the app shell as HTML, which the page cannot run as a script or read as a recording', async ({ request, page }) => {
    const res = await request.get('/assets/does-not-exist.js');
    expect(res.headers()['content-type']).toContain('text/html');
    expect(res.headers()['x-content-type-options']).toBe('nosniff');
    // In a page: the browser refuses an HTML response as a script (nosniff), so nothing runs.
    await page.goto('/about');
    const ran = await page.evaluate(() => new Promise<string>((resolve) => {
      const s = document.createElement('script');
      s.src = '/assets/does-not-exist.js';
      s.onload = () => resolve('loaded'); s.onerror = () => resolve('refused');
      document.head.append(s);
    }));
    expect(ran).toBe('refused');
    // A missing example recording is reported, not parsed.
    await page.goto(`/example/ethereum/0x${'34'.repeat(32)}`);
    await expect(page.getByRole('alert')).toContainText('not on this site');
  });

  test('no request leaves this origin while browsing and rebuilding examples', async ({ page, baseURL }) => {
    const foreign: string[] = [];
    page.on('request', (r) => { if (new URL(r.url()).origin !== new URL(baseURL!).origin) foreign.push(r.url()); });
    await page.goto('/');
    await page.locator('.example-grid a').filter({ hasText: 'payAndTry' }).click();
    await expect(page.getByTestId('reconstruction')).toContainText('Reproduced');
    await page.getByRole('link', { name: 'Examples' }).click();
    await page.locator('.example-grid a').filter({ hasText: 'Synthetic: token swap' }).click();
    await expect(page.getByTestId('reconstruction')).toContainText('synthetic');
    expect(foreign).toEqual([]);
  });
});

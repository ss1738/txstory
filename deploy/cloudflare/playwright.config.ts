/**
 * Browser checks against the Cloudflare build served by `wrangler dev`
 * (Workers Static Assets, run locally; no Cloudflare account needed).
 *
 *   cd deploy/cloudflare && npm ci && ./build.sh
 *   cd ../.. && npx playwright test -c deploy/cloudflare/playwright.config.ts
 *
 * Runs the static-site journeys (tests/e2e/site.spec.ts) and the deployment
 * checks (tests/e2e/cloudflare.spec.ts) against ./public as built.
 */
import { defineConfig } from '@playwright/test';

const PORT = 8788;

export default defineConfig({
  testDir: '../../tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    ...(process.env.TXSTORY_E2E_BROWSER === 'chromium' ? {} : { channel: 'chrome' }),
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'cloudflare', testMatch: ['site.spec.ts', 'cloudflare.spec.ts'] }],
  webServer: {
    command: `npm run -s preview`, // runs in deploy/cloudflare (this file's directory)
    url: `http://127.0.0.1:${PORT}/recordings/index.json`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { WRANGLER_SEND_METRICS: 'false' },
  },
});

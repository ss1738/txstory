import { defineConfig } from '@playwright/test';

const PORT = 8791; // TxStory server, recorded mode
const SITE_PORT = 8792; // static site (dist/site), no server

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    // Locally: the installed Google Chrome (no download). CI: TXSTORY_E2E_BROWSER=chromium uses
    // Playwright's pinned Chromium build (installed with `npx playwright install --with-deps chromium`).
    ...(process.env.TXSTORY_E2E_BROWSER === 'chromium' ? {} : { channel: 'chrome' }),
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'server', testMatch: 'journeys.spec.ts', use: { baseURL: `http://127.0.0.1:${PORT}` } },
    { name: 'static-site', testMatch: 'site.spec.ts', use: { baseURL: `http://127.0.0.1:${SITE_PORT}` } },
  ],
  webServer: [
    {
      // Production build, recorded mode: deterministic, no live network.
      command: `npm run build && TXSTORY_MODE=recorded TXSTORY_PORT=${PORT} TXSTORY_STATIC_DIR=dist/client node dist/node/server/index.js`,
      url: `http://127.0.0.1:${PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      // The static site served by a plain file server: no TxStory server, no API.
      command: `npm run build:site && npx vite preview --outDir ../../dist/site --host 127.0.0.1 --port ${SITE_PORT} --strictPort`,
      url: `http://127.0.0.1:${SITE_PORT}/recordings/index.json`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});

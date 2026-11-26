import { defineConfig } from '@playwright/test';

const PORT = 8791;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    // Locally: the installed Google Chrome (no download). CI: TXSTORY_E2E_BROWSER=chromium uses
    // Playwright's pinned Chromium build (installed with `npx playwright install --with-deps chromium`).
    ...(process.env.TXSTORY_E2E_BROWSER === 'chromium' ? {} : { channel: 'chrome' }),
    trace: 'retain-on-failure',
  },
  webServer: {
    // Production build, recorded mode: deterministic, no live network.
    command: `npm run build && TXSTORY_MODE=recorded TXSTORY_PORT=${PORT} TXSTORY_STATIC_DIR=dist/client node dist/node/server/index.js`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});

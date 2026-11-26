import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const apiPort = Number(process.env.TXSTORY_PORT ?? 8787);

export default defineConfig({
  root: 'src/client',
  plugins: [react()],
  build: { outDir: '../../dist/client', emptyOutDir: true, sourcemap: true },
  server: { port: 5173, proxy: { '/api': `http://127.0.0.1:${apiPort}` } },
  test: {
    root: '.',
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    // Request logs are exercised explicitly in tests via an injected logger.
    env: { TXSTORY_LOG_REQUESTS: '0' },
  },
});

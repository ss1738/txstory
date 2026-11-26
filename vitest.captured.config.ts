// Opt-in suite over captured (real provider) recordings kept outside the public release.
// Usage: TXSTORY_CAPTURED_DIR=/path/to/captured-recordings npm run test:captured
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/captured/**/*.test.ts'],
    environment: 'node',
    env: { TXSTORY_LOG_REQUESTS: '0' },
  },
});

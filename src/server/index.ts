import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { createApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
if (!config.staticDir && existsSync('dist/client/index.html')) config.staticDir = 'dist/client';

const app = createApp({ config });
const server = createServer(app);
// Longer than the largest story budget (TXSTORY_FULL_BUDGET_MS ≤ 110 s), so builds can answer.
server.requestTimeout = 120_000;
server.headersTimeout = 20_000;
server.keepAliveTimeout = 5_000;
server.listen(config.port, config.host, () => {
  // Never log endpoint URLs (custom RPC URLs may embed credentials).
  console.log(JSON.stringify({
    t: new Date().toISOString(), event: 'listening', host: config.host, port: config.port, mode: config.mode,
    static: !!config.staticDir, trustProxy: config.trustProxy.description,
  }));
});

/**
 * Graceful shutdown: stop accepting connections, report 503 on /api/health,
 * close idle keep-alive connections, let in-flight requests finish for up to
 * TXSTORY_SHUTDOWN_GRACE_MS, then close what remains and exit. A second signal
 * exits immediately.
 */
let stopping = false;
function shutdown(signal: string) {
  if (stopping) process.exit(1);
  stopping = true;
  app.drain();
  console.log(JSON.stringify({ t: new Date().toISOString(), event: 'shutdown', signal, graceMs: config.shutdownGraceMs, inFlight: app.stats() }));
  server.close(() => {
    console.log(JSON.stringify({ t: new Date().toISOString(), event: 'stopped', clean: true }));
    process.exit(0);
  });
  server.closeIdleConnections();
  setTimeout(() => {
    console.log(JSON.stringify({ t: new Date().toISOString(), event: 'stopped', clean: false, reason: 'grace period elapsed' }));
    server.closeAllConnections();
    process.exit(0);
  }, config.shutdownGraceMs).unref();
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => shutdown(signal));

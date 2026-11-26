# Self-hosting

TxStory is one Node process with no database. Everything runs on your
infrastructure, and third-party providers are optional.

## Run it

```bash
npm ci && npm run build
TXSTORY_RPC_ETHEREUM=http://your-node:8545 npm start          # serves UI + API on 127.0.0.1:8787
TXSTORY_HOST=0.0.0.0 TXSTORY_TRUST_PROXY=<proxy ip/cidr> npm start   # behind a reverse proxy
```

Container (build locally; nothing is pushed):

```bash
docker build -t txstory:local .
docker run --rm -p 127.0.0.1:8787:8787 -e TXSTORY_RPC_ETHEREUM=http://host.docker.internal:8545 txstory:local
docker run --rm -p 127.0.0.1:8787:8787 -e TXSTORY_MODE=recorded txstory:local     # offline examples only
```

About the image:

- non-root (uid 1000), with a read-only app directory;
- a healthcheck on `/api/health`;
- on SIGTERM it drains, with a grace period of `TXSTORY_SHUTDOWN_GRACE_MS`;
- the build context is an allowlist (`.dockerignore`), so no study data, tests
  or `.env` files reach it.

## With your own node

- **Traces.** A node that offers `debug_traceTransaction` (callTracer) gives the
  call tree, exact native value inside execution, and decoded revert data.
  Without one, internal native value comes from Blockscout if it is configured,
  and is otherwise marked unavailable.
- **No explorer.** `TXSTORY_EXPLORER_<NETWORK>=off` runs TxStory entirely on your
  node. There is then no cross-check and no labels, and the story says so.
- **Devnets.** Use a chain file (`TXSTORY_CHAINS_FILE`); see
  `examples/devnet/README.md`.

## Configuration, limits and logs

- **Variables:** see [configuration.md](configuration.md). This covers RPC and
  explorer endpoints, rate limits, concurrency pools, budgets, cache size, proxy
  trust and logging.
- **Logs:** one JSON line per API request (route, network, stage, status, cache,
  ms, source errors). There are no client IPs, transaction hashes or provider
  URLs in the logs.
- **Health:** `GET /api/health` returns 200, or 503 while draining.

## A private deployment

[DEPLOYMENT.md](../DEPLOYMENT.md) is a worked configuration: one VM, Docker
Compose, and access control by Cloudflare Access in front of a Cloudflare Tunnel.

- The app publishes no ports, and the proxy trust is set exactly.
- The document also covers secret placement, rollback, and cost estimates with
  sources.

Any other access layer works too (Tailscale, a VPN, an identity-aware proxy), as
long as `TXSTORY_TRUST_PROXY` matches the topology. TxStory has no account
system; restrict access at the infrastructure level.

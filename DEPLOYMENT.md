# Private-pilot deployment (prepared, NOT deployed)

**Status:** nothing has been provisioned, deployed, pushed or published. This
document and `deploy/` are a ready configuration waiting for the owner's
authorization. Human usability remains unmeasured (see `study/`). This is a
small private pilot, not a production launch.

## Recommended shape

```
participant browser
  → Cloudflare edge: HTTPS, Cloudflare Access login (allow-listed emails, one-time PIN)
  → Cloudflare Tunnel (outbound-only connection from the VM)
  → cloudflared container 172.30.53.2
  → TxStory container 172.30.53.3:8787   (no published ports)
```

- **One small Linux VM.** It runs Docker Compose (`deploy/compose.yaml`) with
  two containers: the TxStory image and `cloudflared`.
- **Access control is infrastructure, not app code.** Cloudflare Access sits in
  front of the tunnel hostname. TxStory has no accounts, and none are added.
- **No inbound ports except SSH.** The app publishes no ports, so it cannot be
  reached around Access via the VM's IP. `cloudflared` only dials out.
- **HTTPS** is terminated by Cloudflare. The hop from the tunnel to the app is
  plain HTTP inside the private Docker network.

Why this shape: the pilot needs access limited to a handful of invited people,
without building authentication. Access gives that for $0 up to 50 users, and
the tunnel removes the need for a public IP, certificates or firewall rules for
HTTP. The containers are portable: any host that runs Docker Compose works, and
another access layer (Tailscale, Google IAP, a corporate VPN) can replace Access
without app changes, as long as the trust setting below matches the new
topology.

## Proxy trust: exact configuration

Policy (implemented in `src/server/clientIp.ts`, tested in `tests/unit/operations.test.ts`):

- **Default.** No forwarding header is trusted; identity is the TCP peer.
- **Trusted proxies.** With `TXSTORY_TRUST_PROXY` set, `X-Forwarded-For` is read
  only if the TCP peer is a listed proxy.
- **Reading the header.** It is walked right to left, at most 10 hops. The first
  address that is not a trusted proxy is the client. Entries to its left
  (client-supplied) are ignored.
- **Malformed hops.** A malformed hop stops the walk, and the identity falls
  back to the last trusted address.
- **Other headers.** `Forwarded`, `X-Real-IP` and `CF-Connecting-IP` are not
  used.
- **IPv6.** IPv4-mapped IPv6 counts as IPv4, and IPv6 clients are bucketed per
  /64.
- **Fail-safe.** `0.0.0.0/0`, `::/0` and malformed entries refuse to start.

For this topology, `deploy/compose.yaml` sets exactly:

```
TXSTORY_TRUST_PROXY=172.30.53.2      # the cloudflared container, fixed address on a /29 network
```

Cloudflare documents that it sets `X-Forwarded-For` to the connecting IP, or
appends the connecting IP to an existing header ([Cloudflare HTTP
headers](https://developers.cloudflare.com/fundamentals/reference/http-headers/)).
The right-most entry is therefore the visitor as Cloudflare saw them, and that
is what the policy picks.

- **Unverified until the tunnel exists (INFERRED, from that documentation and
  the local simulation in VERIFICATION.md):** that `cloudflared` forwards the
  header unchanged.
- **If it does not:** identity degrades to a shared bucket. Clients still
  cannot choose their own identity.

**Check after deploying.** Temporarily set `TXSTORY_RATE_LIMIT_PER_MINUTE=3`.
Look up four transactions from one network: the fourth should get 429. Then
look one up from a different network (for example a phone hotspot): it should
get 200. Restore the setting afterwards.

## Configuration and secret placement

| What | Where | Notes |
|---|---|---|
| Image tag | `TXSTORY_IMAGE` (shell) | e.g. `txstory:<git-sha>`; required by compose |
| cloudflared version | `CLOUDFLARED_IMAGE` (shell) | Pin a specific `cloudflare/cloudflared:<version>` tag at least 2 weeks old. Never `latest`. Required by compose. |
| Tunnel token | `deploy/cloudflared.env` (`TUNNEL_TOKEN=`) | **Secret.** chmod 600, root-owned, git-ignored, outside the image. Template: `cloudflared.env.example`. |
| RPC URLs with keys, Blockscout key | `deploy/pilot.env` | **Secret if they contain keys.** chmod 600, git-ignored. Template: `pilot.env.example`. |
| Mode, trust, host, grace | `deploy/compose.yaml` | Not secret; fixed for this topology |
| Limits | `deploy/pilot.env` (optional) | Defaults suit a small pilot |

Secrets never enter the image:
- The `.dockerignore` is an allowlist.
- Inspection found no `.env`, CSV, `study/` or `.git` content in the image
  (VERIFICATION.md).
- Provider URLs are redacted in source records and exports, and are never
  logged.

Recorded examples always replay against the public recording endpoints without
any API key, so custom RPCs or a Blockscout key do not affect them. This is
covered by a regression test.

## Resources (from local measurements; see VERIFICATION.md)

| Observation | Value |
|---|---|
| Image size | 245 MB |
| Resident memory: idle → after 120 concurrent requests from 12 clients | 57 → 103 MB |
| Resident memory with an oversized 9 MB explorer response (rejected at the 8 MB cap) | 94 MB |
| Cache bounds | 64 MB for stories plus 64 MB for provider responses, configurable |
| Local mock latency: fast stage p95 / full stage p95 under that burst | 150 ms / 501 ms |

**Recommendation.** 1 vCPU and 1 to 2 GB RAM is ample. The compose file caps the
app at 512 MB and `cloudflared` at 256 MB.

- **What sets throughput:** the upstream providers (public RPC rate limits and
  Blockscout availability), not this server (INFERRED).
- **What these numbers are not:** measurements of internet-scale capacity, or
  of real provider latency (live first renders took about 2 s and full stories
  7 to 15 s in earlier live checks, README).

## Providers and chain limitations

- **Default providers.** The public RPCs are PublicNode, dRPC, Flashbots,
  mainnet.optimism.io, mainnet.base.org and arb1.arbitrum.io. The explorer is
  Blockscout. All are best-effort and rate-limited. For the pilot, configure
  your own RPC endpoints in `pilot.env`.
- **Base and Arbitrum:** Blockscout answered HTTP 403 (bot protection) to
  server-side requests in earlier live checks. Stories there are RPC-only, with
  no cross-check and no internal transfers, and the UI says so.
- **Large transactions** can exceed explorer timeouts or the page cap. They are
  then marked "Partial data", with the consequence stated.
- **One instance.** Rate-limit and cache state live in memory, and a restart
  clears them. Do not run multiple replicas: each would hold its own limits.

## Logs

- **Request lines.** One JSON line per API request, on stdout. Fields: `route`,
  `chain`, `stage`, `status`, `code`, `cache` (hit/joined/built), `ms`,
  `sourceErrors`, `limit`.
- **Lifecycle lines:** `listening`, `shutdown` (with in-flight counts),
  `stopped`.
- **Deliberately absent:** client IP addresses, transaction hashes, provider
  URLs, and request headers. Health probes are not logged.
- **Retention.** Docker's `json-file` driver rotates the logs (10 MB × 5).
  Disable request lines with `TXSTORY_LOG_REQUESTS=0`.
- **Personal data at Cloudflare.** Cloudflare Access keeps its own
  authentication logs, which include participants' email addresses and IPs; the
  free plan retains up to 24 h of logs per Cloudflare's plan page. Tell invited
  participants this.

Useful queries:

```bash
docker compose -f deploy/compose.yaml logs app | grep '"status":5'   # server or provider trouble
docker compose -f deploy/compose.yaml logs app | grep '"limit"'      # rate limits or busy slots
docker compose -f deploy/compose.yaml logs app | grep '"sourceErrors":[1-9]'  # partial data
```

## Health, shutdown, rollback

- **Health.** `GET /api/health` returns 200 `{ok:true}`, or 503 while draining.
  The image `HEALTHCHECK` uses it, and `cloudflared` starts only after the app
  is healthy.
- **Shutdown.** SIGTERM makes the app stop accepting connections, refuse new
  live work, let in-flight requests finish for up to 8 s
  (`TXSTORY_SHUTDOWN_GRACE_MS`), then close and exit 0. Compose's
  `stop_grace_period` of 15 s is longer, so Docker does not SIGKILL first.
  - **Effect on users:** full stories still building when the grace period ends
    are cut off. The browser shows a retry.
- **Deploy and rollback.** Images are tagged by commit, and the previous tag is
  kept on the VM.

```bash
# on your workstation (build only, no registry push): match the VM's CPU architecture
docker buildx build --platform linux/amd64 -t txstory:$(git rev-parse --short HEAD) --load .
docker save txstory:<sha> | gzip | ssh <vm> 'gunzip | docker load'
# on the VM
TXSTORY_IMAGE=txstory:<sha> CLOUDFLARED_IMAGE=cloudflare/cloudflared:<version> docker compose -f deploy/compose.yaml up -d
# the app has no published port by design; check its health from Docker:
docker inspect --format '{{.State.Health.Status}}' txstory-pilot-app-1
# rollback = the same command with the previous tag
```

## Expected charges (estimates; verify before buying)

| Item | Estimate | Source (checked 2026-11-26) |
|---|---|---|
| Cloudflare Zero Trust (Access + Tunnel), at most 50 users | $0 | [Cloudflare SASE/Zero Trust plans](https://www.cloudflare.com/plans/sase-zero-trust.md): Free plan for teams under 50 users. Beyond 50, every seat moves to the paid plan, about $7/user/month per [community reports](https://community.cloudflare.com/t/what-happens-when-you-go-over-the-free-plan/806187). |
| Small VM (e.g. Hetzner CAX11, 2 vCPU arm64, 4 GB) | about €5.49 to 5.99/month excl. VAT | [Hetzner Cloud](https://www.hetzner.com/cloud/). The page layout made the exact figure ambiguous, and availability varies by location. |
| Domain on Cloudflare DNS | $0 if one already exists; otherwise registrar pricing | Access and Tunnel need a hostname in a zone on Cloudflare |
| Own RPC endpoints (optional) | Provider-dependent; free tiers exist | Not chosen |

**If an arm64 VM is used**, build with `--platform linux/arm64`.

## Remaining action requiring owner authorization

The steps below create accounts and resources, may incur charges, and make the
app reachable. **None has been done.**

1. **Choose the VM provider and the hostname.** The hostname must be in a domain
   on Cloudflare.
2. **Create the Cloudflare resources** in the owner's account:
   - a remotely-managed tunnel;
   - a public hostname `pilot.<domain>` pointing to `http://172.30.53.3:8787`;
   - an Access self-hosted application for that hostname, with a policy that
     allows only the invited emails, using the one-time PIN login method.
3. **Create the VM**, install Docker, and allow inbound SSH only.
4. **Place the secret files**: `deploy/cloudflared.env` and optionally
   `deploy/pilot.env`.
5. **Load the image built from the chosen commit** and run the compose command
   above.
6. **Run the post-deploy checks:**
   - health is `healthy`;
   - an un-authenticated browser is blocked by Access;
   - an invited email can reach the app;
   - recorded examples load and are labelled;
   - the proxy-trust check above passes.

# TxStory website on Cloudflare Workers Static Assets

This directory holds everything needed to publish the static developer site
(`npm run build:site`) on Cloudflare. Nothing here deploys automatically. The
public copy at https://txstory-site.satyawansinghinuk.workers.dev was deployed
manually from `v0.4.0` on 2026-11-27 (see RELEASE.md, "Website").

## What is deployed

- Static files only: the site built from an exact commit of this repository,
  the bundled `synthetic` and `local-devnet` example recordings, and
  `source-commit.txt` naming that commit.
- No Worker script, bindings, environment variables, secrets, accounts,
  analytics or telemetry. The site never contacts an RPC provider: examples and
  opened files are rebuilt in the visitor's browser.
- Wrangler's own usage metrics are switched off (`send_metrics: false`).

## Why Workers Static Assets

Cloudflare's documentation describes Workers as having a broader feature set
than Pages and provides a guide for migrating from Pages to Workers Static
Assets. Workers Static Assets covers what this site needs without code: an
assets-only project, single-page-application fallback, and a `_headers` file.
Pages would add nothing here, and on Pages the site's top-level `404.html`
disables the fallback to `index.html` that deep links need.

## Files

| File | Purpose |
|---|---|
| `wrangler.jsonc` | Project `txstory-site`; assets from `./public`; unknown paths serve `/index.html` with 200 (`single-page-application`) |
| `_headers` | Security headers for every response: the CSP from `scripts/build-site.ts` plus `frame-ancestors 'none'`, `nosniff`, `no-referrer`, COOP and a restrictive `Permissions-Policy`. Not served as a file. |
| `build.sh` | Builds the site from a clean `git archive` of an exact ref (default `v0.4.0`) into `./public`, then adds `_headers` and `source-commit.txt` |
| `package.json`, `package-lock.json` | Wrangler pinned to an exact version, kept out of the main install. Wrangler is a deployment tool and is not part of the published site. |
| `playwright.config.ts` | Runs the static-site journeys and `tests/e2e/cloudflare.spec.ts` against `wrangler dev` |

`tests/unit/site-deploy.test.ts` checks that the header CSP matches the build's
CSP and that the configuration stays assets-only.

## Build and check locally (no Cloudflare account needed)

```bash
cd deploy/cloudflare
npm ci
./build.sh v0.4.0          # or any tag or commit
cd ../..
npx playwright test -c deploy/cloudflare/playwright.config.ts
```

`npm run preview` (in this directory) serves `./public` with `wrangler dev` on
http://127.0.0.1:8788.

CI runs the same checks in the job "cloudflare site config (local wrangler
runtime, nothing deployed)", building from the commit under test
(`./build.sh HEAD`). It uses no Cloudflare credentials and fails if any are
present. Passing it shows the configuration works in Wrangler's local runtime,
not that a live deployment works.

## Behaviour to know

- Deep links such as `/start`, `/open` and `/example/<network>/<hash>` return
  the app with 200.
- A missing file (for example `/assets/missing.js` or an unknown recording)
  also returns the app's `index.html` with 200, because single-page-application
  mode applies to every unmatched path. With `nosniff`, browsers do not run it
  as a script, and the app reports an unknown recording as "not on this site".
  A true 404 for missing files would need a Worker script; it is not used.
- `/index.html` and `/404.html` redirect (307) to `/` and `/404`
  (`auto-trailing-slash`). `404.html` is built for other static hosts and is
  not used here.

## Deploying (requires the owner's approval)

Needs a Cloudflare account and a user who can create and deploy Workers in it.
Cloudflare's limits page lists 20,000 files per Worker version and 25 MiB per
file on the Free plan, and static asset requests are not billed; this site is
about 30 files. The first `wrangler deploy` created the `txstory-site` Worker
and, with `workers_dev: true`, served it at
`txstory-site.<account subdomain>.workers.dev`; the deploy output prints the
URL and the version ID.

```bash
cd deploy/cloudflare
npm ci
./build.sh v0.4.0
npx wrangler login         # interactive browser sign-in to the Cloudflare account
npx wrangler deploy
```

If the browser sign-in cannot complete, an account API token that can edit
Workers Scripts in that account works instead. Set `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` in the shell that runs `npx wrangler deploy`, never in
a file in this repository, and delete the token afterwards.

A custom domain, if wanted, is a separate decision and needs DNS for that
domain in the same Cloudflare account.

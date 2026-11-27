# Releases

## Website

Deployed 2026-11-27 at https://txstory-site.satyawansinghinuk.workers.dev.

- Cloudflare Workers Static Assets, project `txstory-site`, assets only: no
  Worker script, bindings, secrets or backend.
- Application built from `v0.4.0` (commit `57b2608`) with `deploy/cloudflare`
  at commit `2547580` and Wrangler 4.162.0; `source-commit.txt` on the site
  names the application commit.
- Cloudflare version `e7c01508-ed17-4173-8962-5c2b02d727ac`, deployment
  `7855f382-7d1a-4c71-8104-e70e7b2ec24d`.
- Checked against the live site after deployment: the static-site and
  deployment browser suites plus reload, content-type and source-commit checks
  (26 passed in Chrome), and the live response headers.
- Six live responses were compared with the local build and matched exactly:
  `/` (`index.html`), the two application scripts, `recordings/index.json`, one
  devnet recording, and `source-commit.txt`. This covers only those six
  responses; other files were not compared byte for byte.
- The site serves the included example recordings and rebuilds recordings a
  visitor opens, in the browser. It has no RPC backend and does not look up
  live transactions.
- Missing files return the app shell with 200, as described in
  `deploy/cloudflare/README.md`. Human usability is not measured, and the site
  performs no cryptographic verification.

## 0.4.0: published 2026-11-27

- Merged through pull requests #3 (Node 22.23.5 for the container and CI),
  #4 (Dependabot cooldown and separate major tooling updates) and #5 (browser
  reconstruction, static developer site, network isolation fix), each after
  its four required checks passed.
- Tag `v0.4.0` on commit `57b2608`, with a GitHub release. All four CI jobs
  passed on that commit.
- The static site (`npm run build:site`) was not deployed at release time. It
  was deployed afterwards from the unchanged `v0.4.0` tag; see "Website"
  below.
- Not published: no npm package (`"private": true`), no container image.
- Human usability is not measured. Traces are tested only via dRPC and a local
  anvil node.

The validation run before publication is recorded in the descriptions and CI
runs of pull requests #3, #4 and #5. The tree tagged `v0.4.0` still shows this
file and CHANGELOG.md as they were before publication ("prepared, not
published"); this later commit corrects the status without moving the tag.

## 0.3.0: published 2026-11-27

- Repository `ss1738/txstory` created and pushed by its owner's account; tag
  `v0.3.0` on commit `7e441c5`, with a GitHub release.
- The first CI run failed in the container job, which requested a captured
  example no longer shipped. Fixed in `7e441c5`; all four checks then passed on
  GitHub.
- Settings applied: private vulnerability reporting, Dependabot alerts and
  security updates, secret scanning with push protection, read-only default
  workflow permissions, and branch protection on `main` (pull requests and the
  four checks required, no force pushes or deletion).
- Not published: no npm package (`"private": true`), no container image, no
  hosted site.

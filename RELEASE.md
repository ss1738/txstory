# Releases

## 0.4.1: prepared, not published

Status on 2026-11-27: version changes are on the branch `release/0.4.1` for a
release pull request. Not merged, tagged or published. The changes themselves
were merged to `main` through pull request #10 (merge commit `8a91b44`); see
CHANGELOG.md, "0.4.1".

The hosted website is not part of this release. It still runs the `v0.4.0`
build recorded under "Website" below, and `deploy/cloudflare/build.sh` still
defaults to `v0.4.0`. Redeploying is a separate decision.

### Review of the changes

- A separate assistant performed a focused review of pull request #10. It
  reproduced a defect in the first version of the provider-error sanitization
  (a successful JSON-RPC result with a field named `error` was modified),
  verified the fix in `42ffccf`, and ran the 37 tests in
  `tests/unit/credentials.test.ts` (19) and `tests/unit/reconstruct.test.ts`
  (18) independently.
- There was no comprehensive security audit and no formal GitHub approval;
  branch protection does not require one.

### Validation of the release candidate (MEASURED)

Run on 2026-11-27 on macOS, Node 22.19.0, on the `release/0.4.1` working tree:

| Check | Result |
|---|---|
| Typecheck, build | Passed |
| `npm test` | 268 passed (17 files) |
| `npm run test:e2e`, `TXSTORY_E2E_BROWSER=chromium` | 40 passed |
| Synthetic regeneration | Only `engine.version` changes, `0.4.0` to `0.4.1`, in the 15 synthetic recordings |
| Offline replay of all 21 shipped recordings, outbound network denied | 20 reproduce both evidence and output digests, including the 6 devnet recordings made by TxStory 0.3.0; the pending case gives its expected "no story" result |
| THIRD_PARTY_NOTICES.md vs generator | No difference |

The version bump does not change provider evidence or output digests: the
engine version is reported but is not part of the story digest.

### Publication steps awaiting authorization

1. Merge the release pull request after its checks pass.
2. `git tag -a v0.4.1 -m "TxStory 0.4.1"` on the merge commit, push the tag,
   and create the GitHub release from the CHANGELOG entry.
3. Separately, if wanted: rebuild and redeploy the website from `v0.4.1`. Only
   the browser's recording panel would change (the "Without your ABIs" result
   and the stricter "Decoded with your ABIs" badge).

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

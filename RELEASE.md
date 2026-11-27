# Releases

## 0.4.0: published 2026-11-27

- Merged through pull requests #3 (Node 22.23.5 for the container and CI),
  #4 (Dependabot cooldown and separate major tooling updates) and #5 (browser
  reconstruction, static developer site, network isolation fix), each after
  its four required checks passed.
- Tag `v0.4.0` on commit `57b2608`, with a GitHub release. All four CI jobs
  passed on that commit.
- The static site (`npm run build:site`) is not deployed.
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

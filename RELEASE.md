# Releases

## 0.4.0: prepared, not published

Status on 2026-11-27: committed on the local branch
`feature/0.4-developer-journey`. Not pushed, merged, tagged or deployed.

### What it adds

See CHANGELOG.md for the full list. In short:

- the browser rebuilds a local recording with the shared engine ("Open
  recording"), optionally with user-supplied ABI files, and shows a
  reconstruction report;
- a static developer site (`npm run build:site`) that rebuilds the shipped
  examples in the browser and documents installation and use;
- a tested getting-started path, a runnable decoder example, and contributor
  documentation for focused tests, fixture regeneration and compatibility.

### Validation (MEASURED, implementer validation, not an independent review)

Run on 2026-11-27 on macOS with Node 22.19.0 and npm 11.12.1, from a
`git archive` export of the branch into an empty directory under
`env -i PATH HOME`. The export has no `.git`, `node_modules`, build output,
ignored files or private material.

| Check | Result |
|---|---|
| `npm ci`; `npm audit --omit=dev` | Installed from the lockfile; 0 vulnerabilities |
| `npm run build` (both typechecks, client, node) | Passed |
| `npm test` | 222 passed (14 files) |
| `npm run test:e2e`, installed Chrome and `TXSTORY_E2E_BROWSER=chromium` | 39 passed in each (22 server journeys, 17 static site) |
| Offline replay of every shipped recording with outbound network denied (`sandbox-exec`) | 20 of 21 reproduce both digests with nothing missing; the pending case reproduces its "no story" result (exit 3) |
| README quick start, library example and decoder example, network denied | Ran; output as documented |
| Static site served by `python3 -m http.server`, driven in Chrome | Example rebuilt, local file opened, Get started shown; 0 requests to other origins, 0 page errors |
| Static site contents | App, CSP-tagged `index.html` and `404.html`, 21 recordings (15 synthetic, 6 local-devnet) |
| Synthetic recordings regenerated | Identical to the committed files (after regenerating for 0.4.0, which only changes `engine.version`) |
| Container built from the export; the CI container step run verbatim | Exit 0 |
| THIRD_PARTY_NOTICES.md vs generator | No difference |
| `gitleaks detect` over all history | No leaks |
| Relative links and anchors in Markdown | None broken |
| Opt-in captured suite against the private recordings, network denied, archive write-protected | 43 passed; archive checksums unchanged |

Limits:

- GitHub Actions has not run this branch. A local run is not a GitHub run.
- A model walkthrough found the first-use friction fixed here. That is not a
  usability study; human usability remains unmeasured.
- Traces were tested only via dRPC and a local anvil node.

### Publication steps awaiting authorization

1. Push `feature/0.4-developer-journey` and open a pull request to `main`;
   wait for the four required checks.
2. After merge: `git tag -a v0.4.0 -m "TxStory 0.4.0"`, push the tag, and
   create the GitHub release from the notes below.
3. Optional, separately decided: deploy `dist/site` to a static host that
   serves `404.html` for unknown paths. Nothing is deployed today.

### Release notes (draft)

TxStory 0.4.0 makes recordings usable outside the command line. The browser
can open a recording file, rebuild its analysis with the same engine the CLI
uses, and report what was captured, what is missing, which engine versions were
involved, and whether the result matches the digests stored in the file. ABI
files can be added to decode custom errors and calls. The file is read in the
page and is not uploaded.

A static developer site (`npm run build:site`) rebuilds the bundled devnet and
synthetic examples in the browser and documents installation, the CLI, the
HTTP API, the library and extension. It needs no server and no provider
credentials.

Rebuilding reruns the analysis on recorded responses. It does not re-execute
EVM code and does not verify chain history. Human usability has not been
measured. See CHANGELOG.md.

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

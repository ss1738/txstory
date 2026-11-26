# Release 0.3.0: final state and publication plan

Status on 2026-11-27:

- **Licensed** under the Apache License, Version 2.0, Copyright 2026 Satyawan
  Singh, as approved by the owner.
- **The release tree is validated** from a clean export.
- **A fresh local repository** is prepared from that tree, with new history.
  The original development repository and its history are preserved unchanged.
- **Not done:** no remote repository has been created, nothing has been pushed,
  tagged publicly, published or deployed.

## Decisions still needed before publication

1. **GitHub owner and repository name.** More than one GitHub account is
   logged in on the development machine, so the owner account (or
   organisation) must be chosen explicitly. The proposed name is `txstory`.
2. **Commit email.** The public commit should use that account's GitHub
   `noreply` address. GitHub could not provide it automatically, because the
   CLI token lacks the `user` scope. It must come from the owner, or from
   `gh auth refresh -h github.com -s user` followed by `gh api user/emails`. It
   is never constructed.

## Requirement checklist

| Requirement | Status | Evidence |
|---|---|---|
| Apache-2.0 license and NOTICE | Done | `LICENSE` is the verbatim text from https://www.apache.org/licenses/LICENSE-2.0.txt (sha256 `cfc7749b…3d30`, matching Playwright's bundled copy apart from its own appendix line); `NOTICE`; `package.json` and lockfile root `"license": "Apache-2.0"`; SPDX in `examples/devnet/src/Demo.sol`; OpenAPI `info.license`; README, CONTRIBUTING, DATA_PROVENANCE, CHANGELOG |
| Redistribution terms of captured responses investigated | Done; unresolved, so excluded | DATA_PROVENANCE.md, primary sources with dates |
| Public-safe example data, accurately labelled | Done | 15 `synthetic` and 6 `local-devnet` recordings, checked file by file in the clean export |
| Captured recordings preserved privately | Done | Kept outside both repositories. `npm run test:captured` passes against them (43 tests). |
| Tree and history review | Done | VERIFICATION.md. The fresh repository has no prior history. |
| Documentation matches the implementation | Done | API and CLI documentation examples run as tests |
| Security policy distinguishes planned from enabled reporting | Done | SECURITY.md; enabling it is a publication step |
| Clean-export verification | Done | See below |
| CI on GitHub's runners | Not yet possible | Runs on first push |

## Final checks from a clean export (MEASURED)

These checks ran on a `git archive` export of the release commit into an empty
directory, under `env -i PATH HOME`, with Node 22.19.0 and npm 11.12.1. The
export contains no `.git`, `node_modules`, build output, ignored files or
private material.

| Check | Result |
|---|---|
| `npm ci`; `npm audit --omit=dev` | Installed from the lockfile; 0 vulnerabilities |
| `npm run build` (both typechecks, client, node) | Passed |
| `npm test` | 204 passed (11 files) |
| `npm run test:e2e` with installed Chrome; with `TXSTORY_E2E_BROWSER=chromium` (the CI setting) | 21 passed in each |
| CLI `help` and `--version`; library example | Correct output; the example ran offline |
| THIRD_PARTY_NOTICES.md vs generator | No difference |
| Synthetic recordings regenerated | Byte-identical |
| Offline replay of all 21 recordings with outbound network blocked (`sandbox-exec`) | 20 reproduce the same evidence and the same output digest; the pending case reproduces its recorded "pending" result (exit 3) |
| Study scripts | Scorer self-test passed; the answer-key check refuses cleanly (exit 2) without the private recordings |
| Captured suite without its directory | Fails with an explanation, as designed |
| Container from the export | 241 MB; uid 1000; `/app` has `LICENSE`, `NOTICE`, `THIRD_PARTY_NOTICES.md`, the build, `fixtures/{synthetic,devnet}`, production `node_modules`; no study, test, `.env`, `.git` or captured files; 21 examples (15 synthetic, 6 local-devnet); 0 startup warnings; `docker stop` exits 0 |

This is implementer validation, not an independent review.

## Remaining limitations

- **GitHub Actions has not run** on GitHub's runners.
- **No captured real-provider data** is in the repository. The study's TxStory
  condition needs the private recordings, or live mode (study/README.md).
- **Traces were tested** only via dRPC and a local anvil node. They were not
  tested against Geth, Reth or Erigon endpoints.
- **Trust.** TxStory trusts the RPC nodes and explorers it queries. Nothing is
  cryptographically verified.
- **Human usability** has not been measured.

## Publication commands (each needs explicit owner authorization)

The fresh repository is prepared locally with one commit on `main`. With the
chosen owner (`<owner>`) and the GitHub account that owns it:

```bash
cd <fresh repository path>
gh repo create <owner>/txstory --public \
  --description "Explain EVM transactions with evidence: browser UI, CLI, HTTP API and TypeScript library on one engine. Read-only, self-hostable." \
  --source . --remote origin --push
git tag -a v0.3.0 -m "TxStory 0.3.0"
git push origin v0.3.0
gh release create v0.3.0 --title "TxStory 0.3.0" --notes-file <file with the release notes below>
```

GitHub settings after creation:

- **Code security:**
  - enable private vulnerability reporting;
  - enable Dependabot alerts and Dependabot security updates;
  - enable secret scanning and push protection where available.
- **Actions:** set the default workflow permissions to "Read repository contents
  permission".
- **Branch protection for `main`:**
  - require pull requests;
  - block force pushes and deletion;
  - require the four checks from `.github/workflows/ci.yml`:
    - `typecheck, build, unit/integration, CLI, docs examples, study kit`
    - `browser journeys (Playwright, recorded mode)`
    - `secret scan (full history)`
    - `container from source (build, run, inspect; nothing is pushed)`
- **First CI run:** watch it on the first push before announcing anything.

**Not planned:** npm publication (`"private": true` stays), a container registry
push, a hosted demo, deployment.

## Release notes (draft)

TxStory 0.3.0 is the first public developer release, licensed under Apache-2.0.
One analysis engine powers a browser UI, the `txstory` CLI, an HTTP API with an
OpenAPI contract, and a TypeScript library entry point.

It explains what an EVM transaction did, with evidence for each claim and
explicit flags where data is partial:

- call traces, with rolled-back transfers excluded;
- ABI decoding of calldata, logs and revert data, with provenance and reported
  ambiguity;
- decoder modules for extension;
- custom networks from data files;
- recordings that replay offline and report whether evidence and output are
  identical;
- comparison that explains differences.

It runs self-hosted with your own RPC endpoints. Third-party providers are
optional. The bundled examples are local devnet executions and labelled
synthetic cases; recordings of public providers are not included.

TxStory trusts the RPC nodes and explorers it queries and does not
cryptographically verify anything. Human usability has not been measured. See
README "Known limitations" and CHANGELOG.md.

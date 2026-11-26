# Contributing

Thank you for helping. TxStory's value is that its claims are correct and their
evidence is visible, so contributions are judged first on correctness and
honesty about uncertainty.

## Setup

Requirements: Node.js 22 or later (see `engines`; CI pins the exact version in
`.github/workflows/ci.yml`) and npm.
Python 3 is needed only for the study kit checks, Chrome or Chromium for browser
tests, and Foundry only to regenerate devnet recordings or ABI vectors. No
global npm packages are needed.

```bash
npm ci
npm run build          # typechecks + client + node build
npm test               # unit/integration, offline
npm run test:e2e       # browser journeys: the server in recorded mode, and the static site
                       # (uses installed Chrome; TXSTORY_E2E_BROWSER=chromium + `npx playwright install chromium` otherwise)
npm run dev            # API :8787 + Vite :5173
npm run build:site     # static site in dist/site; `npm run site:preview` serves it on :4173
```

Nothing in the test suite needs the network or credentials. CI
(`.github/workflows/ci.yml`) runs exactly these commands, plus:

- the dependency audit;
- the secret scan;
- a container build;
- the study-kit checks.

## Running part of the suite

```bash
npx vitest run tests/unit/reconstruct.test.ts     # one file
npx vitest run -t "Seaport"                        # tests whose name matches
npx playwright test --project static-site          # one browser project (server or static-site)
npx playwright test -g "open a recording"          # browser tests whose name matches
```

## Test data: where it comes from and how to regenerate it

| Data | Source | Regenerate |
|---|---|---|
| `fixtures/synthetic/` | Case definitions in `tests/synthetic/cases.ts` | `npm run fixtures:synthetic` (output is byte-identical when nothing changed; commit both files) |
| `fixtures/devnet/` | Transactions executed on a local anvil node; expected values read from the node into `expected.json` | `examples/devnet/README.md` (needs Foundry) |
| `tests/vectors/abi-cast.json` | Foundry's `cast` encoder | `node scripts/gen-abi-vectors.mjs > tests/vectors/abi-cast.json` (needs Foundry) |

Do not commit recordings of third-party provider responses
(DATA_PROVENANCE.md). Recordings you make with `txstory record` are for local
debugging.

## Good first contributions

- **A decoder module** for a standard or protocol, following
  [docs/extending.md](docs/extending.md): ABI data, optional interpretations
  that cite evidence, and tests against an independent reference.
- **A test case** for something TxStory handles poorly: a devnet scenario
  (`examples/devnet/`) or a synthetic case (`tests/synthetic/cases.ts`), with a
  test that states the correct expected values and where they came from. Please
  do not commit recordings of third-party provider responses (see
  DATA_PROVENANCE.md).
- **A network** via a chain file, or a built-in network with fixtures.

## Rules for changes

- **Independent references.** A test that only re-asserts TxStory's own output
  is not evidence of correctness. Use something outside TxStory:
  - node state (`cast balance`, `cast call`);
  - Foundry's encoder;
  - the explorer's decoding;
  - hand-computed values with the computation shown.
- **Never guess.** Unknown, partial and ambiguous data must stay visible: as
  completeness flags, warnings, or `ambiguous` decodings.
- **Exact amounts.** Use bigint or decimal strings end to end. No floating point
  for amounts.
- **Provenance.** Every new fact or interpretation carries its provenance and
  evidence ids.
- **Compatibility.** These are public contracts:
  - the story JSON (`schemaVersion`), recordings (`schema`) and the evidence
    bundle (`formatVersion`);
  - the HTTP API (`src/server/openapi.ts`, checked by
    `tests/unit/api-contract.test.ts`);
  - CLI flags, `--json` output and exit codes;
  - the library entry point `src/engine/index.ts`.

  Adding an optional field is compatible. Removing or renaming a field,
  changing its type or meaning, or changing an exit code is not: bump the
  version, document it in [docs/formats.md](docs/formats.md) (or the API/CLI
  docs), and add a CHANGELOG entry. Older recordings must keep replaying: the
  shipped recordings are rebuilt in tests, and a change that alters their
  output digests must explain why in the CHANGELOG. During 0.x the library
  surface may change between minor versions, with a CHANGELOG entry.
- **Security.** Do not:
  - execute or fetch anything based on transaction data or ABIs;
  - log or print unredacted provider URLs;
  - commit credentials. The pre-commit secret scan and CI scan must pass;
    don't bypass them.
- **Dependencies.** Avoid new runtime dependencies. Any new dependency must be
  necessary, licence-compatible, and released at least two weeks before you
  adopt it. Regenerate the notices with
  `node scripts/third-party.mjs > THIRD_PARTY_NOTICES.md`.

## Pull requests

Keep them focused, and fill in the PR template checklist. Describe how you
verified the change, and which reference you used.

**Licence of contributions:** TxStory is licensed under the Apache License,
Version 2.0. Unless you state otherwise, a contribution you submit is licensed
under the same terms (section 5 of the license). Only submit work you have the
right to license this way.

# Contributing

Thank you for helping. TxStory's value is that its claims are correct and their
evidence is visible, so contributions are judged first on correctness and
honesty about uncertainty.

## Setup

Requirements: Node.js 22 (see `engines`) and Python 3 (for the study kit
checks). Chrome or Chromium is needed for browser tests. Foundry is needed only
to regenerate devnet recordings or ABI vectors.

```bash
npm ci
npm run build          # typechecks + client + node build
npm test               # unit/integration, offline (~10 s)
npm run test:e2e       # browser journeys in recorded mode (uses installed Chrome;
                       # TXSTORY_E2E_BROWSER=chromium + `npx playwright install chromium` otherwise)
npm run dev            # API :8787 + Vite :5173
```

Nothing in the test suite needs the network or credentials. CI
(`.github/workflows/ci.yml`) runs exactly these commands, plus:

- the dependency audit;
- the secret scan;
- a container build;
- the study-kit checks.

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
- **Formats are versioned.** If you change the shape of the story, a recording or
  the evidence bundle:
  - bump its version;
  - document it in [docs/formats.md](docs/formats.md);
  - keep older recordings replayable.
- **Security.** Do not:
  - execute or fetch anything based on transaction data or ABIs;
  - log or print unredacted provider URLs;
  - commit credentials. The pre-commit secret scan and CI scan must pass;
    don't bypass them.
- **Dependencies.** Avoid new runtime dependencies. Any new dependency must be
  necessary, licence-compatible, and released at least two weeks before you
  adopt it. Regenerate the notices with
  `node scripts/third-party.mjs > THIRD_PARTY_NOTICES.md`.

## Reviewing dependency updates

Dependabot waits 14 days before proposing ordinary version updates. Its
cooldown does not delay security-update pull requests. Review security fixes
promptly and record any exception to the two-week adoption policy.

Development-tool patch and minor updates are grouped. Major updates are
proposed separately so compiler, runtime types, and browser-tool changes can
be evaluated on their own. A Node container major upgrade also needs a review
of the documented runtime and CI versions; a green build alone is not a
decision to change the supported runtime.

Before diagnosing a failed dependency pull request, check whether its branch
includes the latest main-branch CI fixes. Regenerate third-party notices from
the updated lockfile, inspect the notice diff, and run all required checks.
Do not remove the notices check or weaken tests to accept an update.

The cooldown configuration affects future version selection. It does not
establish that an already-open pull request meets the age policy. Check the
release dates of those updates explicitly before merging.

## Pull requests

Keep them focused, and fill in the PR template checklist. Describe how you
verified the change, and which reference you used.

**Licence of contributions:** TxStory is licensed under the Apache License,
Version 2.0. Unless you state otherwise, a contribution you submit is licensed
under the same terms (section 5 of the license). Only submit work you have the
right to license this way.

## What and why

## How it was checked
- [ ] `npm run build` (typechecks) and `npm test` pass locally
- [ ] Browser-visible changes: `npm run test:e2e`
- [ ] New behaviour has tests; correctness claims use an **independent** reference (node state, `cast`, explorer decoding), not TxStory's own output
- [ ] Partial/ambiguous/unknown cases are surfaced, not guessed
- [ ] No credentials, private data, or unredacted provider URLs in code, fixtures, logs or docs
- [ ] Docs updated (README / docs/*) if behaviour, formats or the CLI/API changed; formats versioned if their shape changed
- [ ] New dependencies: necessary, licence compatible, ≥ 2 weeks old; `node scripts/third-party.mjs > THIRD_PARTY_NOTICES.md` regenerated

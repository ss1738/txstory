# Data provenance and redistribution status

This file separates material written for TxStory from material that came from
third parties, and records what is and is not part of the public release. It
does not grant, assume or claim any permission for third-party material, and it
is not legal advice.

## Release decision

**The public release contains no verbatim responses captured from third-party
providers.** Example data comes from two sources the project produced itself:

| Directory | What it is | Origin label |
|---|---|---|
| `fixtures/devnet/` | Recordings of transactions this project executed on a local anvil node, the expected values read from that node with `cast`, and the ABI compiled from `examples/devnet/src/Demo.sol` | `local-devnet` |
| `fixtures/synthetic/` | Recordings of responses written by `scripts/synthetic-fixtures.ts` from the case definitions in `tests/synthetic/cases.ts`. Not real transactions and not real provider data. Endpoints use the reserved `.invalid` domain. | `synthetic` |

Recordings carry their origin in the file (`origin`). Replay of a synthetic
recording labels every source and the story `synthetic`, and the browser shows
"Synthetic example (not real provider data)".

**Captured recordings were moved out of the repository tree.** They are
preserved privately by the owner and are not distributed:

- the 20 former `fixtures/recorded/*` files, captured 2026-11-26;
- `study/evidence/` (one Blockscout response);
- `fixtures/legacy/swap.json` (a Blockscout response used by the removed
  prototype).

The opt-in test suite `npm run test:captured` and the study answer-key check
(`study/verify_answer_key.py`) read them from a local directory supplied by the
person running them.

**Git history still contains them.** Removing files from the newest commit does
not remove them from earlier commits. See RELEASE.md for the publication option
that avoids publishing that history.

## Why captured responses are excluded

The redistribution terms were investigated on 2026-11-26 using the services' own
published documents. The sources and what they establish:

| Service | Primary source read | What it establishes |
|---|---|---|
| Blockscout (eth.blockscout.com and the other instances) | Terms & Conditions v1.1, "Last Updated: December 6, 2024" (https://www.blockscout.com/terms-and-conditions, which redirects to https://eaas.blockscout.com/terms-and-conditions) | Covers "the Products and Services provided by Blockscout". Section 7(h) prohibits "copying, reproducing, or cloning any Product as a whole" without consent. In the portion read, no clause addresses using, storing or redistributing API responses. |
| Blockscout software | Blockscout Software Licence FAQ (https://docs.blockscout.com/devs/blockscout-license) | Governs the explorer software, not hosted API data. Says nothing about responses served by public instances. |
| PublicNode | Terms of service (https://www.publicnode.com/terms) | The only source that addresses RPC data directly: "Blockchain data returned by the Endpoints is not Service Content." "You may use it in your own applications and services, including displaying it to your users." It does not say whether republishing raw responses in a public repository is included. |
| dRPC | https://drpc.org/terms-of-use | The page rendered only its title when fetched, so no clause could be read. |
| Flashbots Protect RPC | Flashbots Terms of Service (https://docs.flashbots.net/policies/terms-of-service) | Covers "Flashbots Services". No clause on storing or redistributing response data. |
| OP Mainnet public RPC (mainnet.optimism.io) | Optimism Terms of Service, "Last updated: March 5, 2024" (https://www.optimism.io/terms) | The website terms restrict distributing "content accessible on any Service". They do not name the public RPC endpoint. |
| Base public RPC (mainnet.base.org) | Base Terms of Service, "Last Updated: April 08, 2026" (https://docs.base.org/terms-of-service) | Covers the sequencer, testnet, Basenames and the Dashboard. Does not name `mainnet.base.org`. |
| Arbitrum public RPC (arb1.arbitrum.io) | https://arbitrum.io/tos | Returned HTTP 403; no terms could be read. |

Conclusions:

- **Not established for any service:** that redistributing verbatim responses
  in a public repository is permitted.
- **PublicNode** comes closest, but its text speaks of use in applications and
  display, not republication.
- **Explorer responses** also contain material added by third parties:
  - address labels and tags;
  - token names and symbols chosen by token deployers;
  - ENS names;
  - verified contract ABIs published by contract authors.

  A licence for the explorer software, or the public availability of a contract
  ABI, says nothing about those additions.
- **Public on-chain facts** (transactions, receipts, logs) are recorded on a
  public ledger, but public accessibility was not treated as permission.

**What would change the decision:** written confirmation from the services, or a
re-recording made under explicit terms. Until then, the captured recordings stay
private.

## Original to this project

The following were written for TxStory:

- source code (`src/`, `scripts/`, `tests/`, `examples/`);
- documentation;
- the study kit's text and scripts;
- the Solidity contracts in `examples/devnet/src/`;
- the synthetic case definitions;
- `tests/vectors/abi-cast.json`, generated locally by Foundry's `cast` from
  arguments chosen by this project.

They are licensed under the Apache License, Version 2.0 (LICENSE, NOTICE).
This licence does not extend to third-party material.

**Study kit.** `study/answer-key.json` holds facts derived by this project
(amounts, fees, token ids and transaction hashes of public mainnet
transactions). It contains no verbatim provider response.

**The devnet recordings** use anvil's well-known default test accounts. They
contain no private key.

## Dependencies

npm packages are listed with their licences in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), which is generated from the
installed packages and checked in CI.

- **Distributed:** all packages in the client bundle and the container runtime
  are MIT.
- **Development only (not distributed):** tooling also includes Apache-2.0,
  MPL-2.0, ISC, BSD-3-Clause and 0BSD packages.

## Research material

`study/` is a usability-evaluation kit: protocol, tasks, answer key, scripts
and templates.

- **Why it is included:** it documents how the product is meant to be evaluated.
- **No participant data:** `study/results/` and `study/sessions/` are
  git-ignored and have never been committed.
- **Empty results:** `study/RESULTS.md` is intentionally empty, because human
  usability has not been measured.
- **What running sessions needs:** the TxStory side of the study needs the
  private captured recordings, or live mode (see study/README.md).

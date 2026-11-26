# Evaluation protocol: TxStory vs. the source block explorer

**Status:** written on 2026-11-26, **before** any participant session or walkthrough
observation. Do not change the success criteria after seeing results. If they
must change, add a dated amendment below and say why.

## Question

Does TxStory help people **correctly** understand what a transaction did, compared
with the block explorer it draws on (Blockscout, eth.blockscout.com)? Does it make
uncertain or incomplete evidence **visible** rather than hidden?

This is a small exploratory comparison. It cannot establish population-level
effects, statistical significance, adoption, retention, or willingness to pay.

## Design

- **Participants:** 5 to 8 adults with varied blockchain familiarity (self-rated 1 to 5,
  recorded as a number only). Convenience sample.
- **Within-subject comparison:** every participant uses both interfaces.
- **Matched tasks:** five task types (T1 to T5), each with two different real
  transactions of the same kind (set X and set Y). A participant sees set X in one
  interface and set Y in the other, so no transaction is seen twice.
- **Counterbalancing:** four conditions, rotating interface order and which set
  goes with which interface.

  | Condition | First block | Second block |
  |---|---|---|
  | A | TxStory, set X | Explorer, set Y |
  | B | Explorer, set Y | TxStory, set X |
  | C | TxStory, set Y | Explorer, set X |
  | D | Explorer, set X | TxStory, set Y |

  Assign in order: P01→A, P02→B, P03→C, P04→D, P05→A, and so on.
  `study/make_session_sheets.py` generates each participant's sheet.
- **Task order:** T1→T5 within each block, the same for everyone. This is a known
  limitation: learning effects across task types are not counterbalanced.

## Interfaces

- **TxStory:** the local production build in recorded mode (`TXSTORY_MODE=recorded`),
  opened at `/example/ethereum/<hash>`. These are real provider responses recorded
  on 2026-11-26.
- **Explorer:** `https://eth.blockscout.com/tx/<hash>`, live, in a normal browser.
  Participants may use any tab or page of the explorer, so it is not handicapped.
- **Not allowed in either condition:** other sites, AI assistants, or asking the
  facilitator for help.
- **Known asymmetry:** TxStory shows responses recorded at one point in time, while
  the explorer is live.
  - The on-chain facts in these tasks are final and identical in both.
  - For T5 the explorer now has complete data, while TxStory's recording does not.
  - T5 therefore measures whether each interface communicates the state of its
    *own* evidence, and the answer key differs by interface.

## Measures (per question unless noted)

| Measure | Definition | Recorded as |
|---|---|---|
| Correctness | Scored against `ANSWER_KEY.md` | `correct` / `partial` / `incorrect` / `no-answer` |
| Time | From the facilitator reading the question until the participant states a final answer | seconds (stopwatch) |
| Critical misunderstanding | An answer that would mislead an action, e.g. a failed transaction called successful, the wrong NFT, WETH called ETH, a TxStory heuristic treated as a verified fact, an incomplete figure stated as exact | code from `ANSWER_KEY.md` + note |
| Evidence vs interpretation | T2 Q3: correctly says whether the "swap" description is a recorded fact or an interpretation | `yes` / `no` |
| Noticed incomplete data | T5 Q2: identifies whether the page's own evidence is complete for the question | `yes` / `no` |
| Unassisted completion | Answered without the facilitator intervening. After 4 minutes of no progress the facilitator may say "you can move on" (scored `no-answer`). | `yes` / `no` |
| Confidence | Per question, 1 to 5, asked after the answer | number; **reported separately from correctness** |
| Preference | After both blocks: which interface they would use again, and why | free text; **never used as evidence of correctness** |

## Success criteria (fixed in advance)

These are descriptive decision thresholds for deciding what to improve next. They
are not hypothesis tests.

1. **Accuracy.** TxStory's correct-answer rate across all questions is at least the
   explorer's rate, minus 5 percentage points.
2. **Critical misunderstandings.** No critical misunderstanding is caused by
   TxStory's presentation for more than one participant on the same question. Any
   such case is treated as a defect regardless of averages.
3. **Incomplete data (T5).** At least 75% of participants in the TxStory condition
   correctly say whether TxStory's evidence is complete for the question.
4. **Evidence vs interpretation (T2 Q3).** At least 75% of participants in the
   TxStory condition identify TxStory's exchange description as an interpretation.
5. **Time.** TxStory's median time per question is no more than 1.5× the
   explorer's. A slower median with higher accuracy is reported, not hidden.

TxStory is judged to have **helped** on these tasks only if criteria 1 to 4 hold. It is
judged to have **harmed** if criterion 2 fails or accuracy is lower by more than 5
points. Otherwise the result is **inconclusive**. With 5 to 8 people, all results are
exploratory.

## Data handling

- **Recorded:** participant ID (P01…), condition, familiarity rating (1 to 5),
  answers, times, codes, and short comments.
- **Not recorded:** no names, emails, wallet addresses, balances, screen or audio
  recordings, analytics, or accounts.
- **Storage:** results live only in a local CSV (`study/results/…`), which is
  git-ignored. Delete it by deleting the file.
- **Nothing is uploaded** or shared without the study owner's explicit decision.

## Amendments

None.

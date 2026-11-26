# Expert walkthrough (not a participant study)

**What this is:** the developer worked through every study task in both
interfaces on 2026-11-26, using a scripted browser (Playwright with system
Chrome), screenshots, page text and axe-core, at 1366×900 and 390×844.

**What this is not:** evidence about how real users perform. The developer knows
the answers and the product, so the findings are defects an informed inspector
can reproduce, not measures of difficulty. No human participants took part, and
no model critique is presented as a participant.

Tags: **MEASURED** = observed in this walkthrough or tests; **INFERRED** =
reasoned from a measured observation; **GUESS** = intuition, untested.

## Defects found and fixed

### W0: Explorer state changes timed out, so cross-checks were silently lost
- **Problem:** Blockscout's `/state-changes` endpoint took longer than the 15 s
  request timeout. Recording new study fixtures produced stories with "explorer
  cross-check unavailable" for three of five fresh transactions.
- **Evidence (MEASURED):** the fixture responses recorded `timed out after 15000 ms`.
  A manual `curl` of the same endpoint took 20.3 s and returned 200.
- **Why it matters (INFERRED):** a user in live mode would often see "not
  checked" instead of a cross-check the explorer could provide. That weakens the
  evidence TxStory exists to show.
- **Change:** state-changes and internal-transactions requests use a separate,
  longer timeout. The default is 45 s, set by `TXSTORY_SLOW_EXPLORER_TIMEOUT_MS`.
  All other requests keep 15 s. The timeout is not part of request identity, so
  the cache and fixture keys are unchanged.
- **Check (MEASURED):** two unit tests (per-request timeout honoured; only the
  slow endpoints get it). Re-recording gave 16 / 4 / 4 cross-check matches with 0
  mismatches for the three transactions.

### W1: The fee panel never stated the total fee
- **Problem:** the "Network fee" panel listed only the parts (burned base fee and
  priority fee), each truncated. The first number under the heading reads as the
  fee, but it was only the burned part.
- **Evidence (MEASURED):** for T1X the panel showed "0.0000012543… ETH — Base fee
  (burned)" first, while the true fee is 0.00004325430669 ETH (answer key). The
  explorer shows one "Transaction fee" figure.
- **Why it matters (INFERRED):** T1 Q3 ("what fee was paid?") invites a wrong
  answer that is off by about 34×. Fees are among the most commonly sought facts.
- **Change:** a bold "Total paid by the sender: …" line comes first, then "Made up
  of:" and the parts.
- **Check (MEASURED):** for all 10 study transactions the displayed exact total
  equals the answer key's fee. Two e2e assertions were added (plain transfer and
  failed transaction).

### W2: The partial-data banner named the missing source, not its consequence
- **Problem:** "Partial data. internal native transfers: unavailable" does not
  say what this means for the numbers on the page.
- **Evidence (MEASURED):** in T5X the sender's ETH figure on TxStory
  (−2.4238…) is wrong by about 0.4485 ETH because of exactly this gap. The banner
  did not say that ETH figures could be affected. The row-level note ("Expected
  gap…") did, but only in the cross-check column.
- **Why it matters (INFERRED):** T5 Q2 measures exactly this. A reader who
  doesn't scan the cross-check column could take −2.4238… as exact.
- **Change:** the banner adds plain consequences: "ETH moved inside execution is
  not included, so ETH balance changes may be incomplete." / "Balance changes could
  not be checked against the explorer." / "Token movements may be incomplete."
- **Check (MEASURED):** unit test of the mapping, and an e2e assertion on T5X.

### W3: The page title repeated the main interpretation without its label
- **Problem:** the `<h1>` shows the lead interpretation's headline (e.g.
  "Exchange-like: 13,022,183… M87 out, 0.0683005… WETH in"). Its
  Heuristic/Decoded/Explorer label appeared only on the card further down,
  below the fold on mobile.
- **Evidence (MEASURED):** a 390 px screenshot of T2X shows the h1, hash and
  buttons with no provenance label until the card.
- **Why it matters (INFERRED):** the title is the most-read text. A heuristic
  title without its label is the `M-HEURISTIC-AS-FACT` failure that T2 Q3 tests.
- **Change:** directly under the title: the badge, plus one sentence ("This
  headline is a pattern-based interpretation, not a recorded fact. It may be
  wrong." / "…follows directly from the receipt and decoded events." / "…is the
  explorer's own wording; TxStory does not verify it."). The card badges now
  share the same component.
- **Check (MEASURED):** e2e asserts the label on T2X (Heuristic) and T5X (Decoded).
  The desktop re-walk shows the right label on all 10 study pages.

### W4: The story card mislabelled explorer-written headlines
- **Problem:** the SVG story card printed "Decoded from chain data" for any lead
  that was not heuristic, including one with `confidence: 'explorer'`.
- **Evidence (MEASURED):** found by code inspection (`exporters.ts`). A unit test
  with an explorer lead reproduced the wrong label.
- **Why it matters (INFERRED):** a shared card would present the explorer's
  unverified text as decoded chain data, erasing a provenance distinction the
  product promises to keep.
- **Change:** all three labels are mapped explicitly; heuristic and explorer
  wording state their limits.
- **Check (MEASURED):** unit test.

### W5: An NFT token ID failed colour contrast
- **Problem:** in the movement list the token ID ("#3703") was styled muted. On
  the selected step's background this measured 4.44:1 (WCAG AA needs 4.5:1).
- **Evidence (MEASURED):** axe-core `color-contrast` (serious) on T4X and T4Y only.
  The existing axe e2e scanned a swap story, so it never covered NFTs.
- **Why it matters (INFERRED):** the token ID is the answer to T4 Q1 ("which NFT
  moved?") and is identity, not secondary text.
- **Change:** the token ID is no longer muted.
- **Check (MEASURED):** a new e2e axe scan of NFT, failed and partial-data stories
  passes.

## Re-walk after the fixes (MEASURED)

- **Desktop 1366×900, all 10 study pages:**
  - no horizontal overflow;
  - the headline label is present and correct;
  - the fee total equals the key;
  - the partial-data banner on T5X and T5Y states the ETH consequence;
  - axe serious/critical: none apart from W5, which was fixed afterwards and
    covered by the e2e scan.
- **Mobile 390×844, after all fixes including W5:** all 10 study pages have zero
  serious/critical axe violations, no horizontal overflow, the correct headline
  label, and the fee total present.

## Observed but not changed

- **The explorer's swap headline carries no interpretation label (MEASURED).**
  eth.blockscout.com shows "Swap 13.02M M87 for 0.068 WETH on Uniswap V2" with no
  label (screenshot, 2026-11-26). This is recorded for the answer key, not as a
  TxStory defect.
- **The explorer lists individual token transfers on its main tab (MEASURED).**
  TxStory lists them in "Movements in order" further down. Both make T2 Q2
  answerable.

## Hypotheses (GUESS: untested; for the human study to confirm or refute)

- **H1. Unfamiliar labels.** "Decoded", "Heuristic" and "Explorer" may be
  unfamiliar words. The new one-sentence explanation may or may not be enough.
  T2 Q3 measures this.
- **H2. Scanning cost on the T5X page.** With 13 addresses and 446 movements,
  people may not find the sender's row and its cross-check. Time on T5 Q1 will
  show it.
- **H3. Sign convention.** People may misread "−0.0000473… ETH includes the
  network fee" on swap rows as part of what was given up. That would show as
  `M-DIRECTION` or `M-PARTIAL-AMOUNT` on T2 Q1.
- **H4. "Reverted" versus "failed".** On T3, participants may not equate
  "Reverted" with "the action did not happen"; the headline says "failed" too.

## Recommendations (not implemented; outside this phase)

- Consider a "sender's net result" summary near the top, with the same
  completeness caveat. Untested; it may duplicate the ledger.
- Decide after real sessions whether the label sentence should be shorter.

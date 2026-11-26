# Answer key and scoring guide

Facts come from **raw captured provider data** (not distributed with the
repository; see README.md). They are computed by
`study/verify_answer_key.py` (independent Python, which reads RPC receipts and does
not read TxStory output) and checked against the explorer's own recorded state
changes; the output is in `answer-key.json`. Re-run the script to reproduce. It
exits non-zero on any disagreement.

## General scoring rules

- **Amounts.** Correct if they agree with the key to at least 3 significant digits
  and name the right token. Rounded displays ("13.02M M87") are fine.
- **Partial:** a right amount with the wrong token, or right tokens with a wrong
  amount.
- **Addresses.** The last 4 characters are enough. Names shown by the interface,
  such as "UniswapV2Pair", count if they identify the right address.
- **WETH is not ETH.** Calling WETH "ETH" is scored `partial` and coded `M-WETH`.
- **Fee.** Accept the total fee. Accept the burned base fee plus the priority fee
  stated together. The base fee alone is `partial`.

## Misunderstanding codes

| Code | Meaning |
|---|---|
| `M-OUTCOME` | A failed transaction called successful, or the reverse |
| `M-WETH` | WETH reported as ETH, or the reverse |
| `M-DIRECTION` | Sender and recipient swapped, or gave/received reversed |
| `M-PARTIAL-AMOUNT` | Reported one transfer as the total given up, e.g. 12.63M M87 instead of 13.02M |
| `M-NFT-ID` | Wrong token ID or collection |
| `M-HEURISTIC-AS-FACT` | Treated a TxStory "Heuristic" or "Explorer" statement as a verified fact |
| `M-INCOMPLETE-AS-EXACT` | Stated an incomplete figure as exact (T5) |
| `M-INVENTED` | Asserted something no evidence on the page supports, e.g. a payment in T4 |

---

## T1: Simple transfer

| | Set X `0xf935435d…a9730` | Set Y `0x645ab583…49df0a` |
|---|---|---|
| Q1 succeeded? | Yes | Yes |
| Q2 amount, to | 0.00009502147288237 ETH to …2654 | 0.25254047 ETH to …ea98 |
| Q3 fee | 0.00004325430669 ETH | 0.000043380716316 ETH |

## T2: Exchange

| | Set X `0xec893ce0…69804` | Set Y `0xfe989499…970d3` |
|---|---|---|
| Q1 gave / received | Gave 13,022,183.624750241637229919 **M87**; received 0.068300597997526149 **WETH** | Gave 202.396702 **USDT**; received 1,000,000 **CCDAO** |
| Q2 one or several transfers | Several: **2** (390,665.51 to the M87 token contract + 12,631,518.12 to the pool) | Several: **3** (90.796597 + 81.088611 + 30.511494) |
| Q3 how the swap claim is presented | *see below* | *see below* |

**Q3, by interface.** Score `correct` if the participant accurately describes how
**their** page presents the claim:
- **TxStory:** the exchange headline is labelled **Heuristic**, a pattern match
  from balance changes. The explorer's "Swap…" sentence is labelled **Explorer**,
  meaning the explorer's own summary and not verified. An answer like "it's marked
  heuristic / an interpretation" is correct. "It's a fact" is `incorrect` and coded
  `M-HEURISTIC-AS-FACT`.
- **Explorer (eth.blockscout.com, observed 2026-11-26):** a headline "Swap 13.02M M87
  for 0.068 WETH on Uniswap V2" is shown with no label marking it as interpretation.
  Correct answers note that it is stated without an interpretation label (that is,
  presented like a fact). The method name `swapExactTokens…` is the decoded
  function name: evidence of what was *requested*, not of the result.
- **Ambiguity:** whether a swap "really" happened is a semantic question. Q3 scores
  only the participant's reading of the presentation.

## T3: Outcome

| | Set X `0xdfd1aafc…d0618` | Set Y `0x31b4768c…4d3a8` |
|---|---|---|
| Q1 requested action happened? | **No**, the transaction reverted (explorer reason: "invalid opcode: INVALID") | **No**, reverted (explorer reason: "out of gas") |
| Q2 sender lost | Only the fee: 0.00001917530628 ETH | Only the fee: 0.000002894506886684 ETH |
| Q3 tokens moved? | No | No |

**Ambiguity:** the revert reason is explorer-reported. Participants need not give it.

## T4: NFT

| | Set X `0x1f9753fb…5198a` | Set Y `0xd711cffd…bc517` |
|---|---|---|
| Q1 NFT | **BAYC #3703** (contract …f13D) | **PPG #1484** (contract …2cf8) |
| Q2 from → to | …67a0 → …1935 | …5cfb → …f6d1 |
| Q3 payment in this tx? | **No**: value 0, no token transfers besides the NFT | **No**: same |

**Ambiguity:** a payment could have happened in another transaction. "No payment
in this transaction" is correct. Claiming a sale price is `M-INVENTED`.

## T5: Net result (the answer depends on the interface's evidence)

| | Set X `0x783cf8c0…ff8a69` | Set Y `0x55696a27…484a83` |
|---|---|---|
| True net ETH change of the sender (explorer state changes) | **−1.975363018468247748 ETH** | **−0.043867446235098651 ETH** (value 0.0438099… + fee 0.0000575…; explorer state changes fetched 2026-11-26; the response is kept with the captured recordings, not in this repository) |
| What RPC data alone gives | −2.423858879606830819 ETH: value + fee, **missing** ~0.4485 ETH of internal native transfers back to the sender | −0.043867446235098651 ETH (correct; there are no internal transfers for a WETH deposit) |
| TxStory (recorded) shows | Its own figure −2.42385… with "≠ differs from explorer, explorer: −1.97536…, Expected gap: TxStory is missing internal native-value movements"; a "Partial data" banner | −0.0438674… ETH with "not checked"; "Partial data" banner: the explorer had not indexed the transaction when recorded |
| Explorer (live) shows | Complete data (State tab and internal transactions) | Complete data |

**Q1 scoring.**
- **Explorer:** correct = the true value.
- **TxStory, set X:** correct = −1.9753… *citing the explorer comparison*, or an
  explicit statement that TxStory's own figure is incomplete. −2.4238… stated as
  exact is `incorrect`, coded `M-INCOMPLETE-AS-EXACT`.
- **TxStory, set Y:** correct = −0.04386…; also correct if the participant adds that
  it could not be cross-checked.

**Q2 scoring** (noticed incomplete data). Score `yes` if the answer is accurate for
**their** page:
- **TxStory X:** "no: internal native transfers are missing; the explorer's figure
  differs".
- **TxStory Y:** "not fully: the explorer cross-check is unavailable or internal
  transfers unknown".
- **Explorer X/Y:** "yes", and also accept a reasoned "yes, from the state changes".

**Ambiguities.**
- **TxStory Y:** its number is right, but the page cannot prove that. A participant
  who gives the right number but says the page is complete scores Q1 `correct` and
  Q2 `no`.
- **T5 is intentionally asymmetric:** it measures how each interface communicates
  the state of its own evidence.

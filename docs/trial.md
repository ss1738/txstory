# Developer trial: three tasks

A short way to try TxStory and report what got in the way. Each task lists what
you should observe when it works and what counts as a failure worth reporting
(see the bug report template). Tasks 1 and 2 are offline; task 3 needs network
access.

Setup, once:

```bash
git clone https://github.com/ss1738/txstory.git && cd txstory
npm ci
```

## 1. Understand an included transaction from its evidence

```bash
npm run -s txstory -- replay fixtures/synthetic/ethereum-0xefb65ab1ab71b94063c0ee8e8c7bdde47b808c19f4e653ed931e3006f4983112.json
```

This is a synthetic token swap in which the sold token charges a transfer tax.
Answer from the output alone: how much of each token the sender gave and
received, what the fee was, and which line says the data is synthetic.

- **Success:** exit code 0; `Same evidence: true · Same output: true`; you can
  point to the ledger rows and the fee line that answer each question, and the
  headline is labelled `heuristic`.
- **Failure:** a non-zero exit code, a number you cannot trace to a ledger row or
  source, or an answer you reached that the evidence contradicts.

## 2. Decode a custom error with an ABI

```bash
npm run -s txstory -- replay fixtures/devnet/anvil-0x27dbc58bd2861be2ea7264fd2d03aa97510ebc7ff3e00ab59a0bb114cbbe4aab.json
npm run -s txstory -- replay fixtures/devnet/anvil-0x27dbc58bd2861be2ea7264fd2d03aa97510ebc7ff3e00ab59a0bb114cbbe4aab.json --abi fixtures/devnet/Demo.abi.json
```

The same works in the browser: on the website or `/open`, open the example
"Devnet: customError", then "Decode with ABI files" with `Demo.abi.json`.

- **Success:** the first run shows `unknown error selector 0xcf479181`; the second
  shows `InsufficientBalance(available="1000000000000000000", required="5")`,
  exits 0, reports `Same evidence: true`, and says the ABI changed the output.
- **Failure:** the error stays undecoded, the second run exits non-zero, or the
  report blames the recording rather than the supplied ABI.

## 3. Analyse a transaction locally and reopen its recording

Pick any recent Ethereum mainnet transaction hash (for example from a block
explorer).

```bash
npm run -s txstory -- record ethereum 0x<hash> -o tx.json
npm run -s txstory -- replay tx.json
```

- **Success:** `record` exits 0 and names the file; `replay` exits 0 with
  `Same evidence: true · Same output: true` and the same balance changes, without
  network access. Gaps such as "explorer has not indexed this transaction" are
  shown as completeness flags, not hidden.
- **Failure:** a crash or unexplained error, a replay that differs from the
  recording, or a balance change you can show is wrong.
- **Not a TxStory failure on its own:** exit code 4 when the public endpoints are
  unavailable or limited. Report it if a configured endpoint could answer but
  TxStory did not try it, or if the message does not say what failed.

When reporting, include the command, what you expected, what you observed, and
your TxStory and Node versions.

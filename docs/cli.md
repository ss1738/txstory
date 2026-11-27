# Command line: `txstory`

The CLI uses the same engine as the web app and the API. From a clone:

```bash
npm ci
npm run -s txstory -- help           # runs from source; no build needed
npm run build && node dist/node/cli/main.js help   # the compiled CLI
npm link                             # optional, after the build: puts `txstory` on your PATH (local only, nothing is published)
```

The examples below write `txstory` for any of these forms.

## Conventions (stable)

- **Output streams.** stdout carries the result. stderr carries diagnostics and
  errors. Nothing is interactive.
- **`--json`.** Exactly one JSON document goes to stdout, errors included:
  `{"txstory": "<version>", "command", "ok", ...}`. Human text is for reading;
  parse JSON.
- **Credentials.** Configured provider URLs are withheld
  (`https://rpc-1.withheld.invalid/`); only built-in public, loopback and
  `.invalid` URLs are printed. See
  [Provider URLs in shareable output](configuration.md#provider-urls-in-shareable-output).
- **Exit codes:**

| Code | Meaning |
|---|---|
| 0 | Success. Also: replay identical, compare identical, decode unique. |
| 1 | Result produced but not clean: partial facts with `--strict`, a replay that differs, a comparison with differences, or a decode that is ambiguous or no match. A replay with `--abi` exits 0 when the evidence is identical and the same recording rebuilt without the ABIs reproduces the stored output (`differsOnlyByUserAbis`); the report always states both results. |
| 2 | Usage error |
| 3 | Transaction not found, pending, or unsupported |
| 4 | Providers unavailable |
| 5 | Input file invalid (recording, ABI, chain file, story JSON) |

`--strict` treats these as partial facts:

- native transfers inside execution that are not complete;
- incomplete token metadata;
- a truncated trace;
- any failed source.

Explorer comparisons (`stateChanges`, `explorerTokenTransfers`) are optional
evidence. Their absence alone does not fail `--strict`.

## Commands

```
txstory explain <network> <hash|explorer-link>   analyse live (full stage: RPC + explorer + trace)
txstory explain <explorer-link>                  network taken from the link's host
txstory explain --recording <file>               analyse offline from a recording
txstory record <network> <hash> -o <file>        analyse live, save a replayable recording
txstory replay <file>                            rebuild offline; report same evidence / same output
txstory compare <a> <b>                          explain differences between two analyses
txstory decode calldata|log|revert --data 0x… [--topics …] --abi <file>
txstory selector "<signature>" [--kind function|event|error]
txstory networks [--chains <file>]
```

**Options:**

| Option | Effect |
|---|---|
| `--json` | Machine-readable output |
| `--stage fast\|full` (or `--fast`) | `fast` skips the explorer and trace |
| `--no-trace` | Do not request `debug_traceTransaction` |
| `--abi FILE` | JSON ABI or list of signatures. Repeatable. Labelled `user` everywhere. |
| `--rpc URL` | Repeatable, in fallback order. Replaces the network's default RPCs. |
| `--explorer URL\|off` | Blockscout v2 API base |
| `--chains FILE` | Add networks |
| `--timeout MS` | Per-request timeout |
| `--strict` | Exit 1 on partial facts (see above) |
| `-o FILE` | Output file for `record` |
| `--embed-story` | `record`: also embed the output story, so `replay` can explain differences field by field. Recordings otherwise carry only digests of the output. |

**Environment** (the same variables the server uses):

- `TXSTORY_RPC_<NETWORK>`
- `TXSTORY_EXPLORER_<NETWORK>`
- `TXSTORY_BLOCKSCOUT_API_KEY`
- `TXSTORY_CHAINS_FILE`
- `TXSTORY_TRACE=auto|off`
- `TXSTORY_TIMEOUT_MS`
- `TXSTORY_SLOW_EXPLORER_TIMEOUT_MS`

## Examples

Offline examples, which run in CI against recordings in this repository (`fixtures/devnet` holds real execution on a local anvil node; `fixtures/synthetic` holds generated test data, not real transactions):

```console
$ txstory replay fixtures/devnet/anvil-0xdce671e4526d6d277669b28b2a9108c3f291951eb893a8d716101d94a2640359.json   # exit 0
$ txstory replay fixtures/devnet/anvil-0x27dbc58bd2861be2ea7264fd2d03aa97510ebc7ff3e00ab59a0bb114cbbe4aab.json --abi fixtures/devnet/Demo.abi.json   # exit 0
$ txstory explain --recording fixtures/devnet/anvil-0x27dbc58bd2861be2ea7264fd2d03aa97510ebc7ff3e00ab59a0bb114cbbe4aab.json --abi fixtures/devnet/Demo.abi.json   # exit 0
$ txstory explain --recording fixtures/synthetic/ethereum-0xefb65ab1ab71b94063c0ee8e8c7bdde47b808c19f4e653ed931e3006f4983112.json --json   # exit 0
$ txstory explain --recording fixtures/synthetic/ethereum-0xfeb89d8c5b4ec361b7e3bd004eef2b156f0d4a9f39515d07377a357935891eff.json --strict   # exit 1
$ txstory decode revert --data 0x4e487b710000000000000000000000000000000000000000000000000000000000000011   # exit 0
$ txstory decode calldata --data 0xa9059cbb00000000000000000000000000000000000000000000000000000000deadbeef0000000000000000000000000000000000000000000000000000000000000001 --abi fixtures/devnet/Demo.abi.json   # exit 0
$ txstory selector "transfer(address,uint256)"   # exit 0
$ txstory networks --chains fixtures/devnet/chains.json --json   # exit 0
$ txstory explain ethereum 0x1234   # exit 2
$ txstory replay does-not-exist.json   # exit 5
```

Live examples. These contact public providers and are not run in CI:

```console
$ txstory explain ethereum 0xec893ce03b8b8ef2d5e0d5edb9db9f63ad0972e2a6845504bc31cca395869804   # live
$ txstory explain https://eth.blockscout.com/tx/0xec893ce03b8b8ef2d5e0d5edb9db9f63ad0972e2a6845504bc31cca395869804 --json   # live
$ txstory record ethereum 0xec893ce03b8b8ef2d5e0d5edb9db9f63ad0972e2a6845504bc31cca395869804 -o swap-today.json   # live
$ txstory compare swap-earlier.json swap-today.json   # compares two of your own recordings of the same transaction
```

Scripting, using JSON only:

```bash
txstory explain --recording rec.json --json \
  | jq -r '.story as $s | $s.ledger[] | select(.address == $s.tx.from) | "\(.assetKey) \(.delta)"'
txstory explain ethereum "$HASH" --json --strict > story.json || echo "exit $?: see story.json"
```

## Your own node

Point TxStory at any JSON-RPC endpoint. With a node that offers
`debug_traceTransaction` (Geth, Reth, Erigon, Nethermind, Anvil), stories gain:

- the call tree;
- exact native value moved inside execution, with rolled-back transfers
  excluded;
- decoded revert data.

```bash
txstory explain ethereum "$HASH" --rpc http://127.0.0.1:8545
txstory explain anvil "$HASH" --chains examples/devnet/chains.json   # a local devnet; see examples/devnet/README.md
```

# Local devnet (anvil): real execution, offline tests

This directory produces the recordings in `fixtures/devnet/`. The contracts in
`src/Demo.sol` exercise:

- nested native transfers;
- a transfer rolled back inside `try/catch`;
- a custom error, `Error(string)` and `Panic(0x11)`;
- an ERC-20-style transfer.

Expected values (native balance changes, fees, status) are taken from the node
itself with `cast` at blocks N−1 and N, independently of TxStory. They are stored
in `fixtures/devnet/expected.json`, and `tests/unit/devnet.test.ts` compares
against them.

You need Foundry (`anvil`, `cast`, `forge`). It is not needed to run the tests,
which replay the committed recordings offline.

```bash
cd examples/devnet && forge build --offline && cd ../..
npx tsx examples/devnet/scenario.ts        # starts anvil on :18545, deploys, sends 6 txs, records, stops anvil
```

The scenario uses anvil's **unlocked** default accounts; there are no private
keys anywhere. Transaction hashes are deterministic for a fresh anvil, so
re-running reproduces the same recordings (apart from block timestamps).

## Explore a live devnet yourself

```bash
anvil &                                                   # default port 8545
cat > /tmp/chains.json <<'JSON'
{ "chains": [ { "key": "anvil", "chainId": 31337, "name": "Anvil", "rpc": ["http://127.0.0.1:8545"] } ] }
JSON
npx tsx src/cli/main.ts explain anvil <tx-hash> --chains /tmp/chains.json --abi examples/devnet/out/Demo.sol/Vault.json
TXSTORY_CHAINS_FILE=/tmp/chains.json npm start            # the web UI lists "Anvil" as a network
```

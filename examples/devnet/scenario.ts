/**
 * Local devnet scenario: real EVM execution on anvil, recorded for offline tests.
 *
 *   cd examples/devnet && forge build --offline && cd ../.. && npx tsx examples/devnet/scenario.ts
 *
 * Requires Foundry (anvil, cast, forge). Uses anvil's UNLOCKED default
 * accounts (no private keys anywhere). Writes:
 *   fixtures/devnet/anvil-<hash>.json   TxStory recordings (txstory-fixture-v3)
 *   fixtures/devnet/expected.json       expected values from `cast` (independent of TxStory)
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { engineConfigFromEnv, loadChainFile } from '../../src/engine/config.js';
import { recordAnalysis } from '../../src/engine/recording.js';
import { writeRecording } from '../../src/engine/fixture-files.js';
import { LiveTransport } from '../../src/engine/transport.js';

const PORT = 18545;
const RPC = `http://127.0.0.1:${PORT}`;
const OUT = 'fixtures/devnet';
const cast = (sub: string, ...a: string[]) => execFileSync('cast', [sub, '--rpc-url', RPC, ...a], { encoding: 'utf8' }).trim();
const castOffline = (...a: string[]) => execFileSync('cast', a, { encoding: 'utf8' }).trim();
const artifact = (name: string) => JSON.parse(readFileSync(`examples/devnet/out/Demo.sol/${name}.json`, 'utf8')) as { abi: unknown[]; bytecode: { object: string } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const anvil = spawn('anvil', ['--port', String(PORT), '--silent', '--chain-id', '31337'], { stdio: 'ignore' });
try {
  for (let i = 0; i < 50; i++) { try { cast('chain-id'); break; } catch { await sleep(200); } }
  const accounts = JSON.parse(cast('rpc', 'eth_accounts')) as string[];
  const [A, B, C] = accounts as [string, string, string];
  const send = (from: string, args: string[]) => JSON.parse(execFileSync('cast', ['send', '--rpc-url', RPC, '--unlocked', '--from', from, '--json', ...args], { encoding: 'utf8' })) as { transactionHash: string; contractAddress: string | null; blockNumber: string; status: string };
  const deploy = (name: string, ctorSig?: string, ...ctorArgs: string[]) => {
    const code = artifact(name).bytecode.object;
    const args = ctorSig ? castOffline('abi-encode', ctorSig, ...ctorArgs).slice(2) : '';
    return send(A, ['--create', code + args]).contractAddress!;
  };
  const reverter = deploy('Reverter');
  const vault = deploy('Vault', 'constructor(address)', reverter);
  const token = deploy('DemoToken');

  const txs: Array<{ name: string; hash: string }> = [];
  const run = (name: string, args: string[]) => {
    const r = send(A, args);
    txs.push({ name, hash: r.transactionHash });
  };
  run('split', [vault, 'split(address,address)', B, C, '--value', '1ether']);
  run('payAndTry', [vault, 'payAndTry(address)', B, '--value', '2ether']);
  run('customError', [vault, 'withdrawTooMuch(uint256)', '5', '--gas-limit', '100000']);
  run('errorString', [vault, 'boom()', '--gas-limit', '100000']);
  run('panic', [vault, 'overflow(uint8)', '10', '--gas-limit', '100000']);
  run('tokenTransfer', [token, 'transfer(address,uint256)', B, '1234500000000000000']);

  // Expected native balance deltas from the node's state, independent of TxStory.
  const watch: Record<string, string> = { sender: A, recipientB: B, recipientC: C, vault, reverter };
  const expected = {
    generatedBy: 'examples/devnet/scenario.ts', node: execFileSync('anvil', ['--version'], { encoding: 'utf8' }).split('\n')[0],
    method: 'cast balance <address> --block N-1 and --block N (anvil mines one transaction per block)',
    addresses: watch, contracts: { reverter, vault, erc20: token },
    transactions: txs.map(({ name, hash }) => {
      const receipt = JSON.parse(cast('receipt', hash, '--json')) as { blockNumber: string; status: string; gasUsed: string; effectiveGasPrice: string };
      const n = BigInt(receipt.blockNumber);
      const deltas = Object.fromEntries(Object.entries(watch).map(([k, addr]) => {
        const before = BigInt(cast('balance', addr, '--block', String(n - 1n)));
        const after = BigInt(cast('balance', addr, '--block', String(n)));
        return [k, (after - before).toString()];
      }));
      return { name, hash, block: n.toString(), status: Number(receipt.status), fee: (BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice)).toString(), nativeDeltas: deltas };
    }),
  };

  // Record each transaction with TxStory (traces on; no explorer on a devnet).
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/chains.json`, JSON.stringify({ chains: [{ key: 'anvil', chainId: 31337, name: 'Anvil devnet', nativeSymbol: 'ETH', feeModel: 'ethereum-l1', rpc: [RPC], explorerApi: null }] }, null, 1) + '\n');
  loadChainFile(`${OUT}/chains.json`);
  const config = engineConfigFromEnv({});
  const live = new LiveTransport({ timeoutMs: 15000, maxBytes: 8_000_000, userAgent: config.userAgent });
  for (const t of txs) {
    const { result, recording } = await recordAnalysis('anvil', t.hash, live, config, { description: `Devnet: ${t.name}`, origin: 'local-devnet' });
    await writeRecording(`${OUT}/anvil-${t.hash}.json`, recording);
    console.log(t.name, t.hash.slice(0, 10), result.kind, result.kind === 'ok' ? `${result.story.outcome} trace=${result.story.trace.status} revert=${result.story.revert?.summary ?? '-'}` : result.message);
  }
  writeFileSync(`${OUT}/expected.json`, JSON.stringify(expected, null, 1) + '\n');
  writeFileSync(`${OUT}/Demo.abi.json`, JSON.stringify([...artifact('Vault').abi, ...artifact('Reverter').abi, ...artifact('DemoToken').abi], null, 1) + '\n');
} finally {
  anvil.kill();
}

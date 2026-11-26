/**
 * SYNTHETIC test cases. Nothing here was captured from a provider: every
 * transaction, receipt, block and explorer response is written below and
 * served by a fake provider in scripts/synthetic-fixtures.ts, which records
 * them through the normal recorder into fixtures/synthetic/ (origin
 * "synthetic"). Expected values in `expect` are plain arithmetic on the
 * case's own numbers, independent of TxStory's pipeline.
 *
 * Response shapes follow the JSON-RPC specification and Blockscout's v2 API
 * as consumed by src/engine/providers. Addresses are made-up labels except
 * well-known contract constants (WETH9 on Ethereum, the OP Stack WETH
 * predeploy), which TxStory's network configuration names.
 */
import { keccakHex } from '../../src/core/hex.js';

// ---------------------------------------------------------------- encoding helpers (independent of src/core/abi.ts)

/** A deterministic made-up address for a label. */
export const addr = (label: string) => ('0x' + keccakHex(`txstory-synthetic-address:${label}`).slice(-40)) as `0x${string}`;
export const txHash = (label: string) => keccakHex(`txstory-synthetic-tx:${label}`);
export const hexQ = (n: bigint | number) => '0x' + BigInt(n).toString(16);
export const word = (n: bigint) => (n < 0n ? (1n << 256n) + n : n).toString(16).padStart(64, '0');
export const addrWord = (a: string) => '0x' + a.slice(2).toLowerCase().padStart(64, '0');
const data = (...words: bigint[]) => '0x' + words.map(word).join('');

export const T = {
  transfer: keccakHex('Transfer(address,address,uint256)'),
  transferSingle: keccakHex('TransferSingle(address,address,address,uint256,uint256)'),
  deposit: keccakHex('Deposit(address,uint256)'),
  withdrawal: keccakHex('Withdrawal(address,uint256)'),
  v2Swap: keccakHex('Swap(address,uint256,uint256,uint256,uint256,address)'),
  v2Sync: keccakHex('Sync(uint112,uint112)'),
};

export interface Log { address: string; topics: string[]; data: string }

export const erc20Transfer = (token: string, from: string, to: string, amount: bigint): Log =>
  ({ address: token, topics: [T.transfer, addrWord(from), addrWord(to)], data: data(amount) });
export const erc721Transfer = (token: string, from: string, to: string, id: bigint): Log =>
  ({ address: token, topics: [T.transfer, addrWord(from), addrWord(to), '0x' + word(id)], data: '0x' });
export const erc1155Single = (token: string, operator: string, from: string, to: string, id: bigint, amount: bigint): Log =>
  ({ address: token, topics: [T.transferSingle, addrWord(operator), addrWord(from), addrWord(to)], data: data(id, amount) });

// ---------------------------------------------------------------- case model

export type ExplorerMode =
  | { kind: 'full'; tx: Record<string, unknown>; internal?: unknown[]; internalFailure?: string; stateChanges: unknown[]; transfers: unknown[]; transfersPageSize?: number; logNames?: Record<number, string>; summaries?: unknown[] }
  | { kind: 'status'; httpStatus: 403 | 404 };

export interface TokenMeta { symbol: string; name: string; decimals: number | null }

export interface SyntheticCase {
  id: string;
  network: 'ethereum' | 'optimism' | 'base' | 'arbitrum';
  description: string;
  hash: string;
  /** null: the transaction is pending (no block, no receipt). */
  block: { number: bigint; baseFee: bigint | null; miner: string; timestamp: bigint } | null;
  tx: { from: string; to: string | null; value: bigint; input: string; type: number; nonce: number };
  receipt?: { status: 0 | 1; gasUsed: bigint; effectiveGasPrice: bigint; logs: Log[]; contractAddress?: string; l1Fee?: bigint };
  explorer: ExplorerMode;
  /** Answers for eth_call metadata lookups and eth_getCode (used when the explorer gives nothing). */
  tokens?: Record<string, TokenMeta>;
  contracts?: string[];
}

// ---------------------------------------------------------------- shared actors and constants

export const A = {
  sender: addr('sender'), recipient: addr('recipient'), router: addr('router'), pair: addr('pair'),
  taxToken: addr('tax-token'), nft721: addr('nft-721'), nft1155: addr('nft-1155'), miner: addr('block-builder'),
  deployed: addr('deployed-contract'), depositor: addr('op-depositor'), arbToken: addr('arbitrum-token'),
  seaport: addr('seaport-like-exchange'),
};
export const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
export const OP_WETH = '0x4200000000000000000000000000000000000006';
// Seaport sale actors come from the cast-encoded vector (tests/vectors/abi-cast.json).
export const SEAPORT_SELLER = '0x5e11e75e11e75e11e75e11e75e11e75e11e75e11';
export const SEAPORT_BUYER = '0xb0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0';
export const SEAPORT_NFT = '0x1155115511551155115511551155115511551155';

const E18 = 10n ** 18n;
const GWEI = 10n ** 9n;
const BASE = 1n * GWEI;
const TIP = GWEI / 2n;
const ethBlock = (n: bigint) => ({ number: n, baseFee: BASE, miner: A.miner, timestamp: 1_767_225_600n + n });
/** Ethereum fee split for a gas amount at base 1 gwei + tip 0.5 gwei. */
export const ethFee = (gas: bigint) => ({ total: gas * (BASE + TIP), burned: gas * BASE, tip: gas * TIP });
const price = BASE + TIP;

const addrObj = (hash: string, extra: Record<string, unknown> = {}) => ({ hash, is_contract: false, name: null, ens_domain_name: null, ...extra });
const coin = (address: string, change: bigint, isMiner = false) => ({ type: 'coin', address: addrObj(address), change: change.toString(), is_miner: isMiner, token: null });
const tokenObj = (address: string, symbol: string, decimals: number | null, type: string, name = symbol) => ({ address_hash: address, symbol, name, decimals: decimals === null ? null : String(decimals), type });
const tokenChange = (address: string, token: ReturnType<typeof tokenObj>, change: bigint | unknown[], tokenId: string | null = null) =>
  ({ type: 'token', address: addrObj(address), change: Array.isArray(change) ? change : change.toString(), token, token_id: tokenId, is_miner: false });
const nftDir = (direction: 'from' | 'to', id: string) => ({ direction, total: { token_id: id, token_instance: null } });
const transferItem = (logIndex: number, token: ReturnType<typeof tokenObj>, from: string, to: string) =>
  ({ log_index: logIndex, token, from: addrObj(from), to: addrObj(to) });
const txObj = (c: { hash: string; block: bigint; from: string; to: string | null }, extra: Record<string, unknown> = {}) =>
  ({ hash: c.hash, block_number: Number(c.block), from: addrObj(c.from), to: c.to ? addrObj(c.to, { is_contract: true }) : null, method: null, decoded_input: null, revert_reason: null, ...extra });

const TAXT = tokenObj(A.taxToken, 'TAXT', 18, 'ERC-20', 'Synthetic Tax Token');
const WETH_T = tokenObj(WETH, 'WETH', 18, 'ERC-20', 'Wrapped Ether');
const NFT721_T = tokenObj(A.nft721, 'SYN721', null, 'ERC-721', 'Synthetic NFT');
const NFT1155_T = tokenObj(A.nft1155, 'SYN1155', null, 'ERC-1155', 'Synthetic Multi');

// ---------------------------------------------------------------- cases

function ethTransfer(): SyntheticCase {
  const hash = txHash('eth-transfer'); const gas = 21_000n; const value = 250n * 10n ** 15n; const f = ethFee(gas);
  return {
    id: 'eth-transfer', network: 'ethereum', hash, description: 'Synthetic: plain ETH transfer between two accounts',
    block: ethBlock(20_000_001n), tx: { from: A.sender, to: A.recipient, value, input: '0x', type: 2, nonce: 1 },
    receipt: { status: 1, gasUsed: gas, effectiveGasPrice: price, logs: [] },
    explorer: { kind: 'full', tx: txObj({ hash, block: 20_000_001n, from: A.sender, to: null }, { to: addrObj(A.recipient) }), internal: [], transfers: [],
      stateChanges: [coin(A.sender, -(value + f.total)), coin(A.recipient, value), coin(A.miner, f.tip, true)] },
  };
}

function failed(): SyntheticCase {
  const hash = txHash('failed'); const gas = 40_000n; const f = ethFee(gas);
  const input = '0xa9059cbb' + addrWord(A.recipient).slice(2) + word(1000n);
  return {
    id: 'failed', network: 'ethereum', hash, description: 'Synthetic: reverted token transfer (only the fee is paid)',
    block: ethBlock(20_000_002n), tx: { from: A.sender, to: A.taxToken, value: 0n, input, type: 2, nonce: 2 },
    receipt: { status: 0, gasUsed: gas, effectiveGasPrice: price, logs: [] },
    explorer: { kind: 'full', tx: txObj({ hash, block: 20_000_002n, from: A.sender, to: A.taxToken }, { method: 'transfer', revert_reason: 'execution reverted: transfer amount exceeds balance' }),
      internal: [], transfers: [], stateChanges: [coin(A.sender, -f.total), coin(A.miner, f.tip, true)] },
  };
}

export const SWAP = { tax: 30n * E18, toPair: 970n * E18, wethOut: 5n * 10n ** 17n, gas: 150_000n };
function swapFeeOnTransfer(): SyntheticCase {
  const hash = txHash('swap-fee-on-transfer'); const f = ethFee(SWAP.gas);
  const logs: Log[] = [
    erc20Transfer(A.taxToken, A.sender, A.taxToken, SWAP.tax),
    erc20Transfer(A.taxToken, A.sender, A.pair, SWAP.toPair),
    erc20Transfer(WETH, A.pair, A.sender, SWAP.wethOut),
    { address: A.pair, topics: [T.v2Sync], data: data(10_000n * E18, 5n * E18) },
    { address: A.pair, topics: [T.v2Swap, addrWord(A.router), addrWord(A.sender)], data: data(SWAP.toPair, 0n, 0n, SWAP.wethOut) },
  ];
  const summary = {
    summary_template: '{action_type} {outgoing_amount} {outgoing_token} for {incoming_amount} {incoming_token} on {market}',
    summary_template_variables: {
      action_type: { type: 'string', value: 'Swap' }, outgoing_amount: { type: 'currency', value: '1000' },
      outgoing_token: { type: 'token', value: TAXT }, incoming_amount: { type: 'currency', value: '0.5' },
      incoming_token: { type: 'token', value: WETH_T }, market: { type: 'dexTag', value: { name: 'Uniswap V2' } },
    },
  };
  return {
    id: 'swap-fee-on-transfer', network: 'ethereum', hash, description: 'Synthetic: token swap where the sold token charges a transfer tax',
    block: ethBlock(20_000_003n), tx: { from: A.sender, to: A.router, value: 0n, input: '0x5c11d795' + word(1000n * E18), type: 2, nonce: 3 },
    receipt: { status: 1, gasUsed: SWAP.gas, effectiveGasPrice: price, logs },
    explorer: { kind: 'full', tx: txObj({ hash, block: 20_000_003n, from: A.sender, to: A.router }, { method: 'swapExactTokensForTokensSupportingFeeOnTransferTokens' }),
      internal: [], transfers: [transferItem(0, TAXT, A.sender, A.taxToken), transferItem(1, TAXT, A.sender, A.pair), transferItem(2, WETH_T, A.pair, A.sender)],
      logNames: { 0: 'Transfer(address indexed from, address indexed to, uint256 value)', 4: 'Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)' },
      summaries: [summary],
      stateChanges: [
        coin(A.sender, -f.total), tokenChange(A.sender, TAXT, -(SWAP.tax + SWAP.toPair)), tokenChange(A.sender, WETH_T, SWAP.wethOut),
        tokenChange(A.pair, TAXT, SWAP.toPair), tokenChange(A.pair, WETH_T, -SWAP.wethOut), tokenChange(A.taxToken, TAXT, SWAP.tax),
        coin(A.miner, f.tip, true),
      ] },
  };
}

function wethUnwrap(): SyntheticCase {
  const hash = txHash('weth-unwrap'); const gas = 35_000n; const f = ethFee(gas); const wad = 3n * 10n ** 17n;
  return {
    id: 'weth-unwrap', network: 'ethereum', hash, description: 'Synthetic: WETH unwrap (Withdrawal burns WETH, ETH returns internally)',
    block: ethBlock(20_000_004n), tx: { from: A.sender, to: WETH, value: 0n, input: '0x2e1a7d4d' + word(wad), type: 2, nonce: 4 },
    receipt: { status: 1, gasUsed: gas, effectiveGasPrice: price, logs: [{ address: WETH, topics: [T.withdrawal, addrWord(A.sender)], data: data(wad) }] },
    explorer: { kind: 'full', tx: txObj({ hash, block: 20_000_004n, from: A.sender, to: WETH }, { method: 'withdraw' }),
      internal: [{ index: 0, type: 'call', from: addrObj(WETH, { is_contract: true }), to: addrObj(A.sender), value: wad.toString(), success: true }],
      transfers: [], stateChanges: [coin(A.sender, wad - f.total), coin(WETH, -wad), tokenChange(A.sender, WETH_T, -wad), coin(A.miner, f.tip, true)] },
  };
}

function wethWrapUnindexed(): SyntheticCase {
  const hash = txHash('weth-wrap-unindexed'); const gas = 28_000n; const wad = 2n * 10n ** 17n;
  return {
    id: 'weth-wrap-unindexed', network: 'ethereum', hash, description: 'Synthetic: WETH wrap that the explorer has not indexed (HTTP 404)',
    block: ethBlock(20_000_005n), tx: { from: A.sender, to: WETH, value: wad, input: '0xd0e30db0', type: 2, nonce: 5 },
    receipt: { status: 1, gasUsed: gas, effectiveGasPrice: price, logs: [{ address: WETH, topics: [T.deposit, addrWord(A.sender)], data: data(wad) }] },
    explorer: { kind: 'status', httpStatus: 404 },
    tokens: { [WETH]: { symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 } }, contracts: [WETH],
  };
}

export const NFT = { id721: 42n, id1155: 7n, amount1155: 3n };
function nftTransfers(idSeenByExplorer: bigint, id: string, blockNumber: bigint, description: string): SyntheticCase {
  const hash = txHash(id); const gas = 90_000n; const f = ethFee(gas);
  const zero = '0x0000000000000000000000000000000000000000';
  return {
    id, network: 'ethereum', hash, description,
    block: ethBlock(blockNumber), tx: { from: A.sender, to: A.nft721, value: 0n, input: '0x42842e0e', type: 2, nonce: 6 },
    receipt: { status: 1, gasUsed: gas, effectiveGasPrice: price, logs: [
      erc721Transfer(A.nft721, A.sender, A.recipient, NFT.id721),
      erc1155Single(A.nft1155, A.sender, zero, A.sender, NFT.id1155, NFT.amount1155),
    ] },
    explorer: { kind: 'full', tx: txObj({ hash, block: blockNumber, from: A.sender, to: A.nft721 }, { method: 'safeTransferFrom' }), internal: [],
      transfers: [transferItem(0, NFT721_T, A.sender, A.recipient), transferItem(1, NFT1155_T, zero, A.sender)],
      stateChanges: [
        coin(A.sender, -f.total), coin(A.miner, f.tip, true),
        tokenChange(A.sender, NFT721_T, [nftDir('from', idSeenByExplorer.toString())]),
        tokenChange(A.recipient, NFT721_T, [nftDir('to', idSeenByExplorer.toString())]),
        tokenChange(A.sender, NFT1155_T, NFT.amount1155, NFT.id1155.toString()),
      ] },
  };
}

function contractCreation(): SyntheticCase {
  const hash = txHash('contract-creation'); const gas = 120_000n; const f = ethFee(gas);
  return {
    id: 'contract-creation', network: 'ethereum', hash, description: 'Synthetic: contract deployment',
    block: ethBlock(20_000_007n), tx: { from: A.sender, to: null, value: 0n, input: '0x6080604052348015600f57600080fd5b50', type: 2, nonce: 7 },
    receipt: { status: 1, gasUsed: gas, effectiveGasPrice: price, logs: [], contractAddress: A.deployed },
    explorer: { kind: 'full', tx: txObj({ hash, block: 20_000_007n, from: A.sender, to: null }, { created_contract: addrObj(A.deployed, { is_contract: true }) }),
      internal: [], transfers: [], stateChanges: [coin(A.sender, -f.total), coin(A.miner, f.tip, true)] },
  };
}

function pending(): SyntheticCase {
  return {
    id: 'pending', network: 'ethereum', hash: txHash('pending'), description: 'Synthetic: transaction known to the node but not mined yet',
    block: null, tx: { from: A.sender, to: A.recipient, value: 10n ** 15n, input: '0x', type: 2, nonce: 8 },
    explorer: { kind: 'status', httpStatus: 404 },
  };
}

function opDeposit(): SyntheticCase {
  return {
    id: 'op-deposit', network: 'optimism', hash: txHash('op-deposit'), description: 'Synthetic: OP Stack deposit transaction (type 0x7e, no L2 fee)',
    block: { number: 130_000_001n, baseFee: 1_000n, miner: '0x4200000000000000000000000000000000000011', timestamp: 1_767_225_700n },
    tx: { from: A.depositor, to: A.recipient, value: 10n ** 16n, input: '0x', type: 0x7e, nonce: 0 },
    receipt: { status: 1, gasUsed: 50_000n, effectiveGasPrice: 0n, logs: [] },
    explorer: { kind: 'status', httpStatus: 404 },
  };
}

export const OP_USER = { value: 10n ** 17n, gas: 21_000n, price: 1_000_000n, l1Fee: 25_000_000_000n };
function opUser(): SyntheticCase {
  const hash = txHash('op-user'); const exec = OP_USER.gas * OP_USER.price;
  return {
    id: 'op-user', network: 'optimism', hash, description: 'Synthetic: OP Mainnet transfer with an L1 data fee',
    block: { number: 130_000_002n, baseFee: 900_000n, miner: '0x4200000000000000000000000000000000000011', timestamp: 1_767_225_800n },
    tx: { from: A.sender, to: A.recipient, value: OP_USER.value, input: '0x', type: 2, nonce: 9 },
    receipt: { status: 1, gasUsed: OP_USER.gas, effectiveGasPrice: OP_USER.price, logs: [], l1Fee: OP_USER.l1Fee },
    explorer: { kind: 'full', tx: txObj({ hash, block: 130_000_002n, from: A.sender, to: null }, { to: addrObj(A.recipient) }), internal: [], transfers: [],
      stateChanges: [coin(A.sender, -(OP_USER.value + exec + OP_USER.l1Fee)), coin(A.recipient, OP_USER.value)] },
  };
}

function baseExplorer403(): SyntheticCase {
  return {
    id: 'base-explorer-403', network: 'base', hash: txHash('base-explorer-403'), description: 'Synthetic: Base transfer while the explorer refuses requests (HTTP 403)',
    block: { number: 25_000_001n, baseFee: 2_000_000n, miner: '0x4200000000000000000000000000000000000011', timestamp: 1_767_225_900n },
    tx: { from: A.sender, to: A.recipient, value: 5n * 10n ** 16n, input: '0x', type: 2, nonce: 10 },
    receipt: { status: 1, gasUsed: 21_000n, effectiveGasPrice: 3_000_000n, logs: [], l1Fee: 1_000_000_000n },
    explorer: { kind: 'status', httpStatus: 403 },
  };
}

export const ARB = { amount: 1_234_567n, gas: 60_000n, price: 10_000_000n };
function arbitrumToken(): SyntheticCase {
  return {
    id: 'arbitrum-token-403', network: 'arbitrum', hash: txHash('arbitrum-token-403'), description: 'Synthetic: Arbitrum token transfer; explorer refuses (HTTP 403), metadata from eth_call',
    block: { number: 300_000_001n, baseFee: 10_000_000n, miner: '0xa4b000000000000000000073657175656e636572', timestamp: 1_767_226_000n },
    tx: { from: A.sender, to: A.arbToken, value: 0n, input: '0xa9059cbb' + addrWord(A.recipient).slice(2) + word(ARB.amount), type: 2, nonce: 11 },
    receipt: { status: 1, gasUsed: ARB.gas, effectiveGasPrice: ARB.price, logs: [erc20Transfer(A.arbToken, A.sender, A.recipient, ARB.amount)] },
    explorer: { kind: 'status', httpStatus: 403 },
    tokens: { [A.arbToken]: { symbol: 'SYNA', name: 'Synthetic Arbitrum Token', decimals: 6 } }, contracts: [A.arbToken],
  };
}

/**
 * Many movements routed through 10 pools (so the same address pairs repeat);
 * internal-transaction lookup times out; token-transfer list spans two pages.
 */
export const LARGE = { legs: 40, pools: 10, value: E18, refund: 4n * 10n ** 17n, gas: 2_000_000n };
export const largePair = (i: number) => addr(`large-pair-${i}`);
function largeWithTimeout(): SyntheticCase {
  const hash = txHash('large-internal-timeout'); const f = ethFee(LARGE.gas);
  const logs: Log[] = [];
  const transfers: unknown[] = [];
  const perPool = new Map<number, { tax: bigint; weth: bigint }>();
  let taxOut = 0n; let wethIn = 0n;
  for (let i = 0; i < LARGE.legs; i++) {
    const pool = i % LARGE.pools;
    const amt = BigInt(i + 1) * E18; const back = BigInt(i + 1) * 10n ** 15n;
    logs.push(erc20Transfer(A.taxToken, A.sender, largePair(pool), amt), erc20Transfer(WETH, largePair(pool), A.sender, back));
    transfers.push(transferItem(2 * i, TAXT, A.sender, largePair(pool)), transferItem(2 * i + 1, WETH_T, largePair(pool), A.sender));
    const p = perPool.get(pool) ?? { tax: 0n, weth: 0n };
    perPool.set(pool, { tax: p.tax + amt, weth: p.weth + back });
    taxOut += amt; wethIn += back;
  }
  const state: unknown[] = [...perPool.entries()].flatMap(([pool, t]) => [tokenChange(largePair(pool), TAXT, t.tax), tokenChange(largePair(pool), WETH_T, -t.weth)]);
  state.push(
    coin(A.sender, -LARGE.value + LARGE.refund - f.total), coin(A.router, LARGE.value - LARGE.refund), coin(A.miner, f.tip, true),
    tokenChange(A.sender, TAXT, -taxOut), tokenChange(A.sender, WETH_T, wethIn),
  );
  return {
    id: 'large-internal-timeout', network: 'ethereum', hash, description: 'Synthetic: 80 token movements; explorer internal transactions time out',
    block: ethBlock(20_000_008n), tx: { from: A.sender, to: A.router, value: LARGE.value, input: '0x12345678', type: 2, nonce: 12 },
    receipt: { status: 1, gasUsed: LARGE.gas, effectiveGasPrice: price, logs },
    explorer: { kind: 'full', tx: txObj({ hash, block: 20_000_008n, from: A.sender, to: A.router }), internalFailure: 'timed out after 45000 ms',
      transfers, transfersPageSize: 50, stateChanges: state },
  };
}

function seaportSale(vector: { topics: string[]; data: string }): SyntheticCase {
  const hash = txHash('seaport-sale'); const gas = 180_000n;
  return {
    id: 'seaport-sale', network: 'ethereum', hash, description: 'Synthetic: NFT sale emitting a Seaport-style OrderFulfilled event (event bytes encoded by cast)',
    block: ethBlock(20_000_009n), tx: { from: SEAPORT_BUYER, to: A.seaport, value: 0n, input: '0xf2d12b12', type: 2, nonce: 13 },
    receipt: { status: 1, gasUsed: gas, effectiveGasPrice: price, logs: [
      erc20Transfer(WETH, SEAPORT_BUYER, SEAPORT_SELLER, 3_000_000_000_000_000n - 75_000_000_000_000n),
      erc1155Single(SEAPORT_NFT, A.seaport, SEAPORT_SELLER, SEAPORT_BUYER, 10_933n, 1n),
      { address: A.seaport, topics: vector.topics, data: vector.data },
    ] },
    explorer: { kind: 'status', httpStatus: 404 },
    tokens: { [WETH]: { symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 }, [SEAPORT_NFT]: { symbol: 'SYNSALE', name: 'Synthetic Sale Item', decimals: null } },
    contracts: [WETH, SEAPORT_NFT, A.seaport],
  };
}

export function allCases(vectors: { events: Array<{ abi: string; topics: string[]; data: string }> }): SyntheticCase[] {
  const seaport = vectors.events.find((e) => e.abi.startsWith('event OrderFulfilled'));
  if (!seaport) throw new Error('tests/vectors/abi-cast.json lacks the OrderFulfilled vector');
  return [
    ethTransfer(), failed(), swapFeeOnTransfer(), wethUnwrap(), wethWrapUnindexed(),
    nftTransfers(NFT.id721, 'nft-transfers', 20_000_006n, 'Synthetic: ERC-721 transfer and ERC-1155 mint; explorer agrees on token ids'),
    nftTransfers(NFT.id721 + 1n, 'nft-id-disagreement', 20_000_010n, 'Synthetic: same NFT transfer, but the explorer reports a different token id'),
    contractCreation(), pending(), opDeposit(), opUser(), baseExplorer403(), arbitrumToken(), largeWithTimeout(), seaportSale(seaport),
  ];
}

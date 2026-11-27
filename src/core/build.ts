import { networkDescriptor } from './chains.js';
import { toBigInt } from './amounts.js';
import { decodeLog, decodeTransferBatch, TOPICS, type DecodedEvent } from './events.js';
import { normalizeAddress, ZERO_ADDRESS, type Address, type Hex } from './hex.js';
import { cleanUntrusted } from './text.js';
import { computeLedger } from './ledger.js';
import { crossCheck } from './crosscheck.js';
import { interpret } from './interpret.js';
import { buildAbiDecoding, buildRevert, buildTrace, compareTraceWithExplorer, libraryForBuild } from './analysis.js';
import { runInterpreters } from './decoders/index.js';
import type { BuildInput } from './inputs.js';
import {
  STORY_SCHEMA_VERSION,
  type Asset, type LogEntry, type Movement, type Participant, type Story,
} from './types.js';

/** Sequence bands used to order movements for replay. */
const SEQ = { topValue: 0, log: 1_000, internal: 10_000_000, fee: 20_000_000 } as const;

export class BuildError extends Error {}

export function buildStory(input: BuildInput): Story {
  if (input.network.key !== input.chain) throw new Error(`network definition "${input.network.key}" does not match the analysed network "${input.chain}"`);
  const chain = input.network;
  const { tx, receipt, block, sourceIds } = input.rpc;
  const warnings: string[] = [];

  const from = normalizeAddress(tx.from);
  if (!from) throw new BuildError('Transaction sender is not a valid address');
  const to = tx.to ? normalizeAddress(tx.to) : null;
  const createdContract = receipt.contractAddress ? normalizeAddress(receipt.contractAddress) : null;
  const success = receipt.status === undefined ? null : toBigInt(receipt.status) === 1n;
  if (success === null) throw new BuildError('Receipt has no status field (pre-Byzantium receipts are not supported)');

  const assets: Record<string, Asset> = {
    native: {
      key: 'native', kind: 'native', contract: null, tokenId: null,
      symbol: chain.nativeSymbol, name: `${chain.name} native ${chain.nativeSymbol}`, decimals: chain.nativeDecimals,
      metadataSource: 'chain-config',
    },
  };
  const ensureTokenAsset = (contract: Address, kind: Asset['kind'], tokenId: string | null = null): string => {
    const key = kind === 'erc1155' ? `${contract}#${tokenId}` : contract;
    if (assets[key]) return key;
    const meta = input.tokens[contract];
    const sym = meta ? cleanUntrusted(meta.symbol, 24) : null;
    const name = meta ? cleanUntrusted(meta.name, 64) : null;
    const asset: Asset = {
      key, kind, contract, tokenId: kind === 'erc1155' ? tokenId : null,
      symbol: sym?.text ?? null, name: name?.text ?? null,
      decimals: kind === 'erc20' ? meta?.decimals ?? null : 0,
      metadataSource: meta ? meta.source : 'none',
    };
    if (sym?.altered || name?.altered) asset.metadataAltered = true;
    assets[key] = asset;
    return key;
  };

  // ---- Logs --------------------------------------------------------------
  const rawLogs = receipt.logs
    .filter((l) => !l.removed)
    .map((l) => ({ address: l.address, topics: l.topics, data: l.data, logIndex: Number(toBigInt(l.logIndex)) }));
  // Deduplicate by logIndex (some providers have returned duplicates) and order.
  const seen = new Set<number>();
  const logsOrdered = rawLogs
    .filter((l) => (seen.has(l.logIndex) ? (warnings.push(`Duplicate log index ${l.logIndex} ignored`), false) : (seen.add(l.logIndex), true)))
    .sort((a, b) => a.logIndex - b.logIndex);

  const decoded: DecodedEvent[] = [];
  const logs: LogEntry[] = logsOrdered.map((l) => {
    const contract = (l.address || '').toLowerCase() as Address;
    const entry: LogEntry = {
      logIndex: l.logIndex, contract, topic0: l.topics[0]?.toLowerCase() ?? null,
      label: null, decoded: false, raw: { topics: l.topics, data: l.data },
    };
    const explorerName = input.explorer?.logNames[l.logIndex];
    if (explorerName) entry.explorerName = cleanUntrusted(explorerName, 80)?.text ?? null;
    if (entry.topic0 === TOPICS.TransferBatch) {
      const batch = decodeTransferBatch(l);
      entry.label = 'ERC-1155 TransferBatch';
      if (Array.isArray(batch)) { decoded.push(...batch); entry.decoded = true; entry.summary = `${batch.length} token id(s)`; }
      else entry.problem = batch.problem;
      return entry;
    }
    const r = decodeLog(l);
    entry.label = r.label;
    if (r.event) { decoded.push(r.event); entry.decoded = true; }
    if (r.problem) entry.problem = r.problem;
    return entry;
  });

  // ---- Movements ---------------------------------------------------------
  const movements: Movement[] = [];
  const valueWei = toBigInt(tx.value);

  if (valueWei > 0n) {
    if (success) {
      movements.push({
        id: 'native:call', kind: 'native-call-value', sequence: SEQ.topValue, from, to: to ?? createdContract,
        assetKey: 'native', amount: valueWei.toString(), provenance: 'chain', sourceIds: [sourceIds.tx, sourceIds.receipt],
        label: createdContract && !to ? 'Value sent to newly created contract' : 'Value sent with the transaction',
      });
    } else {
      warnings.push('The transaction reverted, so its attached value was not transferred.');
    }
  }

  const wrapped = new Set(chain.wrappedNative);
  const mintKeys = new Set<string>();
  for (const e of decoded) {
    if (e.kind === 'transfer' && e.standard === 'erc20' && e.from === ZERO_ADDRESS) mintKeys.add(`${e.contract}|${e.to}|${e.amount}`);
    if (e.kind === 'transfer' && e.standard === 'erc20' && e.to === ZERO_ADDRESS) mintKeys.add(`burn|${e.contract}|${e.from}|${e.amount}`);
  }

  for (const e of decoded) {
    if (e.kind === 'transfer') {
      const assetKey = ensureTokenAsset(e.contract, e.standard, e.standard === 'erc1155' ? e.tokenId : null);
      const seq = SEQ.log + e.logIndex * 1000 + (e.standard === 'erc1155' ? e.batchIndex ?? 0 : 0);
      movements.push({
        id: e.standard === 'erc1155' && e.batchIndex !== undefined ? `log:${e.logIndex}:${e.batchIndex}` : `log:${e.logIndex}`,
        kind: 'token-transfer', sequence: seq,
        from: e.from === ZERO_ADDRESS ? null : e.from,
        to: e.to === ZERO_ADDRESS ? null : e.to,
        assetKey, amount: e.standard === 'erc721' ? '1' : e.amount,
        ...(e.standard !== 'erc20' ? { tokenId: e.tokenId } : {}),
        logIndex: e.logIndex, provenance: 'derived', sourceIds: [sourceIds.receipt],
        label: e.from === ZERO_ADDRESS ? 'Minted (Transfer from the zero address)' : e.to === ZERO_ADDRESS ? 'Burned (Transfer to the zero address)' : 'Token transfer event',
      });
    } else if ((e.kind === 'wrap-deposit' || e.kind === 'wrap-withdrawal') && wrapped.has(e.contract)) {
      const isDeposit = e.kind === 'wrap-deposit';
      const dupKey = isDeposit ? `${e.contract}|${e.account}|${e.amount}` : `burn|${e.contract}|${e.account}|${e.amount}`;
      if (mintKeys.has(dupKey)) continue; // contract also emitted a Transfer for this; avoid double count
      const assetKey = ensureTokenAsset(e.contract, 'erc20');
      movements.push({
        id: `log:${e.logIndex}`, kind: isDeposit ? 'wrap-mint' : 'unwrap-burn', sequence: SEQ.log + e.logIndex * 1000,
        from: isDeposit ? null : e.account, to: isDeposit ? e.account : null,
        assetKey, amount: e.amount, logIndex: e.logIndex, provenance: 'derived', sourceIds: [sourceIds.receipt],
        label: isDeposit ? 'Wrapped: Deposit event credits wrapped tokens' : 'Unwrapped: Withdrawal event debits wrapped tokens',
        note: 'WETH9-style contracts emit Deposit/Withdrawal instead of a Transfer for wrapping.',
      });
    }
  }

  // Approvals reference token contracts too; register them so amounts can be formatted.
  for (const e of decoded) {
    if (e.kind === 'approval') ensureTokenAsset(e.contract, e.standard);
  }

  // Native value moved inside execution: from the node's call trace when one is
  // available (chain-reported, with failure propagation), otherwise explorer-reported.
  const abiLib = libraryForBuild(input);
  const trace = buildTrace(input, abiLib);
  warnings.push(...trace.warnings);
  let internalStatus: Story['completeness']['nativeInternal'] = input.explorer?.available ? input.explorer.internal.status : 'unavailable';
  if (trace.parsed) {
    internalStatus = trace.section.status === 'complete' ? 'complete' : 'partial';
    trace.moves.forEach((m, i) => {
      if (!m.committed) return; // rolled back: not a balance change
      movements.push({
        id: `trace:${m.frameId}`, kind: 'native-internal', sequence: SEQ.internal + i,
        from: m.from, to: m.to, assetKey: 'native', amount: m.value,
        provenance: 'chain', sourceIds: trace.section.sourceIds,
        label: `Native value moved by an internal ${m.type.toLowerCase()}`,
        note: `From the node's call trace (frame ${m.frameId}). Position relative to token events is not known.`,
      });
    });
    const rolledBack = trace.moves.filter((m) => !m.committed).length;
    if (rolledBack) warnings.push(`${rolledBack} native transfer(s) inside execution were rolled back by a failed call and are not counted as balance changes (see the call trace).`);
    if (input.explorer) warnings.push(...compareTraceWithExplorer(trace.moves, input.explorer));
  } else if (input.explorer?.available) {
    for (const it of input.explorer.internal.items) {
      const v = toBigInt(it.value);
      if (v === 0n || !it.success) continue;
      if (it.type === 'delegatecall' || it.type === 'staticcall') continue;
      const dest = it.to ?? it.createdContract;
      movements.push({
        id: `internal:${it.index}`, kind: 'native-internal', sequence: SEQ.internal + it.index,
        from: it.from, to: dest, assetKey: 'native', amount: v.toString(),
        provenance: 'explorer', sourceIds: input.explorer.internal.sourceIds,
        label: `Native value moved by an internal ${it.type}`,
        note: 'Reported by the explorer from its execution trace. Position relative to token events is not known.',
      });
    }
    if (input.explorer.internal.status === 'partial') warnings.push('Internal native-value movements are partial (explorer pagination limit or a failed page). Native balance changes may be incomplete.');
    if (input.explorer.internal.status === 'unavailable' && success) warnings.push(`Internal native-value movements are unavailable (${input.explorer.internal.note ?? 'explorer request failed'}). Native balance changes may be incomplete.`);
  } else if (success && input.stage === 'full') {
    warnings.push('Internal native-value movements are unavailable: no execution trace source responded. Native balance changes may be incomplete.');
  }

  // ---- Fees ---------------------------------------------------------------
  const gasUsed = toBigInt(receipt.gasUsed);
  const price = receipt.effectiveGasPrice ? toBigInt(receipt.effectiveGasPrice) : null;
  const feeComponents: Story['fees']['components'] = [];
  const feeNotes: string[] = [];
  const feeRecipient = block.miner ? normalizeAddress(block.miner) : null;
  const addFee = (kind: Movement['kind'], amount: bigint, label: string, toAddr: Address | null, provenance: Movement['provenance'] = 'derived') => {
    if (amount <= 0n) return;
    feeComponents.push({ kind, amount: amount.toString(), label });
    movements.push({
      id: `fee:${kind}`, kind, sequence: SEQ.fee + movements.length, from, to: toAddr, assetKey: 'native', amount: amount.toString(),
      provenance, sourceIds: [sourceIds.receipt, sourceIds.block], label,
    });
  };
  const txType = tx.type ? toBigInt(tx.type) : 0n;
  const systemTx = (chain.feeModel === 'op-stack' && txType === 0x7en) || (chain.feeModel === 'arbitrum' && txType >= 0x64n && txType <= 0x6an);
  if (systemTx) {
    feeNotes.push(chain.feeModel === 'op-stack'
      ? 'OP Stack deposit transaction (type 0x7e): created from L1 or by the system; it does not pay an L2 gas fee in the usual way.'
      : `Arbitrum system/retryable transaction type ${txType.toString()}: fee accounting differs from user transactions and is not itemised.`);
  } else if (price === null) {
    feeNotes.push('Receipt lacks effectiveGasPrice; network fee could not be computed.');
    warnings.push('Network fee unknown: the RPC receipt did not include effectiveGasPrice.');
  } else if (chain.feeModel === 'ethereum-l1') {
    const baseFee = block.baseFeePerGas ? toBigInt(block.baseFeePerGas) : null;
    if (baseFee === null) {
      addFee('fee-execution', gasUsed * price, 'Network fee (pre-EIP-1559 block: paid to the block fee recipient)', feeRecipient);
    } else {
      addFee('fee-burn', gasUsed * baseFee, 'Base fee (burned)', null);
      addFee('fee-tip', gasUsed * (price - baseFee), 'Priority fee (to block fee recipient)', feeRecipient);
    }
    if (receipt.blobGasUsed && receipt.blobGasPrice) {
      addFee('fee-blob', toBigInt(receipt.blobGasUsed) * toBigInt(receipt.blobGasPrice), 'Blob fee (burned)', null);
    }
  } else if (chain.feeModel === 'op-stack') {
    addFee('fee-execution', gasUsed * price, 'L2 execution fee (to fee vaults, not itemised)', null);
    if (receipt.l1Fee) addFee('fee-l1-data', toBigInt(receipt.l1Fee), 'L1 data fee (to fee vault, not itemised)', null);
    else feeNotes.push('Receipt has no l1Fee field; L1 data fee not included.');
    const scalar = receipt.operatorFeeScalar ? toBigInt(receipt.operatorFeeScalar) : 0n;
    const constant = receipt.operatorFeeConstant ? toBigInt(receipt.operatorFeeConstant) : 0n;
    if (scalar !== 0n || constant !== 0n) {
      feeNotes.push('Receipt reports an OP Stack operator fee; TxStory does not include it, so the sender\'s native change may be understated.');
      warnings.push('Operator fee present but not itemised.');
    }
  } else {
    addFee('fee-execution', gasUsed * price, 'Network fee (to network fee accounts, not itemised)', null);
  }
  const feeTotal = feeComponents.reduce((acc, c) => acc + BigInt(c.amount), 0n);

  movements.sort((a, b) => a.sequence - b.sequence);

  // ---- Participants -------------------------------------------------------
  const participants: Record<string, Participant> = {};
  const addRole = (address: Address | null, role: string) => {
    if (!address) return;
    const p = participants[address] ??= {
      address, roles: [], labels: [], ens: null, isContract: null, isContractSource: 'unknown', explorerFlags: [],
    };
    if (!p.roles.includes(role)) p.roles.push(role);
  };
  addRole(from, 'Sender');
  addRole(to, createdContract ? 'Recipient' : 'Called address');
  addRole(createdContract, 'Created contract');
  for (const m of movements) {
    if (m.kind === 'token-transfer' || m.kind === 'wrap-mint' || m.kind === 'unwrap-burn') {
      const contract = assets[m.assetKey]?.contract ?? null;
      addRole(contract, 'Token contract');
    }
    if (m.kind === 'fee-tip' || m.kind === 'fee-execution') addRole(m.to, 'Block fee recipient');
    if (m.kind === 'fee-tip' || m.kind.startsWith('fee')) continue;
    addRole(m.from, 'Sent value');
    addRole(m.to, 'Received value');
  }
  for (const p of Object.values(participants)) {
    const ex = input.explorer?.available ? input.explorer.addresses[p.address] : undefined;
    if (ex) {
      for (const label of [ex.name, ...ex.tags]) {
        const c = cleanUntrusted(label, 48);
        if (c && !p.labels.some((l) => l.text === c.text)) p.labels.push({ text: c.text, source: 'explorer', ...(c.altered ? { altered: true } : {}) });
      }
      p.ens = cleanUntrusted(ex.ens, 64)?.text ?? null;
      if (ex.isContract !== null) { p.isContract = ex.isContract; p.isContractSource = 'explorer'; }
      p.explorerFlags = ex.flags;
    }
    if (p.isContract === null && p.address in input.codeAt) {
      p.isContract = input.codeAt[p.address]!;
      p.isContractSource = 'rpc';
    }
  }

  // ---- Ledger, cross-check, interpretations --------------------------------
  const ledger = computeLedger(movements, assets);
  const nativeFeeSinksItemised = chain.feeModel === 'ethereum-l1';
  const check = input.stage === 'fast'
    ? { available: false, reason: 'Cross-check is still loading (explorer data is requested after the first render).', complete: false, rows: [], summary: { match: 0, mismatch: 0, onlyTxStory: 0, onlyExplorer: 0, notComparable: 0 } }
    : crossCheck(ledger, input.explorer, nativeFeeSinksItemised, internalStatus === 'complete',
        Object.fromEntries(Object.values(assets).map((a) => [a.key, a.kind])));

  const explorerTokenStatus = input.explorer?.available ? input.explorer.tokenTransfers.status : 'unavailable';
  if (input.explorer?.available && explorerTokenStatus === 'complete') {
    const ourTokenEvents = movements.filter((m) => m.kind === 'token-transfer' || m.kind === 'wrap-mint' || m.kind === 'unwrap-burn')
      .reduce((ids, m) => ids.add(m.logIndex ?? -1), new Set<number>()).size;
    // Explorers list one entry per log (batch events may be expanded); compare by distinct log index.
    const theirLogs = new Set(input.explorer.tokenTransfers.items.map((t) => t.logIndex ?? -1)).size;
    if (theirLogs !== ourTokenEvents) {
      warnings.push(`Explorer lists token transfers in ${theirLogs} log(s); TxStory decoded token movements from ${ourTokenEvents}. Differences usually mean non-standard events; inspect the logs.`);
    }
  }
  const undecodedTransfers = logs.filter((l) => l.topic0 === TOPICS.Transfer && !l.decoded);
  if (undecodedTransfers.length) warnings.push(`${undecodedTransfers.length} Transfer-signature log(s) had a non-standard layout and were not counted.`);

  const story: Story = {
    schemaVersion: STORY_SCHEMA_VERSION,
    chain: input.chain,
    network: networkDescriptor(input.network),
    hash: tx.hash.toLowerCase() as Hex,
    outcome: success ? 'success' : 'reverted',
    tx: {
      from, to, createdContract,
      nonce: toBigInt(tx.nonce).toString(),
      value: valueWei.toString(),
      type: tx.type ? toBigInt(tx.type).toString() : '0',
      inputSelector: tx.input && tx.input.length >= 10 ? tx.input.slice(0, 10).toLowerCase() : null,
      inputBytes: tx.input ? Math.max(0, (tx.input.length - 2) / 2) : 0,
      method: input.explorer?.available && input.explorer.method ? { name: cleanUntrusted(input.explorer.method, 64)?.text ?? 'unknown', source: 'explorer' } : null,
      decodedInput: input.explorer?.available && input.explorer.decodedInput
        ? { call: cleanUntrusted(input.explorer.decodedInput.call, 200)?.text ?? '', parameters: input.explorer.decodedInput.parameters.slice(0, 40).map((p) => ({ name: cleanUntrusted(p.name, 64)?.text ?? '', type: cleanUntrusted(p.type, 64)?.text ?? '', value: cleanUntrusted(p.value, 600)?.text ?? '' })), source: 'explorer' }
        : null,
      revertReason: !success && input.explorer?.available && input.explorer.revertReason
        ? { text: cleanUntrusted(input.explorer.revertReason, 300)?.text ?? '', source: 'explorer' } : null,
    },
    block: {
      number: toBigInt(block.number).toString(),
      hash: block.hash,
      timestamp: block.timestamp ? new Date(Number(toBigInt(block.timestamp)) * 1000).toISOString() : null,
      baseFeePerGas: block.baseFeePerGas ? toBigInt(block.baseFeePerGas).toString() : null,
      feeRecipient,
    },
    fees: { total: feeTotal.toString(), gasUsed: gasUsed.toString(), effectiveGasPrice: price?.toString() ?? '0', components: feeComponents, notes: feeNotes },
    assets, participants, movements, ledger, crossCheck: check, logs,
    interpretations: [],
    explorerSummaries: input.explorer?.available
      ? input.explorer.summaries.map((x) => cleanUntrusted(x, 240)?.text).filter((x): x is string => !!x).slice(0, 4)
      : [],
    completeness: {
      logs: 'complete',
      tokenTransfers: 'complete',
      nativeInternal: internalStatus,
      explorerTokenTransfers: explorerTokenStatus,
      stateChanges: input.explorer?.available ? input.explorer.stateChanges.status : 'unavailable',
      tokenMetadata: input.tokenMetadataStatus,
      trace: trace.section.status,
    },
    trace: trace.section,
    revert: buildRevert(trace, abiLib, success),
    abiDecoding: { libraries: [], call: null, logs: [], unmatchedLogs: 0 },
    warnings,
    sources: input.sources,
    generatedAt: input.generatedAt,
    mode: input.mode,
    stage: input.stage,
  };
  story.interpretations = interpret(story, decoded);
  const abi = buildAbiDecoding(story, tx.input ?? '0x', abiLib, input);
  story.abiDecoding = abi.section;
  const modules = runInterpreters(story, abi.logs);
  story.interpretations.push(...modules.interpretations);
  story.warnings.push(...modules.warnings);
  return story;
}

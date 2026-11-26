/**
 * Human-readable interpretations. Two confidence levels:
 *  - decoded:   follows directly from receipt status / decoded standard events
 *  - heuristic: a pattern match (e.g. "swap-like") that can be wrong
 * Interpretations never assert intent, identity, safety, or exploit status.
 */
import type { DecodedEvent } from './events.js';
import { amountCompact, amountExact, assetSymbol, participantName } from './format.js';
import type { Interpretation, Story } from './types.js';

export function interpret(story: Story, decoded: DecodedEvent[]): Interpretation[] {
  const out: Interpretation[] = [];
  const P = (a: string | null) => participantName(a ? story.participants[a] : undefined, a);
  const A = (key: string) => story.assets[key];
  const sender = story.tx.from;
  const nonFee = story.movements.filter((m) => !m.kind.startsWith('fee'));

  if (story.outcome === 'reverted') {
    out.push({
      id: 'failed', kind: 'failed', confidence: 'decoded',
      headline: 'This transaction failed and its changes were reverted',
      detail: `The receipt status is 0 (reverted). No token or value changes from the call took effect, but ${P(sender)} still paid the network fee of ${amountExact(A('native'), story.fees.total)}.`
        + (story.revert ? ` The node's call trace returns revert data decoded as ${story.revert.summary}.` : '')
        + (story.tx.revertReason ? ` The explorer reports the revert reason as: “${story.tx.revertReason.text}”.` : ''),
      evidence: ['receipt.status', ...story.movements.filter((m) => m.kind.startsWith('fee')).map((m) => m.id)],
      caveats: [
        ...(story.revert ? ['Revert data comes from the node\'s trace; its decoding uses the ABI sources listed in the evidence and is not proof of the contract\'s intent.'] : []),
        ...(story.tx.revertReason ? ['The revert reason is explorer-reported.'] : []),
      ],
    });
    return out;
  }

  if (story.fees.notes.some((n) => n.startsWith('OP Stack deposit transaction'))) {
    out.push({
      id: 'deposit', kind: 'generic', confidence: 'decoded',
      headline: 'An OP Stack deposit transaction',
      detail: `Transaction type 0x7e is created by the rollup from L1 data or by the system (sender ${P(sender)}), not signed and submitted by a user on L2.`,
      evidence: ['tx.type'], caveats: [],
    });
  }

  if (story.tx.createdContract) {
    out.push({
      id: 'creation', kind: 'contract-creation', confidence: 'decoded',
      headline: 'This transaction deployed a contract',
      detail: `${P(sender)} created the contract at ${story.tx.createdContract}.`,
      evidence: ['receipt.contractAddress'], caveats: [],
    });
  }

  const tokenMoves = nonFee.filter((m) => m.kind === 'token-transfer');
  const nativeMoves = nonFee.filter((m) => m.kind === 'native-call-value' || m.kind === 'native-internal');

  if (!tokenMoves.length && story.logs.length === 0 && story.tx.to && BigInt(story.tx.value) > 0n && nativeMoves.length === 1) {
    out.push({
      id: 'native', kind: 'native-transfer', confidence: 'decoded',
      headline: `A direct ${A('native')?.symbol ?? 'native'} transfer`,
      detail: `${P(sender)} sent ${amountExact(A('native'), story.tx.value)} to ${P(story.tx.to)}. No events were emitted.`,
      evidence: ['native:call'],
      caveats: story.participants[story.tx.to]?.isContract ? ['The recipient is a contract; its code ran but emitted no events.'] : [],
    });
  }

  for (const wrap of [true, false]) {
    const ms = nonFee.filter((x) => x.kind === (wrap ? 'wrap-mint' : 'unwrap-burn'));
    if (!ms.length) continue;
    const assetKey = ms[0]!.assetKey;
    const total = ms.reduce((acc, m) => acc + BigInt(m.amount), 0n).toString();
    const accounts = [...new Set(ms.map((m) => (wrap ? m.to : m.from)))];
    const symbol = A(assetKey)?.symbol ?? 'wrapped tokens';
    out.push({
      id: wrap ? 'wrap' : 'unwrap', kind: wrap ? 'wrap' : 'unwrap', confidence: 'decoded',
      headline: ms.length === 1
        ? (wrap ? `Wrapped native ${A('native')?.symbol} into ${symbol}` : `Unwrapped ${symbol} back to native ${A('native')?.symbol}`)
        : `${ms.length} ${wrap ? 'wrap (Deposit)' : 'unwrap (Withdrawal)'} events, ${amountCompact(A(assetKey), total)} in total`,
      detail: ms.length === 1
        ? `${P(accounts[0] ?? null)} ${wrap ? 'received' : 'gave up'} ${amountExact(A(assetKey), ms[0]!.amount)} (log ${ms[0]!.logIndex}).`
        : `${accounts.length} account(s) involved: ${accounts.slice(0, 3).map((a) => P(a)).join(', ')}${accounts.length > 3 ? ', …' : ''}.`,
      evidence: ms.map((m) => m.id),
      caveats: ['Recognised because the events came from the configured wrapped-native contract for this chain.'],
    });
  }

  const mints = tokenMoves.filter((m) => m.from === null);
  const burns = tokenMoves.filter((m) => m.to === null);
  if (mints.length) {
    out.push({
      id: 'mint', kind: 'mint', confidence: 'decoded',
      headline: `${mints.length} token mint event${mints.length > 1 ? 's' : ''}`,
      detail: mints.slice(0, 4).map((m) => `${amountExact(A(m.assetKey), m.amount)}${m.tokenId && A(m.assetKey)?.kind !== 'erc20' ? ` (id ${short(m.tokenId)})` : ''} to ${P(m.to)}`).join('; ') + (mints.length > 4 ? `; and ${mints.length - 4} more` : '') + '.',
      evidence: mints.map((m) => m.id), caveats: ['A “mint” here means a Transfer event from the zero address.'],
    });
  }
  if (burns.length) {
    out.push({
      id: 'burn', kind: 'burn', confidence: 'decoded',
      headline: `${burns.length} token burn event${burns.length > 1 ? 's' : ''}`,
      detail: burns.slice(0, 4).map((m) => `${amountExact(A(m.assetKey), m.amount)} from ${P(m.from)}`).join('; ') + (burns.length > 4 ? `; and ${burns.length - 4} more` : '') + '.',
      evidence: burns.map((m) => m.id), caveats: ['A “burn” here means a Transfer event to the zero address.'],
    });
  }

  const nfts = tokenMoves.filter((m) => A(m.assetKey)?.kind === 'erc721' || A(m.assetKey)?.kind === 'erc1155');
  const nftNonMint = nfts.filter((m) => m.from !== null && m.to !== null);
  if (nftNonMint.length) {
    out.push({
      id: 'nft', kind: 'nft-transfer', confidence: 'decoded',
      headline: `${nftNonMint.length} NFT transfer${nftNonMint.length > 1 ? 's' : ''}`,
      detail: nftNonMint.slice(0, 4).map((m) => `${A(m.assetKey)?.symbol ?? 'NFT'} id ${short(m.tokenId ?? '?')}${A(m.assetKey)?.kind === 'erc1155' ? ` ×${m.amount}` : ''}: ${P(m.from)} → ${P(m.to)}`).join('; ') + (nftNonMint.length > 4 ? `; and ${nftNonMint.length - 4} more` : '') + '.',
      evidence: nftNonMint.map((m) => m.id), caveats: [],
    });
  }

  // Swap-like heuristic: the sender's own net position lost one asset and gained another.
  const senderRows = story.ledger.filter((r) => r.address === sender);
  const feeTotal = BigInt(story.fees.total);
  const net = senderRows.map((r) => ({ ...r, ex: r.assetKey === 'native' ? BigInt(r.delta) + feeTotal : BigInt(r.delta) })).filter((r) => r.ex !== 0n);
  const outs = net.filter((r) => r.ex < 0n);
  const ins = net.filter((r) => r.ex > 0n);
  const swapEvents = decoded.filter((e) => e.kind === 'swap');
  const fungible = (key: string) => A(key)?.kind === 'native' || A(key)?.kind === 'erc20';
  const wrappedKeys = new Set(nonFee.filter((m) => m.kind === 'wrap-mint' || m.kind === 'unwrap-burn').map((m) => m.assetKey));
  const onlyWrapPair = wrappedKeys.size > 0 && net.every((r) => r.assetKey === 'native' || wrappedKeys.has(r.assetKey));
  if (outs.length && ins.length && [...outs, ...ins].some((r) => fungible(r.assetKey)) && !onlyWrapPair) {
    const abs = (r: typeof net[number]) => (r.ex < 0n ? -r.ex : r.ex).toString();
    const fmtShort = (r: typeof net[number]) => amountCompact(A(r.assetKey), abs(r));
    const fmtExact = (r: typeof net[number]) => amountExact(A(r.assetKey), abs(r));
    out.push({
      id: 'swap', kind: 'swap', confidence: 'heuristic',
      headline: `Exchange-like: ${outs.map(fmtShort).join(' + ')} out, ${ins.map(fmtShort).join(' + ')} in`,
      detail: `Excluding the network fee, ${P(sender)} gave up ${outs.map(fmtExact).join(' and ')} and received ${ins.map(fmtExact).join(' and ')} (net balance changes).`
        + (swapEvents.length ? ` ${swapEvents.length} DEX swap event(s) were emitted (${[...new Set(swapEvents.map((e) => e.kind === 'swap' ? e.protocol : ''))].join(', ')}-style).` : ' No recognised DEX swap event was emitted.'),
      evidence: [...net.map((r) => `ledger:${r.address}:${r.assetKey}`), ...swapEvents.map((e) => `log:${e.logIndex}`)],
      caveats: [
        'Pattern-based: derived from net balance changes, not from decoded calldata.',
        ...(net.some((r) => r.usesExplorerData) ? ['Includes native-value movements reported by the explorer.'] : []),
        ...(story.completeness.nativeInternal !== 'complete' ? ['Internal native movements are not fully known, so native amounts may be incomplete.'] : []),
      ],
    });
  }

  // Fee-on-transfer signal: the same token debited from the sender by more than any single counterparty received.
  for (const r of senderRows) {
    const asset = A(r.assetKey);
    if (asset?.kind !== 'erc20' || BigInt(r.delta) >= 0n) continue;
    const debits = tokenMoves.filter((m) => m.assetKey === r.assetKey && m.from === sender);
    const recipients = new Set(debits.map((m) => m.to));
    if (debits.length >= 2 && recipients.size >= 2 && debits.some((m) => m.to === asset.contract)) {
      out.push({
        id: `fot:${r.assetKey}`, kind: 'fee-on-transfer', confidence: 'heuristic',
        headline: `${asset.symbol ?? 'This token'} split one outgoing amount between several recipients`,
        detail: `${P(sender)}’s ${asset.symbol ?? 'token'} left in ${debits.length} transfers, including one to the token contract itself. This pattern is common for tokens that charge a transfer tax.`,
        evidence: debits.map((m) => m.id), caveats: ['Pattern-based; the token’s actual transfer rules were not inspected.'],
      });
    }
  }

  const approvals = decoded.filter((e) => e.kind === 'approval' || e.kind === 'approval-for-all');
  if (approvals.length && !tokenMoves.length) {
    out.push({
      id: 'approval', kind: 'approval', confidence: 'decoded',
      headline: `${approvals.length} approval event${approvals.length > 1 ? 's' : ''} and no token movements`,
      detail: approvals.slice(0, 3).map((e) => e.kind === 'approval'
        ? `${P(e.owner)} approved ${P(e.spender)} for ${e.standard === 'erc20' ? amountExact(A(e.contract), e.value) : `token id ${short(e.value)}`}`
        : e.kind === 'approval-for-all' ? `${P(e.owner)} ${e.approved ? 'granted' : 'revoked'} operator rights for ${P(e.operator)}` : '').join('; ') + '.',
      evidence: approvals.map((e) => `log:${e.logIndex}`),
      caveats: ['An approval grants future spending permission; it does not move tokens by itself.'],
    });
  }

  // Lead with a whole-transaction view unless a decisive interpretation already leads.
  const decisive = new Set(['failed', 'contract-creation', 'native-transfer', 'swap']);
  if (!tokenMoves.length) { decisive.add('wrap'); decisive.add('unwrap'); }
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const valueMoves = nonFee;
  if (!out.some((i) => decisive.has(i.kind) || i.id === 'deposit') && nonFee.length > 0) {
    if (nonFee.length === 1) {
      const m = nonFee[0]!;
      const asset = A(m.assetKey);
      const what = asset?.kind === 'erc721' ? `${asset.symbol ?? 'NFT'} #${short(m.tokenId ?? '?')}` : amountCompact(asset, m.amount);
      out.unshift({
        id: 'single', kind: 'generic', confidence: 'decoded',
        headline: m.from === null ? `Minted ${what} to ${P(m.to)}` : m.to === null ? `Burned ${what} from ${P(m.from)}` : `${P(m.from)} sent ${what} to ${P(m.to)}`,
        detail: `One movement was decoded: ${amountExact(asset, m.amount)}${m.logIndex !== undefined ? ` (log ${m.logIndex})` : ''}. ${P(sender)} submitted the transaction${story.tx.to ? ` to ${P(story.tx.to)}` : ''}.`,
        evidence: [m.id], caveats: [],
      });
    } else {
      const assetKeys = [...new Set(valueMoves.map((m) => m.assetKey))];
      const addrs = new Set(valueMoves.flatMap((m) => [m.from, m.to]).filter((a): a is NonNullable<typeof a> => !!a));
      const names = assetKeys.slice(0, 3).map((k) => assetSymbol(A(k))).join(', ') + (assetKeys.length > 3 ? ` and ${assetKeys.length - 3} more` : '');
      out.unshift({
        id: 'overview', kind: 'generic', confidence: 'decoded',
        headline: `${plural(valueMoves.length, 'movement', 'movements')} of ${assetKeys.length === 1 ? names : `${assetKeys.length} assets (${names})`} among ${plural(addrs.size, 'address', 'addresses')}`,
        detail: `${P(sender)} called ${story.tx.to ? P(story.tx.to) : 'a new contract'}${story.tx.method ? ` (explorer-decoded method “${story.tx.method.name}”)` : ''}, emitting ${story.logs.length} event(s). See the balance table for each address’s net result.`,
        evidence: [], caveats: [],
      });
    }
  }

  appendExplorerSummary(out, story);

  if (!out.length) {
    out.push({
      id: 'generic', kind: 'generic', confidence: 'decoded',
      headline: story.logs.length ? `A contract call that emitted ${story.logs.length} event(s)` : 'A contract call with no events',
      detail: `${P(sender)} called ${P(story.tx.to)}${story.tx.method ? ` (explorer-decoded method “${story.tx.method.name}”)` : ''}. ${tokenMoves.length ? '' : 'No token movements were decoded.'}`,
      evidence: [], caveats: [],
    });
  }
  return out;
}

export function appendExplorerSummary(out: Interpretation[], story: Story) {
  const summaries = story.explorerSummaries ?? [];
  if (!summaries.length) return;
  out.splice(Math.min(1, out.length), 0, {
    id: 'explorer-summary', kind: 'explorer-summary', confidence: 'explorer',
    headline: 'The explorer’s own summary',
    detail: summaries.join(' · '),
    evidence: [],
    caveats: ['Written by the explorer from its own decoding; TxStory does not verify it. Compare it with the balance table.'],
  });
}

function short(id: string): string {
  return id.length > 14 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

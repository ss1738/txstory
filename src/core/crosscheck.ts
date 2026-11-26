/**
 * Compare TxStory's ledger (derived mostly from RPC receipt logs) with the
 * explorer's independently computed state changes. Agreement is evidence that
 * both pipelines read the same chain data the same way; it is NOT a
 * cryptographic proof, and both rely on third-party infrastructure.
 *
 * Every row records the comparison SCOPE actually used:
 *  - amount    : exact signed integer deltas (native, ERC-20, ERC-1155 per token id)
 *  - token-ids : ERC-721 net sets of token ids received and sent (order-insensitive,
 *                duplicates removed, ids that pass through in the same tx cancelled)
 *  - count     : ERC-721 where the explorer only supplied a net count; identity
 *                was NOT compared and the UI must say so
 *  - none      : nothing comparable (ambiguous or differently modelled data)
 */
import type { BalanceChange, CrossCheck, CrossCheckRow, CrossCheckScope } from './types.js';
import type { ExplorerInput, ExplorerStateChangeInput } from './inputs.js';
import { ZERO_ADDRESS } from './hex.js';

type Theirs =
  | { kind: 'amount'; delta: string }
  | { kind: 'nft'; ids: { in: Set<string>; out: Set<string> } }
  | { kind: 'ambiguous'; note: string };

/** Net an in/out id pair: ids present on both sides passed through and cancel out. */
export function netTokenIds(tokenIdsIn: Iterable<string>, tokenIdsOut: Iterable<string>): { in: string[]; out: string[] } {
  const inSet = new Set(tokenIdsIn);
  const outSet = new Set(tokenIdsOut);
  const order = (a: string, b: string) => (a.length - b.length) || (a < b ? -1 : a > b ? 1 : 0); // numeric order for decimal ids
  return {
    in: [...inSet].filter((id) => !outSet.has(id)).sort(order),
    out: [...outSet].filter((id) => !inSet.has(id)).sort(order),
  };
}

const sameIds = (a: { in: string[]; out: string[] }, b: { in: string[]; out: string[] }) =>
  a.in.length === b.in.length && a.out.length === b.out.length && a.in.every((x, i) => x === b.in[i]) && a.out.every((x, i) => x === b.out[i]);

function assetKeyFor(sc: ExplorerStateChangeInput): string | null {
  if (sc.isCoin) return 'native';
  if (!sc.token) return null;
  if (sc.tokenType === 'ERC-1155') return sc.tokenId ? `${sc.token}#${sc.tokenId}` : null;
  return sc.token;
}

function merge(existing: Theirs | undefined, sc: ExplorerStateChangeInput): Theirs {
  const incoming: Theirs = sc.change.kind === 'amount'
    ? { kind: 'amount', delta: sc.change.delta }
    : sc.change.kind === 'nft'
      ? { kind: 'nft', ids: { in: new Set(sc.change.tokenIdsIn), out: new Set(sc.change.tokenIdsOut) } }
      : { kind: 'ambiguous', note: 'Explorer change value not understood' };
  if (!existing) return incoming;
  // The same address and asset reported more than once.
  if (existing.kind === 'nft' && incoming.kind === 'nft') {
    for (const id of incoming.ids.in) existing.ids.in.add(id);
    for (const id of incoming.ids.out) existing.ids.out.add(id);
    return existing;
  }
  if (existing.kind === 'amount' && incoming.kind === 'amount' && existing.delta === incoming.delta) return existing; // exact duplicate
  return { kind: 'ambiguous', note: 'Explorer reported conflicting entries for this address and asset' };
}

const SUMMARY_FIELD = { match: 'match', mismatch: 'mismatch', 'only-txstory': 'onlyTxStory', 'only-explorer': 'onlyExplorer', 'not-comparable': 'notComparable' } as const;

export function crossCheck(
  ledger: BalanceChange[],
  explorer: ExplorerInput | null,
  nativeFeeSinksItemised: boolean,
  nativeInternalComplete = true,
  /** Asset kinds known to TxStory, keyed by asset key (to recognise ERC-721 rows). */
  assetKinds: Record<string, string> = {},
): CrossCheck {
  const empty = { match: 0, mismatch: 0, onlyTxStory: 0, onlyExplorer: 0, notComparable: 0 };
  if (!explorer || !explorer.available || explorer.stateChanges.status === 'unavailable') {
    return { available: false, reason: explorer?.reason ?? 'Explorer state changes unavailable', complete: false, rows: [], summary: empty };
  }
  const ours = new Map<string, BalanceChange>();
  for (const r of ledger) ours.set(`${r.address}|${r.assetKey}`, r);

  const theirs = new Map<string, Theirs>();
  const minerKeys = new Set<string>();
  const tokenTypeOf = new Map<string, string | null>();
  for (const sc of explorer.stateChanges.items) {
    const assetKey = assetKeyFor(sc);
    const key = assetKey ? `${sc.address}|${assetKey}` : `${sc.address}|unknown:${sc.token ?? '?'}`;
    theirs.set(key, merge(theirs.get(key), sc));
    tokenTypeOf.set(key, sc.tokenType);
    if (sc.isMiner) minerKeys.add(key);
  }

  const rows: CrossCheckRow[] = [];
  const summary = { ...empty };
  for (const key of new Set([...ours.keys(), ...theirs.keys()])) {
    const [address, assetKey] = key.split('|') as [string, string];
    const o = ours.get(key);
    const t = theirs.get(key);
    const isNft = assetKinds[assetKey] === 'erc721' || tokenTypeOf.get(key) === 'ERC-721' || t?.kind === 'nft';
    const scope: CrossCheckScope = isNft ? (t?.kind === 'amount' ? 'count' : 'token-ids') : 'amount';
    const theirIds = t?.kind === 'nft' ? netTokenIds(t.ids.in, t.ids.out) : null;
    const ourIds = netTokenIds(o?.tokenIdsIn ?? [], o?.tokenIdsOut ?? []);
    const row: CrossCheckRow = {
      address: address as CrossCheckRow['address'], assetKey,
      txstory: o?.delta ?? null,
      explorer: t?.kind === 'amount' ? t.delta : theirIds ? String(theirIds.in.length - theirIds.out.length) : null,
      status: 'match', scope,
    };
    if (isNft && o) row.txstoryTokenIds = ourIds;
    if (theirIds) row.explorerTokenIds = theirIds;
    const notes: string[] = [];
    if (minerKeys.has(key)) notes.push('Explorer marks this address as the block fee recipient');
    const set = (status: CrossCheckRow['status']) => { row.status = status; summary[SUMMARY_FIELD[status]]++; };

    if (assetKey.startsWith('unknown:') || t?.kind === 'ambiguous') {
      notes.push(t?.kind === 'ambiguous' ? t.note : 'Explorer did not identify the asset precisely');
      row.scope = 'none';
      set('not-comparable');
    } else if (address === ZERO_ADDRESS && !o) {
      // Explorers book mints/burns as zero-address balance changes; TxStory models
      // them as supply changes, so there is nothing to compare.
      notes.push('Explorer records mints/burns against the zero address; TxStory treats them as supply changes');
      row.scope = 'none';
      set('not-comparable');
    } else if (scope === 'token-ids' && theirIds) {
      if (!o && theirIds.in.length === 0 && theirIds.out.length === 0) {
        row.txstory = '0';
        row.txstoryTokenIds = { in: [], out: [] };
        notes.push('Net zero: the same token ids passed through this address within the transaction');
        set('match');
      } else if (!o) {
        set('only-explorer');
      } else if (sameIds(ourIds, theirIds)) {
        set('match');
      } else {
        notes.push('Same collection, but different token ids or directions');
        set('mismatch');
      }
    } else if (!o && t?.kind === 'amount' && BigInt(t.delta) === 0n) {
      row.txstory = '0';
      notes.push('Net zero: the asset passed through this address within the transaction');
      set('match');
    } else if (o && t?.kind === 'amount') {
      set(BigInt(o.delta) === BigInt(t.delta) ? 'match' : 'mismatch');
      if (scope === 'count') notes.push('Explorer gave only a count for this NFT collection; token ids were not compared');
    } else if (o) {
      set('only-txstory');
      if (explorer.stateChanges.status === 'partial') notes.push('Explorer state changes were partial');
    } else {
      set('only-explorer');
      if (assetKey === 'native' && !nativeFeeSinksItemised) notes.push('Likely a network fee recipient; TxStory does not itemise fee vaults on this chain');
    }
    if (assetKey === 'native' && !nativeInternalComplete && row.status !== 'match' && row.status !== 'not-comparable') {
      notes.push('Expected gap: TxStory is missing internal native-value movements for this transaction');
    }
    if (notes.length) row.note = notes.join('. ');
    rows.push(row);
  }
  const order: Record<CrossCheckRow['status'], number> = { mismatch: 0, 'only-txstory': 1, 'only-explorer': 2, 'not-comparable': 3, match: 4 };
  rows.sort((a, b) => order[a.status] - order[b.status] || a.address.localeCompare(b.address) || a.assetKey.localeCompare(b.assetKey));
  return { available: true, complete: explorer.stateChanges.status === 'complete', rows, summary };
}

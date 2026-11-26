import type { Address } from './hex.js';
import type { Asset, BalanceChange, Movement } from './types.js';

/**
 * Net per-address, per-asset balance change from a list of movements.
 * Movements with a null side (fee sinks, burns to "no account") only affect
 * the non-null side. Zero-net rows are dropped unless NFT ids moved.
 */
export function computeLedger(movements: Movement[], assets: Record<string, Asset>): BalanceChange[] {
  const rows = new Map<string, BalanceChange & { _delta: bigint; _in: Set<string>; _out: Set<string> }>();
  const touch = (address: Address, assetKey: string) => {
    const key = `${address}|${assetKey}`;
    let row = rows.get(key);
    if (!row) {
      row = { address, assetKey, delta: '0', movementIds: [], usesExplorerData: false, _delta: 0n, _in: new Set(), _out: new Set() };
      rows.set(key, row);
    }
    return row;
  };
  for (const m of movements) {
    const amount = BigInt(m.amount);
    const isNft = assets[m.assetKey]?.kind === 'erc721';
    if (m.from) {
      const r = touch(m.from, m.assetKey);
      r._delta -= amount;
      r.movementIds.push(m.id);
      r.usesExplorerData ||= m.provenance === 'explorer';
      if (isNft && m.tokenId) {
        if (r._in.has(m.tokenId)) r._in.delete(m.tokenId); else r._out.add(m.tokenId);
      }
    }
    if (m.to) {
      const r = touch(m.to, m.assetKey);
      r._delta += amount;
      r.movementIds.push(m.id);
      r.usesExplorerData ||= m.provenance === 'explorer';
      if (isNft && m.tokenId) {
        if (r._out.has(m.tokenId)) r._out.delete(m.tokenId); else r._in.add(m.tokenId);
      }
    }
  }
  const out: BalanceChange[] = [];
  for (const r of rows.values()) {
    if (r._delta === 0n && r._in.size === 0 && r._out.size === 0) continue;
    const change: BalanceChange = {
      address: r.address,
      assetKey: r.assetKey,
      delta: r._delta.toString(),
      movementIds: r.movementIds,
      usesExplorerData: r.usesExplorerData,
    };
    if (r._in.size) change.tokenIdsIn = [...r._in];
    if (r._out.size) change.tokenIdsOut = [...r._out];
    out.push(change);
  }
  // Stable, deterministic order: address then asset.
  out.sort((a, b) => (a.address === b.address ? a.assetKey.localeCompare(b.assetKey) : a.address.localeCompare(b.address)));
  return out;
}

/** Ledger rows for one address, keyed by asset. */
export function ledgerFor(ledger: BalanceChange[], address: Address): Map<string, BalanceChange> {
  return new Map(ledger.filter((r) => r.address === address).map((r) => [r.assetKey, r]));
}

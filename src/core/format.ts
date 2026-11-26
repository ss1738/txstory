import { formatCompact, formatUnits } from './amounts.js';
import { shortAddress } from './hex.js';
import type { Asset, Participant } from './types.js';

export function assetSymbol(asset: Asset | undefined): string {
  if (!asset) return 'unknown asset';
  if (asset.symbol) return asset.symbol;
  if (asset.name) return asset.name;
  const kind = asset.kind === 'erc1155' ? 'ERC-1155' : asset.kind === 'erc721' ? 'ERC-721' : 'token';
  if (asset.contract) return `${kind} ${shortAddress(asset.contract)}`;
  return 'unknown asset';
}

/** Exact amount text, e.g. "1,234.5 USDC" or "12345 raw units of token 0xab…cd". */
export function amountExact(asset: Asset | undefined, raw: string, opts: { signed?: boolean } = {}): string {
  if (asset?.kind === 'erc721') return `${raw.startsWith('-') ? '−' : ''}${raw.replace('-', '')} NFT`;
  if (asset && asset.decimals !== null) {
    const s = formatUnits(raw, asset.decimals, { group: true });
    return `${opts.signed && !s.startsWith('-') && s !== '0' ? '+' : ''}${s.replace('-', '−')} ${assetSymbol(asset)}`;
  }
  return `${raw} raw units of ${assetSymbol(asset)} (decimals unknown)`;
}

export function amountCompact(asset: Asset | undefined, raw: string, opts: { signed?: boolean } = {}): string {
  if (asset?.kind === 'erc721') return amountExact(asset, raw, opts);
  if (asset && asset.decimals !== null) {
    const s = formatCompact(raw, asset.decimals);
    return `${opts.signed && !s.startsWith('−') && s !== '0' ? '+' : ''}${s} ${assetSymbol(asset)}`;
  }
  return `${raw.length > 12 ? raw.slice(0, 12) + '…' : raw} raw ${assetSymbol(asset)}`;
}

export function participantName(p: Participant | undefined, address: string | null): string {
  if (!address) return 'no account';
  const label = p?.ens ?? p?.labels[0]?.text;
  return label ? `${label} (${shortAddress(address)})` : shortAddress(address);
}

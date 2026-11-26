import { modeText } from './dataMode.js';
import { amountExact, participantName } from '../../core/format.js';
import type { Story } from '../../core/types.js';

export const APP_VERSION = '0.2.0';

export interface EvidenceBundle {
  format: 'txstory-evidence-bundle';
  /** 2: story schemaVersion 2 (cross-check rows carry `scope` and ERC-721 token ids). */
  formatVersion: 2;
  appVersion: string;
  exportedAt: string;
  notice: string[];
  story: Story;
}

export function buildEvidenceBundle(story: Story, exportedAt = new Date().toISOString()): EvidenceBundle {
  return {
    format: 'txstory-evidence-bundle',
    formatVersion: 2,
    appVersion: APP_VERSION,
    exportedAt,
    notice: [
      modeText(story).notice,
      'Chain observations come from JSON-RPC nodes and were not cryptographically verified by TxStory.',
      'Explorer data (labels, token metadata, internal transfers, state changes) is provider-reported.',
      'Interpretations marked "heuristic" are pattern matches and may be wrong.',
      'sources[].sha256 identifies the exact response bodies used. Explorer responses contain changing fields (e.g. confirmations), so re-fetching typically yields a different digest.',
      'All amounts are exact integers in base units (strings).',
      'crossCheck.rows[].scope states what was compared: "amount" (exact deltas), "token-ids" (ERC-721 identities), "count" (NFT count only; ids NOT compared) or "none".',
    ],
    story,
  };
}

const XML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
export function xmlEscape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => XML_ESCAPES[c]!);
}

function clip(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/** Self-contained SVG summary card. All text is XML-escaped; no external resources. */
export function buildStoryCardSvg(story: Story): string {
  const chain = story.network;
  const W = 1200; const H = 630;
  const lead = story.interpretations[0];
  const sender = story.tx.from;
  const rows = story.ledger.filter((r) => r.address === sender).slice(0, 5);
  const lines: string[] = [];
  const text = (x: number, y: number, s: string, size: number, weight = 400, fill = '#14231f', family = 'system-ui, sans-serif') =>
    lines.push(`<text x="${x}" y="${y}" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${fill}">${xmlEscape(s)}</text>`);
  lines.push(`<rect width="${W}" height="${H}" fill="#f6f8f4"/>`);
  lines.push(`<rect x="40" y="40" width="${W - 80}" height="${H - 80}" rx="20" fill="#ffffff" stroke="#d5ded7"/>`);
  text(80, 105, `${chain.name.toUpperCase()} · ${story.outcome === 'success' ? 'SUCCEEDED' : 'REVERTED'} · BLOCK ${story.block.number}`, 20, 600, '#4b6355');
  text(80, 160, clip(lead?.headline ?? 'Transaction', 70), 36, 650);
  const kind = { heuristic: 'Heuristic interpretation (may be wrong)', explorer: 'Explorer summary (not verified by TxStory)', decoded: 'Decoded from chain data' } as const;
  text(80, 200, lead ? kind[lead.confidence] : '', 20, 400, '#4b6355');
  text(80, 260, `Net change for sender ${participantName(story.participants[sender], sender)}`, 22, 600);
  rows.forEach((r, i) => {
    const asset = story.assets[r.assetKey];
    text(100, 305 + i * 40, clip(amountExact(asset, r.delta, { signed: true }), 80), 24, 500, r.delta.startsWith('-') ? '#8a2f22' : '#1f5c33', 'ui-monospace, monospace');
  });
  if (!rows.length) text(100, 305, 'No net balance change for the sender (besides any fee).', 22, 400, '#4b6355');
  const footer = modeText(story).card;
  text(80, 520, clip(`${story.hash}`, 80), 18, 400, '#4b6355', 'ui-monospace, monospace');
  text(80, 555, `txstory · ${footer} · Chain data via JSON-RPC, labels via explorer; not cryptographically verified`, 16, 400, '#4b6355');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${xmlEscape(lead?.headline ?? 'TxStory card')}">\n${lines.join('\n')}\n</svg>\n`;
}

export function download(filename: string, mime: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

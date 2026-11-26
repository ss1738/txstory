import type { CrossCheckRow } from '../../core/types.js';

const XC_TEXT: Record<CrossCheckRow['status'], { label: string; tone: string; title: string }> = {
  match: { label: '✓ matches explorer', tone: 'ok', title: 'The explorer’s independently computed balance change agrees exactly.' },
  mismatch: { label: '≠ differs from explorer', tone: 'bad', title: 'The explorer reports a different balance change for this address and asset.' },
  'only-txstory': { label: 'explorer silent', tone: 'warn', title: 'TxStory found a change the explorer did not report.' },
  'only-explorer': { label: 'explorer only', tone: 'warn', title: 'The explorer reports a change TxStory did not derive.' },
  'not-comparable': { label: 'not comparable', tone: 'neutral', title: 'The two sources model this differently.' },
};

/** The label must state what was actually compared (amounts, token ids, or only a count). */
export function crossCheckLabel(c: CrossCheckRow): { label: string; tone: string; title: string } {
  const base = XC_TEXT[c.status];
  if (c.status === 'match' && c.scope === 'token-ids') {
    return { label: '✓ matches explorer (same token ids)', tone: 'ok', title: 'Both sources report the same ERC-721 token ids moving in the same directions.' };
  }
  if (c.status === 'match' && c.scope === 'count') {
    return { label: '≈ count matches; token ids not compared', tone: 'warn', title: 'The explorer supplied only a net count for this NFT collection, so token identity could not be checked.' };
  }
  if (c.status === 'mismatch' && c.scope === 'token-ids') {
    return { ...base, label: '≠ different token ids', title: 'Same collection, but the explorer reports different token ids or directions.' };
  }
  return base;
}


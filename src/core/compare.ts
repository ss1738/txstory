/**
 * Compare two analyses (stories) and EXPLAIN the differences.
 *
 * Typical uses: the same transaction from two providers, live vs recorded,
 * two TxStory versions, or with and without a trace. Each difference carries
 * the values on both sides and, where the data supports it, a likely cause
 * (e.g. a native-balance difference that coincides with different internal-
 * transfer completeness). Causes are stated as "coincides with", never as fact.
 */
import type { Story } from './types.js';

export type CompareArea = 'identity' | 'outcome' | 'fees' | 'balances' | 'nft-ids' | 'completeness' | 'trace' | 'revert' | 'abi' | 'cross-check' | 'interpretations' | 'warnings' | 'evidence' | 'schema';

export interface Difference {
  area: CompareArea;
  /** What differs, e.g. "0xabc… native" or "completeness.nativeInternal". */
  subject: string;
  a: string | null;
  b: string | null;
  /** Signed b − a for amounts, when both are integers. */
  delta?: string;
  explanation?: string;
}

export interface Comparison {
  sameTransaction: boolean;
  /** No differences in facts (balances, outcome, fees, NFT ids). Presentation/evidence may still differ. */
  factsAgree: boolean;
  identical: boolean;
  differences: Difference[];
  summary: string;
}

const INT = /^-?\d+$/;

function nftKey(ids?: string[]) {
  return ids && ids.length ? [...ids].sort().join(',') : '';
}

export function compareStories(a: Story, b: Story): Comparison {
  const d: Difference[] = [];
  const push = (x: Difference) => d.push(x);
  const sameTransaction = a.chain === b.chain && a.hash === b.hash;
  if (!sameTransaction) push({ area: 'identity', subject: 'transaction', a: `${a.chain}:${a.hash}`, b: `${b.chain}:${b.hash}`, explanation: 'Different transactions; all other differences are expected.' });
  if (a.schemaVersion !== b.schemaVersion) push({ area: 'schema', subject: 'schemaVersion', a: String(a.schemaVersion), b: String(b.schemaVersion), explanation: 'Different story schema versions; some fields may be absent on one side.' });
  if (a.outcome !== b.outcome) push({ area: 'outcome', subject: 'outcome', a: a.outcome, b: b.outcome, explanation: 'Receipt status differs: the analyses read different receipts (different transaction, reorg, or provider fault).' });
  if (a.block?.number !== b.block?.number) push({ area: 'outcome', subject: 'block', a: a.block?.number ?? null, b: b.block?.number ?? null, explanation: 'Included in different blocks (reorg or different transaction).' });
  if (a.fees?.total !== b.fees?.total) push({ area: 'fees', subject: 'fees.total', a: a.fees?.total ?? null, b: b.fees?.total ?? null, ...(INT.test(a.fees?.total ?? '') && INT.test(b.fees?.total ?? '') ? { delta: (BigInt(b.fees.total) - BigInt(a.fees.total)).toString() } : {}) });

  // Completeness first: it explains balance differences.
  // Older stories may lack fields; compare whatever both sides carry.
  const ca: Record<string, string> = { ...a.completeness };
  const cb: Record<string, string> = { ...b.completeness };
  for (const k of new Set([...Object.keys(ca), ...Object.keys(cb)])) {
    if (ca[k] !== cb[k]) push({ area: 'completeness', subject: `completeness.${k}`, a: ca[k] ?? null, b: cb[k] ?? null });
  }
  const nativeCompletenessDiffers = ca.nativeInternal !== cb.nativeInternal || ca.trace !== cb.trace;

  const rows = (s: Story) => new Map(s.ledger.map((r) => [`${r.address}|${r.assetKey}`, r]));
  const ra = rows(a); const rb = rows(b);
  const sym = (s: Story, key: string) => s.assets[key]?.symbol ?? (key === 'native' ? s.network?.nativeSymbol ?? 'native' : key);
  for (const key of [...new Set([...ra.keys(), ...rb.keys()])].sort()) {
    const x = ra.get(key); const y = rb.get(key);
    const [address, asset] = key.split('|') as [string, string];
    const subject = `${address} ${sym(x ? a : b, asset)}`;
    const da = x?.delta ?? '0'; const db = y?.delta ?? '0';
    if (da !== db) {
      let explanation: string | undefined;
      if (asset === 'native' && nativeCompletenessDiffers) explanation = `Coincides with different native-value completeness (internal transfers: ${ca.nativeInternal ?? '?'} vs ${cb.nativeInternal ?? '?'}; trace: ${ca.trace ?? '?'} vs ${cb.trace ?? '?'}).`;
      else if (!x || !y) explanation = `Row present only in ${x ? 'A' : 'B'}.`;
      push({ area: 'balances', subject, a: x ? da : null, b: y ? db : null, ...(INT.test(da) && INT.test(db) ? { delta: (BigInt(db) - BigInt(da)).toString() } : {}), ...(explanation ? { explanation } : {}) });
    }
    if (x && y && (nftKey(x.tokenIdsIn) !== nftKey(y.tokenIdsIn) || nftKey(x.tokenIdsOut) !== nftKey(y.tokenIdsOut))) {
      push({ area: 'nft-ids', subject, a: `in [${nftKey(x.tokenIdsIn)}] out [${nftKey(x.tokenIdsOut)}]`, b: `in [${nftKey(y.tokenIdsIn)}] out [${nftKey(y.tokenIdsOut)}]`, explanation: 'Same count may hide different token ids; compare the ids, not only the counts.' });
    }
  }

  if (a.trace?.status !== b.trace?.status || a.trace?.frameCount !== b.trace?.frameCount) {
    push({ area: 'trace', subject: 'trace', a: a.trace ? `${a.trace.status} (${a.trace.frameCount} frames, ${a.trace.provider ?? 'no provider'})` : null, b: b.trace ? `${b.trace.status} (${b.trace.frameCount} frames, ${b.trace.provider ?? 'no provider'})` : null });
  }
  if ((a.revert?.summary ?? null) !== (b.revert?.summary ?? null)) push({ area: 'revert', subject: 'revert', a: a.revert?.summary ?? null, b: b.revert?.summary ?? null, explanation: 'Decoded revert differs: usually different ABI sources (e.g. a user ABI on one side) or trace availability.' });

  const call = (s: Story) => {
    const c = s.abiDecoding?.call;
    if (!c) return null;
    const ok = c.candidates.filter((x) => x.ok);
    return `${c.status}${ok.length ? `: ${ok.map((x) => `${x.signature} [${x.sources.map((y) => y.source).join('+')}]`).join(' | ')}` : ''}`;
  };
  if (call(a) !== call(b)) push({ area: 'abi', subject: 'calldata decoding', a: call(a), b: call(b), explanation: 'Different ABI sources were available (e.g. a user ABI on one side).' });

  const cs = (s: Story) => s.crossCheck?.available ? `${s.crossCheck.summary.match} match, ${s.crossCheck.summary.mismatch} mismatch, ${s.crossCheck.summary.onlyTxStory} only TxStory, ${s.crossCheck.summary.onlyExplorer} only explorer` : `unavailable: ${s.crossCheck?.reason ?? '?'}`;
  if (cs(a) !== cs(b)) push({ area: 'cross-check', subject: 'crossCheck', a: cs(a), b: cs(b) });

  const interp = (s: Story) => new Set(s.interpretations.map((i) => `[${i.confidence}] ${i.headline}`));
  const ia = interp(a); const ib = interp(b);
  for (const i of ia) if (!ib.has(i)) push({ area: 'interpretations', subject: 'interpretation', a: i, b: null });
  for (const i of ib) if (!ia.has(i)) push({ area: 'interpretations', subject: 'interpretation', a: null, b: i });
  const wa = new Set(a.warnings); const wb = new Set(b.warnings);
  for (const w of wa) if (!wb.has(w)) push({ area: 'warnings', subject: 'warning', a: w, b: null });
  for (const w of wb) if (!wa.has(w)) push({ area: 'warnings', subject: 'warning', a: null, b: w });

  // Evidence: which response bodies differ, by request.
  const ev = (s: Story) => new Map(s.sources.map((x) => [`${x.kind} ${x.method} ${x.url}`, x.sha256 ?? x.status]));
  const ea = ev(a); const eb = ev(b);
  let sameBodies = 0;
  for (const [k, h] of ea) {
    if (!eb.has(k)) continue;
    if (eb.get(k) === h) sameBodies++;
    else push({ area: 'evidence', subject: k, a: String(h).slice(0, 16), b: String(eb.get(k)).slice(0, 16), explanation: 'The provider returned a different response body for the same request.' });
  }
  const onlyA = [...ea.keys()].filter((k) => !eb.has(k)).length;
  const onlyB = [...eb.keys()].filter((k) => !ea.has(k)).length;
  if (onlyA || onlyB) push({ area: 'evidence', subject: 'requests', a: `${onlyA} request(s) only in A`, b: `${onlyB} request(s) only in B`, explanation: `Different providers or options (${sameBodies} identical response(s) shared).` });

  const factAreas = new Set<CompareArea>(['identity', 'outcome', 'fees', 'balances', 'nft-ids']);
  const factsAgree = !d.some((x) => factAreas.has(x.area));
  const count = (area: CompareArea) => d.filter((x) => x.area === area).length;
  const summary = d.length === 0
    ? 'The analyses are identical in every compared field.'
    : `${factsAgree ? 'Facts agree' : 'Facts DIFFER'} (balances ${count('balances')}, NFT ids ${count('nft-ids')}, outcome ${count('outcome')}, fees ${count('fees')}); `
      + `other differences: completeness ${count('completeness')}, trace ${count('trace')}, revert ${count('revert')}, ABI ${count('abi')}, cross-check ${count('cross-check')}, interpretations ${count('interpretations')}, warnings ${count('warnings')}, evidence ${count('evidence')}, schema ${count('schema')}.`;
  return { sameTransaction, factsAgree, identical: d.length === 0, differences: d, summary };
}

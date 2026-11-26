/**
 * Deeper analysis assembled into a story: call traces, revert decoding and ABI
 * decoding. Pure functions over validated inputs.
 */
import { AbiLibrary, decodeCalldata, decodeRevertData, type AbiValue, type Candidate, type DecodeResult } from './abi.js';
import { builtinLibrary, decodeLogs, type DecodedLogView } from './decoders/index.js';
import type { Address } from './hex.js';
import type { BuildInput } from './inputs.js';
import { parseCallTrace, traceValueMoves, type ParsedTrace, type TraceValueMove } from './trace.js';
import type { AbiDecodingSection, RevertSection, StoredDecode, Story, TraceFrameView, TraceSection } from './types.js';

const MAX_STORED_FRAMES = 2000;
const MAX_VALUE_CHARS = 512;

/** The ABI library for a build: built-in modules plus user ABIs (if any). */
export function libraryForBuild(input: BuildInput): AbiLibrary {
  return input.userAbi ? builtinLibrary().merge(input.userAbi.library) : builtinLibrary();
}

function compactValue(v: AbiValue): AbiValue {
  if (typeof v === 'string') return v.length > MAX_VALUE_CHARS ? `${v.slice(0, MAX_VALUE_CHARS)}…(${v.length - MAX_VALUE_CHARS} more chars; full value in raw data)` : v;
  if (Array.isArray(v)) return v.slice(0, 200).map(compactValue).concat(v.length > 200 ? [`…(${v.length - 200} more items)`] : []);
  if (typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, compactValue(x)]));
  return v;
}

export function store(r: DecodeResult): StoredDecode {
  return {
    status: r.status, id: r.id, ...(r.note ? { note: r.note } : {}),
    candidates: r.candidates.map((c): Candidate => ({ ...c, ...(c.params ? { params: c.params.map((p) => ({ ...p, value: compactValue(p.value) })) } : {}) })),
  };
}

/** One-line description of a decoded revert, honest about ambiguity. */
export function revertSummary(r: DecodeResult & { panic?: string }): string {
  const ok = r.candidates.filter((c) => c.ok);
  const fmt = (c: Candidate) => {
    if (c.signature === 'Error(string)') return `Error("${String(c.params?.[0]?.value ?? '')}")`;
    if (c.signature === 'Panic(uint256)') return `Panic(${String(c.params?.[0]?.value)}${r.panic ? `: ${r.panic}` : ''})`;
    return `${c.name}(${(c.params ?? []).map((p) => `${p.name ? `${p.name}=` : ''}${JSON.stringify(compactValue(p.value))}`).join(', ')})`;
  };
  switch (r.status) {
    case 'decoded': return fmt(ok[0]!);
    case 'ambiguous': return `ambiguous: ${ok.map(fmt).join(' | ')}`;
    case 'empty': return 'no revert data';
    case 'no-match': return `unknown error selector ${r.id} (supply the contract ABI to decode it)`;
    case 'no-valid-candidate': return `selector ${r.id} matched, but the data does not fit any known error`;
    default: return r.note ?? r.status;
  }
}

export interface TraceResult {
  section: TraceSection;
  parsed: ParsedTrace | null;
  moves: TraceValueMove[];
  warnings: string[];
}

export function buildTrace(input: BuildInput, lib: AbiLibrary): TraceResult {
  const t = input.trace;
  const empty = (status: TraceSection['status'], note?: string): TraceResult => ({
    section: { status, provider: t?.provider ?? null, sourceIds: t?.sourceIds ?? [], ...(note ? { note } : {}), frameCount: 0, maxDepth: 0, revertedFrames: 0, frames: [], valueMoves: [] },
    parsed: null, moves: [], warnings: [],
  });
  if (!t || t.status === 'not-requested') return empty('not-requested', t?.note ?? (input.stage === 'fast' ? 'Traces are requested in the full stage.' : 'Trace requests are switched off (TXSTORY_TRACE=off / --no-trace).'));
  if (t.status === 'unavailable') return empty('unavailable', t.note ?? 'No configured RPC endpoint provided debug_traceTransaction.');
  let parsed: ParsedTrace;
  try {
    parsed = parseCallTrace(t.raw);
  } catch (err) {
    return { ...empty('unavailable', `The trace response was rejected: ${err instanceof Error ? err.message : 'invalid'}`), warnings: ['A call trace was returned but failed validation; native value inside execution falls back to the explorer.'] };
  }
  const moves = traceValueMoves(parsed);
  const frames: TraceFrameView[] = parsed.frames.slice(0, MAX_STORED_FRAMES).map((f) => {
    const view: TraceFrameView = { ...f };
    if (f.inputSelector) {
      const r = decodeCalldata(f.input, lib);
      view.call = { status: r.status, signatures: [...new Set(r.candidates.filter((c) => c.ok).map((c) => c.signature))] };
    }
    if (f.reverted && f.output !== null) {
      const r = decodeRevertData(f.output, lib);
      view.revert = { status: r.status, summary: revertSummary(r) };
    }
    return view;
  });
  const notes: string[] = [];
  if (parsed.truncated) notes.push('The trace exceeded TxStory\'s frame/depth limits and was truncated.');
  if (parsed.frames.length > MAX_STORED_FRAMES) notes.push(`Only the first ${MAX_STORED_FRAMES} of ${parsed.frames.length} frames are stored in the story.`);
  return {
    section: {
      status: parsed.truncated ? 'partial' : 'complete', provider: t.provider, sourceIds: t.sourceIds,
      ...(notes.length ? { note: notes.join(' ') } : t.note ? { note: t.note } : {}),
      frameCount: parsed.frames.length, maxDepth: parsed.maxDepth, revertedFrames: parsed.frames.filter((f) => f.reverted).length,
      frames, valueMoves: moves,
    },
    parsed, moves, warnings: parsed.truncated ? ['The call trace was truncated; native value inside execution may be incomplete.'] : [],
  };
}

export function buildRevert(trace: TraceResult, lib: AbiLibrary, success: boolean): RevertSection | null {
  if (success || !trace.parsed) return null;
  const root = trace.parsed.frames[0];
  if (!root || root.output === null) return null;
  const r = decodeRevertData(root.output, lib);
  return { source: 'trace', frameId: root.id, data: root.output, decoded: { ...store(r), ...(r.panic ? { panic: r.panic } : {}) }, summary: revertSummary(r) };
}

/**
 * Compare trace-derived committed value transfers with the explorer's internal
 * transactions (both independent sources). Returns human-readable differences.
 */
export function compareTraceWithExplorer(moves: TraceValueMove[], explorer: NonNullable<BuildInput['explorer']>): string[] {
  if (!explorer.available || explorer.internal.status !== 'complete') return [];
  const key = (from: string, to: string | null, value: string) => `${from.toLowerCase()}>${(to ?? '').toLowerCase()}:${value}`;
  const ours = new Map<string, number>();
  for (const m of moves.filter((x) => x.committed)) ours.set(key(m.from, m.to, m.value), (ours.get(key(m.from, m.to, m.value)) ?? 0) + 1);
  const theirs = new Map<string, number>();
  for (const it of explorer.internal.items) {
    if (!it.success || BigInt(it.value) === 0n || it.type === 'delegatecall' || it.type === 'staticcall') continue;
    const k = key(it.from, it.to ?? it.createdContract, BigInt(it.value).toString());
    theirs.set(k, (theirs.get(k) ?? 0) + 1);
  }
  const diffs: string[] = [];
  for (const [k, n] of ours) if ((theirs.get(k) ?? 0) !== n) diffs.push(`trace has ${n}× ${k}, explorer ${theirs.get(k) ?? 0}×`);
  for (const [k, n] of theirs) if (!ours.has(k)) diffs.push(`explorer has ${n}× ${k}, trace 0×`);
  return diffs.length ? [`The node's call trace and the explorer's internal transactions disagree on ${diffs.length} native transfer(s) (TxStory uses the trace): ${diffs.slice(0, 3).join('; ')}${diffs.length > 3 ? '; …' : ''}.`] : [];
}

export function buildAbiDecoding(story: Story, txInput: string, lib: AbiLibrary, input: BuildInput): { section: AbiDecodingSection; logs: DecodedLogView[] } {
  const logs = decodeLogs(story, lib);
  const matched = logs.filter((l) => l.result.status !== 'no-match');
  const libraries: AbiDecodingSection['libraries'] = [{ label: 'Built-in decoder modules', source: 'builtin', entries: builtinLibrary().size }];
  for (const u of input.userAbi?.labels ?? []) libraries.push({ label: u.label, source: 'user', entries: u.entries });
  return {
    section: {
      libraries,
      call: txInput && txInput !== '0x' ? store(decodeCalldata(txInput, lib)) : null,
      logs: matched.map((l) => ({ logIndex: l.logIndex, ...store(l.result) })),
      unmatchedLogs: story.logs.length - matched.length,
    },
    logs,
  };
}

export type { Address };

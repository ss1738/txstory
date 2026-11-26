/**
 * Call traces from `debug_traceTransaction` with Geth's built-in `callTracer`
 * (also implemented by Erigon, Reth, Nethermind, Anvil and others).
 *
 * The trace is UNTRUSTED provider output: it is validated, bounded, and kept
 * as the node reported it. TxStory derives two things from it:
 *  - the call tree with failure propagation: a frame is `undone` when it or
 *    any ancestor failed (its effects were rolled back);
 *  - native value transfers inside execution. Only transfers in frames that
 *    were NOT undone are committed balance changes. CALLCODE moves value to the
 *    caller itself (no net change) and DELEGATECALL/STATICCALL move none.
 *
 * The callTracer does not say when, relative to emitted events, a call ran
 * (unless `withLog` is used), so TxStory does not order value transfers
 * against token events.
 */
import { normalizeAddress, type Address } from './hex.js';
import { cleanUntrusted } from './text.js';

export type FrameType = 'CALL' | 'CALLCODE' | 'DELEGATECALL' | 'STATICCALL' | 'CREATE' | 'CREATE2' | 'SELFDESTRUCT';
const TYPES = new Set<FrameType>(['CALL', 'CALLCODE', 'DELEGATECALL', 'STATICCALL', 'CREATE', 'CREATE2', 'SELFDESTRUCT']);

export interface CallFrame {
  /** Path in the tree: "0" is the top-level call, "0.2.1" the second child of its third child. */
  id: string;
  depth: number;
  type: FrameType;
  from: Address;
  to: Address | null;
  /** Exact wei, decimal. */
  value: string;
  gasUsed: string | null;
  inputSelector: string | null;
  inputBytes: number;
  /** Hex, possibly truncated (see inputTruncated). */
  input: string;
  inputTruncated: boolean;
  output: string | null;
  outputTruncated: boolean;
  /** The node's error for this frame (e.g. "execution reverted", "out of gas"). */
  error: string | null;
  /** The node's own revert-reason text, if it provided one (sanitised). */
  revertReason: string | null;
  /** This frame failed. */
  reverted: boolean;
  /** This frame's effects were rolled back (it or an ancestor failed). */
  undone: boolean;
  children: number;
}

export interface ParsedTrace {
  frames: CallFrame[];
  truncated: boolean;
  maxDepth: number;
}

export const TRACE_LIMITS = { maxFrames: 5000, maxDepth: 1100, maxHexChars: 8192 };

const HEX = /^0x[0-9a-fA-F]*$/;

function hexToDec(v: unknown): string | null {
  if (v === undefined || v === null || v === '0x' || v === '') return '0';
  if (typeof v === 'string' && /^0x[0-9a-fA-F]{1,64}$/.test(v)) return BigInt(v).toString();
  return null;
}

/** Validate and flatten a callTracer result (pre-order). Throws on structurally invalid input. */
export function parseCallTrace(raw: unknown, limits = TRACE_LIMITS): ParsedTrace {
  const frames: CallFrame[] = [];
  let truncated = false;
  let maxDepth = 0;
  const visit = (node: unknown, id: string, depth: number, parentUndone: boolean): void => {
    if (frames.length >= limits.maxFrames || depth > limits.maxDepth) { truncated = true; return; }
    if (typeof node !== 'object' || node === null) throw new Error(`trace frame ${id} is not an object`);
    const n = node as Record<string, unknown>;
    const type = String(n.type ?? '').toUpperCase() as FrameType;
    if (!TYPES.has(type)) throw new Error(`trace frame ${id} has unknown type "${String(n.type).slice(0, 20)}"`);
    const from = typeof n.from === 'string' ? normalizeAddress(n.from) : null;
    if (!from) throw new Error(`trace frame ${id} has no valid "from"`);
    const to = typeof n.to === 'string' ? normalizeAddress(n.to) : null;
    const value = hexToDec(n.value);
    if (value === null) throw new Error(`trace frame ${id} has an invalid value`);
    const input = typeof n.input === 'string' && HEX.test(n.input) ? n.input.toLowerCase() : '0x';
    const output = typeof n.output === 'string' && HEX.test(n.output) ? n.output.toLowerCase() : null;
    const error = typeof n.error === 'string' ? cleanUntrusted(n.error, 200)?.text ?? 'error' : null;
    const reverted = error !== null;
    const undone = parentUndone || reverted;
    const kids = Array.isArray(n.calls) ? n.calls : [];
    maxDepth = Math.max(maxDepth, depth);
    frames.push({
      id, depth, type, from, to, value,
      gasUsed: hexToDec(n.gasUsed),
      inputSelector: input.length >= 10 ? input.slice(0, 10) : null,
      inputBytes: Math.max(0, (input.length - 2) / 2),
      input: input.slice(0, limits.maxHexChars + 2), inputTruncated: input.length > limits.maxHexChars + 2,
      output: output === null ? null : output.slice(0, limits.maxHexChars + 2), outputTruncated: output !== null && output.length > limits.maxHexChars + 2,
      error,
      revertReason: typeof n.revertReason === 'string' ? cleanUntrusted(n.revertReason, 300)?.text ?? null : null,
      reverted, undone, children: kids.length,
    });
    kids.forEach((child, i) => visit(child, `${id}.${i}`, depth + 1, undone));
  };
  visit(raw, '0', 0, false);
  return { frames, truncated, maxDepth };
}

export interface TraceValueMove {
  frameId: string;
  type: FrameType;
  from: Address;
  to: Address;
  value: string;
  /** false when the frame (or an ancestor) failed: the transfer was rolled back. */
  committed: boolean;
}

/**
 * Native value transfers inside execution (the top-level call's value is the
 * transaction's own value and is excluded). Frames with zero value, DELEGATECALL
 * and STATICCALL carry no transfer; CALLCODE sends to the caller itself.
 */
export function traceValueMoves(trace: ParsedTrace): TraceValueMove[] {
  const out: TraceValueMove[] = [];
  for (const f of trace.frames) {
    if (f.id === '0' || f.value === '0') continue;
    if (f.type === 'DELEGATECALL' || f.type === 'STATICCALL' || f.type === 'CALLCODE') continue;
    if (!f.to) continue;
    out.push({ frameId: f.id, type: f.type, from: f.from, to: f.to, value: f.value, committed: !f.undone });
  }
  return out;
}

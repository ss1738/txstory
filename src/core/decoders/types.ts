/**
 * Decoder modules: the extension point for recognising events, calls and
 * errors of a standard or protocol. A module is TRUSTED CODE that ships with
 * TxStory (reviewed like any source file). It contributes:
 *  - `abi`: ABI items or human-readable signatures (data). They join the
 *    built-in ABI library and are used to decode logs, calldata, trace frames
 *    and revert data, always labelled with the module as their source.
 *  - `interpret` (optional): turns DECODED logs into interpretations. Every
 *    interpretation must cite evidence (`log:<index>`, movement ids or
 *    `ledger:<address>:<asset>`); the registry drops any that do not.
 *
 * Modules never fetch anything, never change balances or movements (those come
 * only from standard token semantics in events.ts), and must report what the
 * events SAY, not what the contract "really" did.
 */
import type { AbiValue, Candidate, DecodeResult } from '../abi.js';
import type { Address } from '../hex.js';
import type { Interpretation, Story } from '../types.js';

export interface DecodedLogView {
  logIndex: number;
  contract: Address;
  result: DecodeResult;
  /** The single successful candidate, or null when undecoded or ambiguous. */
  match: (Candidate & { ok: true; params: NonNullable<Candidate['params']> }) | null;
}

export interface DecoderContext {
  story: Readonly<Story>;
  logs: readonly DecodedLogView[];
}

export type ModuleInterpretation = Omit<Interpretation, 'kind' | 'id'> & { id: string };

export interface DecoderModule {
  /** Short stable id, e.g. "seaport". Used to prefix interpretation ids. */
  id: string;
  name: string;
  description: string;
  abi: unknown[];
  interpret?: (ctx: DecoderContext) => ModuleInterpretation[];
}

/** Named access to decoded parameters (falls back to position). */
export function param(match: NonNullable<DecodedLogView['match']>, name: string, position: number): AbiValue | undefined {
  return match.params.find((p) => p.name === name)?.value ?? match.params[position]?.value;
}

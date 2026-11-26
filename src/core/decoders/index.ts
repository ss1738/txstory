/**
 * Decoder registry. To add a module: create a file exporting a DecoderModule,
 * add it to BUILTIN_DECODERS, and add tests with independent expected values
 * (see docs/extending.md).
 */
import { AbiLibrary, decodeEventLog } from '../abi.js';
import type { Interpretation, Story } from '../types.js';
import { seaport } from './seaport.js';
import { erc1155, erc20, erc721, weth } from './standards.js';
import type { DecodedLogView, DecoderModule } from './types.js';
import { uniswap } from './uniswap.js';

export type { DecodedLogView, DecoderContext, DecoderModule, ModuleInterpretation } from './types.js';

export const BUILTIN_DECODERS: readonly DecoderModule[] = [erc20, erc721, erc1155, weth, uniswap, seaport];

/** ABI library of the given modules (source "builtin", labelled per module). */
export function libraryFor(modules: readonly DecoderModule[] = BUILTIN_DECODERS): AbiLibrary {
  const lib = new AbiLibrary();
  for (const m of modules) lib.addJson(m.abi, 'builtin', `${m.name} (built-in)`);
  return lib;
}

let cached: AbiLibrary | null = null;
export function builtinLibrary(): AbiLibrary {
  cached ??= libraryFor(BUILTIN_DECODERS);
  return cached;
}

const MAX_LOGS = 2000;

/** Decode every receipt log with the library (bounded). */
export function decodeLogs(story: Pick<Story, 'logs'>, lib: AbiLibrary): DecodedLogView[] {
  return story.logs.slice(0, MAX_LOGS).map((l) => {
    const result = decodeEventLog(l.raw, lib);
    const ok = result.candidates.filter((c) => c.ok);
    const match = result.status === 'decoded' && ok.length === 1 ? (ok[0] as DecodedLogView['match']) : null;
    return { logIndex: l.logIndex, contract: l.contract, result, match };
  });
}

/**
 * Run module interpretations. Output is validated: evidence must reference
 * existing logs, movements or ledger rows; failures become warnings.
 */
export function runInterpreters(story: Readonly<Story>, logs: readonly DecodedLogView[], modules: readonly DecoderModule[] = BUILTIN_DECODERS): { interpretations: Interpretation[]; warnings: string[] } {
  const known = new Set<string>([
    ...story.logs.map((l) => `log:${l.logIndex}`),
    ...story.movements.map((m) => m.id),
    ...story.ledger.map((r) => `ledger:${r.address}:${r.assetKey}`),
  ]);
  const interpretations: Interpretation[] = [];
  const warnings: string[] = [];
  for (const m of modules) {
    if (!m.interpret) continue;
    let produced: ReturnType<NonNullable<DecoderModule['interpret']>>;
    try {
      produced = m.interpret({ story, logs });
    } catch (err) {
      warnings.push(`Decoder "${m.id}" failed and was skipped: ${err instanceof Error ? err.message.slice(0, 160) : 'error'}`);
      continue;
    }
    for (const i of produced.slice(0, 50)) {
      const valid = i.evidence.length > 0 && i.evidence.every((e) => known.has(e)) && (i.confidence === 'decoded' || i.confidence === 'heuristic');
      if (!valid) { warnings.push(`Decoder "${m.id}" produced an interpretation without valid evidence; it was dropped.`); continue; }
      interpretations.push({
        ...i, id: `${m.id}:${i.id}`, kind: 'protocol',
        headline: i.headline.slice(0, 200), detail: i.detail.slice(0, 2000), caveats: i.caveats.slice(0, 5).map((c) => c.slice(0, 400)),
      });
    }
  }
  return { interpretations, warnings };
}

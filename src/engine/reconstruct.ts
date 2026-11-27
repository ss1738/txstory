/**
 * Reconstruction report: rebuild an analysis from a recording's raw provider
 * responses and say plainly what that does and does not establish.
 *
 * Shared by the CLI (`txstory replay`) and the browser ("Open a recording"),
 * so both describe a recording the same way. Browser-safe.
 *
 * What reconstruction is: the same analysis code runs again on the recorded
 * provider responses. What it is not: EVM re-execution (no bytecode is run)
 * or verification of chain history (no headers, proofs or signatures are
 * checked). The recorded responses are trusted as they were captured.
 */
import { STORY_SCHEMA_VERSION, type Story } from '../core/types.js';
import { compareStories, type Comparison } from '../core/compare.js';
import type { StoryResult } from './analyze.js';
import { ENGINE_VERSION } from './defaults.js';
import { checkReplay, replayRecording, storyDigest, type Recording, type ReplayCheck, type ReplayOptions } from './recording.js';
import { fixtureRequestKey, legacyFixtureKeyV1, FIXTURE_SCHEMA_V1, type TransportRequest } from './transport.js';
import type { EngineConfig } from './defaults.js';

export type ReconstructionVerdict =
  /** Rebuilt output and evidence digests both equal the recorded ones. */
  | 'reproduced'
  /** At least one digest differs. */
  | 'differs'
  /** The recording stores no output digest, so there is nothing to compare with. */
  | 'no-digest'
  /** The analysis did not produce a story (for example, the recording holds a pending or missing transaction). */
  | 'no-story';

export interface ReconstructionReport {
  recording: {
    schema: string;
    network: string;
    hash: string;
    origin: NonNullable<Recording['origin']> | 'unspecified';
    description: string;
    recordedAt: string;
    recorder: string | null;
    engineVersion: string | null;
    storySchema: number | null;
    exchanges: { total: number; rpc: number; explorer: number };
    providers: string[];
    recordedStage: 'fast' | 'full' | null;
    recordedKind: string | null;
    embedsStory: boolean;
    explorerApiKeyUsed: boolean;
  };
  /** The engine that ran this reconstruction. */
  engine: { version: string; storySchema: number };
  /** ABIs supplied for this reconstruction (not part of the recording), with their entry counts. */
  userAbis: Array<{ label: string; entries: number }>;
  result: { kind: StoryResult['kind']; message: string | null };
  check: ReplayCheck;
  verdict: ReconstructionVerdict;
  /**
   * With user ABIs only: the same recording rebuilt WITHOUT them, compared with
   * the stored digests. This answers "does the original output still
   * reproduce?" independently of the reinterpretation. null without user ABIs.
   */
  withoutUserAbis: { sameEvidence: boolean | null; sameOutput: boolean | null; replayDigest: string | null } | null;
  /**
   * With user ABIs only: whether they changed any decoding or interpretation.
   * Listing a supplied ABI among the output's ABI sources does not count, so
   * an ABI that matched nothing gives false. null without user ABIs.
   */
  userAbisChangedOutput: boolean | null;
  /**
   * True only when the verdict is `differs`, the evidence is the same, and the
   * rebuild WITHOUT user ABIs reproduces both stored digests. The two rebuilds
   * differ only in the supplied ABIs, so the difference is the requested
   * reinterpretation, not a reproducibility failure. Nothing else is excused.
   */
  differsOnlyByUserAbis: boolean;
  /** Requests the analysis made that the recording has no answer for (each is shown as missing data). */
  missing: Array<{ kind: 'rpc' | 'explorer'; provider: string; method: string }>;
  /** Recorded exchanges the analysis never requested (older engines asked for different things). */
  unusedExchanges: number;
  /** Field-level differences from the embedded story, when the recording has one and the output differs. */
  differences: Comparison | null;
  /** Plain-English lines explaining the verdict and how to investigate. */
  notes: string[];
}

export const RECONSTRUCTION_SCOPE = 'Reconstruction reruns TxStory\'s analysis on the recorded provider responses. It does not re-execute EVM code and does not verify chain history: the responses are trusted as recorded.';

export async function reconstruct(rec: Recording, base: EngineConfig, opts: Omit<ReplayOptions, 'onRequest'> = {}): Promise<{ report: ReconstructionReport; result: StoryResult }> {
  const missing: ReconstructionReport['missing'] = [];
  const seen = new Set<string>();
  const keyOf = rec.schema === FIXTURE_SCHEMA_V1 ? legacyFixtureKeyV1 : fixtureRequestKey;
  const onRequest = (req: TransportRequest, recorded: boolean) => {
    if (recorded) seen.add(keyOf(req));
    else missing.push({ kind: req.kind, provider: req.provider, method: req.method });
  };
  const result = await replayRecording(rec, base, { ...opts, onRequest });
  const check = checkReplay(rec, result);
  // Reproduction of the original output is judged without the user's ABIs.
  const hasUserAbis = (opts.userAbi?.labels.length ?? 0) > 0;
  let withoutUserAbis: ReconstructionReport['withoutUserAbis'] = null;
  let userAbisChangedOutput: boolean | null = null;
  if (hasUserAbis) {
    const { userAbi: _omit, ...plainOpts } = opts;
    const plainResult = await replayRecording(rec, base, plainOpts);
    const plain = checkReplay(rec, plainResult);
    withoutUserAbis = { sameEvidence: plain.sameEvidence, sameOutput: plain.sameOutput, replayDigest: plain.replayDigest };
    userAbisChangedOutput = result.kind === 'ok' && plainResult.kind === 'ok'
      ? storyDigest(withoutUserAbiSources(result.story)) !== storyDigest(withoutUserAbiSources(plainResult.story))
      : result.kind !== plainResult.kind;
  }
  const ex = Object.values(rec.exchanges);
  const verdict: ReconstructionVerdict =
    result.kind !== 'ok' ? 'no-story'
      : check.sameOutput === false || check.sameEvidence === false ? 'differs'
        : check.sameOutput === null ? 'no-digest'
          : 'reproduced';
  const embedded: Story | undefined = rec.output?.story;
  const differences = verdict === 'differs' && embedded && result.kind === 'ok' ? compareStories(embedded, result.story) : null;
  const report: ReconstructionReport = {
    recording: {
      schema: rec.schema,
      network: rec.chain,
      hash: rec.hash,
      origin: rec.origin ?? 'unspecified',
      description: rec.description ?? '',
      recordedAt: rec.recordedAt,
      recorder: rec.recorder ?? null,
      engineVersion: rec.engine?.version ?? null,
      storySchema: rec.engine?.storySchema ?? null,
      exchanges: { total: ex.length, rpc: ex.filter((e) => e.kind === 'rpc').length, explorer: ex.filter((e) => e.kind === 'explorer').length },
      providers: [...new Set(ex.map((e) => e.provider))].sort(),
      recordedStage: rec.output?.stage ?? null,
      recordedKind: rec.output?.kind ?? null,
      embedsStory: !!embedded,
      explorerApiKeyUsed: rec.config?.explorerApiKeyUsed ?? false,
    },
    engine: { version: ENGINE_VERSION, storySchema: STORY_SCHEMA_VERSION },
    userAbis: opts.userAbi?.labels.map((l) => ({ ...l })) ?? [],
    result: { kind: result.kind, message: result.kind === 'ok' ? null : result.message },
    check,
    verdict,
    withoutUserAbis,
    userAbisChangedOutput,
    differsOnlyByUserAbis: verdict === 'differs' && check.sameEvidence === true
      && withoutUserAbis?.sameEvidence === true && withoutUserAbis.sameOutput === true,
    missing: dedupe(missing),
    unusedExchanges: Math.max(0, ex.length - seen.size),
    differences,
    notes: [],
  };
  report.notes = explain(report);
  return { report, result };
}

/** A story without the user-ABI entries in its ABI source list, to tell real decoding changes from that listing. */
function withoutUserAbiSources(story: Story): Story {
  return { ...story, abiDecoding: { ...story.abiDecoding, libraries: story.abiDecoding.libraries.filter((l) => l.source !== 'user') } };
}

function dedupe(list: ReconstructionReport['missing']): ReconstructionReport['missing'] {
  const out = new Map<string, ReconstructionReport['missing'][number]>();
  for (const m of list) out.set(`${m.kind}|${m.provider}|${m.method}`, m);
  return [...out.values()];
}

function explain(r: ReconstructionReport): string[] {
  const notes: string[] = [];
  const versionChanged = r.recording.engineVersion !== null && r.recording.engineVersion !== r.engine.version;
  switch (r.verdict) {
    case 'reproduced':
      notes.push(`The rebuilt analysis is identical to the one stored when this recording was made (same evidence digest, same output digest).`);
      break;
    case 'differs':
      if (r.check.sameEvidence === false) {
        notes.push('The provider evidence differs from what was recorded. The analysis now reads a different set of responses: either the recording was edited, or this engine requests different data than the one that made it.');
      }
      if (r.differsOnlyByUserAbis) {
        const names = r.userAbis.map((a) => a.label).join(', ');
        notes.push(r.userAbisChangedOutput
          ? `The output differs because this rebuild decodes with ABIs you supplied (${names}), which the original analysis did not have. The recorded evidence is the same, and without your ABIs the stored output is reproduced exactly; decodings and the interpretations built on them changed.`
          : `The ABIs you supplied (${names}) did not change any decoding. The output differs only because it lists them among the ABI sources consulted. Without them the stored output is reproduced exactly.`);
        break;
      }
      if (r.withoutUserAbis && r.withoutUserAbis.sameOutput !== true) {
        notes.push('Without your ABIs the rebuilt output also differs from the recording, so the difference is not caused by your ABIs.');
      }
      if (r.check.sameOutput === false) {
        notes.push(versionChanged
          ? `The output differs. The recording was made by TxStory ${r.recording.engineVersion} and rebuilt with ${r.engine.version}, so a change in analysis code is the first thing to check.`
          : 'The output differs although the engine version is the same. That points to an edited recording or a non-deterministic step in the analysis; please report it with the recording attached if it is shareable.');
      }
      notes.push(r.differences
        ? 'The differences below compare the story stored in the recording with the rebuilt one.'
        : 'This recording does not embed its original story, so differences cannot be listed field by field. Record with --embed-story, or compare two `txstory explain --json` outputs with `txstory compare`.');
      break;
    case 'no-digest':
      notes.push('This recording stores no output digest (older schema or a failed analysis), so the rebuilt analysis cannot be compared with the original.');
      break;
    case 'no-story':
      notes.push(`The recorded responses do not produce a transaction story (${r.result.kind}${r.result.message ? `: ${r.result.message}` : ''}). This can be the correct result, for example for a transaction that was pending when it was recorded.`);
      break;
  }
  if (r.missing.length > 0) {
    notes.push(`${r.missing.length} request(s) had no recorded answer. Replay never uses the network, so they appear as missing data in the story's completeness flags and sources.`);
  }
  if (r.unusedExchanges > 0) {
    notes.push(`${r.unusedExchanges} recorded exchange(s) were not requested by this engine. That is expected when the recording was made by a different engine version.`);
  }
  if (r.recording.origin === 'synthetic') notes.push('This is a synthetic recording: its responses were written for testing and are not real provider data.');
  if (r.recording.origin === 'unspecified') notes.push('The recording does not state its origin.');
  notes.push(RECONSTRUCTION_SCOPE);
  return notes;
}

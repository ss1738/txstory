#!/usr/bin/env node
/**
 * txstory: command-line interface to the TxStory engine (same code as the web app).
 * Run `txstory help` for usage. Conventions:
 *  - stdout: the result (human text, or exactly one JSON document with --json);
 *  - stderr: diagnostics and errors;
 *  - exit codes are stable (see EXIT below and docs/cli.md);
 *  - provider URLs are only ever printed in redacted form.
 */
import { readFileSync, statSync } from 'node:fs';
import { AbiLibrary, decodeCalldata, decodeEventLog, decodeRevertData, idOf, type DecodeResult } from '../core/abi.js';
import { chainKeys, getChain, isChainKey } from '../core/chains.js';
import { compareStories } from '../core/compare.js';
import { amountExact } from '../core/format.js';
import { parseLookupInput } from '../core/lookupInput.js';
import type { Story } from '../core/types.js';
import { analyzeTransaction, type AssembleOptions, type StoryResult } from '../engine/analyze.js';
import { ENGINE_VERSION, engineConfigFromEnv, loadChainFile, shareableLooseUrl, shareableUrlMapper, type EngineConfig } from '../engine/config.js';
import { recordAnalysis, replayRecording, validateRecording, type Recording } from '../engine/recording.js';
import { reconstruct, type ReconstructionReport } from '../engine/reconstruct.js';
import { readRecording, writeRecording } from '../engine/fixture-files.js';
import { LiveTransport } from '../engine/transport.js';

export const EXIT = {
  ok: 0,
  /** Result produced but not clean: partial data with --strict, differences in compare, replay mismatch. */
  incomplete: 1,
  usage: 2,
  /** Transaction not found, pending, or unsupported. */
  notExplained: 3,
  /** Providers unavailable. */
  unavailable: 4,
  /** Input file invalid (recording, ABI, chain file, story JSON). */
  badInput: 5,
} as const;

class CliError extends Error {
  constructor(public code: keyof typeof EXIT, message: string) { super(message); }
}

interface Io { out: (s: string) => void; err: (s: string) => void; env: Record<string, string | undefined> }

/**
 * The command to show in suggestions. From a clone, `npm run -s txstory --`
 * works without a build or `npm link`; npm sets npm_lifecycle_event then.
 */
const selfCommand = (io: Io) => (io.env.npm_lifecycle_event === 'txstory' ? 'npm run -s txstory --' : 'txstory');

// ---------------------------------------------------------------- argument parsing

type Flags = Record<string, string[]>;
const BOOLEAN = new Set(['json', 'strict', 'no-trace', 'fast', 'help', 'version', 'exact', 'embed-story']);
const VALUE = new Set(['abi', 'rpc', 'explorer', 'chains', 'out', 'stage', 'recording', 'data', 'topics', 'timeout', 'kind']);

function parseArgs(argv: string[]): { positional: string[]; flags: Flags } {
  const positional: string[] = []; const flags: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--') { positional.push(...argv.slice(i + 1)); break; }
    if (a.startsWith('--')) {
      const [name, inline] = a.slice(2).split(/=(.*)/s, 2) as [string, string | undefined];
      if (BOOLEAN.has(name)) { flags[name] = ['true']; continue; }
      if (!VALUE.has(name)) throw new CliError('usage', `unknown option --${name}`);
      const v = inline ?? argv[++i];
      if (v === undefined) throw new CliError('usage', `--${name} needs a value`);
      (flags[name] ??= []).push(v);
    } else if (a === '-o') {
      const v = argv[++i]; if (v === undefined) throw new CliError('usage', '-o needs a file');
      (flags.out ??= []).push(v);
    } else if (a === '-h') flags.help = ['true'];
    else positional.push(a);
  }
  return { positional, flags };
}
const flag = (f: Flags, n: string) => f[n]?.[f[n]!.length - 1];
const has = (f: Flags, n: string) => !!f[n];

// ---------------------------------------------------------------- shared setup

function readJsonFile(path: string, what: string, maxBytes = 16 * 1024 * 1024): unknown {
  let size: number;
  try { size = statSync(path).size; } catch { throw new CliError('badInput', `${what}: cannot read ${path}`); }
  if (size > maxBytes) throw new CliError('badInput', `${what}: ${path} is larger than ${maxBytes} bytes`);
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch (e) { throw new CliError('badInput', `${what}: ${path} is not valid JSON (${e instanceof Error ? e.message : 'parse error'})`); }
}

function loadAbis(f: Flags): AssembleOptions['userAbi'] | undefined {
  const files = f.abi ?? [];
  if (!files.length) return undefined;
  const library = new AbiLibrary();
  const labels: Array<{ label: string; entries: number }> = [];
  for (const path of files) {
    const json = readJsonFile(path, 'ABI', 4 * 1024 * 1024);
    const label = path.split('/').pop() ?? path;
    try { labels.push({ label, entries: library.addJson(json, 'user', label) }); } catch (e) { throw new CliError('badInput', e instanceof Error ? e.message : 'invalid ABI'); }
  }
  return { library, labels };
}

function engineConfig(f: Flags, io: Io, network?: string): EngineConfig {
  const env = { ...io.env };
  // Explicit flags override the environment for the selected network.
  if (network && f.rpc) env[`TXSTORY_RPC_${network.toUpperCase().replace(/-/g, '_')}`] = f.rpc.join(',');
  if (network && f.explorer) env[`TXSTORY_EXPLORER_${network.toUpperCase().replace(/-/g, '_')}`] = flag(f, 'explorer');
  if (has(f, 'no-trace')) env.TXSTORY_TRACE = 'off';
  if (f.timeout) env.TXSTORY_TIMEOUT_MS = flag(f, 'timeout');
  try { return engineConfigFromEnv(env); } catch (e) { throw new CliError('usage', e instanceof Error ? e.message : 'invalid configuration'); }
}

function loadChains(f: Flags, io: Io) {
  const path = flag(f, 'chains') ?? io.env.TXSTORY_CHAINS_FILE;
  if (!path) return;
  try { loadChainFile(path); } catch (e) { throw new CliError('badInput', e instanceof Error ? e.message : 'invalid chain file'); }
}

function resolveTarget(positional: string[]): { network: string; hash: string } {
  if (positional.length === 1) {
    const p = parseLookupInput(positional[0]!);
    if (!p.ok) throw new CliError('usage', p.message);
    if (!p.chain) throw new CliError('usage', 'give the network first: txstory explain <network> <hash>');
    return { network: p.chain, hash: p.hash };
  }
  const [network, target] = positional as [string, string | undefined];
  if (!target) throw new CliError('usage', 'expected <network> <hash|explorer-link>');
  if (!isChainKey(network)) throw new CliError('usage', `unknown network "${network}". Known: ${chainKeys().join(', ')} (add more with --chains FILE)`);
  const p = parseLookupInput(target);
  if (!p.ok) throw new CliError('usage', p.message);
  if (p.chain && p.chain !== network) throw new CliError('usage', `the link is for ${p.chain}, not ${network}`);
  return { network, hash: p.hash };
}

function stageOf(f: Flags): 'fast' | 'full' {
  const s = has(f, 'fast') ? 'fast' : flag(f, 'stage') ?? 'full';
  if (s !== 'fast' && s !== 'full') throw new CliError('usage', '--stage must be fast or full');
  return s;
}

const live = (config: EngineConfig) => new LiveTransport({ timeoutMs: config.requestTimeoutMs, maxBytes: config.maxResponseBytes, userAgent: config.userAgent });

function resultExit(r: StoryResult, strict: boolean): number {
  if (r.kind === 'ok') {
    const s = r.story;
    // Facts must be complete; explorer comparisons (state changes, transfer list) are optional evidence.
    const c = s.completeness;
    const partial = c.nativeInternal !== 'complete' || c.tokenMetadata !== 'complete' || c.trace === 'partial'
      || s.sources.some((x) => x.status === 'error' && !x.method.startsWith('debug_traceTransaction'));
    return strict && partial ? EXIT.incomplete : EXIT.ok;
  }
  return r.kind === 'rpc-unavailable' ? EXIT.unavailable : EXIT.notExplained;
}

function json(io: Io, command: string, body: Record<string, unknown>) {
  io.out(JSON.stringify({ txstory: ENGINE_VERSION, command, ...body }, null, 2));
}

// ---------------------------------------------------------------- human rendering

function short(a: string | null | undefined) { return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : 'none'; }

export function renderStory(s: Story, exactAll = true): string {
  const L: string[] = [];
  const asset = (k: string) => s.assets[k];
  L.push(`${s.network.name} · ${s.hash}`);
  L.push(`${s.outcome === 'success' ? 'Succeeded' : 'REVERTED'} · block ${s.block.number}${s.block.timestamp ? ` · ${s.block.timestamp}` : ''} · ${s.mode} data · stage ${s.stage}`);
  if (s.revert) L.push(`Revert: ${s.revert.summary}`);
  L.push('');
  L.push('Interpretations (confidence in brackets):');
  for (const i of s.interpretations) {
    L.push(`  [${i.confidence}] ${i.headline}`);
    L.push(`      ${i.detail}`);
    for (const c of i.caveats) L.push(`      caveat: ${c}`);
  }
  L.push('');
  L.push('Net balance changes (exact):');
  for (const r of s.ledger) {
    const p = s.participants[r.address];
    const who = `${short(r.address)}${r.address === s.tx.from ? ' (sender)' : ''}${p?.labels[0] ? ` ${p.labels[0].text}` : ''}`;
    const a = asset(r.assetKey);
    const amount = a?.kind === 'erc721' ? `${r.delta} NFT${r.tokenIdsIn?.length ? ` in #${r.tokenIdsIn.join(',#')}` : ''}${r.tokenIdsOut?.length ? ` out #${r.tokenIdsOut.join(',#')}` : ''}` : amountExact(a, r.delta, { signed: true });
    const xc = s.crossCheck.rows.find((x) => x.address === r.address && x.assetKey === r.assetKey);
    L.push(`  ${who.padEnd(28)} ${amount}${xc ? `  [cross-check: ${xc.status}${xc.scope !== 'amount' && xc.scope !== 'none' ? ` by ${xc.scope}` : ''}]` : ''}`);
  }
  if (!s.ledger.length) L.push('  (none)');
  L.push('');
  L.push(`Fee: ${amountExact(asset('native'), s.fees.total)} paid by ${short(s.tx.from)}${s.fees.components.length ? ` (${s.fees.components.map((c) => `${c.label}: ${amountExact(asset('native'), c.amount)}`).join('; ')})` : ''}`);
  if (s.abiDecoding.call && s.abiDecoding.call.status !== 'empty') {
    const ok = s.abiDecoding.call.candidates.filter((c) => c.ok);
    L.push(`Call: ${s.abiDecoding.call.status}${ok.length ? ` ${ok.map((c) => `${c.signature} [${c.sources.map((x) => x.source).join('+')}]`).join(' | ')}` : ` selector ${s.abiDecoding.call.id ?? '?'}`}`);
  }
  L.push(`Trace: ${s.trace.status}${s.trace.provider ? ` via ${s.trace.provider}` : ''}${s.trace.frameCount ? ` · ${s.trace.frameCount} frames, ${s.trace.revertedFrames} failed, ${s.trace.valueMoves.filter((m) => !m.committed).length} rolled-back transfer(s)` : ''}`);
  L.push(`Completeness: ${Object.entries(s.completeness).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  L.push(`Cross-check: ${s.crossCheck.available ? `${s.crossCheck.summary.match} match, ${s.crossCheck.summary.mismatch} mismatch, ${s.crossCheck.summary.onlyTxStory} only TxStory, ${s.crossCheck.summary.onlyExplorer} only explorer, ${s.crossCheck.summary.notComparable} not comparable` : s.crossCheck.reason}`);
  if (s.warnings.length) { L.push('Warnings:'); for (const w of s.warnings) L.push(`  - ${w}`); }
  L.push(`Sources: ${s.sources.length} request(s), ${s.sources.filter((x) => x.status === 'error').length} failed. Use --json for the full evidence.`);
  void exactAll;
  return L.join('\n');
}

function renderDecode(r: DecodeResult & { panic?: string }): string {
  const L = [`status: ${r.status}${r.id ? ` (${r.id})` : ''}${r.note ? ` (${r.note})` : ''}`];
  for (const c of r.candidates) {
    L.push(`${c.ok ? 'fits' : 'rejected'}: ${c.signature}  [${c.sources.map((s) => `${s.source}: ${s.label}`).join('; ')}]${c.error ? `: ${c.error}` : ''}`);
    for (const p of c.params ?? []) L.push(`  ${(p.name ?? '?').padEnd(16)} ${p.type.padEnd(14)} ${typeof p.value === 'string' ? p.value : JSON.stringify(p.value)}`);
    if (c.notes.length) L.push(`  notes: ${c.notes.join('; ')}`);
  }
  if (r.panic) L.push(`panic: ${r.panic}`);
  if (r.status === 'decoded' || r.status === 'ambiguous') L.push('A fit shows the bytes are consistent with the ABI; it does not prove what the contract does.');
  return L.join('\n');
}

// ---------------------------------------------------------------- commands

const HELP = `txstory ${ENGINE_VERSION}: explain EVM transactions with evidence

From a clone, run commands as \`npm run -s txstory -- <command>\` (no build needed),
or \`node dist/node/cli/main.js <command>\` after \`npm run build\`. \`txstory\` below
is short for either; \`npm link\` makes it a real command.

Usage:
  txstory explain <network> <hash|explorer-link> [options]   analyse live
  txstory explain <explorer-link>                            network from the link
  txstory explain --recording <file> [options]               analyse offline from a recording
  txstory record <network> <hash> -o <file> [options]        analyse live and save a replayable recording
  txstory replay <file> [--json]                             rebuild offline; report same evidence / same output
  txstory compare <a> <b> [--json]                           explain differences (story JSON, --json output, or recordings)
  txstory decode calldata --data 0x… --abi <file>            decode with ABIs (also: log --topics t0,t1 --data 0x…; revert --data 0x…)
  txstory selector "<signature>" [--kind function|event|error]
  txstory networks [--chains <file>] [--json]

Options:
  --json               one JSON document on stdout (errors too)
  --stage fast|full    fast = RPC only; full (default) adds explorer + trace
  --no-trace           do not request debug_traceTransaction
  --abi <file>         JSON ABI (or list of signatures); repeatable; provenance "user"
  --rpc <url>          RPC endpoint for the network; repeatable (fallback order)
  --explorer <url|off> Blockscout v2 API base, or off
  --chains <file>      add networks from a chain file (e.g. a local devnet)
  --timeout <ms>       per-request timeout
  --strict             exit 1 when any data is partial or a source failed
  -o <file>            output file (record)
  --embed-story        record: also embed the output story (enables field-level replay diffs)

Exit codes: 0 ok · 1 incomplete/different · 2 usage · 3 not found/pending/unsupported · 4 providers unavailable · 5 invalid input file
Environment: TXSTORY_RPC_<NETWORK>, TXSTORY_EXPLORER_<NETWORK>, TXSTORY_BLOCKSCOUT_API_KEY, TXSTORY_CHAINS_FILE, TXSTORY_TRACE (see docs/cli.md)`;

async function cmdExplain(pos: string[], f: Flags, io: Io): Promise<number> {
  loadChains(f, io);
  const userAbi = loadAbis(f);
  let result: StoryResult; let target: { network: string; hash: string };
  if (f.recording) {
    const rec = await openRecording(flag(f, 'recording')!);
    target = { network: rec.chain, hash: rec.hash };
    result = await replayRecording(rec, engineConfig(f, io), { ...(userAbi ? { userAbi } : {}), ...(f.stage || f.fast ? { stage: stageOf(f) } : {}) });
  } else {
    target = resolveTarget(pos);
    const config = engineConfig(f, io, target.network);
    result = await analyzeTransaction(target.network, target.hash, live(config), config, { stage: stageOf(f), ...(userAbi ? { userAbi } : {}) });
  }
  const code = resultExit(result, has(f, 'strict'));
  if (has(f, 'json')) {
    json(io, 'explain', result.kind === 'ok'
      ? { ok: true, story: result.story }
      : { ok: false, error: { code: result.kind, message: result.message }, network: target.network, hash: target.hash, sources: result.sources });
  } else if (result.kind === 'ok') {
    io.out(renderStory(result.story));
  } else {
    io.err(`${result.kind}: ${result.message}`);
    for (const s of result.sources.filter((x) => x.status === 'error').slice(0, 6)) io.err(`  ${s.provider} ${s.method}: ${s.note ?? s.status} (${s.url})`);
  }
  return code;
}

async function openRecording(path: string): Promise<Recording> {
  try { return await readRecording(path); } catch (e) { throw new CliError('badInput', e instanceof Error ? e.message : 'invalid recording'); }
}

async function cmdRecord(pos: string[], f: Flags, io: Io): Promise<number> {
  loadChains(f, io);
  const out = flag(f, 'out');
  if (!out) throw new CliError('usage', 'record needs -o <file>');
  const target = resolveTarget(pos);
  const config = engineConfig(f, io, target.network);
  const userAbi = loadAbis(f);
  const { result, recording } = await recordAnalysis(target.network, target.hash, live(config), config, { stage: stageOf(f), embedStory: has(f, 'embed-story'), ...(userAbi ? { userAbi } : {}) });
  await writeRecording(out, recording);
  const summary = { file: out, exchanges: Object.keys(recording.exchanges).length, kind: result.kind, storySha256: recording.output?.storySha256 ?? null };
  if (has(f, 'json')) json(io, 'record', { ok: result.kind === 'ok', ...summary });
  else io.out(`Recorded ${summary.exchanges} provider exchange(s) to ${out} (${result.kind}). Replay offline with: ${selfCommand(io)} replay ${out}`);
  if (result.kind !== 'ok') io.err(`${result.kind}: ${result.message}`);
  return result.kind === 'ok' ? EXIT.ok : resultExit(result, false);
}

async function cmdReplay(pos: string[], f: Flags, io: Io): Promise<number> {
  const path = pos[0];
  if (!path) throw new CliError('usage', 'replay needs a recording file');
  loadChains(f, io);
  const rec = await openRecording(path);
  const userAbi = loadAbis(f);
  const { report, result } = await reconstruct(rec, engineConfig(f, io), userAbi ? { userAbi } : {});
  const check = report.check;
  // A difference caused only by --abi is the requested result, not a reproducibility failure.
  const differs = report.verdict === 'differs' && !report.differsOnlyByUserAbis;
  if (has(f, 'json')) {
    json(io, 'replay', { ok: result.kind === 'ok' && !differs, check, report, ...(result.kind === 'ok' ? { story: result.story } : { error: { code: result.kind, message: result.message } }) });
  } else {
    io.out(renderReport(report));
    if (result.kind === 'ok') io.out('\n' + renderStory(result.story));
    else io.err(`${result.kind}: ${result.message}`);
  }
  if (result.kind !== 'ok') return resultExit(result, false);
  return differs ? EXIT.incomplete : EXIT.ok;
}

/** Text form of a reconstruction report (the browser shows the same fields). */
function renderReport(r: ReconstructionReport): string {
  const rec = r.recording;
  const lines = [
    `Recording: ${rec.network} ${rec.hash} (${rec.schema}${rec.engineVersion ? `, recorded by TxStory ${rec.engineVersion}` : ''}; ${rec.exchanges.total} exchanges; offline replay)`,
    `Origin: ${rec.origin} · recorded ${rec.recordedAt}${rec.description ? ` · ${rec.description}` : ''}`,
    `Same evidence: ${r.check.sameEvidence ?? 'unknown (no recorded output)'} · Same output: ${r.check.sameOutput ?? 'unknown (no recorded output)'} · Rebuilt by TxStory ${r.engine.version}`,
  ];
  if (r.withoutUserAbis) lines.push(`Without your ABIs: same evidence ${r.withoutUserAbis.sameEvidence ?? 'unknown'} · same output ${r.withoutUserAbis.sameOutput ?? 'unknown'} · your ABIs ${r.userAbisChangedOutput ? 'changed' : 'did not change'} the output`);
  if (r.missing.length) lines.push(`Not in the recording (${r.missing.length}): ${r.missing.slice(0, 8).map((m) => `${m.provider} ${m.method}`).join('; ')}${r.missing.length > 8 ? '; …' : ''}`);
  if (r.differences) {
    lines.push(r.differences.summary);
    for (const d of r.differences.differences.slice(0, 20)) lines.push(`  ${d.area}: ${d.subject}: ${d.a ?? 'none'} → ${d.b ?? 'none'}${d.explanation ? ` (${d.explanation})` : ''}`);
  }
  if (r.verdict !== 'reproduced') for (const n of r.notes.slice(0, -1)) lines.push(`Note: ${n}`);
  return lines.join('\n');
}

/** A story from: a story JSON, `explain --json` / API output, a recording with an embedded story, or any recording (replayed offline). */
async function storyFromFile(path: string, f: Flags, io: Io): Promise<{ story: Story; how: string }> {
  const j = readJsonFile(path, 'compare input', 64 * 1024 * 1024) as Record<string, unknown>;
  const direct = (j.story ?? (j.schemaVersion !== undefined ? j : null)) as Story | null;
  if (direct && typeof direct === 'object' && Array.isArray(direct.ledger)) return { story: direct, how: 'story JSON' };
  const recJson = (j.recording ?? (j.exchanges ? j : null)) as unknown;
  if (recJson) {
    let rec: Recording;
    try { rec = validateRecording(recJson); } catch (e) { throw new CliError('badInput', `${path}: ${e instanceof Error ? e.message : 'invalid recording'}`); }
    if (rec.output?.story) return { story: rec.output.story, how: 'story embedded in recording' };
    const r = await replayRecording(rec, engineConfig(f, io));
    if (r.kind !== 'ok') throw new CliError('badInput', `${path}: replay produced ${r.kind}: ${r.message}`);
    return { story: r.story, how: 'recording replayed offline' };
  }
  throw new CliError('badInput', `${path}: no story found (expected a story, \`txstory explain --json\` output, an API response, or a recording)`);
}

async function cmdCompare(pos: string[], f: Flags, io: Io): Promise<number> {
  if (pos.length !== 2) throw new CliError('usage', 'compare needs two files');
  const a = await storyFromFile(pos[0]!, f, io); const b = await storyFromFile(pos[1]!, f, io);
  const c = compareStories(a.story, b.story);
  if (has(f, 'json')) json(io, 'compare', { ok: c.identical, inputs: [a.how, b.how], comparison: c });
  else {
    io.out(`A: ${pos[0]} (${a.how})\nB: ${pos[1]} (${b.how})`);
    io.out(c.summary);
    for (const d of c.differences) io.out(`- ${d.area}: ${d.subject}\n    A: ${d.a ?? 'none'}\n    B: ${d.b ?? 'none'}${d.delta ? `\n    B−A: ${d.delta}` : ''}${d.explanation ? `\n    ${d.explanation}` : ''}`);
  }
  return c.identical ? EXIT.ok : EXIT.incomplete;
}

async function cmdDecode(pos: string[], f: Flags, io: Io): Promise<number> {
  const what = pos[0];
  const lib = loadAbis(f)?.library ?? new AbiLibrary();
  const data = flag(f, 'data');
  if (!data) throw new CliError('usage', 'decode needs --data 0x…');
  let r: DecodeResult & { panic?: string };
  if (what === 'calldata') r = decodeCalldata(data, lib);
  else if (what === 'revert') r = decodeRevertData(data, lib);
  else if (what === 'log') {
    const topics = (flag(f, 'topics') ?? '').split(',').map((t) => t.trim()).filter(Boolean);
    if (!topics.every((t) => /^0x[0-9a-fA-F]{64}$/.test(t))) throw new CliError('usage', '--topics must be comma-separated 32-byte hex values');
    r = decodeEventLog({ topics, data }, lib);
  } else throw new CliError('usage', 'decode calldata|log|revert');
  if (has(f, 'json')) json(io, 'decode', { ok: r.status === 'decoded', result: r });
  else io.out(renderDecode(r));
  return r.status === 'decoded' ? EXIT.ok : EXIT.incomplete;
}

async function cmdSelector(pos: string[], f: Flags, io: Io): Promise<number> {
  const sig = pos.join(' ');
  if (!sig) throw new CliError('usage', 'selector needs a signature, e.g. "transfer(address,uint256)"');
  const kind = (flag(f, 'kind') ?? (sig.startsWith('event ') ? 'event' : sig.startsWith('error ') ? 'error' : 'function')) as 'function' | 'event' | 'error';
  let r: { signature: string; id: string };
  try { r = idOf(kind, sig); } catch (e) { throw new CliError('usage', e instanceof Error ? e.message : 'invalid signature'); }
  if (has(f, 'json')) json(io, 'selector', { ok: true, kind, ...r }); else io.out(`${r.id}  ${kind} ${r.signature}`);
  return EXIT.ok;
}

async function cmdNetworks(_pos: string[], f: Flags, io: Io): Promise<number> {
  loadChains(f, io);
  const config = engineConfig(f, io);
  const list = chainKeys().map((k) => {
    const c = getChain(k); const e = config.endpoints[k];
    return { key: k, name: c.name, chainId: c.chainId, builtin: c.builtin, feeModel: c.feeModel, rpc: e ? e.rpcs.map((r) => shareableUrlMapper(e, config.trustedEndpointUrls)(r.url)) : [], explorerApi: e?.explorerApi ? shareableUrlMapper(e, config.trustedEndpointUrls)(e.explorerApi) : null, trace: config.trace };
  });
  if (has(f, 'json')) json(io, 'networks', { ok: true, networks: list });
  else for (const n of list) io.out(`${n.key.padEnd(10)} ${String(n.chainId).padEnd(8)} ${n.name}${n.builtin ? '' : ' (custom)'}\n           rpc: ${n.rpc.join(', ') || '(none)'}\n           explorer: ${n.explorerApi ?? 'off'}`);
  return EXIT.ok;
}

export async function main(argv: string[], io: Io): Promise<number> {
  let jsonMode = false;
  try {
    const [command, ...rest] = argv;
    const { positional, flags } = parseArgs(rest);
    jsonMode = has(flags, 'json');
    if (!command || command === 'help' || command === '--help' || command === '-h' || has(flags, 'help')) { io.out(HELP); return command ? EXIT.ok : EXIT.usage; }
    if (command === '--version' || command === 'version') { io.out(ENGINE_VERSION); return EXIT.ok; }
    const commands: Record<string, (p: string[], f: Flags, io: Io) => Promise<number>> = {
      explain: cmdExplain, record: cmdRecord, replay: cmdReplay, compare: cmdCompare, decode: cmdDecode, selector: cmdSelector, networks: cmdNetworks,
    };
    const fn = commands[command];
    if (!fn) throw new CliError('usage', `unknown command "${command}" (try: txstory help)`);
    return await fn(positional, flags, io);
  } catch (e) {
    const err = e instanceof CliError ? e : new CliError('unavailable', e instanceof Error ? e.message : 'unexpected error');
    // Never echo URLs unredacted.
    const message = err.message.replace(/https?:\/\/[^\s"')]+/g, (u) => shareableLooseUrl(u));
    if (jsonMode) io.out(JSON.stringify({ txstory: ENGINE_VERSION, ok: false, error: { code: err.code, message } }, null, 2));
    io.err(`txstory: ${message}`);
    return EXIT[err.code];
  }
}

const invokedDirectly = (() => {
  try { return import.meta.url === new URL(`file://${process.argv[1]}`).href || process.argv[1]?.endsWith('/cli/main.js') || process.argv[1]?.endsWith('/cli/main.ts'); } catch { return false; }
})();
if (invokedDirectly) {
  // A closed pipe (e.g. `txstory … | head`) is a normal way for a consumer to stop reading.
  process.stdout.on('error', (e: NodeJS.ErrnoException) => { if (e.code === 'EPIPE') process.exit(process.exitCode ?? 0); throw e; });
  main(process.argv.slice(2), { out: (s) => process.stdout.write(s + '\n'), err: (s) => process.stderr.write(s + '\n'), env: process.env })
    .then((code) => { process.exitCode = code; });
}

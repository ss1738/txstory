/**
 * Engine configuration: which providers to ask, how long to wait, how much to
 * fetch. Shared by the HTTP server, the CLI and library users. The engine never
 * reads the process environment by itself; callers pass `env` explicitly.
 *
 * Node only (reads chain files). Browser-safe parts are in defaults.ts.
 */
import { readFileSync, statSync } from 'node:fs';
import { parseChainFile, type ChainKey } from '../core/chains.js';
import { engineConfigFromValues, read, registerCustomNetwork, type EngineConfig, type Env } from './defaults.js';

export * from './defaults.js';

const MAX_CHAIN_FILE_BYTES = 256 * 1024;

/** Load and register networks from a chain file. Returns the registered keys. */
export function loadChainFile(path: string): ChainKey[] {
  const size = statSync(path).size;
  if (size > MAX_CHAIN_FILE_BYTES) throw new Error(`chain file: larger than ${MAX_CHAIN_FILE_BYTES} bytes`);
  let json: unknown;
  try { json = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { throw new Error(`chain file: not valid JSON (${e instanceof Error ? e.message : 'parse error'})`); }
  const entries = parseChainFile(json);
  for (const e of entries) registerCustomNetwork(e.info, e.rpc, e.explorerApi);
  return entries.map((e) => e.info.key);
}

/** Build an engine configuration from explicit environment values (defaults for anything unset). */
export function engineConfigFromEnv(env: Env = {}, overrides: Partial<EngineConfig> = {}): EngineConfig {
  const chainsFile = read(env, 'TXSTORY_CHAINS_FILE');
  if (chainsFile) loadChainFile(chainsFile);
  return engineConfigFromValues(env, overrides);
}

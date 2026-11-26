/**
 * TxStory engine: the public, supported programmatic surface.
 *
 * Import from here (not from internal modules). Everything exported here is
 * documented in docs/engine.md. During 0.x, this surface may change between
 * minor versions; serialized formats are versioned independently
 * (story schemaVersion, recording schema, evidence bundle formatVersion).
 *
 *   import { analyzeTransaction, engineConfigFromEnv, LiveTransport } from './src/engine/index.js';
 */

// Analysis
export { analyzeTransaction, type AssembleOptions as AnalyzeOptions, type StoryResult } from './analyze.js';
export { engineConfigFromEnv, loadChainFile, endpointsFor, redactUrl, ENGINE_VERSION, type EngineConfig, type ChainEndpoints, type RpcEndpoint, type TraceMode } from './config.js';

// Transports (how the engine talks to providers)
export { LiveTransport, CachingTransport, type Transport, type TransportRequest, type TransportResponse } from './transport.js';

// Reproducibility
export { recordAnalysis, parseRecording, validateRecording, replayRecording, checkReplay, storyDigest, evidenceDigest, normalizedStory, RECORDING_SCHEMA_V3, type Recording, type ReplayCheck } from './recording.js';
export { readRecording, writeRecording } from './fixture-files.js';

// Pure domain (also usable in browsers)
export { compareStories, type Comparison, type Difference } from '../core/compare.js';
export { AbiLibrary, decodeCalldata, decodeEventLog, decodeRevertData, idOf, type AbiSource, type DecodeResult, type Candidate } from '../core/abi.js';
export { BUILTIN_DECODERS, builtinLibrary, libraryFor, type DecoderModule, type DecoderContext, type ModuleInterpretation } from '../core/decoders/index.js';
export { chainKeys, getChain, isChainKey, parseChainFile, registerChain, type ChainInfo, type ChainKey, type NetworkDescriptor } from '../core/chains.js';
export { parseLookupInput } from '../core/lookupInput.js';
export { STORY_SCHEMA_VERSION, type Story, type Interpretation, type Movement, type BalanceChange, type SourceRecord, type Completeness, type TraceSection, type AbiDecodingSection, type RevertSection } from '../core/types.js';

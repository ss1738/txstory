/**
 * OpenAPI 3.1 description of the HTTP API: the single route contract.
 * tests/unit/api-contract.test.ts checks the implementation against it
 * (every documented route/status is produced; every response carries the
 * documented required fields; undocumented /api/ routes return 404).
 * Field-level documentation of the Story object lives in docs/formats.md.
 */
import { ENGINE_VERSION } from '../engine/config.js';
import { STORY_SCHEMA_VERSION } from '../core/types.js';

const network = { name: 'network', in: 'path', required: true, schema: { type: 'string', pattern: '^[a-z][a-z0-9-]{1,31}$' }, description: 'Network key from /api/chains (built-in: ethereum, optimism, base, arbitrum; more via a chain file).' };
const hash = { name: 'hash', in: 'path', required: true, schema: { type: 'string', pattern: '^0x[0-9a-fA-F]{64}$' } };
const stage = { name: 'stage', in: 'query', required: false, schema: { type: 'string', enum: ['fast', 'full'], default: 'full' }, description: 'fast: RPC only, no explorer, no trace (quick first render). full: adds explorer data, the cross-check and the call trace.' };
const err = (description: string, headers?: Record<string, unknown>) => ({ description, ...(headers ? { headers } : {}), content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } });
const retryAfter = { 'Retry-After': { description: 'Seconds to wait before retrying.', schema: { type: 'integer' } } };

export const OPENAPI = {
  openapi: '3.1.0',
  info: {
    title: 'TxStory API',
    version: ENGINE_VERSION,
    description: 'Read-only API that explains EVM transactions with provenance. All routes are GET (HEAD also accepted). '
      + 'Live routes are rate limited per client and globally (429 + Retry-After) and admission-controlled (503 busy + Retry-After). '
      + 'A client disconnect does not cancel a build in progress: its result is cached briefly so a retry is cheap; every build has a wall-clock budget. '
      + 'Partial outcomes are explicit: a 200 story may carry `completeness` values other than "complete", `warnings`, and sources with status "error".',
    license: { name: 'Apache-2.0', identifier: 'Apache-2.0' },
  },
  paths: {
    '/api/health': {
      get: { summary: 'Liveness', responses: {
        200: { description: 'Serving.', content: { 'application/json': { schema: { type: 'object', required: ['ok', 'mode', 'draining'], properties: { ok: { const: true }, mode: { enum: ['live', 'recorded'] }, draining: { const: false } } } } } },
        503: { description: 'Draining for shutdown.', content: { 'application/json': { schema: { type: 'object', required: ['ok', 'draining'], properties: { ok: { const: false }, draining: { const: true } } } } } },
      } },
    },
    '/api/chains': {
      get: { summary: 'Configured networks and providers (provider names only, never URLs)', responses: {
        200: { description: 'Networks.', content: { 'application/json': { schema: { type: 'object', required: ['ok', 'mode', 'chains'], properties: { ok: { const: true }, mode: { enum: ['live', 'recorded'] }, chains: { type: 'array', items: { $ref: '#/components/schemas/Network' } } } } } } },
      } },
    },
    '/api/examples': {
      get: { summary: 'Recorded examples served by /api/example', responses: {
        200: { description: 'Examples.', content: { 'application/json': { schema: { type: 'object', required: ['ok', 'examples'], properties: { ok: { const: true }, examples: { type: 'array', items: { type: 'object', required: ['chain', 'hash', 'description', 'recordedAt', 'origin'], properties: { origin: { enum: ['captured', 'local-devnet', 'synthetic'], description: 'synthetic: generated responses, not real provider data' } } } } } } } } },
      } },
    },
    '/api/story/{network}/{hash}': {
      get: { summary: 'Explain a transaction (live providers, or recorded fixtures in recorded mode)', parameters: [network, hash, stage], responses: {
        200: { description: 'A story. Check completeness/warnings for partial data.', content: { 'application/json': { schema: { $ref: '#/components/schemas/StoryResponse' } } } },
        400: err('invalid-chain or invalid-hash.'),
        404: err('not-found: no such transaction on this network (or not recorded, in recorded mode).'),
        409: err('pending: known but not mined; retry later.'),
        422: err('unsupported: cannot be explained (e.g. pre-Byzantium receipt).'),
        429: err('rate-limited.', retryAfter),
        502: err('rpc-unavailable: every RPC endpoint failed.'),
        503: err('busy: no build slot became free in time, or the server is draining.', retryAfter),
      } },
    },
    '/api/example/{network}/{hash}': {
      get: { summary: 'Explain a recorded example (offline; always labelled recorded)', parameters: [network, hash, stage], responses: {
        200: { description: 'A story built only from the recording.', content: { 'application/json': { schema: { $ref: '#/components/schemas/StoryResponse' } } } },
        400: err('invalid-chain or invalid-hash.'),
        404: err('not-found: no recording for this transaction.'),
      } },
    },
    '/api/recording/{network}/{hash}': {
      get: { summary: 'A replayable recording (txstory-fixture-v3): every provider response used plus the output story', description: 'Replay offline with `txstory replay <file>`. In recorded mode, returns the stored fixture (older fixtures are schema v1/v2 and carry no output). Live builds count against the same limits as full stories.', parameters: [network, hash], responses: {
        200: { description: 'Recording.', content: { 'application/json': { schema: { type: 'object', required: ['ok', 'recording'], properties: { ok: { const: true }, recording: { $ref: '#/components/schemas/Recording' } } } } } },
        400: err('invalid-chain or invalid-hash.'),
        404: err('not-found (the body also includes the partial recording when live).'),
        409: err('pending.'), 422: err('unsupported.'), 429: err('rate-limited.', retryAfter), 502: err('rpc-unavailable.'), 503: err('busy.', retryAfter),
      } },
    },
    '/api/openapi.json': { get: { summary: 'This document', responses: { 200: { description: 'OpenAPI 3.1 document.' } } } },
  },
  components: {
    schemas: {
      Error: { type: 'object', required: ['ok', 'code', 'message'], properties: {
        ok: { const: false },
        code: { enum: ['invalid-chain', 'invalid-hash', 'not-found', 'pending', 'unsupported', 'rate-limited', 'rpc-unavailable', 'busy', 'unknown-route', 'method-not-allowed', 'internal'] },
        message: { type: 'string' },
        sources: { type: 'array', description: 'Requests made before the failure (redacted URLs).' },
      } },
      Network: { type: 'object', required: ['key', 'name', 'chainId', 'nativeSymbol', 'explorerUi', 'builtin', 'rpcProviders', 'explorerConfigured'] },
      StoryResponse: { type: 'object', required: ['ok', 'story'], properties: { ok: { const: true }, story: { $ref: '#/components/schemas/Story' } } },
      Story: {
        type: 'object', description: `Story schema version ${STORY_SCHEMA_VERSION}. Field reference: docs/formats.md. Integers are decimal strings (exact).`,
        required: ['schemaVersion', 'chain', 'network', 'hash', 'outcome', 'tx', 'block', 'fees', 'assets', 'participants', 'movements', 'ledger', 'crossCheck', 'logs', 'interpretations', 'completeness', 'trace', 'revert', 'abiDecoding', 'warnings', 'sources', 'generatedAt', 'mode', 'stage'],
        properties: { schemaVersion: { const: STORY_SCHEMA_VERSION }, outcome: { enum: ['success', 'reverted'] }, mode: { enum: ['live', 'recorded', 'synthetic', 'mixed'] }, stage: { enum: ['fast', 'full'] } },
      },
      Recording: { type: 'object', required: ['schema', 'chain', 'hash', 'exchanges'], properties: { schema: { enum: ['txstory-fixture-v1', 'txstory-fixture-v2', 'txstory-fixture-v3'] } } },
    },
  },
} as const;

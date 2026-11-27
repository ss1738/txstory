/**
 * Commands shown on the "Get started" page. This is the only copy in the
 * client; tests/unit/guide.test.ts runs the offline ones and checks that the
 * rest match the README and docs, so the page cannot drift from what works.
 */
export const QUICKSTART_RECORDING = 'fixtures/devnet/anvil-0xdce671e4526d6d277669b28b2a9108c3f291951eb893a8d716101d94a2640359.json';

export interface GuideStep {
  id: string;
  title: string;
  text: string;
  commands: string[];
  /** Runs offline from a fresh clone after `npm ci`; the test executes it. */
  offline?: boolean;
  doc?: string;
}

export const GUIDE: GuideStep[] = [
  {
    id: 'install',
    title: 'Install from source',
    text: 'Needs Node.js 22 or later and npm. No API keys or accounts. TxStory is not published to npm or a container registry; you run it from a clone.',
    commands: ['git clone https://github.com/ss1738/txstory.git', 'cd txstory', 'npm ci'],
  },
  {
    id: 'try',
    title: 'Rebuild an example offline',
    text: 'Replays a recording of a real execution on a local anvil devnet. No network access is used; the output says whether the rebuilt evidence and result match the recording.',
    commands: [`npm run -s txstory -- replay ${QUICKSTART_RECORDING}`],
    offline: true,
    doc: 'docs/cli.md',
  },
  {
    id: 'browser',
    title: 'Run the browser UI',
    text: 'Recorded mode serves only the example recordings and makes no provider requests. Without TXSTORY_MODE it looks transactions up live.',
    commands: ['npm run build', 'TXSTORY_MODE=recorded npm start   # http://127.0.0.1:8787'],
    doc: 'docs/self-hosting.md',
  },
  {
    id: 'live',
    title: 'Analyse a live transaction',
    text: 'Uses public RPC endpoints and Blockscout by default. Set TXSTORY_RPC_<NETWORK> to use your own node. Call traces need a node that offers debug_traceTransaction; without one the story says the trace is unavailable.',
    commands: [
      'npm run -s txstory -- explain ethereum 0x<transaction hash>',
      'TXSTORY_RPC_ETHEREUM=http://127.0.0.1:8545 npm run -s txstory -- explain ethereum 0x<transaction hash>',
    ],
    doc: 'docs/configuration.md',
  },
  {
    id: 'record',
    title: 'Record, share and rebuild',
    text: 'A recording holds every provider response one analysis used, with credentials removed from URLs. Rebuild it on any machine, or open it in the browser.',
    commands: [
      'npm run -s txstory -- record ethereum 0x<transaction hash> -o tx.json',
      'npm run -s txstory -- replay tx.json',
    ],
    doc: 'docs/formats.md',
  },
  {
    id: 'api',
    title: 'HTTP API',
    text: 'The server publishes its OpenAPI contract. Every response says where its data came from.',
    commands: [
      'curl -s http://127.0.0.1:8787/api/openapi.json',
      'curl -s "http://127.0.0.1:8787/api/story/ethereum/0x<transaction hash>?stage=full"',
    ],
    doc: 'docs/api.md',
  },
  {
    id: 'library',
    title: 'TypeScript library',
    text: 'Import from src/engine/index.ts. The example replays a devnet recording with an extra ABI and compares the two results.',
    commands: ['npx tsx examples/library/explain.ts'],
    offline: true,
    doc: 'docs/engine.md',
  },
  {
    id: 'extend',
    title: 'Add a decoder',
    text: 'Decoder modules recognise a contract, decode its calls and events, and add labelled interpretations. The example module decodes an event from the devnet contract; its test checks the fields against values read from the node. Run one test file while you work.',
    commands: ['npx tsx examples/decoder/split.ts', 'npx vitest run tests/unit/decoder-example.test.ts'],
    offline: true,
    doc: 'docs/extending.md',
  },
];

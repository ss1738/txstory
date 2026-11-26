import { useEffect, useRef } from 'react';
import { Home } from './components/Home.js';
import { OpenRecordingPage, ShippedExamplePage } from './components/Recording.js';
import { StartPage } from './components/Start.js';
import { StoryPage } from './components/StoryView.js';
import { REPOSITORY_URL, repoFile, STATIC_SITE } from './lib/site.js';
import { navigate, useRoute, type Route } from './router.js';

const TITLES: Record<Route['name'], string> = {
  home: 'TxStory: see what a transaction actually did',
  story: 'Transaction · TxStory',
  about: 'Method · TxStory',
  open: 'Open a recording · TxStory',
  start: 'Get started · TxStory',
  'not-found': 'Page not found · TxStory',
};

function NavLink({ to, current, children }: { to: string; current: boolean; children: React.ReactNode }) {
  return <a href={to} onClick={(e) => { e.preventDefault(); navigate(to); }} aria-current={current ? 'page' : undefined}>{children}</a>;
}

export function App() {
  const route = useRoute();
  useEffect(() => {
    document.title = route.name === 'story' ? `Transaction ${route.hash.slice(0, 10)}… · TxStory` : TITLES[route.name];
    window.scrollTo(0, 0);
  }, [route]);

  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <header className="site-header">
        <a className="brand" href="/" onClick={(e) => { e.preventDefault(); navigate('/'); }}>tx<span>story</span></a>
        <nav aria-label="Primary">
          <NavLink to="/" current={route.name === 'home'}>{STATIC_SITE ? 'Examples' : 'Lookup'}</NavLink>
          <NavLink to="/open" current={route.name === 'open'}>Open recording</NavLink>
          <NavLink to="/start" current={route.name === 'start'}>Get started</NavLink>
          <NavLink to="/about" current={route.name === 'about'}>Method</NavLink>
        </nav>
      </header>
      <main id="main">
        {route.name === 'home' && <Home />}
        {route.name === 'story' && (STATIC_SITE
          ? route.example
            ? <ShippedExamplePage key={`${route.chain}:${route.hash}`} chain={route.chain} hash={route.hash} focus={route.focus} />
            : <LiveNeedsInstall chain={route.chain} hash={route.hash} />
          : <StoryPage key={`${route.chain}:${route.hash}:${route.example}`} chain={route.chain} hash={route.hash} example={route.example} focus={route.focus} />)}
        {route.name === 'about' && <About />}
        {route.name === 'open' && <OpenRecordingPage />}
        {route.name === 'start' && <StartPage />}
        {route.name === 'not-found' && <NotFound />}
      </main>
      <footer className="site-footer">
        <span>txstory · read-only · <a href={REPOSITORY_URL}>source</a> · <a href={repoFile('SECURITY.md')}>security</a> · Apache-2.0</span>
        <span>{STATIC_SITE ? 'Examples are rebuilt in your browser from recordings shipped with this site.' : 'Chain data from the configured JSON-RPC nodes; labels and some evidence from Blockscout.'} Not cryptographically verified. Not financial or security advice.</span>
      </footer>
    </>
  );
}

function About() {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div className="page prose">
      <h1 ref={ref} tabIndex={-1}>Method</h1>
      <p>TxStory builds each story from two kinds of sources and keeps them apart:</p>
      <ol>
        <li><strong>Chain observations</strong> from JSON-RPC nodes: the transaction, its receipt, its block, and a call trace when the node offers <code>debug_traceTransaction</code>. TxStory decodes standard token events itself, and decodes calldata, logs, trace frames and revert data with built-in decoder modules and any ABIs you supply.</li>
        <li><strong>Explorer interpretations</strong> from Blockscout: address labels, token metadata, internal transactions and the explorer’s own balance-change calculation.</li>
      </ol>
      <p>The balance table nets every movement per address and asset, including the network fee. Native value moved inside execution comes from the call trace when one is available; transfers rolled back by a failed call are excluded. When the explorer answers, each row is compared with its independently computed change. Agreement shows that two pipelines read the provider data the same way. It is not a cryptographic proof: both rely on third-party infrastructure.</p>
      <h2>Recordings and rebuilding</h2>
      <p>A recording stores every provider response one analysis used. Rebuilding runs the analysis again on those responses and compares digests with the ones stored at recording time. It does not re-execute EVM code and does not verify chain history.</p>
      <h2>What TxStory does not do</h2>
      <ul>
        <li>It does not verify block headers, proofs or signatures; it trusts the RPC node and explorer.</li>
        <li>It does not simulate transactions.</li>
        <li>It does not identify owners, infer intent, or judge whether a transaction or token is safe. Explorer labels are shown as labels.</li>
        <li>Tokens that do not follow their standard (rebasing, fee-on-transfer, malicious) can make event-based balances differ from real balances. The explorer cross-check is there to surface such cases.</li>
        <li>Selector collisions and other ambiguous decodings are shown with every candidate, never resolved silently.</li>
      </ul>
      <h2>Networks</h2>
      <p>Ethereum, OP Mainnet, Base and Arbitrum One are built in. Other EVM networks can be added from a chain file without code changes. Explorer enrichment depends on the explorer answering; when it does not, stories are built from RPC data alone and say so.</p>
    </div>
  );
}

function LiveNeedsInstall({ chain, hash }: { chain: string; hash: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div className="page prose">
      <h1 ref={ref} tabIndex={-1} className="page-title">Live lookups run on your own machine</h1>
      <p>This site has no server, so it cannot fetch transactions. It does not ask for your RPC URL. To analyse this transaction, run TxStory locally:</p>
      <pre tabIndex={0} aria-label="Command"><code>{`npm run -s txstory -- explain ${chain} ${hash}`}</code></pre>
      <p><a href="/start" onClick={(e) => { e.preventDefault(); navigate('/start'); }}>Installation and setup</a> · <a href="/" onClick={(e) => { e.preventDefault(); navigate('/'); }}>Examples</a></p>
    </div>
  );
}

function NotFound() {
  return (
    <div className="page">
      <h1 className="page-title">Page not found</h1>
      <p><a href="/" onClick={(e) => { e.preventDefault(); navigate('/'); }}>Go to the lookup</a></p>
    </div>
  );
}

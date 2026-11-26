import { useEffect, useRef } from 'react';
import { Home } from './components/Home.js';
import { StoryPage } from './components/StoryView.js';
import { navigate, useRoute } from './router.js';

export function App() {
  const route = useRoute();
  useEffect(() => {
    document.title = route.name === 'story' ? `Transaction ${route.hash.slice(0, 10)}… · TxStory` : route.name === 'about' ? 'About · TxStory' : 'TxStory: see what a transaction actually did';
    window.scrollTo(0, 0);
  }, [route]);

  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <header className="site-header">
        <a className="brand" href="/" onClick={(e) => { e.preventDefault(); navigate('/'); }}>tx<span>story</span></a>
        <nav aria-label="Primary">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/'); }} aria-current={route.name === 'home' ? 'page' : undefined}>Lookup</a>
          <a href="/about" onClick={(e) => { e.preventDefault(); navigate('/about'); }} aria-current={route.name === 'about' ? 'page' : undefined}>Method</a>
        </nav>
      </header>
      <main id="main">
        {route.name === 'home' && <Home />}
        {route.name === 'story' && <StoryPage key={`${route.chain}:${route.hash}:${route.example}`} chain={route.chain} hash={route.hash} example={route.example} focus={route.focus} />}
        {route.name === 'about' && <About />}
        {route.name === 'not-found' && <NotFound />}
      </main>
      <footer className="site-footer">
        <span>txstory · read-only</span>
        <span>Chain data from public JSON-RPC nodes; labels and traces from Blockscout. Not cryptographically verified. Not financial or security advice.</span>
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
        <li><strong>Chain observations</strong>: the transaction, its receipt and its block, fetched from public JSON-RPC nodes. TxStory decodes standard events (ERC-20/721/1155 transfers, WETH deposits and withdrawals, common DEX swap events) from the receipt logs itself.</li>
        <li><strong>Explorer interpretations</strong>: from Blockscout: address labels, token names and decimals, native value moved inside execution (from its traces), decoded call data, and its own balance-change calculation.</li>
      </ol>
      <p>The balance table nets every movement per address, including the network fee split into the burned base fee and the priority fee. When the explorer is available, each row is compared with the explorer’s independently computed change. Agreement shows that two pipelines read the provider data the same way; it is not a cryptographic proof, because both rely on third-party infrastructure.</p>
      <h2>What TxStory does not do</h2>
      <ul>
        <li>It does not verify block headers or proofs; it trusts the RPC node.</li>
        <li>It does not simulate transactions or reconstruct full execution traces.</li>
        <li>It does not identify owners, infer intent, or judge whether a transaction or token is safe. Explorer labels are shown as labels.</li>
        <li>It decodes a fixed set of standard events; anything else is shown raw. Tokens that do not follow their standard (rebasing, fee-on-transfer, malicious) can make event-based balances differ from real balances. The explorer cross-check is there to surface such cases.</li>
      </ul>
      <h2>Supported networks</h2>
      <p>Ethereum, OP Mainnet, Base and Arbitrum One. Explorer enrichment depends on the explorer answering this server; when it does not, stories are built from RPC data alone and say so.</p>
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

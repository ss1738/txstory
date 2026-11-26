import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { ChainKey } from '../../core/chains.js';
import { fetchChains, fetchExamples, networkName, networks, type Example } from '../api.js';
import { parseLookupInput } from '../../core/lookupInput.js';
import { navigate, storyPath } from '../router.js';

const ORIGIN_TEXT = { captured: 'captured from providers', 'local-devnet': 'local devnet', synthetic: 'synthetic (not real data)' } as const;

export function Home() {
  const [chain, setChain] = useState<ChainKey>('ethereum');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'live' | 'recorded' | null>(null);
  const [nets, setNets] = useState(networks());
  const [examples, setExamples] = useState<Example[] | null>(null);
  const [exampleError, setExampleError] = useState(false);
  const inputId = useId();
  const errId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
    const ctrl = new AbortController();
    fetchChains(ctrl.signal).then((c) => { setMode(c.mode); setNets(networks()); }).catch(() => setMode(null));
    fetchExamples(ctrl.signal).then(setExamples).catch(() => setExampleError(true));
    return () => ctrl.abort();
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = parseLookupInput(value);
    if (!parsed.ok) { setError(parsed.message); return; }
    const c = parsed.chain ?? chain;
    if (parsed.chain && parsed.chain !== chain) setChain(parsed.chain);
    setError(null);
    navigate(storyPath(c, parsed.hash));
  };

  return (
    <div className="page home">
      <section className="hero">
        <p className="eyebrow">Read-only · no wallet · evidence attached</p>
        <h1 ref={headingRef} tabIndex={-1}>See what a transaction <em>actually</em> did.</h1>
        <p className="lede">Paste a transaction. TxStory decodes the receipt into who gained and lost what, replays how value moved, and shows the evidence behind every claim, including where it is uncertain.</p>
      </section>

      <form className="lookup" onSubmit={submit} noValidate aria-describedby={error ? errId : undefined}>
        <label htmlFor="network" className="sr-only">Network</label>
        <select id="network" value={chain} onChange={(e) => setChain(e.target.value as ChainKey)}>
          {nets.map((n) => <option key={n.key} value={n.key}>{n.name}</option>)}
        </select>
        <label htmlFor={inputId} className="sr-only">Transaction hash or explorer link</label>
        <input
          id={inputId} value={value} onChange={(e) => { setValue(e.target.value); if (error) setError(null); }}
          placeholder="0x… transaction hash, or an Etherscan/Blockscout link" autoComplete="off" spellCheck={false}
          aria-invalid={error ? true : undefined} aria-describedby={error ? errId : undefined} inputMode="text"
        />
        <button type="submit" className="btn-primary">Explain</button>
      </form>
      {error && <p id={errId} className="field-error" role="alert">{error}</p>}
      {mode === 'recorded' && <p className="banner banner-info">This server runs in <strong>recorded mode</strong>: only the saved examples below can be opened. Live lookups are disabled.</p>}

      <section className="examples" aria-labelledby="ex-h">
        <h2 id="ex-h">Start with an example</h2>
        <p className="small muted">Examples replay saved responses, so they load instantly and never change. Each one says where its data came from: a local devnet node (real execution on your own machine), synthetic responses written for testing (not real provider data), or recordings captured from public providers (only present if this server has them).</p>
        {exampleError && <p className="small warn-text">Examples could not be loaded.</p>}
        {!examples && !exampleError && <p className="small muted" role="status">Loading examples…</p>}
        <ul className="example-grid">
          {examples?.map((ex) => (
            <li key={`${ex.chain}-${ex.hash}`}>
              <a href={storyPath(ex.chain, ex.hash, true)} onClick={(e) => { e.preventDefault(); navigate(storyPath(ex.chain, ex.hash, true)); }}>
                <span className="eyebrow">{networkName(ex.chain)}</span>
                <span className="ex-title">{ex.description}</span>
                <span className="mono small muted">{ex.hash.slice(0, 10)}…{ex.hash.slice(-6)} · {ORIGIN_TEXT[ex.origin]} · {ex.recordedAt.slice(0, 10)}</span>
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className="legend" aria-labelledby="legend-h">
        <h2 id="legend-h">How to read a story</h2>
        <dl>
          <div><dt><span className="prov prov-derived">Decoded</span></dt><dd>Computed by TxStory from the RPC receipt: status, events, value, gas.</dd></div>
          <div><dt><span className="prov prov-explorer">Explorer</span></dt><dd>Reported by a block explorer: labels, token names, value moved inside execution, decoded call data.</dd></div>
          <div><dt><span className="prov prov-heuristic">Heuristic</span></dt><dd>A pattern match such as “exchange-like”. Useful, but it can be wrong.</dd></div>
          <div><dt><span className="xc xc-ok">✓ matches explorer</span></dt><dd>The explorer’s own balance calculation agrees exactly with TxStory’s. Agreement between providers is evidence, not proof.</dd></div>
        </dl>
        <p className="small muted">TxStory never asks for a wallet, never signs anything, and does not judge safety, intent, or identity.</p>
      </section>
    </div>
  );
}

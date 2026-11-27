import { useEffect, useRef } from 'react';
import { GUIDE } from '../lib/guide.js';
import { REPOSITORY_URL, repoFile } from '../lib/site.js';
import { navigate } from '../router.js';
import { CopyButton } from './common.js';

/** Install, use and extend TxStory. Commands come from lib/guide.ts (tested). */
export function StartPage() {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div className="page prose start">
      <h1 ref={ref} tabIndex={-1} className="page-title">Get started</h1>
      <p>
        TxStory runs on your machine: a command-line tool, a local web server with an HTTP API, and a TypeScript library, all on one
        analysis engine. It needs no account, wallet or API key, and it sends no telemetry.
      </p>
      <nav aria-label="On this page" className="toc">
        <ol>{GUIDE.map((s) => <li key={s.id}><a href={`#${s.id}`}>{s.title}</a></li>)}</ol>
      </nav>
      {GUIDE.map((s) => (
        <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`}>
          <h2 id={`${s.id}-h`}>{s.title}</h2>
          <p>{s.text}</p>
          <div className="code-block">
            <pre tabIndex={0} aria-label={`Commands: ${s.title}`}><code>{s.commands.join('\n')}</code></pre>
            <CopyButton value={s.commands.join('\n')} label="Copy" />
          </div>
          {s.doc && <p className="small"><a href={repoFile(s.doc)}>{s.doc}</a></p>}
        </section>
      ))}
      <section aria-labelledby="trust-h">
        <h2 id="trust-h">What to trust, and what not to</h2>
        <ul>
          <li>TxStory trusts the RPC nodes and explorer it asks. It does not verify block headers, proofs or signatures.</li>
          <li>Rebuilding from a recording reruns the analysis on recorded responses. It does not re-execute EVM code.</li>
          <li>Interpretations are labelled <em>decoded</em>, <em>heuristic</em> or <em>explorer</em>. Only the first follows from the data; the others can be wrong.</li>
          <li>Missing or partial data is reported in the story’s completeness flags, never filled in.</li>
        </ul>
        <p><a href="/about" onClick={(e) => { e.preventDefault(); navigate('/about'); }}>How a story is built</a></p>
      </section>
      <section aria-labelledby="contrib-h">
        <h2 id="contrib-h">Contribute or report a problem</h2>
        <ul>
          <li><a href={REPOSITORY_URL}>Source code on GitHub</a> (Apache-2.0)</li>
          <li><a href={repoFile('CONTRIBUTING.md')}>CONTRIBUTING.md</a>: setup, focused tests, fixture rules, compatibility rules</li>
          <li><a href={`${REPOSITORY_URL}/issues/new/choose`}>Open an issue</a> (the bug template says which diagnostics to include)</li>
          <li><a href={repoFile('SECURITY.md')}>Security reports</a> go through GitHub private vulnerability reporting, not public issues</li>
        </ul>
      </section>
    </div>
  );
}

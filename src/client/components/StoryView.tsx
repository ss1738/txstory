import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChainKey } from '../../core/chains.js';
import type { Interpretation, Story } from '../../core/types.js';
import { networkName, networks, type ApiError } from '../api.js';
import { gapConsequences } from '../lib/gaps.js';
import { buildEvidenceBundle, buildStoryCardSvg, download } from '../lib/exporters.js';
import { navigate, storyPath } from '../router.js';
import { useStory } from '../useStory.js';
import { modeText } from '../lib/dataMode.js';
import { Badge, CopyButton, ExplorerLink, StoryCtx, useStoryUi, type StoryUi } from './common.js';
import { Evidence } from './Evidence.js';
import { Flow } from './Flow.js';
import { Ledger } from './Ledger.js';

export function StoryPage({ chain, hash, example, focus }: { chain: ChainKey; hash: string; example: boolean; focus: string | null }) {
  const { state, retry } = useStory(chain, hash, example);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus(); }, [chain, hash]);

  if (state.status === 'loading') {
    return (
      <div className="page">
        <h1 ref={headingRef} tabIndex={-1} className="page-title">Reading the transaction…</h1>
        <p role="status" className="loading">Fetching the transaction, receipt and block from {networkName(chain)} {example ? '(recorded example)' : 'RPC nodes'}…</p>
        <div className="skeleton" aria-hidden="true"><div /><div /><div /></div>
      </div>
    );
  }
  if (state.status === 'error') return <ErrorState chain={chain} hash={hash} example={example} error={state.error} onRetry={retry} headingRef={headingRef} />;
  return <StoryLoaded story={state.story} loadingFull={state.status === 'partial'} enrichError={state.status === 'ready' ? state.enrichError : undefined} focus={focus} headingRef={headingRef} onRetry={retry} />;
}

function readExactPref(): boolean {
  try { return localStorage.getItem('txstory.exact') === '1'; } catch { return false; }
}

function StoryLoaded({ story, loadingFull, enrichError, focus, headingRef, onRetry }: { story: Story; loadingFull: boolean; enrichError?: string; focus: string | null; headingRef: React.RefObject<HTMLHeadingElement | null>; onRetry: () => void }) {
  // Transient source failures (timeouts, HTTP 5xx/429) can succeed on retry; recorded stories cannot change.
  // Replayed (recorded or synthetic) stories cannot change on retry.
  const retryable = (story.mode === 'live' || story.mode === 'mixed') && story.sources.some((s) => s.status === 'error');
  const [exact, setExactState] = useState(readExactPref);
  const [selected, setSelected] = useState<string | null>(focus && story.movements.some((m) => m.id === focus) ? focus : null);
  const [highlight, setHighlightState] = useState<Set<string>>(new Set());
  const setExact = useCallback((v: boolean) => {
    setExactState(v);
    try { localStorage.setItem('txstory.exact', v ? '1' : '0'); } catch { /* storage unavailable */ }
  }, []);
  const select = useCallback((id: string | null) => {
    setSelected(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('m', id); else url.searchParams.delete('m');
    history.replaceState(null, '', url.pathname + url.search);
  }, []);
  const setHighlight = useCallback((ids: string[]) => setHighlightState(new Set(ids)), []);
  const ui: StoryUi = useMemo(() => ({ story, exact, setExact, selected, select, highlight, setHighlight }), [story, exact, setExact, selected, select, highlight, setHighlight]);
  const chain = story.network;
  const lead = story.interpretations[0];
  // In the fast stage explorer data has not been requested yet; that is loading, not a gap.
  const gaps = story.stage === 'fast' ? [] : (Object.entries(story.completeness) as Array<[string, string]>).filter(([, v]) => v !== 'complete');

  return (
    <StoryCtx.Provider value={ui}>
      <div className="page story">
        <div className="story-strip">
          <span className="eyebrow">{chain.name}</span>
          <Badge tone={story.outcome === 'success' ? 'ok' : 'bad'}>{story.outcome === 'success' ? 'Succeeded' : 'Reverted'}</Badge>
          <span className="small muted">Block {story.block.number}{story.block.timestamp ? ` · ${formatTime(story.block.timestamp)}` : ''}</span>
          <Badge tone={story.mode === 'live' ? 'neutral' : story.mode === 'synthetic' ? 'warn' : 'info'} title={modeText(story).title}>{modeText(story).badge}</Badge>
        </div>

        <h1 ref={headingRef} tabIndex={-1} className="story-title">{lead?.headline ?? 'Transaction'}</h1>
        {lead && (
          <p className="story-title-kind small" data-testid="lead-kind">
            <ConfidenceBadge confidence={lead.confidence} /> <span className="muted">{CONFIDENCE_TEXT[lead.confidence].sentence}</span>
          </p>
        )}
        <div className="hash-row">
          <span className="mono wrap small">{story.hash}</span>
          <CopyButton value={story.hash} label="Copy hash" />
          <ExplorerLink kind="tx" value={story.hash}>View on explorer</ExplorerLink>
        </div>

        <div className="actions" role="group" aria-label="Share and export">
          <CopyButton value={window.location.origin + storyPath(story.chain, story.hash, story.mode !== 'live' && window.location.pathname.startsWith('/example/'))} label="Copy link" />
          <button type="button" className="btn-ghost btn-xs" onClick={() => download(`txstory-${story.chain}-${story.hash.slice(0, 10)}-evidence.json`, 'application/json', JSON.stringify(buildEvidenceBundle(story), null, 2))}>Download evidence (.json)</button>
          <button type="button" className="btn-ghost btn-xs" onClick={() => download(`txstory-${story.chain}-${story.hash.slice(0, 10)}.svg`, 'image/svg+xml', buildStoryCardSvg(story))}>Download story card (.svg)</button>
          <a className="btn-ghost btn-xs" href={`/api/recording/${story.chain}/${story.hash}`} download={`txstory-${story.chain}-${story.hash.slice(0, 10)}.recording.json`} title="Every provider response this analysis used; replay offline with `txstory replay <file>`">Download recording (.json)</a>
          <label className="toggle"><input type="checkbox" checked={exact} onChange={(e) => setExact(e.target.checked)} /> Exact amounts</label>
        </div>

        {loadingFull && <p className="banner banner-info" role="status"><span className="spinner" aria-hidden="true" /> Showing what the chain reports. Loading explorer labels, value moved inside execution, and the balance cross-check…</p>}
        {enrichError && <p className="banner banner-warn" role="status">The explorer cross-check could not be completed: {enrichError} The story below is shown without it. <button type="button" className="btn-ghost btn-xs" onClick={onRetry}>Retry</button></p>}
        {gaps.length > 0 && (
          <p className="banner banner-warn">
            <strong>Partial data.</strong> {gaps.map(([k, v]) => `${humanGap(k)}: ${v}`).join(' · ')}.
            {gapConsequences(gaps.map(([k]) => k), chain.nativeSymbol).map((c) => <span key={c}> {c}</span>)}
            {' '}<a href="#evidence">See evidence</a>
            {retryable && <> {' '}<button type="button" className="btn-ghost btn-xs" onClick={onRetry}>Retry missing explorer data</button></>}
          </p>
        )}

        <Interpretations />
        <Ledger />
        <Flow />
        <Evidence />
      </div>
    </StoryCtx.Provider>
  );
}

function Interpretations() {
  const { story, setHighlight, select } = useStoryUi();
  return (
    <section className="interps" aria-label="What happened">
      {story.interpretations.map((i, n) => (
        <article key={i.id} className={`interp interp-${i.confidence}`}>
          <div className="interp-head">
            {n === 0
              ? <h2><span className="eyebrow">Main interpretation</span><span className="sr-only">: {i.headline}</span></h2>
              : <h2>{i.headline}</h2>}
            <ConfidenceBadge confidence={i.confidence} />
          </div>
          <p>{i.detail}</p>
          {i.caveats.length > 0 && <ul className="caveats small">{i.caveats.map((c) => <li key={c}>{c}</li>)}</ul>}
          {i.evidence.length > 0 && (
            <button type="button" className="btn-ghost btn-xs" onClick={() => {
              setHighlight(i.evidence);
              const firstMove = story.movements.find((m) => i.evidence.includes(m.id) && !m.kind.startsWith('fee'));
              if (firstMove) select(firstMove.id);
              const target = document.getElementById(i.evidence.find((e) => e.startsWith('ledger:')) ?? '') ?? document.getElementById('flow-h');
              target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }}>Show evidence ({i.evidence.length})</button>
          )}
        </article>
      ))}
    </section>
  );
}


const CONFIDENCE_TEXT: Record<Interpretation['confidence'], { label: string; tone: 'ok' | 'info' | 'warn'; title: string; sentence: string }> = {
  decoded: { label: 'Decoded', tone: 'ok', title: 'Follows directly from receipt status or decoded standard events.', sentence: 'This headline follows directly from the receipt and decoded events.' },
  explorer: { label: 'Explorer', tone: 'info', title: 'Written by the block explorer; not verified by TxStory.', sentence: 'This headline is the explorer’s own wording; TxStory does not verify it.' },
  heuristic: { label: 'Heuristic', tone: 'warn', title: 'A pattern match that may be wrong.', sentence: 'This headline is a pattern-based interpretation, not a recorded fact. It may be wrong.' },
};

function ConfidenceBadge({ confidence }: { confidence: Interpretation['confidence'] }) {
  const t = CONFIDENCE_TEXT[confidence];
  return <Badge tone={t.tone} title={t.title}>{t.label}</Badge>;
}

function humanGap(k: string) {
  return ({ nativeInternal: 'internal native transfers', explorerTokenTransfers: 'explorer transfer list', stateChanges: 'explorer cross-check', tokenMetadata: 'token metadata', logs: 'logs', tokenTransfers: 'token transfers' } as Record<string, string>)[k] ?? k;
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function ErrorState({ chain, hash, example, error, onRetry, headingRef }: { chain: ChainKey; hash: string; example: boolean; error: ApiError; onRetry: () => void; headingRef: React.RefObject<HTMLHeadingElement | null> }) {
  const titles: Partial<Record<ApiError['code'], string>> = {
    'not-found': 'Transaction not found on this network',
    pending: 'This transaction has not been mined yet',
    'rpc-unavailable': 'The network’s RPC providers did not answer',
    'rate-limited': 'Too many lookups for now',
    busy: 'The server is busy',
    network: 'Could not reach TxStory',
    'invalid-hash': 'That is not a transaction hash',
    'invalid-chain': 'Unsupported network',
    unsupported: 'This transaction cannot be explained yet',
  };
  const retryable = ['pending', 'rpc-unavailable', 'rate-limited', 'busy', 'network', 'internal', 'bad-response'].includes(error.code);
  const others = networks().map((n) => n.key).filter((c) => c !== chain);
  return (
    <div className="page">
      <h1 ref={headingRef} tabIndex={-1} className="page-title">{titles[error.code] ?? 'Something went wrong'}</h1>
      <p role="alert" className="banner banner-bad">{error.message}{error.retryAfter ? ` (retry in ${error.retryAfter}s)` : ''}</p>
      <p className="mono small wrap muted">{networkName(chain)} · {hash}</p>
      <div className="actions">
        {retryable && <button type="button" className="btn-primary" onClick={onRetry}>Try again</button>}
        {error.code === 'not-found' && !example && (
          <>
            <span className="small">Try this hash on:</span>
            {others.map((c) => <button key={c} type="button" className="btn-ghost btn-xs" onClick={() => navigate(storyPath(c, hash))}>{networkName(c)}</button>)}
          </>
        )}
        <button type="button" className="btn-ghost" onClick={() => navigate('/')}>New lookup</button>
      </div>
      {error.sources.length > 0 && (
        <details className="sub-details">
          <summary>What TxStory asked ({error.sources.length} request{error.sources.length === 1 ? '' : 's'})</summary>
          <ul className="plain small">{error.sources.map((s) => <li key={s.id}><span className="mono">{s.method}</span>, {s.provider}, {s.status}{s.httpStatus ? ` (HTTP ${s.httpStatus})` : ''}{s.note ? `: ${s.note}` : ''}</li>)}</ul>
        </details>
      )}
    </div>
  );
}

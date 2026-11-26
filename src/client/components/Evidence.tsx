import { useRef, useState, type KeyboardEvent } from 'react';
import { checksumAddress } from '../../core/hex.js';
import type { Completeness, StoredDecode, TraceFrameView } from '../../core/types.js';
import { Address, Amount, Badge, CopyButton, ExplorerLink, useStoryUi } from './common.js';
import { modeText } from '../lib/dataMode.js';

const TABS = ['Completeness', 'Logs', 'Call data', 'Call trace', 'Participants', 'Sources'] as const;
type Tab = typeof TABS[number];

export function Evidence({ initialTab = 'Completeness' as Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const onKey = (e: KeyboardEvent) => {
    const i = TABS.indexOf(tab);
    const n = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : null;
    if (n === null) return;
    e.preventDefault();
    const t = TABS[(n + TABS.length) % TABS.length]!;
    setTab(t);
    refs.current[t]?.focus();
  };
  return (
    <section className="panel" aria-labelledby="ev-h" id="evidence">
      <div className="panel-head">
        <h2 id="ev-h">Evidence</h2>
        <p className="panel-sub">Everything above traces back to these records.</p>
      </div>
      <div className="tabs" role="tablist" aria-label="Evidence views" onKeyDown={onKey}>
        {TABS.map((t) => (
          <button key={t} ref={(el) => { refs.current[t] = el; }} role="tab" id={`tab-${slug(t)}`} aria-controls={`tp-${slug(t)}`} aria-selected={tab === t} tabIndex={tab === t ? 0 : -1} onClick={() => setTab(t)} type="button">{t}</button>
        ))}
      </div>
      <div className="tabpanel" role="tabpanel" id={`tp-${slug(tab)}`} aria-labelledby={`tab-${slug(tab)}`} tabIndex={0}>
        {tab === 'Completeness' && <CompletenessView />}
        {tab === 'Logs' && <LogsView />}
        {tab === 'Call data' && <CallDataView />}
        {tab === 'Call trace' && <TraceView />}
        {tab === 'Participants' && <ParticipantsView />}
        {tab === 'Sources' && <SourcesView />}
      </div>
    </section>
  );
}

const slug = (t: string) => t.toLowerCase().replace(/\s+/g, '-');

const COMPLETENESS_TEXT: Record<keyof Completeness, string> = {
  logs: 'Receipt logs (all events emitted), from the RPC receipt',
  tokenTransfers: 'Token movements decoded from those logs',
  nativeInternal: 'Native value moved inside execution (node call trace, or the explorer’s internal transactions)',
  explorerTokenTransfers: 'Explorer’s own token-transfer list (used for comparison)',
  stateChanges: 'Explorer state changes (used for the balance cross-check)',
  tokenMetadata: 'Token symbols and decimals',
  trace: 'Call trace (debug_traceTransaction from a configured RPC)',
};

function CompletenessView() {
  const { story } = useStoryUi();
  return (
    <div>
      <ul className="completeness">
        {(Object.keys(COMPLETENESS_TEXT) as Array<keyof Completeness>).map((k) => {
          const v = story.completeness[k];
          return (
            <li key={k}>
              <Badge tone={v === 'complete' ? 'ok' : v === 'partial' ? 'warn' : 'neutral'}>{v}</Badge> {COMPLETENESS_TEXT[k]}
              {k === 'stateChanges' && story.stage === 'fast' ? <span className="small muted"> (still loading)</span> : null}
            </li>
          );
        })}
      </ul>
      {story.crossCheck.available ? (
        <p className="small">
          Cross-check: <strong>{story.crossCheck.summary.match}</strong> balance change(s) match the explorer exactly,{' '}
          <strong>{story.crossCheck.summary.mismatch}</strong> differ, {story.crossCheck.summary.onlyTxStory} only TxStory, {story.crossCheck.summary.onlyExplorer} only explorer, {story.crossCheck.summary.notComparable} not comparable.
          {' '}Scope: {scopeSummary(story.crossCheck.rows)}.
          {' '}Agreement means two independent pipelines read the same provider data the same way. It is not a cryptographic proof.
        </p>
      ) : <p className="small muted">Cross-check: {story.crossCheck.reason}</p>}
      {story.warnings.length > 0 && (
        <>
          <h3>Warnings</h3>
          <ul className="warnings">{story.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </>
      )}
    </div>
  );
}

function scopeSummary(rows: Array<{ scope: string; status: string }>) {
  const n = (scope: string) => rows.filter((r) => r.scope === scope && r.status !== 'not-comparable').length;
  const parts = [
    n('amount') ? `${n('amount')} compared by exact amount` : '',
    n('token-ids') ? `${n('token-ids')} NFT row(s) compared by token id` : '',
    n('count') ? `${n('count')} NFT row(s) compared by count only (ids not checked)` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : 'no comparable rows';
}

const SOURCE_TEXT = { builtin: 'Built-in ABI', user: 'User ABI', signature: 'Signature only' } as const;

/** One decode outcome: status, candidates, provenance, parameters. Ambiguity is shown, never resolved. */
export function DecodeView({ d, compact = false }: { d: StoredDecode; compact?: boolean }) {
  const ok = d.candidates.filter((c) => c.ok);
  if (d.status === 'no-match') return <span className="small muted">No ABI entry for {d.id ?? 'this'}</span>;
  return (
    <div className="decode">
      {d.status === 'ambiguous' && <p className="small warn-text">Ambiguous: {ok.length} signatures fit these bytes. TxStory does not choose between them.</p>}
      {d.status === 'no-valid-candidate' && <p className="small warn-text">Selector {d.id} is known, but the bytes do not fit: {d.candidates.map((c) => `${c.signature}: ${c.error}`).join('; ')}</p>}
      {(d.status === 'empty' || d.status === 'malformed') && <p className="small muted">{d.note ?? d.status}</p>}
      {ok.map((c) => (
        <div key={c.signature} className="candidate">
          <span className="mono wrap">{c.signature}</span>{' '}
          {c.sources.map((src) => <span key={src.label} className="label-chip" title={`ABI source: ${src.label}`}>{SOURCE_TEXT[src.source]}: {src.label}</span>)}
          {!compact && c.params && c.params.length > 0 && (
            <div className="table-wrap">
              <table className="params"><thead><tr><th scope="col">Name</th><th scope="col">Type</th><th scope="col">Value</th></tr></thead>
                <tbody>{c.params.map((p, i) => <tr key={i}><td className="mono">{p.name ?? `#${i}`}</td><td className="mono">{p.type}{p.indexedHashOnly ? ' (indexed: hash only)' : ''}</td><td className="mono wrap small">{typeof p.value === 'string' ? p.value : JSON.stringify(p.value)}</td></tr>)}</tbody>
              </table>
            </div>
          )}
          {c.notes.length > 0 && <div className="small muted">{c.notes.join(' · ')}</div>}
        </div>
      ))}
      <p className="small muted">A successful decode shows the bytes are consistent with this ABI. It does not show what the contract actually does.</p>
    </div>
  );
}

function LogsView() {
  const { story } = useStoryUi();
  const abiByLog = new Map(story.abiDecoding.logs.map((l) => [l.logIndex, l]));
  const [limit, setLimit] = useState(60);
  if (!story.logs.length) return <p className="empty">This transaction emitted no events.</p>;
  const undecoded = story.logs.filter((l) => !l.decoded).length;
  return (
    <div>
      <p className="small muted">{story.logs.length} log(s); {story.logs.length - undecoded} decoded locally from known event signatures{undecoded ? `, ${undecoded} not decoded (unknown or non-standard events, shown raw)` : ''}. Explorer-decoded names are shown when available and marked as such.</p>
      <div className="table-wrap">
        <table className="logs">
          <thead><tr><th scope="col">Log</th><th scope="col">Emitted by</th><th scope="col">Event</th><th scope="col">Raw</th></tr></thead>
          <tbody>
            {story.logs.slice(0, limit).map((l) => (
              <tr key={l.logIndex} id={`log:${l.logIndex}`}>
                <td className="mono">{l.logIndex}</td>
                <td><Address address={l.contract} /></td>
                <td>
                  {l.label ? <span>{l.label}{l.summary ? ` (${l.summary})` : ''} <span className="prov prov-derived">Decoded</span></span> : <span className="muted">Unknown event</span>}
                  {l.problem && <div className="small warn-text">Not counted: {l.problem}</div>}
                  {l.explorerName && <div className="small"><span className="prov prov-explorer">Explorer</span> <span className="mono wrap">{l.explorerName}</span></div>}
                  {abiByLog.has(l.logIndex) && <details className="small"><summary>ABI-decoded parameters</summary><DecodeView d={abiByLog.get(l.logIndex)!} /></details>}
                </td>
                <td>
                  <details>
                    <summary>topics &amp; data</summary>
                    <ol className="raw mono small" start={0}>{l.raw.topics.map((t, i) => <li key={i}>{t}</li>)}</ol>
                    <p className="raw mono small wrap">{l.raw.data.length > 2 ? l.raw.data : '(no data)'}</p>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {story.logs.length > limit && <button type="button" className="btn-ghost" onClick={() => setLimit((n) => n + 200)}>Show more logs ({story.logs.length - limit} remaining)</button>}
    </div>
  );
}

function CallDataView() {
  const { story } = useStoryUi();
  const d = story.tx.decodedInput;
  return (
    <div>
      <dl className="kv">
        <dt>Called</dt><dd>{story.tx.to ? <Address address={story.tx.to} /> : <span>Contract creation{story.tx.createdContract ? <> → <Address address={story.tx.createdContract} /></> : null}</span>}</dd>
        <dt>Function selector</dt><dd className="mono">{story.tx.inputSelector ?? '(none: plain value transfer or fallback)'}</dd>
        <dt>Input size</dt><dd>{story.tx.inputBytes.toLocaleString('en-US')} bytes</dd>
        <dt>Method</dt><dd>{story.tx.method ? <>{story.tx.method.name} <span className="prov prov-explorer">Explorer</span></> : <span className="muted">not decoded (explorer unavailable or contract source not verified)</span>}</dd>
        <dt>Nonce · type</dt><dd className="mono">{story.tx.nonce} · {story.tx.type}</dd>
      </dl>
      {d ? (
        <>
          <p className="small">Decoded by the explorer: <span className="mono wrap">{d.call}</span> <span className="prov prov-explorer">Explorer</span></p>
          {d.parameters.length > 0 && (
            <div className="table-wrap">
              <table className="params"><thead><tr><th scope="col">Name</th><th scope="col">Type</th><th scope="col">Value</th></tr></thead>
                <tbody>{d.parameters.map((p, i) => <tr key={i}><td className="mono">{p.name || '(unnamed)'}</td><td className="mono">{p.type}</td><td className="mono wrap small">{p.value}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
      <h3>ABI decoding</h3>
      {story.abiDecoding.call ? <DecodeView d={story.abiDecoding.call} /> : <p className="small muted">No calldata.</p>}
      <p className="small muted">ABIs used: {story.abiDecoding.libraries.map((l) => `${l.label} (${l.source}, ${l.entries} entries)`).join('; ')}. Supply a contract’s ABI with the CLI (<span className="mono">txstory explain --abi file.json</span>) to decode more.</p>
    </div>
  );
}

function TraceView() {
  const { story } = useStoryUi();
  const [limit, setLimit] = useState(150);
  const t = story.trace;
  if (t.status === 'not-requested' || t.status === 'unavailable') {
    return (
      <div>
        <p><Badge tone="neutral">{t.status}</Badge> {t.note}</p>
        <p className="small muted">Traces need an RPC endpoint that offers <span className="mono">debug_traceTransaction</span> with the callTracer (for example your own Geth/Reth/Erigon/Anvil node, or some public providers). Without one, native value inside execution comes from the explorer if it answers.</p>
      </div>
    );
  }
  const moves = t.valueMoves;
  return (
    <div>
      <p className="small">
        {t.frameCount} call frame(s), maximum depth {t.maxDepth}, {t.revertedFrames} failed frame(s). Source: {t.provider} <span className="prov prov-chain">Chain</span>.
        {' '}{moves.filter((m) => m.committed).length} native transfer(s) inside execution were committed{moves.some((m) => !m.committed) ? `; ${moves.filter((m) => !m.committed).length} were rolled back and are not balance changes` : ''}.
        {t.note ? ` ${t.note}` : ''}
      </p>
      {story.revert && <p className="banner banner-warn">Top-level revert: <span className="mono wrap">{story.revert.summary}</span></p>}
      <ol className="trace">
        {t.frames.slice(0, limit).map((f) => <TraceRow key={f.id} f={f} />)}
      </ol>
      {t.frames.length > limit && <button type="button" className="btn-ghost" onClick={() => setLimit((n) => n + 300)}>Show more frames ({t.frames.length - limit} remaining)</button>}
    </div>
  );
}

function TraceRow({ f }: { f: TraceFrameView }) {
  return (
    <li className={`frame${f.undone ? ' undone' : ''}`} style={{ marginLeft: `${Math.min(f.depth, 12) * 14}px` }}>
      <span className="mono small">{f.id}</span> <Badge tone={f.reverted ? 'bad' : 'neutral'}>{f.type}</Badge>{' '}
      <Address address={f.from} /> → {f.to ? <Address address={f.to} /> : <span className="muted">(no target)</span>}
      {f.value !== '0' && <> · <Amount assetKey="native" raw={f.value} /></>}
      {f.call && f.call.signatures.length > 0 && <span className="mono small"> · {f.call.signatures.join(' | ')}{f.call.status === 'ambiguous' ? ' (ambiguous)' : ''}</span>}
      {f.error && <div className="small warn-text">Failed: {f.error}{f.revert ? `. Revert data: ${f.revert.summary}` : ''}</div>}
      {f.undone && !f.reverted && <div className="small">Rolled back by a failed ancestor call.</div>}
      {f.reverted && f.value !== '0' && <div className="small">This call's value transfer was rolled back (not a balance change).</div>}
    </li>
  );
}

function ParticipantsView() {
  const { story } = useStoryUi();
  const list = Object.values(story.participants);
  return (
    <div>
      <p className="small muted">Labels and flags come from the explorer. They are not verified identities, and they say nothing about intent.</p>
      <ul className="participants">
        {list.map((p) => (
          <li key={p.address}>
            <div><span className="mono wrap">{checksumAddress(p.address)}</span> <CopyButton value={checksumAddress(p.address)} /> <ExplorerLink kind="address" value={p.address} /></div>
            <div className="small">
              {p.roles.join(' · ')}
              {' · '}{p.isContract === null ? 'contract status unknown' : p.isContract ? 'contract' : 'externally owned account'}
              {p.isContractSource !== 'unknown' ? <span className="muted"> ({p.isContractSource === 'rpc' ? 'eth_getCode' : 'explorer'})</span> : null}
            </div>
            {(p.labels.length > 0 || p.ens) && (
              <div className="small">{p.ens && <span className="label-chip" title="ENS name reported by the explorer">{p.ens}</span>}{p.labels.map((l) => <span key={l.text} className="label-chip" title="Explorer label, not verified">{l.text}{l.altered ? ' ⚠' : ''}</span>)}</div>
            )}
            {p.explorerFlags.length > 0 && <ul className="small flags">{p.explorerFlags.map((f) => <li key={f}>{f}</li>)}</ul>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SourcesView() {
  const { story } = useStoryUi();
  return (
    <div>
      <p className="small">
        {modeText(story).sources}{' '}
        SHA-256 digests identify the exact bodies used. Provider responses are trusted as reported; nothing here is a cryptographic proof.
      </p>
      <div className="table-wrap">
        <table className="sources">
          <thead><tr><th scope="col">Request</th><th scope="col">Provider</th><th scope="col">Status</th><th scope="col">Retrieved</th><th scope="col">SHA-256</th></tr></thead>
          <tbody>
            {story.sources.map((s) => (
              <tr key={s.id}>
                <td><span className="mono small wrap">{s.method}</span><div className="small muted wrap">{s.url}</div>{s.note && <div className="small warn-text">{s.note}</div>}</td>
                <td className="small">{s.provider}<div className="muted">{s.kind === 'rpc' ? 'JSON-RPC' : 'Explorer API'} · {s.mode}</div></td>
                <td><Badge tone={s.status === 'ok' ? 'ok' : s.status === 'empty' ? 'neutral' : s.status === 'partial' ? 'warn' : 'bad'}>{s.status}{s.httpStatus ? ` · ${s.httpStatus}` : ''}</Badge></td>
                <td className="small mono">{s.retrievedAt.replace('T', ' ').slice(0, 19)}</td>
                <td className="small mono">{s.sha256 ? <>{s.sha256.slice(0, 12)}… <CopyButton value={s.sha256} /></> : 'none'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

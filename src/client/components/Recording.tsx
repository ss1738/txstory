import { useEffect, useRef, useState, type DragEvent } from 'react';
import type { ReconstructionReport } from '../../engine/reconstruct.js';
import type { Reconstruction } from '../lib/replay.js';
import { navigate } from '../router.js';
import { Badge } from './common.js';
import { StoryLoaded } from './StoryView.js';

type ReplayModule = typeof import('../lib/replay.js');
/** The engine is loaded only when a recording is opened. */
const loadReplay = (): Promise<ReplayModule> => import('../lib/replay.js');

type Load =
  | { status: 'idle' }
  | { status: 'working'; label: string }
  | { status: 'done'; value: Reconstruction; name: string }
  | { status: 'error'; message: string };

const errorText = (e: unknown) => (e instanceof Error ? e.message : 'unknown error');

/** "Open a recording": rebuild a story from a local file, in this browser. */
export function OpenRecordingPage() {
  const [load, setLoad] = useState<Load>({ status: 'idle' });
  const [dragging, setDragging] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { headingRef.current?.focus(); }, []);

  const open = async (file: File | undefined) => {
    if (!file) return;
    setLoad({ status: 'working', label: `Rebuilding ${file.name}…` });
    try {
      const m = await loadReplay();
      setLoad({ status: 'done', value: await m.reconstructFile(file), name: file.name });
    } catch (e) {
      setLoad({ status: 'error', message: `${file.name}: ${errorText(e)}` });
    }
  };
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDragging(false); void open(e.dataTransfer.files[0]); };

  if (load.status === 'done') {
    return <ReconstructedStory value={load.value} sourceLabel={`File: ${load.name}`} recordingHref={null} onReset={() => { setLoad({ status: 'idle' }); }} />;
  }
  return (
    <div className="page prose">
      <h1 ref={headingRef} tabIndex={-1} className="page-title">Open a recording</h1>
      <p>
        A recording is a JSON file with every provider response one analysis used. Make one with <code>txstory record</code>,
        or with “Download recording” on a story page. Opening it here runs TxStory’s analysis again on those responses, in this
        browser, and checks the result against the digests stored in the file.
      </p>
      <p className="banner banner-info" data-testid="privacy-note">
        <strong>The file stays on this device.</strong> It is read by this page and is not uploaded. Rebuilding makes no network requests:
        a request the recording cannot answer is shown as missing data, never fetched.
      </p>
      <div
        className={`dropzone${dragging ? ' dropzone-active' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <label htmlFor="recording-file" className="btn-primary">Choose a recording file</label>
        <input ref={inputRef} id="recording-file" className="sr-only" type="file" accept=".json,application/json" onChange={(e) => { void open(e.target.files?.[0]); e.target.value = ''; }} />
        <span className="small muted">or drop it here · JSON, up to 64 MB</span>
      </div>
      {load.status === 'working' && <p role="status" className="loading"><span className="spinner" aria-hidden="true" /> {load.label}</p>}
      {load.status === 'error' && <p role="alert" className="banner banner-bad" data-testid="open-error">This file cannot be opened. {load.message}</p>}
      <h2>What this does and does not show</h2>
      <ul>
        <li><strong>Rebuilds the analysis</strong> from the recorded raw responses with the engine version shown on the result. It does not display a stored result.</li>
        <li><strong>Compares digests:</strong> whether the rebuilt evidence and output equal what the recording stored when it was made.</li>
        <li><strong>Does not re-execute EVM code</strong> and <strong>does not verify chain history</strong>. The recorded responses are trusted as they were captured.</li>
      </ul>
      <p className="small muted">The same check runs on the command line: <code>txstory replay &lt;file&gt;</code>.</p>
    </div>
  );
}

/** A shipped example recording, rebuilt in the browser (static site). */
export function ShippedExamplePage({ chain, hash, focus }: { chain: string; hash: string; focus: string | null }) {
  const [load, setLoad] = useState<Load>({ status: 'working', label: 'Rebuilding the example from its recording…' });
  const [attempt, setAttempt] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const path = `/recordings/${chain}-${hash}.json`;
  useEffect(() => {
    const ctrl = new AbortController();
    setLoad({ status: 'working', label: 'Rebuilding the example from its recording…' });
    loadReplay()
      .then((m) => m.reconstructShipped(path, ctrl.signal))
      .then((value) => { if (!ctrl.signal.aborted) setLoad({ status: 'done', value, name: path }); })
      .catch((e: unknown) => { if (!ctrl.signal.aborted) setLoad({ status: 'error', message: errorText(e) }); });
    return () => ctrl.abort();
  }, [path, attempt]);
  useEffect(() => { if (load.status !== 'done') headingRef.current?.focus(); }, [load.status]);

  if (load.status === 'done') return <ReconstructedStory value={load.value} sourceLabel="Example shipped with this site" recordingHref={path} focus={focus} />;
  return (
    <div className="page">
      <h1 ref={headingRef} tabIndex={-1} className="page-title">{load.status === 'error' ? 'This example could not be opened' : 'Rebuilding the example…'}</h1>
      {load.status === 'working' && <><p role="status" className="loading">{load.label}</p><div className="skeleton" aria-hidden="true"><div /><div /><div /></div></>}
      {load.status === 'error' && (
        <>
          <p role="alert" className="banner banner-bad">{load.message}</p>
          <div className="actions">
            <button type="button" className="btn-primary" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
            <button type="button" className="btn-ghost" onClick={() => navigate('/')}>All examples</button>
          </div>
        </>
      )}
    </div>
  );
}

function ReconstructedStory({ value, sourceLabel, recordingHref, focus = null, onReset }: { value: Reconstruction; sourceLabel: string; recordingHref: string | null; focus?: string | null; onReset?: () => void }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus(); }, [value]);
  const { report, result } = value;
  const panel = <ReconstructionPanel report={report} sourceLabel={sourceLabel} onReset={onReset} />;
  if (result.kind !== 'ok') {
    return (
      <div className="page">
        <h1 ref={headingRef} tabIndex={-1} className="page-title">No story from this recording</h1>
        {panel}
      </div>
    );
  }
  return <StoryLoaded story={result.story} loadingFull={false} focus={focus} headingRef={headingRef} onRetry={() => undefined} links={{ share: null, recording: recordingHref }} before={panel} />;
}

const VERDICT: Record<ReconstructionReport['verdict'], { tone: 'ok' | 'warn' | 'bad' | 'neutral'; label: string }> = {
  reproduced: { tone: 'ok', label: 'Reproduced' },
  differs: { tone: 'bad', label: 'Differs from the recording' },
  'no-digest': { tone: 'neutral', label: 'Nothing to compare with' },
  'no-story': { tone: 'warn', label: 'No story produced' },
};

export function ReconstructionPanel({ report, sourceLabel, onReset }: { report: ReconstructionReport; sourceLabel: string; onReset?: (() => void) | undefined }) {
  const r = report.recording;
  const v = VERDICT[report.verdict];
  const yesNo = (b: boolean | null) => (b === null ? 'not stored' : b ? 'same' : 'different');
  return (
    <section className="panel reconstruction" aria-labelledby="recon-h" data-testid="reconstruction">
      <div className="panel-head">
        <h2 id="recon-h">Rebuilt from a recording</h2>
        <Badge tone={v.tone}>{v.label}</Badge>
      </div>
      <p className="small">{report.notes[0]}</p>
      <dl className="kv recon-kv">
        <div><dt>Source</dt><dd>{sourceLabel}</dd></div>
        <div><dt>Origin</dt><dd>{ORIGIN[r.origin]}</dd></div>
        <div><dt>Recorded</dt><dd>{r.recordedAt}{r.recorder ? ` by ${r.recorder}` : ''}</dd></div>
        <div><dt>Captured</dt><dd>{r.exchanges.total} responses ({r.exchanges.rpc} RPC, {r.exchanges.explorer} explorer){r.providers.length ? ` from ${r.providers.join(', ')}` : ''}</dd></div>
        <div><dt>Engine</dt><dd>recorded with {r.engineVersion ? `TxStory ${r.engineVersion}` : 'an unknown version'}; rebuilt with TxStory {report.engine.version} (story schema {report.engine.storySchema})</dd></div>
        <div><dt>Evidence digest</dt><dd>{yesNo(report.check.sameEvidence)}</dd></div>
        <div><dt>Output digest</dt><dd>{yesNo(report.check.sameOutput)}{report.check.recordedDigest ? <span className="mono small muted wrap"> · recorded {report.check.recordedDigest.slice(0, 16)}…{report.check.replayDigest ? `, rebuilt ${report.check.replayDigest.slice(0, 16)}…` : ''}</span> : null}</dd></div>
      </dl>
      {report.missing.length > 0 && (
        <details className="sub-details" open={report.verdict !== 'reproduced'}>
          <summary>Not in the recording ({report.missing.length})</summary>
          <ul className="plain small">{report.missing.map((m) => <li key={`${m.kind}|${m.provider}|${m.method}`}><span className="mono">{m.method}</span> · {m.provider}</li>)}</ul>
        </details>
      )}
      {report.differences && (
        <details className="sub-details" open>
          <summary>Differences from the stored story ({report.differences.differences.length})</summary>
          <p className="small">{report.differences.summary}</p>
          <ul className="plain small">{report.differences.differences.slice(0, 40).map((d, i) => <li key={i}><strong>{d.area}</strong> · {d.subject}: {d.a ?? 'none'} → {d.b ?? 'none'}{d.explanation ? ` (${d.explanation})` : ''}</li>)}</ul>
        </details>
      )}
      {report.notes.length > 1 && <ul className="small notes">{report.notes.slice(1).map((n) => <li key={n}>{n}</li>)}</ul>}
      {onReset && <button type="button" className="btn-ghost btn-xs" onClick={onReset}>Open another file</button>}
    </section>
  );
}

const ORIGIN: Record<ReconstructionReport['recording']['origin'], string> = {
  captured: 'captured from live providers',
  'local-devnet': 'local devnet (real execution on a local node)',
  synthetic: 'synthetic (written for testing; not real provider data)',
  unspecified: 'not stated in the file',
};

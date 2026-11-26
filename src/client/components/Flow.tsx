import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { assetSymbol } from '../../core/format.js';
import { shortAddress } from '../../core/hex.js';
import type { Movement } from '../../core/types.js';
import { BURN_NODE, flowMovements, layoutGraph, MINT_NODE, NODE_H, NODE_W, type GraphLayout } from '../lib/graph.js';
import { Address, Amount, ExplorerLink, ProvTag, useStoryUi } from './common.js';

const KIND_TEXT: Record<Movement['kind'], string> = {
  'token-transfer': 'Token transfer',
  'wrap-mint': 'Wrap (Deposit)',
  'unwrap-burn': 'Unwrap (Withdrawal)',
  'native-call-value': 'Value sent with the call',
  'native-internal': 'Native value inside execution',
  'fee-burn': 'Fee', 'fee-tip': 'Fee', 'fee-execution': 'Fee', 'fee-l1-data': 'Fee', 'fee-blob': 'Fee',
};

export function Flow() {
  const { story, selected, select } = useStoryUi();
  const moves = useMemo(() => flowMovements(story), [story]);
  const layout = useMemo(() => layoutGraph(story), [story]);
  const index = Math.max(0, moves.findIndex((m) => m.id === selected));
  const current = moves.length ? moves[selected ? index : 0] : undefined;
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      const i = moves.findIndex((m) => m.id === selected);
      if (i >= moves.length - 1) { setPlaying(false); return; }
      select(moves[i + 1]!.id);
    }, 1600);
    return () => clearInterval(t);
  }, [playing, selected, moves, select]);

  if (!moves.length) {
    return (
      <section className="panel" aria-labelledby="flow-h">
        <div className="panel-head"><h2 id="flow-h">How value moved</h2></div>
        <p className="empty">
          {story.outcome === 'reverted'
            ? 'Nothing moved: the call reverted. Only the network fee was charged.'
            : story.completeness.nativeInternal !== 'complete'
              ? 'No token or value movements were decoded from the receipt. Native value moved inside execution could not be checked (no trace source answered).'
              : 'No token or value movements: this transaction changed contract state without moving assets.'}
        </p>
      </section>
    );
  }

  const go = (i: number) => { setPlaying(false); select(moves[Math.max(0, Math.min(moves.length - 1, i))]!.id); };
  const hasInternal = moves.some((m) => m.kind === 'native-internal');

  return (
    <section className="panel" aria-labelledby="flow-h">
      <div className="panel-head">
        <h2 id="flow-h">How value moved</h2>
        <p className="panel-sub">
          {moves.length} movement{moves.length === 1 ? '' : 's'} in event order{layout.edges.length < moves.length ? `, drawn as ${layout.edges.length} grouped flows` : ''}. Fees are listed with the balance changes.
          {hasInternal ? ' Native value moved inside execution is shown after the events because its exact position relative to them is not known.' : ''}
        </p>
      </div>

      <div className="flow-grid">
        <div className="graph-col">
          <Graph layout={layout} activeMovement={current?.id ?? null} />
          <div className="transport" role="group" aria-label="Replay controls">
            <button type="button" className="btn-icon" onClick={() => go(index - 1)} disabled={index <= 0} aria-label="Previous movement">‹</button>
            <button type="button" className="btn-primary btn-sm" onClick={() => { if (index >= moves.length - 1) select(moves[0]!.id); setPlaying((p) => !p); }} aria-pressed={playing}>
              {playing ? 'Pause' : 'Play'}
            </button>
            <button type="button" className="btn-icon" onClick={() => go(index + 1)} disabled={index >= moves.length - 1} aria-label="Next movement">›</button>
            <input type="range" min={0} max={moves.length - 1} value={index} onChange={(e) => go(Number(e.target.value))} aria-label="Movement position" aria-valuetext={`Movement ${index + 1} of ${moves.length}`} />
            <span className="counter mono" aria-hidden="true">{String(index + 1).padStart(2, '0')} / {String(moves.length).padStart(2, '0')}</span>
          </div>
          {current && <MovementDetail m={current} position={index + 1} total={moves.length} />}
        </div>
        <MovementList moves={moves} activeId={current?.id ?? null} onPick={(id) => { setPlaying(false); select(id); }} />
      </div>
    </section>
  );
}

function nodeLabel(id: string, story: ReturnType<typeof useStoryUi>['story']): { title: string; sub: string } {
  if (id === MINT_NODE) return { title: 'Minted / created', sub: 'no prior holder' };
  if (id === BURN_NODE) return { title: 'Burned / removed', sub: 'leaves circulation' };
  const p = story.participants[id];
  const label = p?.ens ?? p?.labels[0]?.text;
  const role = id === story.tx.from ? 'SENDER' : p?.isContract ? 'CONTRACT' : p?.isContract === false ? 'ACCOUNT' : 'ADDRESS';
  return { title: label ? (label.length > 20 ? label.slice(0, 19) + '…' : label) : shortAddress(id), sub: `${role}${label ? ' · ' + shortAddress(id) : ''}` };
}

function Graph({ layout, activeMovement }: { layout: GraphLayout; activeMovement: string | null }) {
  const { story, select } = useStoryUi();
  const pos = new Map(layout.nodes.map((n) => [n.id, n]));
  const activeEdge = layout.edges.find((e) => activeMovement && e.movementIds.includes(activeMovement));
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Keep the active edge's source node in view on narrow screens.
    if (!activeEdge || !scroller.current) return;
    const n = pos.get(activeEdge.from);
    if (n) scroller.current.scrollTo({ left: Math.max(0, n.x - 24), behavior: 'smooth' });
  }, [activeEdge?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const summary = `Flow diagram with ${layout.nodes.length} participants and ${layout.edges.length} flows. The movement list beside it describes the same data.`;
  return (
    <div className="graph-scroll" ref={scroller} tabIndex={0} role="region" aria-label="Flow diagram (scrollable)">
      <svg className="graph" width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} role="img" aria-label={summary}>
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" className="arrowhead" /></marker>
          <marker id="arrow-active" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" className="arrowhead-active" /></marker>
        </defs>
        {layout.edges.map((e) => {
          const a = pos.get(e.from); const b = pos.get(e.to);
          if (!a || !b) return null;
          const d = edgePath(a, b);
          const active = e.id === activeEdge?.id;
          return (
            <g key={e.id} className={`edge ${active ? 'edge-active' : ''}`} onClick={() => select(e.movementIds[0]!)}>
              <path id={`p-${e.id}`} d={d} markerEnd={active ? 'url(#arrow-active)' : 'url(#arrow)'} />
              {active && <circle r="6" className="token-dot"><animateMotion dur="1.2s" repeatCount="indefinite" path={d} /></circle>}
            </g>
          );
        })}
        {layout.nodes.map((n) => {
          const { title, sub } = nodeLabel(n.id, story);
          const active = activeEdge && (activeEdge.from === n.id || activeEdge.to === n.id);
          return (
            <g key={n.id} transform={`translate(${n.x},${n.y})`} className={`node node-${n.kind} ${active ? 'node-active' : ''} ${n.id === story.tx.from ? 'node-sender' : ''}`}>
              <rect width={NODE_W} height={NODE_H} rx="10" />
              <text x="12" y="23" className="node-title">{title}</text>
              <text x="12" y="42" className="node-sub">{sub}</text>
            </g>
          );
        })}
        {activeEdge && (() => {
          const a = pos.get(activeEdge.from)!; const b = pos.get(activeEdge.to)!;
          const mx = (a.x + b.x + NODE_W) / 2; const my = (a.y + b.y + NODE_H) / 2 - 10;
          const m = story.movements.find((x) => x.id === activeMovement);
          const label = m ? `${activeEdge.count > 1 ? `${activeEdge.count}× ` : ''}${assetSymbol(story.assets[m.assetKey])}` : '';
          return <g className="edge-chip" transform={`translate(${mx},${my})`}><rect x={-label.length * 4 - 10} y="-13" width={label.length * 8 + 20} height="24" rx="12" /><text textAnchor="middle" y="4">{label}</text></g>;
        })()}
      </svg>
    </div>
  );
}

function edgePath(a: { x: number; y: number }, b: { x: number; y: number }) {
  const ax = a.x + NODE_W; const ay = a.y + NODE_H / 2;
  if (a === b || (a.x === b.x && a.y === b.y)) {
    return `M ${ax} ${ay} c 40 -40 40 40 0 10`;
  }
  if (b.x > a.x) {
    const bx = b.x; const by = b.y + NODE_H / 2;
    const cx = (ax + bx) / 2;
    return `M ${ax} ${ay} C ${cx} ${ay}, ${cx} ${by}, ${bx - 2} ${by}`;
  }
  // Backward or same-column edge: arc around below.
  const sx = a.x + NODE_W / 2; const sy = a.y + NODE_H;
  const tx = b.x + NODE_W / 2; const ty = b.y + NODE_H;
  const dip = Math.max(sy, ty) + 40;
  return `M ${sx} ${sy} C ${sx} ${dip}, ${tx} ${dip}, ${tx} ${ty + 2}`;
}

function MovementList({ moves, activeId, onPick }: { moves: Movement[]; activeId: string | null; onPick: (id: string) => void }) {
  const { story, highlight } = useStoryUi();
  const listRef = useRef<HTMLUListElement>(null);
  const activeIndex = Math.max(0, moves.findIndex((m) => m.id === activeId));
  useEffect(() => {
    // Scroll only the list container, never the page (initial render must not jump).
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>(`[data-mid="${CSS.escape(moves[activeIndex]?.id ?? '')}"]`);
    if (list && el) {
      const top = el.offsetTop - list.offsetTop;
      if (top < list.scrollTop) list.scrollTop = top - 4;
      else if (top + el.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + el.offsetHeight - list.clientHeight + 4;
    }
  }, [activeIndex, moves]);
  const onKey = (e: KeyboardEvent<HTMLUListElement>) => {
    const next = e.key === 'ArrowDown' ? activeIndex + 1 : e.key === 'ArrowUp' ? activeIndex - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? moves.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    onPick(moves[Math.max(0, Math.min(moves.length - 1, next))]!.id);
  };
  return (
    <div className="list-col">
      <h3 className="list-h" id="moves-h">Movements in order</h3>
      <p className="small muted" id="moves-help">Use ↑ ↓ to step through. Each item opens its evidence.</p>
      <ul
        ref={listRef} className="moves" role="listbox" tabIndex={0} aria-labelledby="moves-h" aria-describedby="moves-help"
        aria-activedescendant={moves[activeIndex] ? `mv-${cssId(moves[activeIndex]!.id)}` : undefined} onKeyDown={onKey}
      >
        {moves.map((m, i) => {
          const internalStart = m.kind === 'native-internal' && moves[i - 1]?.kind !== 'native-internal';
          return (
            <li key={m.id} id={`mv-${cssId(m.id)}`} data-mid={m.id} role="option" aria-selected={m.id === activeId}
              className={`move ${m.id === activeId ? 'active' : ''} ${highlight.has(m.id) ? 'hl' : ''} ${internalStart ? 'group-break' : ''}`}
              onClick={() => onPick(m.id)}>
              {internalStart && <span className="group-label">Inside execution · order relative to events unknown</span>}
              <span className="move-step mono">{String(i + 1).padStart(2, '0')} · {m.logIndex !== undefined ? `log ${m.logIndex}` : m.kind === 'native-internal' ? 'trace' : 'tx'}</span>
              <span className="move-amt"><Amount assetKey={m.assetKey} raw={m.amount} />{m.tokenId && story.assets[m.assetKey]?.kind !== 'erc20' ? <span className="small token-id"> #{m.tokenId.length > 10 ? m.tokenId.slice(0, 6) + '…' : m.tokenId}</span> : null}</span>
              <span className="move-parties small"><Address address={m.from} compact /> <span aria-hidden="true">→</span><span className="sr-only">to</span> <Address address={m.to} compact /></span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function MovementDetail({ m, position, total }: { m: Movement; position: number; total: number }) {
  const { story } = useStoryUi();
  const asset = story.assets[m.assetKey];
  return (
    <div className="detail" aria-live="polite">
      <div className="detail-head">
        <span className="eyebrow">Step {position} of {total} · {KIND_TEXT[m.kind]}</span>
        <ProvTag p={m.provenance} />
      </div>
      <p className="detail-sentence">
        <Address address={m.from} /> <span className="muted">{m.from ? 'sent' : 'minted'}</span> <Amount assetKey={m.assetKey} raw={m.amount} />{' '}
        <span className="muted">{m.to ? 'to' : 'out of circulation'}</span> {m.to ? <Address address={m.to} /> : null}
      </p>
      <dl className="kv">
        <dt>Evidence</dt><dd>{m.label}{m.logIndex !== undefined ? ` (receipt log ${m.logIndex})` : ''}</dd>
        {asset?.contract && <><dt>Token contract</dt><dd><span className="mono">{asset.contract}</span> <ExplorerLink kind="token" value={asset.contract} /></dd></>}
        {m.tokenId && asset?.kind !== 'erc20' && <><dt>Token id</dt><dd className="mono wrap">{m.tokenId}</dd></>}
        {asset && <><dt>Metadata</dt><dd>{asset.symbol ?? 'no symbol'} · {asset.decimals === null ? 'decimals unknown' : `${asset.decimals} decimals`} · {asset.metadataSource === 'explorer' ? 'from explorer' : asset.metadataSource === 'rpc-call' ? 'from contract call' : asset.metadataSource === 'chain-config' ? 'chain config' : 'unavailable'}</dd></>}
        {m.note && <><dt>Note</dt><dd>{m.note}</dd></>}
      </dl>
    </div>
  );
}

function cssId(id: string) {
  return id.replace(/[^a-z0-9-]/gi, '_');
}

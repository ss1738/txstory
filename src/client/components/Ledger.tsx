import { Fragment, useMemo, useState } from 'react';
import type { BalanceChange } from '../../core/types.js';
import { Address, Amount, useStoryUi } from './common.js';
import { crossCheckLabel } from '../lib/crosscheckLabel.js';

function idList(ids: { in: string[]; out: string[] } | undefined) {
  if (!ids || (!ids.in.length && !ids.out.length)) return 'no net change';
  const f = (xs: string[]) => xs.map((x) => (x.length > 12 ? `${x.slice(0, 6)}…${x.slice(-4)}` : x)).join(', ');
  return [ids.in.length ? `in #${f(ids.in)}` : '', ids.out.length ? `out #${f(ids.out)}` : ''].filter(Boolean).join(' · ');
}

export function Ledger() {
  const { story, highlight } = useStoryUi();
  const [showAll, setShowAll] = useState(false);
  const xc = useMemo(() => new Map(story.crossCheck.rows.map((r) => [`${r.address}|${r.assetKey}`, r])), [story.crossCheck.rows]);

  const groups = useMemo(() => {
    const by = new Map<string, BalanceChange[]>();
    for (const r of story.ledger) (by.get(r.address) ?? by.set(r.address, []).get(r.address)!).push(r);
    const entries = [...by.entries()];
    entries.sort(([a, ra], [b, rb]) => (a === story.tx.from ? -1 : b === story.tx.from ? 1 : rb.length - ra.length || a.localeCompare(b)));
    return entries;
  }, [story.ledger, story.tx.from]);

  const explorerOnly = story.crossCheck.rows.filter((r) => r.status === 'only-explorer');
  const LIMIT = 8;
  const visible = showAll ? groups : groups.slice(0, LIMIT);

  return (
    <section className="panel" aria-labelledby="ledger-h">
      <div className="panel-head">
        <h2 id="ledger-h">Who gained and lost what</h2>
        <p className="panel-sub">Net balance change per address after the whole transaction, including the network fee. Exact on hover; switch on “Exact amounts” for full precision.</p>
      </div>
      {groups.length === 0 ? (
        <p className="empty">No balance changes were derived{story.outcome === 'reverted' ? ' (the call reverted, so only the fee was paid; see below)' : ''}.</p>
      ) : (
        <div className="table-wrap">
          <table className="ledger">
            <caption className="sr-only">Net balance changes by address and asset</caption>
            <thead>
              <tr><th scope="col">Address</th><th scope="col">Asset change</th><th scope="col">Source</th><th scope="col">Cross-check</th></tr>
            </thead>
            <tbody>
              {visible.map(([address, rows]) => (
                <Fragment key={address}>
                  {rows.map((r, i) => {
                    const c = xc.get(`${r.address}|${r.assetKey}`);
                    const id = `ledger:${r.address}:${r.assetKey}`;
                    const asset = story.assets[r.assetKey];
                    return (
                      <tr key={id} id={id} className={`${i === 0 ? 'group-start' : ''} ${highlight.has(id) ? 'hl' : ''}`}>
                        {i === 0 ? (
                          <th scope="rowgroup" rowSpan={rows.length} className="ledger-addr">
                            <Address address={address} />
                            <span className="roles">{story.participants[address]?.roles.filter((x) => x !== 'Sent value' && x !== 'Received value').join(' · ')}</span>
                          </th>
                        ) : null}
                        <td>
                          <Amount assetKey={r.assetKey} raw={r.delta} signed />
                          {asset?.kind === 'erc721' && (r.tokenIdsIn?.length || r.tokenIdsOut?.length) ? (
                            <div className="small muted">
                              {r.tokenIdsIn?.length ? <>received id {r.tokenIdsIn.map(shortId).join(', ')} </> : null}
                              {r.tokenIdsOut?.length ? <>sent id {r.tokenIdsOut.map(shortId).join(', ')}</> : null}
                            </div>
                          ) : null}
                          {r.assetKey === 'native' && address === story.tx.from && story.fees.total !== '0' ? <div className="small muted">includes the network fee</div> : null}
                        </td>
                        <td className="cell-src"><span className={`prov prov-${r.usesExplorerData ? 'explorer' : 'derived'}`} title={r.usesExplorerData ? 'Includes native value the explorer reports moving inside execution.' : 'Derived from RPC-reported receipt logs, value and gas.'}>{r.usesExplorerData ? 'Decoded + explorer' : 'Decoded'}</span></td>
                        <td className="cell-xc">
                          {c ? (
                            <span className={`xc xc-${crossCheckLabel(c).tone}`} title={`${crossCheckLabel(c).title}${c.note ? `\n${c.note}` : ''}${c.status === 'mismatch' && c.explorer ? `\nExplorer: ${c.explorer}` : ''}`}>
                              {crossCheckLabel(c).label}
                              {c.status === 'mismatch' && c.scope === 'token-ids'
                                ? <span className="small block mono">TxStory: {idList(c.txstoryTokenIds)}<br />Explorer: {idList(c.explorerTokenIds)}</span>
                                : c.status === 'mismatch' && c.explorer && asset ? <span className="small block">explorer: <Amount assetKey={r.assetKey} raw={c.explorer} signed /></span> : null}
                              {c.note ? <span className="small block muted">{c.note}</span> : null}
                            </span>
                          ) : <span className="xc xc-neutral" title={story.crossCheck.reason}>{story.crossCheck.available ? 'not reported by explorer' : 'not checked'}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {groups.length > LIMIT && (
        <button type="button" className="btn-ghost" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
          {showAll ? 'Show fewer addresses' : `Show all ${groups.length} addresses`}
        </button>
      )}
      {explorerOnly.length > 0 && (
        <details className="sub-details">
          <summary>{explorerOnly.length} change(s) reported only by the explorer</summary>
          <ul className="plain">
            {explorerOnly.map((r) => (
              <li key={`${r.address}|${r.assetKey}`}><Address address={r.address} /> {r.explorer && story.assets[r.assetKey] ? <Amount assetKey={r.assetKey} raw={r.explorer} signed /> : <span className="mono">{r.assetKey}: {r.explorer}</span>} {r.note ? <span className="small muted">({r.note})</span> : null}</li>
            ))}
          </ul>
        </details>
      )}
      <FeeLine />
    </section>
  );
}

function FeeLine() {
  const { story } = useStoryUi();
  if (story.fees.components.length === 0 && story.fees.notes.length === 0) return null;
  return (
    <div className="fees">
      <h3>Network fee</h3>
      {story.fees.total !== '0' ? (
        <p className="fee-total" data-testid="fee-total">
          <strong>Total paid by the sender: <Amount assetKey="native" raw={story.fees.total} /></strong>
        </p>
      ) : null}
      {story.fees.components.length > 1 ? <p className="small muted">Made up of:</p> : null}
      {story.fees.components.length ? (
        <ul className="plain">
          {story.fees.components.map((c) => <li key={c.kind}><Amount assetKey="native" raw={c.amount} /> <span className="muted">{c.label}</span></li>)}
          <li className="small muted">Gas used {BigInt(story.fees.gasUsed).toLocaleString('en-US')} × effective price {story.fees.effectiveGasPrice} wei (from the RPC receipt).</li>
        </ul>
      ) : null}
      {story.fees.notes.map((n) => <p key={n} className="small muted">{n}</p>)}
    </div>
  );
}

function shortId(id: string) {
  return id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

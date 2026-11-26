import { createContext, useContext, useState, type ReactNode } from 'react';
import { amountCompact, amountExact } from '../../core/format.js';
import { checksumAddress, shortAddress } from '../../core/hex.js';
import type { Provenance, Story } from '../../core/types.js';

export interface StoryUi {
  story: Story;
  exact: boolean;
  setExact: (v: boolean) => void;
  selected: string | null; // movement id
  select: (id: string | null, opts?: { scroll?: boolean }) => void;
  highlight: Set<string>; // evidence ids to highlight
  setHighlight: (ids: string[]) => void;
}

export const StoryCtx = createContext<StoryUi | null>(null);
export function useStoryUi(): StoryUi {
  const v = useContext(StoryCtx);
  if (!v) throw new Error('StoryCtx missing');
  return v;
}

const PROV_TEXT: Record<Provenance, { label: string; title: string }> = {
  chain: { label: 'Chain', title: 'Reported by a JSON-RPC node. TxStory trusts the node; it does not cryptographically verify it.' },
  derived: { label: 'Decoded', title: 'Computed by TxStory from RPC-reported receipt data (logs, status, gas).' },
  explorer: { label: 'Explorer', title: 'Reported or interpreted by the block explorer (Blockscout). Not independently verified.' },
  heuristic: { label: 'Heuristic', title: 'A pattern-based interpretation. It can be wrong.' },
};

export function ProvTag({ p }: { p: Provenance }) {
  const t = PROV_TEXT[p];
  return <span className={`prov prov-${p}`} title={t.title}>{t.label}</span>;
}

export function Amount({ assetKey, raw, signed = false }: { assetKey: string; raw: string; signed?: boolean }) {
  const { story, exact } = useStoryUi();
  const asset = story.assets[assetKey];
  const full = amountExact(asset, raw, { signed });
  const shown = exact ? full : amountCompact(asset, raw, { signed });
  const tone = signed ? (raw.startsWith('-') ? 'neg' : raw === '0' ? '' : 'pos') : '';
  return (
    <span className={`amount ${tone}`} title={shown === full ? undefined : `Exact: ${full}`}>
      {shown}
      {shown !== full && <span className="sr-only"> (exact {full})</span>}
      {asset?.metadataAltered && <span className="warn-chip" title="This token's name or symbol contained hidden/direction-control characters that were removed. Treat the name with suspicion.">altered name</span>}
    </span>
  );
}

export function Address({ address, compact = false }: { address: string | null; compact?: boolean }) {
  const { story } = useStoryUi();
  if (!address) return <span className="addr muted">no account</span>;
  const p = story.participants[address];
  const label = p?.ens ?? p?.labels[0]?.text ?? null;
  const roleHint = address === story.tx.from ? 'sender' : null;
  return (
    <span className="addr" title={`${checksumAddress(address)}${label ? `\nLabel from explorer (not verified identity): ${label}` : ''}`}>
      {label && <span className="addr-label">{label}</span>}
      <span className="mono addr-hex">{compact && label ? '' : shortAddress(address)}</span>
      {roleHint && <span className="role-chip">sender</span>}
    </span>
  );
}

export function ExplorerLink({ kind, value, children }: { kind: 'tx' | 'address' | 'token' | 'block'; value: string; children?: ReactNode }) {
  const { story } = useStoryUi();
  const base = story.network.explorerUi;
  if (!base) return null; // e.g. a devnet without an explorer
  return (
    <a className="ext" href={`${base}/${kind}/${value}`} target="_blank" rel="noopener noreferrer">
      {children ?? 'Explorer'}<span aria-hidden="true"> ↗</span><span className="sr-only"> (opens external explorer)</span>
    </a>
  );
}

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'done' | 'fail'>('idle');
  return (
    <button
      type="button"
      className="btn-ghost btn-xs"
      onClick={async () => {
        try { await navigator.clipboard.writeText(value); setState('done'); } catch { setState('fail'); }
        setTimeout(() => setState('idle'), 1500);
      }}
    >
      {state === 'done' ? 'Copied' : state === 'fail' ? 'Copy failed' : label}
    </button>
  );
}

export function Badge({ tone, children, title }: { tone: 'ok' | 'bad' | 'warn' | 'info' | 'neutral'; children: ReactNode; title?: string }) {
  return <span className={`badge badge-${tone}`} title={title}>{children}</span>;
}

/**
 * Deterministic layered layout for the value-flow graph. Fees are excluded
 * (shown in the balance table). Movements sharing (from, to, asset) are
 * aggregated into one edge so large transactions stay legible.
 */
import type { Movement, Story } from '../../core/types.js';

export const MINT_NODE = 'source:mint';
export const BURN_NODE = 'sink:burn';

export interface GraphNode { id: string; column: number; row: number; x: number; y: number; kind: 'address' | 'mint' | 'burn'; firstSeen: number }
export interface GraphEdge { id: string; from: string; to: string; assetKey: string; movementIds: string[]; count: number }
export interface GraphLayout { nodes: GraphNode[]; edges: GraphEdge[]; width: number; height: number; columns: number }

export const NODE_W = 168;
export const NODE_H = 56;
const COL_GAP = 120;
const ROW_GAP = 26;
const PAD = 24;

export function flowMovements(story: Story): Movement[] {
  return story.movements.filter((m) => !m.kind.startsWith('fee'));
}

export function layoutGraph(story: Story): GraphLayout {
  const moves = flowMovements(story);
  const nodeId = (addr: string | null, side: 'from' | 'to') => addr ?? (side === 'from' ? MINT_NODE : BURN_NODE);

  const firstSeen = new Map<string, number>();
  firstSeen.set(story.tx.from, -1);
  moves.forEach((m, i) => {
    for (const id of [nodeId(m.from, 'from'), nodeId(m.to, 'to')]) if (!firstSeen.has(id)) firstSeen.set(id, i);
  });

  // Edges (aggregated).
  const edgeMap = new Map<string, GraphEdge>();
  for (const m of moves) {
    const from = nodeId(m.from, 'from'); const to = nodeId(m.to, 'to');
    const key = `${from}>${to}>${m.assetKey}`;
    const e = edgeMap.get(key);
    if (e) { e.movementIds.push(m.id); e.count++; }
    else edgeMap.set(key, { id: `e${edgeMap.size}`, from, to, assetKey: m.assetKey, movementIds: [m.id], count: 1 });
  }
  const edges = [...edgeMap.values()];

  // Columns: longest-path-ish BFS from the sender (and mint source) over edges, cycle-safe.
  const column = new Map<string, number>();
  const roots = [story.tx.from, ...(firstSeen.has(MINT_NODE) ? [MINT_NODE] : [])];
  const queue: Array<[string, number]> = roots.map((r) => [r, 0]);
  const adjacency = new Map<string, string[]>();
  for (const e of edges) {
    if (e.from === e.to) continue;
    (adjacency.get(e.from) ?? adjacency.set(e.from, []).get(e.from)!).push(e.to);
  }
  const maxColumns = 6;
  while (queue.length) {
    const [id, c] = queue.shift()!;
    if (column.has(id) && column.get(id)! <= c) continue;
    if (column.has(id)) continue; // first assignment wins (BFS = shortest distance), keeps layout stable
    column.set(id, Math.min(c, maxColumns - 1));
    for (const next of adjacency.get(id) ?? []) if (!column.has(next)) queue.push([next, c + 1]);
  }
  // Unreached nodes go after their first appearance's predecessor column (or 1).
  for (const id of firstSeen.keys()) if (!column.has(id)) column.set(id, id === BURN_NODE ? maxColumns - 1 : 1);
  if (firstSeen.has(BURN_NODE)) {
    const maxUsed = Math.max(0, ...[...column.entries()].filter(([k]) => k !== BURN_NODE).map(([, v]) => v));
    column.set(BURN_NODE, Math.min(maxColumns - 1, maxUsed + 1));
  }

  // Compact columns (remove empty ones), then rows by first appearance.
  const used = [...new Set(column.values())].sort((a, b) => a - b);
  const remap = new Map(used.map((c, i) => [c, i]));
  const byColumn = new Map<number, string[]>();
  for (const [id, c] of column) {
    const cc = remap.get(c)!;
    (byColumn.get(cc) ?? byColumn.set(cc, []).get(cc)!).push(id);
  }
  const nodes: GraphNode[] = [];
  let maxRows = 0;
  for (const [c, ids] of byColumn) {
    ids.sort((a, b) => firstSeen.get(a)! - firstSeen.get(b)! || a.localeCompare(b));
    maxRows = Math.max(maxRows, ids.length);
    ids.forEach((id, row) => nodes.push({
      id, column: c, row, x: PAD + c * (NODE_W + COL_GAP), y: PAD + row * (NODE_H + ROW_GAP),
      kind: id === MINT_NODE ? 'mint' : id === BURN_NODE ? 'burn' : 'address', firstSeen: firstSeen.get(id)!,
    }));
  }
  const columns = used.length;
  return {
    nodes, edges, columns,
    width: PAD * 2 + Math.max(1, columns) * NODE_W + Math.max(0, columns - 1) * COL_GAP,
    height: PAD * 2 + Math.max(1, maxRows) * NODE_H + Math.max(0, maxRows - 1) * ROW_GAP,
  };
}

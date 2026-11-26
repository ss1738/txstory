/** Defensive accessors for untrusted provider JSON. */
export type Json = unknown;

export const isObj = (v: Json): v is Record<string, Json> => typeof v === 'object' && v !== null && !Array.isArray(v);
export const str = (v: Json): string | null => (typeof v === 'string' ? v : null);
export const bool = (v: Json): boolean | null => (typeof v === 'boolean' ? v : null);
export const arr = (v: Json): Json[] => (Array.isArray(v) ? v : []);
export const get = (v: Json, ...path: string[]): Json => {
  let cur: Json = v;
  for (const p of path) {
    if (!isObj(cur)) return undefined;
    cur = cur[p];
  }
  return cur;
};

export function parseJson(text: string): Json | undefined {
  try {
    return JSON.parse(text) as Json;
  } catch {
    return undefined;
  }
}

/** Integer-looking string (decimal) or number → decimal string; anything else → null. */
export function intString(v: Json): string | null {
  if (typeof v === 'string' && /^-?\d+$/.test(v)) return v;
  if (typeof v === 'number' && Number.isSafeInteger(v)) return String(v);
  return null;
}

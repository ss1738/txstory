/**
 * Exact integer amount handling. All on-chain quantities are kept as decimal
 * strings of base units (or bigint), never JavaScript numbers.
 */

const DECIMAL_INT = /^-?\d+$/;

export function isIntegerString(value: unknown): value is string {
  return typeof value === 'string' && DECIMAL_INT.test(value);
}

/** Parse a 0x-hex or decimal quantity into bigint. Throws on anything else. */
export function toBigInt(value: string | bigint | number): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new RangeError(`Unsafe integer: ${value}`);
    return BigInt(value);
  }
  const v = value.trim();
  if (/^0x[0-9a-fA-F]+$/.test(v)) return BigInt(v);
  if (v === '0x') return 0n;
  if (DECIMAL_INT.test(v)) return BigInt(v);
  throw new TypeError(`Not an integer quantity: ${JSON.stringify(value).slice(0, 80)}`);
}

/**
 * Format base units with `decimals` places, exactly. Returns e.g. "-1,234.5"
 * (grouping optional). Trailing fractional zeros are removed.
 */
export function formatUnits(raw: bigint | string, decimals: number, opts: { group?: boolean } = {}): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new RangeError(`Invalid decimals: ${decimals}`);
  }
  let value = typeof raw === 'bigint' ? raw : toBigInt(raw);
  const negative = value < 0n;
  if (negative) value = -value;
  const s = value.toString().padStart(decimals + 1, '0');
  const intPart = decimals ? s.slice(0, -decimals) : s;
  const fracPart = decimals ? s.slice(-decimals).replace(/0+$/, '') : '';
  const grouped = opts.group ? intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : intPart;
  return (negative ? '-' : '') + grouped + (fracPart ? '.' + fracPart : '');
}

/**
 * Compact display form. Never used for exports; the exact form must always be
 * reachable from the UI. Keeps up to `significant` significant fractional digits
 * for small values and abbreviates very large integers.
 */
export function formatCompact(raw: bigint | string, decimals: number, significant = 6): string {
  const exact = formatUnits(raw, decimals);
  const negative = exact.startsWith('-');
  const body = negative ? exact.slice(1) : exact;
  const [intPart = '0', frac = ''] = body.split('.');
  let out: string;
  if (intPart.length > 15) {
    const units: Array<[number, string]> = [[24, 'Sp'], [21, 'Sx'], [18, 'Qi'], [15, 'Qa'], [12, 'T']];
    const digits = intPart.length;
    const [pow, suffix] = units.find(([p]) => digits > p) ?? [12, 'T'];
    const head = intPart.slice(0, digits - pow);
    const tail = intPart.slice(digits - pow, digits - pow + 2).replace(/0+$/, '');
    out = `${group(head)}${tail ? '.' + tail : ''}${suffix}`;
  } else if (intPart !== '0') {
    const keep = Math.max(0, significant - intPart.length);
    const f = frac.slice(0, keep).replace(/0+$/, '');
    out = group(intPart) + (f ? '.' + f : '') + (frac.length > keep && keep >= 0 && frac.slice(keep).replace(/0/g, '') ? '…' : '');
  } else if (frac) {
    const lead = frac.match(/^0*/)?.[0].length ?? 0;
    if (lead >= 9) {
      out = '<0.' + '0'.repeat(8) + '1';
    } else {
      const f = frac.slice(0, lead + significant).replace(/0+$/, '');
      out = '0.' + f + (frac.length > lead + significant ? '…' : '');
    }
  } else {
    out = '0';
  }
  return (negative && out !== '0' ? '−' : '') + out;
}

function group(s: string): string {
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function sumStrings(values: Array<string | bigint>): bigint {
  return values.reduce<bigint>((acc, v) => acc + (typeof v === 'bigint' ? v : toBigInt(v)), 0n);
}

/** Parse an explorer-provided decimals field; returns null when absent or malformed. */
export function parseDecimals(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 255) return value;
  if (typeof value === 'string' && /^\d{1,3}$/.test(value)) {
    const n = Number(value);
    return n <= 255 ? n : null;
  }
  return null;
}

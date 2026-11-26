/**
 * Client identity for rate limiting and concurrency caps.
 *
 * Policy (documented in README "Reverse proxies and client identity"):
 * - By default NO forwarding header is trusted. The identity is the TCP peer.
 * - With TXSTORY_TRUST_PROXY set, X-Forwarded-For is consulted only when the TCP
 *   peer is itself a trusted proxy. The header is walked RIGHT TO LEFT (nearest
 *   hop first). Each hop appended by a trusted proxy is accepted. The first
 *   address that is NOT a trusted proxy is the client. Anything to its left was
 *   supplied by the client (or by untrusted hops) and is ignored, so a client
 *   cannot pick its own identity by sending X-Forwarded-For.
 * - A malformed hop stops the walk; the last address we could vouch for (a
 *   trusted proxy) becomes the identity. That is conservative: a misbehaving
 *   proxy degrades to sharing one bucket rather than letting clients choose.
 * - At most MAX_HOPS entries are examined.
 * - Only X-Forwarded-For is used. `Forwarded`, `X-Real-IP` and similar headers
 *   are always ignored.
 * - IPv4-mapped IPv6 (::ffff:a.b.c.d) is treated as IPv4. IPv6 clients are rate
 *   limited per /64, because one host or customer typically controls a whole /64.
 */
import { BlockList, isIP } from 'node:net';

export const MAX_HOPS = 10;

export interface NormalizedIp { ip: string; family: 4 | 6 }

export interface ClientIdentity {
  /** Normalised client address (never logged). */
  ip: string;
  /** Rate-limit bucket: the IPv4 address, or the IPv6 /64 prefix. */
  key: string;
  /** How it was determined. */
  via: 'socket' | 'forwarded' | 'unknown';
}

/** Expand a valid IPv6 string (already accepted by net.isIP) to 8 lowercase 4-digit hextets. */
function expandIpv6(s: string): string[] {
  let text = s.toLowerCase();
  // Embedded IPv4 tail (e.g. ::ffff:1.2.3.4) → two hextets.
  const v4 = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number) as [number, number, number, number];
    text = text.slice(0, v4.index) + ((a << 8) | b).toString(16) + ':' + ((c << 8) | d).toString(16);
  }
  const [head, tail] = text.includes('::') ? text.split('::') as [string, string] : [text, null];
  const h = head ? head.split(':') : [];
  const t = tail === null ? [] : tail ? tail.split(':') : [];
  const fill = tail === null ? [] : Array(8 - h.length - t.length).fill('0');
  return [...h, ...fill, ...t].map((x) => x.padStart(4, '0'));
}

/**
 * Parse one address as it may appear in a socket or X-Forwarded-For entry.
 * Accepts `1.2.3.4`, `1.2.3.4:port`, IPv6, `[v6]`, `[v6]:port`, a zone id.
 * Returns null for anything else (`unknown`, obfuscated identifiers, garbage).
 */
export function normalizeIp(raw: string | undefined | null): NormalizedIp | null {
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  if (!s || s.length > 100) return null;
  const portOk = (p: string | undefined) => p === undefined || Number(p) <= 65535;
  const bracket = /^\[([^\]]+)\](?::(\d{1,5}))?$/.exec(s);
  if (bracket) {
    if (!portOk(bracket[2])) return null;
    s = bracket[1]!;
  } else {
    const v4port = /^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/.exec(s);
    if (v4port) {
      if (!portOk(v4port[2])) return null;
      s = v4port[1]!;
    }
  }
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  const fam = isIP(s);
  if (fam === 4) return { ip: s, family: 4 };
  if (fam === 6) {
    const hex = expandIpv6(s);
    // IPv4-mapped (::ffff:a.b.c.d) → IPv4, so one client has one identity.
    if (hex.slice(0, 5).every((x) => x === '0000') && hex[5] === 'ffff') {
      const a = parseInt(hex[6]!, 16); const b = parseInt(hex[7]!, 16);
      return { ip: `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`, family: 4 };
    }
    return { ip: hex.join(':'), family: 6 };
  }
  return null;
}

export function rateKey(n: NormalizedIp): string {
  return n.family === 4 ? n.ip : `${n.ip.split(':').slice(0, 4).join(':')}::/64`;
}

export interface TrustedProxies {
  /** The configuration as written, for logs and docs (no addresses of clients). */
  readonly description: string;
  readonly enabled: boolean;
  has(n: NormalizedIp): boolean;
}

const PRESETS: Record<string, Array<[string, number, 'ipv4' | 'ipv6']>> = {
  loopback: [['127.0.0.0', 8, 'ipv4'], ['::1', 128, 'ipv6']],
  // RFC 1918 + IPv6 unique-local: typical container networks / private load balancers.
  private: [['10.0.0.0', 8, 'ipv4'], ['172.16.0.0', 12, 'ipv4'], ['192.168.0.0', 16, 'ipv4'], ['fc00::', 7, 'ipv6']],
};

/**
 * Parse TXSTORY_TRUST_PROXY: empty / "none" (default), or a comma-separated list
 * of `loopback`, `private`, IP addresses and CIDR ranges. Invalid entries and
 * "trust everything" ranges (prefix length 0) are rejected at startup.
 */
export function parseTrustedProxies(spec: string | undefined | null): TrustedProxies {
  const text = (spec ?? '').trim();
  if (!text || text === 'none') return { description: 'none', enabled: false, has: () => false };
  const list = new BlockList();
  const parts = text.split(',').map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    const preset = PRESETS[part.toLowerCase()];
    if (preset) { for (const [net, len, type] of preset) list.addSubnet(net, len, type); continue; }
    const [addr, lenText, extra] = part.split('/');
    const n = normalizeIp(addr);
    if (!n || extra !== undefined || (addr !== undefined && /[[\]]/.test(addr))) throw new Error(`TXSTORY_TRUST_PROXY: "${part}" is not an IP address, CIDR range, "loopback" or "private"`);
    const max = n.family === 4 ? 32 : 128;
    const len = lenText === undefined ? max : Number(lenText);
    if (!Number.isInteger(len) || len < 1 || len > max || (lenText !== undefined && !/^\d{1,3}$/.test(lenText))) {
      throw new Error(`TXSTORY_TRUST_PROXY: "${part}" needs a prefix length between 1 and ${max} (trusting every address would let clients choose their identity)`);
    }
    list.addSubnet(n.ip, len, n.family === 4 ? 'ipv4' : 'ipv6');
  }
  return {
    description: parts.join(','),
    enabled: true,
    has: (n) => list.check(n.ip, n.family === 4 ? 'ipv4' : 'ipv6'),
  };
}

/** Resolve the client identity for one request (see the policy at the top of this file). */
export function resolveClient(socketAddress: string | undefined, forwardedFor: string | string[] | undefined, trusted: TrustedProxies): ClientIdentity {
  const peer = normalizeIp(socketAddress);
  if (!peer) return { ip: 'unknown', key: 'unknown', via: 'unknown' };
  if (!trusted.enabled || !trusted.has(peer) || forwardedFor === undefined) return { ip: peer.ip, key: rateKey(peer), via: 'socket' };
  const header = Array.isArray(forwardedFor) ? forwardedFor.join(',') : forwardedFor;
  const hops = header.split(',');
  let current = peer;
  let via: ClientIdentity['via'] = 'socket';
  for (let i = hops.length - 1, seen = 0; i >= 0 && seen < MAX_HOPS; i--, seen++) {
    if (!hops[i]!.trim() && i === hops.length - 1 && hops.length === 1) break; // empty header
    const hop = normalizeIp(hops[i]);
    if (!hop) break; // malformed: stop at the last address we can vouch for
    current = hop;
    via = 'forwarded';
    if (!trusted.has(hop)) break; // first untrusted hop is the client
  }
  return { ip: current.ip, key: rateKey(current), via };
}

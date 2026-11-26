/**
 * Bounded admission control: per-client and global rate limits, concurrency
 * slots, a byte-bounded cache, and a per-story time budget for provider calls.
 * Everything is in memory with fixed upper bounds; nothing is persisted.
 */
import { createHash } from 'node:crypto';
import type { Transport, TransportResponse } from '../engine/transport.js';

export type RateDecision = { ok: true } | { ok: false; retryAfterS: number; scope: 'client' | 'global' | 'overflow' };

interface Window { start: number; count: number }

/**
 * Fixed one-minute windows.
 * - Per client key: `perKey` requests per window.
 * - All clients together: `globalPerWindow` requests per window. This protects
 *   the upstream providers, whose free tiers are the real capacity limit.
 * - At most `maxKeys` client windows are tracked. Expired windows are dropped
 *   first, oldest first, in O(1) amortised time. If the table is still full,
 *   new keys share one "overflow" window. Address spraying therefore cannot
 *   evict, or reset, the limits of clients already being tracked.
 */
export class RateLimiter {
  private windows = new Map<string, Window>();
  private overflow: Window = { start: -Infinity, count: 0 };
  private global: Window = { start: -Infinity, count: 0 };

  constructor(
    private perKey: number,
    private globalPerWindow: number,
    private maxKeys = 10_000,
    private windowMs = 60_000,
    private now: () => number = Date.now,
  ) {}

  get trackedKeys(): number { return this.windows.size; }

  check(key: string): RateDecision {
    const t = this.now();
    // Map iteration order is insertion order, and windows are re-inserted when
    // they restart, so the oldest windows are always at the front.
    for (const [k, w] of this.windows) {
      if (t - w.start < this.windowMs) break;
      this.windows.delete(k);
    }
    let w = this.windows.get(key);
    if (w && t - w.start >= this.windowMs) {
      // Expired but behind a live window in the map: restart it at the back.
      this.windows.delete(key);
      w = undefined;
    }
    let scope: 'client' | 'overflow' = 'client';
    if (!w) {
      if (this.windows.size < this.maxKeys) {
        w = { start: t, count: 0 };
        this.windows.set(key, w);
      } else {
        w = this.overflow;
        scope = 'overflow';
        if (t - w.start >= this.windowMs) { w.start = t; w.count = 0; }
      }
    }
    if (w.count >= this.perKey) return { ok: false, retryAfterS: this.wait(w, t), scope };
    if (t - this.global.start >= this.windowMs) this.global = { start: t, count: 0 };
    if (this.global.count >= this.globalPerWindow) return { ok: false, retryAfterS: this.wait(this.global, t), scope: 'global' };
    w.count++;
    this.global.count++;
    return { ok: true };
  }

  private wait(w: Window, t: number): number {
    return Math.max(1, Math.ceil((w.start + this.windowMs - t) / 1000));
  }
}

/**
 * Concurrency slots for story builds: a total cap and a per-client cap, so one
 * client cannot hold every slot. A short, bounded FIFO queue absorbs bursts:
 * at most `maxQueue` requests wait, each for at most `maxWaitMs`. Waiting
 * requests count toward their client's cap. Cache hits and joins onto an
 * identical in-flight build never reach this.
 */
export class Slots {
  private active = 0;
  private byClient = new Map<string, number>();
  private queue: Array<{ client: string; grant: (r: { release: () => void }) => void; timer: ReturnType<typeof setTimeout> }> = [];

  constructor(private max: number, private perClient: number, private maxQueue = 0, private maxWaitMs = 0) {}

  get inUse(): number { return this.active; }
  get waiting(): number { return this.queue.length; }

  /** Resolves with a release function, or with why no slot became available. */
  async acquire(client: string): Promise<{ release: () => void } | { refused: 'busy' | 'client-busy' }> {
    const mine = this.byClient.get(client) ?? 0;
    if (mine >= this.perClient) return { refused: 'client-busy' };
    if (this.active < this.max) return this.grant(client);
    if (this.queue.length >= this.maxQueue || this.maxWaitMs <= 0) return { refused: 'busy' };
    this.byClient.set(client, mine + 1); // reserve while waiting
    return new Promise((resolve) => {
      const entry = {
        client,
        grant: (r: { release: () => void }) => resolve(r),
        timer: setTimeout(() => {
          const i = this.queue.indexOf(entry);
          if (i >= 0) this.queue.splice(i, 1);
          this.dec(client);
          resolve({ refused: 'busy' });
        }, this.maxWaitMs),
      };
      this.queue.push(entry);
    });
  }

  /** Synchronous variant without queueing (kept for callers that must not wait). */
  tryAcquire(client: string): { release: () => void } | { refused: 'busy' | 'client-busy' } {
    if ((this.byClient.get(client) ?? 0) >= this.perClient) return { refused: 'client-busy' };
    if (this.active >= this.max) return { refused: 'busy' };
    return this.grant(client);
  }

  private grant(client: string, reserved = false): { release: () => void } {
    this.active++;
    if (!reserved) this.byClient.set(client, (this.byClient.get(client) ?? 0) + 1);
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        this.active--;
        this.dec(client);
        const next = this.queue.shift();
        if (next) { clearTimeout(next.timer); next.grant(this.grant(next.client, true)); }
      },
    };
  }

  private dec(client: string): void {
    const n = (this.byClient.get(client) ?? 1) - 1;
    if (n <= 0) this.byClient.delete(client); else this.byClient.set(client, n);
  }
}

/** LRU-by-insertion cache bounded by total approximate bytes as well as entry count. */
export class BoundedCache<V> {
  private map = new Map<string, { value: V; bytes: number; at: number }>();
  private total = 0;
  constructor(private maxBytes: number, private maxEntries: number, private ttlMs: number, private now: () => number = Date.now) {}

  get bytes(): number { return this.total; }
  get size(): number { return this.map.size; }

  get(key: string): V | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (this.now() - e.at >= this.ttlMs) { this.delete(key); return undefined; }
    return e.value;
  }

  set(key: string, value: V, bytes: number): void {
    if (bytes > this.maxBytes / 4) return; // one item may not dominate the cache
    this.delete(key);
    this.map.set(key, { value, bytes, at: this.now() });
    this.total += bytes;
    while (this.total > this.maxBytes || this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.delete(oldest);
    }
  }

  private delete(key: string): void {
    const e = this.map.get(key);
    if (!e) return;
    this.total -= e.bytes;
    this.map.delete(key);
  }
}

export const BUDGET_EXHAUSTED = 'story time budget exhausted';

/**
 * Gives one story build a wall-clock budget. Each provider request gets
 * min(its own timeout, the time left). Once the budget is spent, further
 * requests fail immediately, so the build finishes with partial data and
 * frees its slot instead of holding it through every fallback and page.
 */
export function withDeadline(inner: Transport, deadlineAt: number, defaultTimeoutMs: number, now: () => number = Date.now): Transport {
  return {
    send: async (req) => {
      const remaining = deadlineAt - now();
      if (remaining <= 0) {
        const res: TransportResponse = {
          ok: false, httpStatus: 0, text: '', sha256: createHash('sha256').update('').digest('hex'),
          retrievedAt: new Date(now()).toISOString(), mode: 'live', failure: BUDGET_EXHAUSTED,
        };
        return res;
      }
      return inner.send({ ...req, timeoutMs: Math.max(1, Math.min(req.timeoutMs ?? defaultTimeoutMs, remaining)) });
    },
  };
}

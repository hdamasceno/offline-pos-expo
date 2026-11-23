import { type BackoffOptions, DEFAULT_BACKOFF, backoffDelay } from './backoff';
import {
  type Clock,
  type KeyValueStorage,
  PermanentError,
  type Sale,
  type StockLevels,
  type StockSnapshot,
  type Transport,
  TransientError,
} from './types';

export interface OutboxEntry {
  sale: Sale;
  status: 'pending' | 'failed';
  attempts: number;
  /** Epoch ms; the entry is not sent before this. */
  nextAttemptAt: number;
  enqueuedAt: number;
  lastError?: string;
}

export interface SyncState {
  /** Oldest first. Order is kept: a sale is never sent before an older pending one. */
  outbox: OutboxEntry[];
  serverStock: StockLevels;
  stockVersion: number;
  lastSyncAt: number | null;
  lastError: string | null;
  syncing: boolean;
  loaded: boolean;
}

export interface FlushResult {
  sent: number;
  failed: number;
  /** Pending entries left (blocked by an error or waiting for backoff). */
  remaining: number;
}

interface PersistedV1 {
  v: 1;
  outbox: OutboxEntry[];
  serverStock: StockLevels;
  stockVersion: number;
  lastSyncAt: number | null;
}

export interface SyncEngineDeps {
  storage: KeyValueStorage;
  transport: Transport;
  clock?: Clock;
  random?: () => number;
  backoff?: BackoffOptions;
  storageKey?: string;
  initialStock?: StockSnapshot;
}

export const STORAGE_KEY = 'pos.sync.v1';

const systemClock: Clock = { now: () => Date.now() };

function isPersistedV1(x: unknown): x is PersistedV1 {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Partial<PersistedV1>;
  return o.v === 1 && Array.isArray(o.outbox) && typeof o.serverStock === 'object' && typeof o.stockVersion === 'number';
}

/**
 * The outbox and sync loop for offline-first sales.
 *
 * - `enqueue` resolves only after the sale is on disk, so "Charge" never loses a sale.
 * - `flush` sends pending sales oldest first. A transient error (offline, 5xx)
 *   stops the run and schedules a retry with backoff; nothing newer jumps ahead.
 *   A permanent error (4xx) moves that one sale aside as "failed" and continues.
 * - Every request carries the sale id as its idempotency key, so a retry after a
 *   lost response cannot double-count a sale.
 * - Stock from the server always wins; pending local sales are re-applied on top
 *   (see `projectStock`). Older stock snapshots are ignored by version.
 */
export class SyncEngine {
  private state: SyncState;
  private readonly listeners = new Set<() => void>();
  private inflight: Promise<FlushResult> | null = null;
  private readonly storage: KeyValueStorage;
  private readonly transport: Transport;
  private readonly clock: Clock;
  private readonly random: () => number;
  private readonly backoff: BackoffOptions;
  private readonly storageKey: string;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(deps: SyncEngineDeps) {
    this.storage = deps.storage;
    this.transport = deps.transport;
    this.clock = deps.clock ?? systemClock;
    this.random = deps.random ?? Math.random;
    this.backoff = deps.backoff ?? DEFAULT_BACKOFF;
    this.storageKey = deps.storageKey ?? STORAGE_KEY;
    this.state = {
      outbox: [],
      serverStock: { ...(deps.initialStock?.stock ?? {}) },
      stockVersion: deps.initialStock?.version ?? 0,
      lastSyncAt: null,
      lastError: null,
      syncing: false,
      loaded: false,
    };
  }

  // ---- observable state (works with React's useSyncExternalStore) ----

  getState = (): SyncState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<SyncState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  // ---- persistence ----

  /** Restores the outbox from storage. A corrupt record is reported and replaced, never thrown. */
  async load(): Promise<void> {
    const raw = await this.storage.getItem(this.storageKey);
    if (raw) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (!isPersistedV1(parsed)) throw new Error('unrecognised format');
        const newer = parsed.stockVersion >= this.state.stockVersion;
        this.set({
          outbox: parsed.outbox,
          lastSyncAt: parsed.lastSyncAt,
          ...(newer ? { serverStock: parsed.serverStock, stockVersion: parsed.stockVersion } : {}),
          loaded: true,
        });
        return;
      } catch (e) {
        this.set({ lastError: `Saved sync data was unreadable and was reset (${(e as Error).message})` });
      }
    }
    this.set({ loaded: true });
  }

  /** Writes are serialised so an older snapshot can never overwrite a newer one. */
  private persist(): Promise<void> {
    const { outbox, serverStock, stockVersion, lastSyncAt } = this.state;
    const data: PersistedV1 = { v: 1, outbox, serverStock, stockVersion, lastSyncAt };
    const json = JSON.stringify(data);
    this.writeChain = this.writeChain.then(() => this.storage.setItem(this.storageKey, json));
    return this.writeChain;
  }

  // ---- commands ----

  async enqueue(sale: Sale): Promise<void> {
    if (this.state.outbox.some((e) => e.sale.id === sale.id)) return; // already queued
    const now = this.clock.now();
    const entry: OutboxEntry = { sale, status: 'pending', attempts: 0, nextAttemptAt: now, enqueuedAt: now };
    this.set({ outbox: [...this.state.outbox, entry] });
    await this.persist();
  }

  /** Sends what is due. Concurrent calls share one run. */
  flush(): Promise<FlushResult> {
    this.inflight ??= this.runFlush().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  /** A person pressed "Sync now" (or the network came back): skip any backoff wait. */
  syncNow(): Promise<FlushResult> {
    const now = this.clock.now();
    this.set({
      outbox: this.state.outbox.map((e) =>
        e.status === 'pending' && e.nextAttemptAt > now ? { ...e, nextAttemptAt: now } : e,
      ),
    });
    return this.flush();
  }

  async retryFailed(saleId: string): Promise<void> {
    this.updateEntry(saleId, (e) => ({ ...e, status: 'pending', attempts: 0, nextAttemptAt: this.clock.now() }));
    await this.persist();
  }

  async discardFailed(saleId: string): Promise<void> {
    this.set({ outbox: this.state.outbox.filter((e) => !(e.sale.id === saleId && e.status === 'failed')) });
    await this.persist();
  }

  async refreshStock(): Promise<boolean> {
    try {
      const snap = await this.transport.fetchStock();
      this.applyStock(snap, true);
      await this.persist();
      return true;
    } catch (e) {
      this.set({ lastError: (e as Error).message });
      return false;
    }
  }

  /** Milliseconds until the next pending entry is due, or null if nothing is pending. */
  nextDueIn(): number | null {
    const head = this.state.outbox.find((e) => e.status === 'pending');
    if (!head) return null;
    return Math.max(0, head.nextAttemptAt - this.clock.now());
  }

  // ---- internals ----

  private updateEntry(saleId: string, fn: (e: OutboxEntry) => OutboxEntry): void {
    this.set({ outbox: this.state.outbox.map((e) => (e.sale.id === saleId ? fn(e) : e)) });
  }

  private applyStock(snap: StockSnapshot, full: boolean): void {
    if (snap.version < this.state.stockVersion) return; // stale: a newer snapshot already arrived
    const serverStock = full ? { ...snap.stock } : { ...this.state.serverStock, ...snap.stock };
    this.set({ serverStock, stockVersion: snap.version });
  }

  private async runFlush(): Promise<FlushResult> {
    let sent = 0;
    let failed = 0;
    this.set({ syncing: true });
    try {
      for (;;) {
        const entry = this.state.outbox.find((e) => e.status === 'pending');
        if (!entry || entry.nextAttemptAt > this.clock.now()) break;
        try {
          const result = await this.transport.submitSale(entry.sale);
          this.set({
            outbox: this.state.outbox.filter((e) => e.sale.id !== entry.sale.id),
            lastSyncAt: this.clock.now(),
            lastError: null,
          });
          this.applyStock(result, false);
          sent += 1;
        } catch (e) {
          if (e instanceof PermanentError) {
            this.updateEntry(entry.sale.id, (x) => ({ ...x, status: 'failed', lastError: e.code }));
            failed += 1;
            await this.persist();
            continue;
          }
          const attempts = entry.attempts + 1;
          const retryAfter = e instanceof TransientError ? e.retryAfterMs : undefined;
          const delay = backoffDelay(attempts, this.random, this.backoff, retryAfter);
          const message = (e as Error).message || 'Unknown error';
          this.updateEntry(entry.sale.id, (x) => ({
            ...x,
            attempts,
            nextAttemptAt: this.clock.now() + delay,
            lastError: message,
          }));
          this.set({ lastError: message });
          await this.persist();
          break;
        }
        await this.persist();
      }
    } finally {
      this.set({ syncing: false });
    }
    return { sent, failed, remaining: this.state.outbox.filter((e) => e.status === 'pending').length };
  }
}

/**
 * What the till should show: the last server stock minus every sale the server
 * has not seen yet. Failed (rejected) sales are not subtracted.
 */
export function projectStock(serverStock: StockLevels, outbox: readonly OutboxEntry[]): StockLevels {
  const result = { ...serverStock };
  for (const e of outbox) {
    if (e.status !== 'pending') continue;
    for (const l of e.sale.lines) result[l.sku] = (result[l.sku] ?? 0) - l.qty;
  }
  return result;
}

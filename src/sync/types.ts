import type { SaleInput } from '../server/inventory';

export type Sale = SaleInput;

export type StockLevels = Record<string, number>;

export interface StockSnapshot {
  stock: StockLevels;
  /** Monotonic server version; older snapshots are ignored. */
  version: number;
}

export interface SubmitResult extends StockSnapshot {
  duplicate: boolean;
  oversold: string[];
}

/** Worth retrying later: offline, timeout, 5xx, 429. */
export class TransientError extends Error {
  readonly retryAfterMs: number | undefined;
  constructor(message: string, retryAfterMs?: number) {
    super(message);
    this.name = 'TransientError';
    this.retryAfterMs = retryAfterMs;
  }
}

/** Retrying will never help: the server rejected the request itself. */
export class PermanentError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(`Rejected by server: ${code}`);
    this.name = 'PermanentError';
    this.code = code;
  }
}

export interface Transport {
  submitSale(sale: Sale): Promise<SubmitResult>;
  fetchStock(): Promise<StockSnapshot>;
}

/** The subset of AsyncStorage the engine needs, so tests can pass a Map. */
export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface Clock {
  now(): number;
}

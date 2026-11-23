import type { Clock, KeyValueStorage, Sale } from '../sync/types';

export class MemoryStorage implements KeyValueStorage {
  readonly data = new Map<string, string>();
  writes = 0;
  async getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  async setItem(key: string, value: string) {
    this.writes += 1;
    this.data.set(key, value);
  }
}

export class FakeClock implements Clock {
  constructor(public t = Date.UTC(2026, 4, 4, 9, 0, 0)) {}
  now() {
    return this.t;
  }
  advance(ms: number) {
    this.t += ms;
  }
}

/** A seeded PRNG so randomized tests are reproducible. */
export function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

let n = 0;
export function makeSale(lines: Array<[sku: string, qty: number]>, id = `sale-${String(++n).padStart(6, '0')}`): Sale {
  const saleLines = lines.map(([sku, qty]) => ({ sku, qty, unitPrice: 100, net: 100 * qty, tax: 0 }));
  const total = saleLines.reduce((s, l) => s + l.net, 0);
  return { id, createdAt: '2026-05-04T09:00:00.000Z', lines: saleLines, total, tax: 0 };
}

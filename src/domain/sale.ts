import type { Sale } from '../sync/types';
import type { CartTotals } from './cart';

/** Freezes a priced cart into the sale record that is queued and sent. */
export function buildSale(totals: CartTotals, id: string, now: Date): Sale {
  if (totals.lines.length === 0) throw new Error('Cannot build a sale from an empty cart');
  return {
    id,
    createdAt: now.toISOString(),
    lines: totals.lines.map((l) => ({ sku: l.sku, qty: l.qty, unitPrice: l.unitPrice, net: l.net, tax: l.tax })),
    total: totals.total,
    tax: totals.tax,
  };
}

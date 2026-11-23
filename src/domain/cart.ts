import type { Product } from './catalog';
import {
  type BasisPoints,
  type Cents,
  ZERO,
  add,
  allocate,
  bp,
  percentOf,
  sub,
  times,
} from './money';

export interface CartLine {
  sku: string;
  qty: number;
  /** Line discount, e.g. a damaged-item markdown. */
  discount: BasisPoints;
}

export interface Cart {
  lines: CartLine[];
  /** Whole-order discount, spread over the lines before tax. */
  orderDiscount: BasisPoints;
}

export const EMPTY_CART: Cart = { lines: [], orderDiscount: bp(0) };

export type CartAction =
  | { type: 'add'; sku: string }
  | { type: 'decrement'; sku: string }
  | { type: 'setQty'; sku: string; qty: number }
  | { type: 'remove'; sku: string }
  | { type: 'lineDiscount'; sku: string; discount: BasisPoints }
  | { type: 'orderDiscount'; discount: BasisPoints }
  | { type: 'clear' };

export const MAX_QTY = 999;

function updateLine(cart: Cart, sku: string, fn: (l: CartLine) => CartLine | null): Cart {
  const lines = cart.lines.flatMap((l) => {
    if (l.sku !== sku) return [l];
    const next = fn(l);
    return next ? [next] : [];
  });
  return { ...cart, lines };
}

export function cartReducer(cart: Cart, action: CartAction): Cart {
  switch (action.type) {
    case 'add':
      return cart.lines.some((l) => l.sku === action.sku)
        ? updateLine(cart, action.sku, (l) => ({ ...l, qty: Math.min(MAX_QTY, l.qty + 1) }))
        : { ...cart, lines: [...cart.lines, { sku: action.sku, qty: 1, discount: bp(0) }] };
    case 'decrement':
      return updateLine(cart, action.sku, (l) => (l.qty > 1 ? { ...l, qty: l.qty - 1 } : null));
    case 'setQty': {
      if (!Number.isInteger(action.qty) || action.qty < 0) return cart;
      const qty = Math.min(MAX_QTY, action.qty);
      return updateLine(cart, action.sku, (l) => (qty === 0 ? null : { ...l, qty }));
    }
    case 'remove':
      return updateLine(cart, action.sku, () => null);
    case 'lineDiscount':
      return updateLine(cart, action.sku, (l) => ({ ...l, discount: action.discount }));
    case 'orderDiscount':
      return { ...cart, orderDiscount: action.discount };
    case 'clear':
      return EMPTY_CART;
  }
}

export interface PricedLine {
  sku: string;
  name: string;
  qty: number;
  unitPrice: Cents;
  gross: Cents;
  /** Line discount plus this line's share of the order discount. */
  discount: Cents;
  net: Cents;
  tax: Cents;
}

export interface CartTotals {
  lines: PricedLine[];
  subtotal: Cents;
  discount: Cents;
  tax: Cents;
  total: Cents;
  itemCount: number;
}

/**
 * Prices a cart. Order of operations: line discount, then the order discount
 * (allocated across lines by their discounted value, to the cent), then tax per
 * line on what the customer actually pays. Every amount is an integer.
 */
export function priceCart(cart: Cart, catalog: ReadonlyMap<string, Product>): CartTotals {
  const base = cart.lines.map((l) => {
    const product = catalog.get(l.sku);
    if (!product) throw new Error(`Unknown SKU ${l.sku}`);
    const gross = times(product.price, l.qty);
    const lineDiscount = percentOf(gross, l.discount);
    return { l, product, gross, lineDiscount, afterLine: sub(gross, lineDiscount) };
  });

  const orderDiscount = percentOf(add(...base.map((b) => b.afterLine)), cart.orderDiscount);
  const shares = allocate(orderDiscount, base.map((b) => b.afterLine));

  const lines: PricedLine[] = base.map((b, i) => {
    const discount = add(b.lineDiscount, shares[i] ?? ZERO);
    const net = sub(b.gross, discount);
    return {
      sku: b.l.sku,
      name: b.product.name,
      qty: b.l.qty,
      unitPrice: b.product.price,
      gross: b.gross,
      discount,
      net,
      tax: percentOf(net, b.product.taxRate),
    };
  });

  const net = add(...lines.map((l) => l.net));
  const tax = add(...lines.map((l) => l.tax));
  return {
    lines,
    subtotal: add(...lines.map((l) => l.gross)),
    discount: add(...lines.map((l) => l.discount)),
    tax,
    total: add(net, tax),
    itemCount: lines.reduce((s, l) => s + l.qty, 0),
  };
}

export function catalogMap(products: readonly Product[]): ReadonlyMap<string, Product> {
  return new Map(products.map((p) => [p.sku, p]));
}

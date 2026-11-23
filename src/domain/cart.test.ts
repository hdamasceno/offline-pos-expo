import { DEMO_PRODUCTS } from './catalog';
import { type Cart, EMPTY_CART, MAX_QTY, cartReducer, catalogMap, priceCart } from './cart';
import { bp } from './money';

const catalog = catalogMap(DEMO_PRODUCTS);
const run = (...actions: Parameters<typeof cartReducer>[1][]): Cart => actions.reduce(cartReducer, EMPTY_CART);

describe('cartReducer', () => {
  it('adds, increments and decrements lines', () => {
    const cart = run({ type: 'add', sku: 'COF-ESP' }, { type: 'add', sku: 'COF-ESP' }, { type: 'add', sku: 'BAK-CRO' });
    expect(cart.lines).toEqual([
      { sku: 'COF-ESP', qty: 2, discount: 0 },
      { sku: 'BAK-CRO', qty: 1, discount: 0 },
    ]);
    const after = cartReducer(cartReducer(cart, { type: 'decrement', sku: 'BAK-CRO' }), { type: 'decrement', sku: 'COF-ESP' });
    expect(after.lines).toEqual([{ sku: 'COF-ESP', qty: 1, discount: 0 }]);
  });

  it('clamps and validates quantities', () => {
    const cart = run({ type: 'add', sku: 'COF-ESP' });
    expect(cartReducer(cart, { type: 'setQty', sku: 'COF-ESP', qty: 5000 }).lines[0]?.qty).toBe(MAX_QTY);
    expect(cartReducer(cart, { type: 'setQty', sku: 'COF-ESP', qty: -1 })).toBe(cart);
    expect(cartReducer(cart, { type: 'setQty', sku: 'COF-ESP', qty: 2.5 })).toBe(cart);
    expect(cartReducer(cart, { type: 'setQty', sku: 'COF-ESP', qty: 0 }).lines).toEqual([]);
  });

  it('does not mutate the previous state', () => {
    const cart = run({ type: 'add', sku: 'COF-ESP' });
    const frozen = JSON.stringify(cart);
    cartReducer(cart, { type: 'add', sku: 'COF-ESP' });
    cartReducer(cart, { type: 'remove', sku: 'COF-ESP' });
    expect(JSON.stringify(cart)).toBe(frozen);
  });

  it('clears', () => {
    expect(cartReducer(run({ type: 'add', sku: 'COF-ESP' }), { type: 'clear' })).toBe(EMPTY_CART);
  });
});

describe('priceCart', () => {
  it('prices an empty cart at zero', () => {
    expect(priceCart(EMPTY_CART, catalog)).toMatchObject({ subtotal: 0, discount: 0, tax: 0, total: 0, itemCount: 0 });
  });

  it('applies tax per line only on taxable products', () => {
    const t = priceCart(run({ type: 'add', sku: 'COF-ESP' }, { type: 'add', sku: 'MER-MUG' }), catalog);
    // Mug: 1499 * 8.25% = 123.67 -> 124. Espresso: no tax.
    expect(t.tax).toBe(124);
    expect(t.total).toBe(300 + 1499 + 124);
  });

  it('applies line discount, then the order discount, then tax, and totals add up', () => {
    const cart = run(
      { type: 'add', sku: 'MER-MUG' },
      { type: 'add', sku: 'MER-MUG' },
      { type: 'add', sku: 'BAK-CRO' },
      { type: 'lineDiscount', sku: 'MER-MUG', discount: bp(1000) },
      { type: 'orderDiscount', discount: bp(500) },
    );
    const t = priceCart(cart, catalog);
    const [mug, croissant] = t.lines;
    // Mug: 2998 - 300 (10%) = 2698. Croissant: 350. Order 5% of 3048 = 152.4 -> 152,
    // split 2698:350 -> 134.55 / 17.45 -> 135 / 17.
    expect(mug).toMatchObject({ gross: 2998, discount: 300 + 135, net: 2563 });
    expect(croissant).toMatchObject({ gross: 350, discount: 17, net: 333, tax: 0 });
    expect(mug?.tax).toBe(211); // 2563 * 8.25% = 211.4475
    expect(t.discount).toBe(452);
    expect(t.total).toBe(t.subtotal - t.discount + t.tax);
    expect(t.itemCount).toBe(3);
  });

  it('rejects a SKU that is not in the catalogue', () => {
    expect(() => priceCart(run({ type: 'add', sku: 'NOPE' }), catalog)).toThrow(/Unknown SKU/);
  });
});

import { DEMO_PRODUCTS } from './catalog';
import { EMPTY_CART, cartReducer, catalogMap, priceCart } from './cart';
import { parseSale } from '../server/inventory';
import { buildSale } from './sale';

describe('buildSale', () => {
  it('produces a record the server accepts', () => {
    const cart = [{ type: 'add', sku: 'MER-MUG' } as const, { type: 'add', sku: 'COF-ESP' } as const].reduce(cartReducer, EMPTY_CART);
    const sale = buildSale(priceCart(cart, catalogMap(DEMO_PRODUCTS)), 'sale-abcdef01', new Date('2026-05-04T10:00:00Z'));
    expect(sale).toMatchObject({ id: 'sale-abcdef01', createdAt: '2026-05-04T10:00:00.000Z', total: 1923, tax: 124 });
    expect(parseSale(JSON.parse(JSON.stringify(sale)))).toEqual(sale);
  });

  it('refuses an empty cart', () => {
    expect(() => buildSale(priceCart(EMPTY_CART, new Map()), 'x', new Date())).toThrow(/empty/);
  });
});

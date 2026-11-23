import { createInventory, parseSale } from './inventory';

const sale = (id: string, qty = 1) => ({
  id,
  createdAt: '2026-05-04T10:00:00.000Z',
  lines: [{ sku: 'A', qty, unitPrice: 100, net: 100 * qty, tax: 0 }],
  total: 100 * qty,
  tax: 0,
});
const post = (inv: ReturnType<typeof createInventory>, body: ReturnType<typeof sale>, key = body.id) =>
  inv.handle({ method: 'POST', path: '/sales', headers: { 'idempotency-key': key }, body });

describe('inventory API', () => {
  it('records a sale, lowers stock and bumps the version', () => {
    const inv = createInventory({ initialStock: { A: 5 } });
    const res = post(inv, sale('sale-0001', 2));
    expect(res).toEqual({ status: 201, body: { saleId: 'sale-0001', stock: { A: 3 }, version: 2, oversold: [], duplicate: false } });
    expect(inv.handle({ method: 'GET', path: '/stock', headers: {} }).body).toEqual({ stock: { A: 3 }, version: 2 });
  });

  it('replays the stored response for a repeated idempotency key', () => {
    const inv = createInventory({ initialStock: { A: 5 } });
    post(inv, sale('sale-0001'));
    const again = post(inv, sale('sale-0001'));
    expect(again.body).toMatchObject({ duplicate: true, stock: { A: 4 } });
    expect(inv.stockOf('A')).toBe(4);
    expect(inv.sales()).toHaveLength(1);
  });

  it('refuses a reused key with a different body', () => {
    const inv = createInventory({ initialStock: { A: 5 } });
    post(inv, sale('sale-0001'));
    expect(post(inv, sale('sale-0001', 3)).status).toBe(422);
  });

  it('accepts oversold sales and reports them', () => {
    const inv = createInventory({ initialStock: { A: 1 } });
    expect(post(inv, sale('sale-0001', 3)).body).toMatchObject({ stock: { A: -2 }, oversold: ['A'] });
  });

  it('validates input', () => {
    const inv = createInventory({ initialStock: { A: 1 } });
    expect(inv.handle({ method: 'POST', path: '/sales', headers: {}, body: sale('sale-0001') }).status).toBe(400);
    expect(post(inv, sale('sale-0001'), 'other-key-01').status).toBe(422);
    expect(post(inv, { ...sale('sale-0002'), lines: [{ sku: 'ZZ', qty: 1, unitPrice: 100, net: 100, tax: 0 }] }).body).toEqual({ error: 'unknown_sku' });
    expect(inv.handle({ method: 'GET', path: '/nope', headers: {} }).status).toBe(404);
  });

  it('can fail before processing, or lose the response after processing', () => {
    const inv = createInventory({ initialStock: { A: 5 }, failureRate: 1 });
    expect(post(inv, sale('sale-0001'))).toMatchObject({ status: 503, headers: { 'Retry-After': '1' } });
    expect(inv.stockOf('A')).toBe(5);
    inv.setFailureRates({ failureRate: 0, lostResponseRate: 1 });
    expect(post(inv, sale('sale-0002')).status).toBe(503);
    expect(inv.stockOf('A')).toBe(4); // processed even though the client saw an error
  });
});

describe('parseSale', () => {
  it.each([
    ['not an object', 42],
    ['short id', { ...sale('x'), id: 'x' }],
    ['bad date', { ...sale('sale-0001'), createdAt: 'yesterday' }],
    ['no lines', { ...sale('sale-0001'), lines: [] }],
    ['zero qty', { ...sale('sale-0001'), lines: [{ sku: 'A', qty: 0, unitPrice: 1, net: 0, tax: 0 }], total: 0 }],
    ['float money', { ...sale('sale-0001'), total: 1.5 }],
    ['total mismatch', { ...sale('sale-0001'), total: 999 }],
  ])('rejects %s', (_label, body) => {
    expect(parseSale(body)).toBeNull();
  });
});

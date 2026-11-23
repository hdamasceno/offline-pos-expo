/**
 * A tiny in-memory inventory API. It has no imports on purpose: the same code
 * runs inside the app (as an in-process fake backend for the demo and tests)
 * and in `server/index.ts` under plain Node.
 *
 * Behaviour that matters for the client:
 * - POST /sales needs an `Idempotency-Key`. Replaying a key returns the first
 *   response with `duplicate: true`; reusing a key with a different body is a 422.
 * - A sale is always accepted, even if it drives stock negative: the goods have
 *   already left the store, so the server records it and reports `oversold`.
 * - Every stock change bumps `version`, so clients can ignore stale snapshots.
 * - Failure injection: `failureRate` fails before processing (safe to retry),
 *   `lostResponseRate` processes the sale and then fails (only idempotency
 *   keeps a retry from double-counting it).
 */

export interface ApiRequest {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  body?: unknown;
}

export interface ApiResponse {
  status: number;
  headers?: Record<string, string>;
  body: unknown;
}

export interface InventoryOptions {
  initialStock: Record<string, number>;
  failureRate?: number;
  lostResponseRate?: number;
  random?: () => number;
}

export interface SaleLineInput {
  sku: string;
  qty: number;
  unitPrice: number;
  net: number;
  tax: number;
}

export interface SaleInput {
  id: string;
  createdAt: string;
  lines: SaleLineInput[];
  total: number;
  tax: number;
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);

export function parseSale(body: unknown): SaleInput | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.id !== 'string' || b.id.length < 8 || b.id.length > 64) return null;
  if (typeof b.createdAt !== 'string' || Number.isNaN(Date.parse(b.createdAt))) return null;
  if (!isInt(b.total) || !isInt(b.tax) || !Array.isArray(b.lines) || b.lines.length === 0) return null;
  const lines: SaleLineInput[] = [];
  for (const raw of b.lines as unknown[]) {
    if (typeof raw !== 'object' || raw === null) return null;
    const l = raw as Record<string, unknown>;
    if (typeof l.sku !== 'string' || !isInt(l.qty) || l.qty <= 0) return null;
    if (!isInt(l.unitPrice) || !isInt(l.net) || !isInt(l.tax)) return null;
    lines.push({ sku: l.sku, qty: l.qty, unitPrice: l.unitPrice, net: l.net, tax: l.tax });
  }
  const sum = lines.reduce((s, l) => s + l.net + l.tax, 0);
  if (sum !== b.total) return null;
  return { id: b.id, createdAt: b.createdAt, lines, total: b.total, tax: b.tax };
}

function header(req: ApiRequest, name: string): string | undefined {
  const key = Object.keys(req.headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? req.headers[key] : undefined;
}

export function createInventory(opts: InventoryOptions) {
  const random = opts.random ?? Math.random;
  const stock = new Map(Object.entries(opts.initialStock));
  let version = 1;
  const seen = new Map<string, { fingerprint: string; response: ApiResponse }>();
  const sales: SaleInput[] = [];
  let failureRate = opts.failureRate ?? 0;
  let lostResponseRate = opts.lostResponseRate ?? 0;

  const error = (status: number, code: string, extra: Record<string, string> = {}): ApiResponse => ({
    status,
    headers: extra,
    body: { error: code },
  });

  function postSale(req: ApiRequest): ApiResponse {
    const key = header(req, 'Idempotency-Key');
    if (!key) return error(400, 'missing_idempotency_key');

    const fingerprint = JSON.stringify(req.body);
    const previous = seen.get(key);
    if (previous) {
      if (previous.fingerprint !== fingerprint) return error(422, 'idempotency_key_reused');
      return { ...previous.response, body: { ...(previous.response.body as object), duplicate: true } };
    }

    if (random() < failureRate) return error(503, 'unavailable', { 'Retry-After': '1' });

    const sale = parseSale(req.body);
    if (!sale || sale.id !== key) return error(422, 'invalid_sale');
    const unknown = sale.lines.find((l) => !stock.has(l.sku));
    if (unknown) return error(422, 'unknown_sku');

    const affected: Record<string, number> = {};
    const oversold: string[] = [];
    for (const line of sale.lines) {
      const next = (stock.get(line.sku) ?? 0) - line.qty;
      stock.set(line.sku, next);
      affected[line.sku] = next;
      if (next < 0) oversold.push(line.sku);
    }
    version += 1;
    sales.push(sale);
    const response: ApiResponse = {
      status: 201,
      body: { saleId: sale.id, stock: affected, version, oversold, duplicate: false },
    };
    seen.set(key, { fingerprint, response });

    // The sale is stored, but the client never hears back.
    if (random() < lostResponseRate) return error(503, 'response_lost');
    return response;
  }

  function handle(req: ApiRequest): ApiResponse {
    const route = `${req.method.toUpperCase()} ${req.path.split('?')[0]}`;
    switch (route) {
      case 'GET /health':
        return { status: 200, body: { ok: true } };
      case 'GET /stock':
        return { status: 200, body: { stock: Object.fromEntries(stock), version } };
      case 'POST /sales':
        return postSale(req);
      default:
        return error(404, 'not_found');
    }
  }

  return {
    handle,
    /** Test and demo helpers. */
    sales: () => [...sales],
    stockOf: (sku: string) => stock.get(sku),
    setFailureRates(rates: { failureRate?: number; lostResponseRate?: number }) {
      failureRate = rates.failureRate ?? failureRate;
      lostResponseRate = rates.lostResponseRate ?? lostResponseRate;
    },
    /** Someone else (another till, a stock count) changed stock on the server. */
    adjustStock(sku: string, delta: number) {
      stock.set(sku, (stock.get(sku) ?? 0) + delta);
      version += 1;
    },
  };
}

export type Inventory = ReturnType<typeof createInventory>;

import { createHttpTransport, interpret, parseRetryAfter, withNetworkSwitch } from './transports';
import { PermanentError, TransientError } from './types';
import { makeSale } from '../test/fakes';

function fakeFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  return jest.fn(async () => new Response(JSON.stringify(body), { status, headers }));
}

describe('interpret', () => {
  it('maps statuses to results and error types', () => {
    expect(interpret({ status: 201, body: { ok: 1 } })).toEqual({ ok: 1 });
    expect(() => interpret({ status: 503, body: { error: 'x' } })).toThrow(TransientError);
    expect(() => interpret({ status: 429, body: null })).toThrow(TransientError);
    expect(() => interpret({ status: 422, body: { error: 'invalid_sale' } })).toThrow(new PermanentError('invalid_sale'));
    expect(() => interpret({ status: 404, body: null })).toThrow(new PermanentError('http_404'));
  });

  it('reads Retry-After seconds', () => {
    expect(parseRetryAfter('3')).toBe(3000);
    expect(parseRetryAfter('soon')).toBeUndefined();
    expect(parseRetryAfter(undefined)).toBeUndefined();
  });
});

describe('createHttpTransport', () => {
  it('posts the sale with its id as the idempotency key', async () => {
    const fetchFn = fakeFetch(201, { stock: { A: 1 }, version: 2, duplicate: false, oversold: [] });
    const t = createHttpTransport('https://api.example.test/', { fetchFn });
    const sale = makeSale([['A', 1]]);
    await expect(t.submitSale(sale)).resolves.toMatchObject({ version: 2 });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.test/sales');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe(sale.id);
    expect(JSON.parse(init.body as string)).toEqual(sale);
  });

  it('turns network failures and timeouts into transient errors', async () => {
    const offline = createHttpTransport('http://x.test', { fetchFn: jest.fn(() => Promise.reject(new TypeError('Network request failed'))) });
    await expect(offline.fetchStock()).rejects.toThrow(new TransientError('Network unavailable'));

    const hang = jest.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        }),
    );
    const slow = createHttpTransport('http://x.test', { fetchFn: hang as unknown as typeof fetch, timeoutMs: 10 });
    await expect(slow.fetchStock()).rejects.toThrow('Request timed out');
  });

  it('passes Retry-After through', async () => {
    const t = createHttpTransport('http://x.test', { fetchFn: fakeFetch(503, { error: 'unavailable' }, { 'Retry-After': '2' }) });
    await expect(t.fetchStock()).rejects.toMatchObject({ retryAfterMs: 2000 });
  });
});

describe('withNetworkSwitch', () => {
  it('fails fast while offline', async () => {
    const inner = { submitSale: jest.fn(), fetchStock: jest.fn(async () => ({ stock: {}, version: 1 })) };
    const net = withNetworkSwitch(inner, false);
    await expect(net.fetchStock()).rejects.toThrow('Offline');
    expect(inner.fetchStock).not.toHaveBeenCalled();
    net.setOnline(true);
    await expect(net.fetchStock()).resolves.toEqual({ stock: {}, version: 1 });
  });
});

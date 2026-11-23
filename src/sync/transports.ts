import type { ApiRequest, ApiResponse, Inventory } from '../server/inventory';
import {
  PermanentError,
  type Sale,
  type StockSnapshot,
  type SubmitResult,
  type Transport,
  TransientError,
} from './types';

/** Turns an HTTP-like response into a result or a typed error. */
export function interpret<T>(res: ApiResponse): T {
  if (res.status >= 200 && res.status < 300) return res.body as T;
  const code =
    typeof res.body === 'object' && res.body !== null && 'error' in res.body
      ? String((res.body as { error: unknown }).error)
      : `http_${res.status}`;
  if (res.status === 408 || res.status === 425 || res.status === 429 || res.status >= 500) {
    throw new TransientError(`Server busy (${code})`, parseRetryAfter(res.headers?.['Retry-After']));
  }
  throw new PermanentError(code);
}

/** `Retry-After` in seconds (HTTP-date is not supported by the demo server). */
export function parseRetryAfter(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const s = Number(value);
  return Number.isFinite(s) && s >= 0 ? s * 1000 : undefined;
}

/** Talks to the API over fetch. Used when EXPO_PUBLIC_API_URL is set. */
export function createHttpTransport(
  baseUrl: string,
  opts: { timeoutMs?: number; fetchFn?: typeof fetch } = {},
): Transport {
  const timeoutMs = opts.timeoutMs ?? 8_000;
  const fetchFn = opts.fetchFn ?? fetch;
  const root = baseUrl.replace(/\/+$/, '');

  async function call<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetchFn(`${root}${path}`, {
        method,
        headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });
    } catch (e) {
      const aborted = (e as Error).name === 'AbortError';
      throw new TransientError(aborted ? 'Request timed out' : 'Network unavailable');
    } finally {
      clearTimeout(timer);
    }
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }
    const retryAfter = res.headers.get('Retry-After');
    return interpret<T>({ status: res.status, body: parsed, ...(retryAfter ? { headers: { 'Retry-After': retryAfter } } : {}) });
  }

  return {
    submitSale: (sale) => call<SubmitResult>('POST', '/sales', sale, { 'Idempotency-Key': sale.id }),
    fetchStock: () => call<StockSnapshot>('GET', '/stock'),
  };
}

/**
 * Runs the inventory "server" inside the app. This keeps the demo self-contained
 * (Expo Go, web) while going through the same request/response contract.
 */
export function createInProcessTransport(inventory: Inventory, opts: { latencyMs?: number } = {}): Transport {
  const latency = opts.latencyMs ?? 0;
  const send = async <T>(req: ApiRequest): Promise<T> => {
    if (latency > 0) await new Promise((r) => setTimeout(r, latency));
    // Round-trip through JSON so the client never shares objects with the "server".
    const res = inventory.handle({ ...req, body: req.body === undefined ? undefined : JSON.parse(JSON.stringify(req.body)) });
    return interpret<T>(JSON.parse(JSON.stringify(res)) as ApiResponse);
  };
  return {
    submitSale: (sale: Sale) =>
      send<SubmitResult>({ method: 'POST', path: '/sales', headers: { 'Idempotency-Key': sale.id }, body: sale }),
    fetchStock: () => send<StockSnapshot>({ method: 'GET', path: '/stock', headers: {} }),
  };
}

export interface NetworkSwitch extends Transport {
  readonly online: boolean;
  setOnline(online: boolean): void;
}

/** Wraps a transport with an "airplane mode" switch for demos and tests. */
export function withNetworkSwitch(inner: Transport, initiallyOnline = true): NetworkSwitch {
  let online = initiallyOnline;
  const guard = <T>(fn: () => Promise<T>): Promise<T> =>
    online ? fn() : Promise.reject(new TransientError('Offline'));
  return {
    get online() {
      return online;
    },
    setOnline(next) {
      online = next;
    },
    submitSale: (sale) => guard(() => inner.submitSale(sale)),
    fetchStock: () => guard(() => inner.fetchStock()),
  };
}

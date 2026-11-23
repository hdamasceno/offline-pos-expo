export interface BackoffOptions {
  baseMs: number;
  capMs: number;
}

export const DEFAULT_BACKOFF: BackoffOptions = { baseMs: 1_000, capMs: 60_000 };

/**
 * Exponential backoff with "equal jitter": half of the window is fixed and half
 * is random. Jitter spreads retries from many tills that went offline together;
 * the fixed half stops a retry from firing almost immediately.
 *
 * attempt 1 -> 0.5..1 s, 2 -> 1..2 s, 3 -> 2..4 s, ... capped at `capMs`.
 * A server `Retry-After` is a floor.
 */
export function backoffDelay(
  attempt: number,
  random: () => number,
  opts: BackoffOptions = DEFAULT_BACKOFF,
  retryAfterMs?: number,
): number {
  if (!Number.isInteger(attempt) || attempt < 1) throw new RangeError('attempt starts at 1');
  const window = Math.min(opts.capMs, opts.baseMs * 2 ** (attempt - 1));
  const delay = Math.round(window / 2 + random() * (window / 2));
  return Math.max(delay, retryAfterMs ?? 0);
}

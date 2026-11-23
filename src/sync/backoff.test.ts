import { backoffDelay } from './backoff';

describe('backoffDelay', () => {
  const opts = { baseMs: 1000, capMs: 8000 };

  it('doubles the window and keeps half of it fixed', () => {
    expect([1, 2, 3, 4].map((a) => backoffDelay(a, () => 0, opts))).toEqual([500, 1000, 2000, 4000]);
    expect([1, 2, 3, 4].map((a) => backoffDelay(a, () => 1, opts))).toEqual([1000, 2000, 4000, 8000]);
  });

  it('is capped', () => {
    expect(backoffDelay(30, () => 1, opts)).toBe(8000);
  });

  it('never goes below Retry-After', () => {
    expect(backoffDelay(1, () => 0, opts, 5000)).toBe(5000);
  });

  it('rejects attempt numbers below 1', () => {
    expect(() => backoffDelay(0, Math.random)).toThrow(RangeError);
  });
});

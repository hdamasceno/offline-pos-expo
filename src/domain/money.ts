/**
 * Money is always an integer number of cents. Floating point never touches a
 * stored amount; percentages are integer basis points (1% = 100 bp).
 */
export type Cents = number & { readonly __brand: 'Cents' };
export type BasisPoints = number & { readonly __brand: 'BasisPoints' };

export function cents(value: number): Cents {
  if (!Number.isSafeInteger(value)) throw new RangeError(`Cents must be a safe integer, got ${value}`);
  return value as Cents;
}

export function bp(value: number): BasisPoints {
  if (!Number.isInteger(value) || value < 0 || value > 10_000) {
    throw new RangeError(`Basis points must be an integer from 0 to 10000, got ${value}`);
  }
  return value as BasisPoints;
}

export const ZERO = cents(0);

export function add(...values: Cents[]): Cents {
  return cents(values.reduce<number>((s, v) => s + v, 0));
}

export function sub(a: Cents, b: Cents): Cents {
  return cents(a - b);
}

export function times(a: Cents, qty: number): Cents {
  if (!Number.isInteger(qty)) throw new RangeError(`Quantity must be an integer, got ${qty}`);
  return cents(a * qty);
}

/**
 * Divides two integers and rounds half to even ("banker's rounding").
 * Rounding half-even avoids the upward bias of always rounding .5 up,
 * which adds up over thousands of tax lines.
 */
export function divRoundHalfEven(numerator: number, denominator: number): number {
  if (denominator <= 0 || !Number.isInteger(denominator)) throw new RangeError('denominator must be a positive integer');
  const sign = numerator < 0 ? -1 : 1;
  const n = Math.abs(numerator);
  const q = Math.floor(n / denominator);
  const r = n - q * denominator;
  const twice = 2 * r;
  let result = q;
  if (twice > denominator || (twice === denominator && q % 2 === 1)) result = q + 1;
  return sign * result;
}

/** `amount * rate`, rounded half-even to whole cents. */
export function percentOf(amount: Cents, rate: BasisPoints): Cents {
  return cents(divRoundHalfEven(amount * rate, 10_000));
}

/**
 * Splits `total` across `weights` so the parts are whole cents, proportional to the
 * weights, and add up to exactly `total` (largest remainder method). Ties go to the
 * earlier index, so the result is deterministic.
 */
export function allocate(total: Cents, weights: readonly number[]): Cents[] {
  if (weights.some((w) => w < 0 || !Number.isFinite(w))) throw new RangeError('weights must be >= 0');
  const sum = weights.reduce((s, w) => s + w, 0);
  if (weights.length === 0) return [];
  if (sum === 0) {
    // Nothing to weigh by: split evenly.
    return allocate(total, weights.map(() => 1));
  }
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const exact = weights.map((w) => (abs * w) / sum);
  const floors = exact.map(Math.floor);
  let left = abs - floors.reduce((s, v) => s + v, 0);
  const order = exact
    .map((e, i) => ({ i, frac: e - Math.floor(e) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i] = (floors[i] ?? 0) + 1;
    left -= 1;
  }
  return floors.map((v) => cents(sign * v));
}

/** Formats with `Intl.NumberFormat`, e.g. 123456 -> "$1,234.56". */
export function formatMoney(amount: Cents, currency = 'USD', locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount / 100);
}

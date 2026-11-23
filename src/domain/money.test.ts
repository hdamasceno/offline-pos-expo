import { add, allocate, bp, cents, divRoundHalfEven, formatMoney, percentOf, times } from './money';

describe('money', () => {
  it('only accepts integer cents and valid basis points', () => {
    expect(() => cents(1.5)).toThrow(RangeError);
    expect(() => bp(10_001)).toThrow(RangeError);
    expect(() => bp(-1)).toThrow(RangeError);
    expect(() => times(cents(100), 1.5)).toThrow(RangeError);
  });

  it('rounds half to even', () => {
    expect(divRoundHalfEven(5, 10)).toBe(0); // 0.5 -> 0
    expect(divRoundHalfEven(15, 10)).toBe(2); // 1.5 -> 2
    expect(divRoundHalfEven(25, 10)).toBe(2); // 2.5 -> 2
    expect(divRoundHalfEven(26, 10)).toBe(3);
    expect(divRoundHalfEven(-25, 10)).toBe(-2);
    expect(() => divRoundHalfEven(1, 0)).toThrow(RangeError);
  });

  it('computes percentages in whole cents', () => {
    expect(percentOf(cents(1499), bp(825))).toBe(124); // 123.6675 -> 124
    expect(percentOf(cents(200), bp(1250))).toBe(25);
    expect(percentOf(cents(1000), bp(0))).toBe(0);
  });

  it('allocates exactly, proportionally and deterministically', () => {
    expect(allocate(cents(100), [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(cents(-100), [1, 1, 1])).toEqual([-34, -33, -33]);
    expect(allocate(cents(10), [0, 0])).toEqual([5, 5]);
    expect(allocate(cents(7), [])).toEqual([]);
    expect(() => allocate(cents(1), [-1, 2])).toThrow(RangeError);
  });

  it('never loses or creates a cent when allocating (property check)', () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 500; i += 1) {
      const total = cents(Math.floor(rand() * 100_000) - 20_000);
      const weights = Array.from({ length: 1 + Math.floor(rand() * 8) }, () => Math.floor(rand() * 5000));
      const parts = allocate(total, weights);
      expect(add(...parts)).toBe(total);
      const sum = weights.reduce((s, w) => s + w, 0);
      parts.forEach((p, idx) => {
        const exact = sum === 0 ? total / weights.length : (total * (weights[idx] ?? 0)) / sum;
        expect(Math.abs(p - exact)).toBeLessThan(1);
      });
    }
  });

  it('formats currency', () => {
    expect(formatMoney(cents(123456))).toBe('$1,234.56');
    expect(formatMoney(cents(-5))).toBe('-$0.05');
  });
});

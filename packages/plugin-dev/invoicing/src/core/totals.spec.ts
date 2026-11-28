import { computeTotals } from './totals';

describe('computeTotals', () => {
  it('rounds each line to cents and adds tax on the subtotal', () => {
    // 1.33 h × 85 = 113.05; 2.5 h × 80 = 200.00; subtotal 313.05; 19% = 59.4795 → 59.48
    expect(
      computeTotals(
        [
          { title: 'a', hours: 1.33, rate: 85 },
          { title: 'b', hours: 2.5, rate: 80 },
        ],
        19,
      ),
    ).toEqual({ subtotalCents: 31305, taxCents: 5948, totalCents: 37253 });
  });

  it('has no tax at 0%', () => {
    expect(computeTotals([{ title: 'a', hours: 1, rate: 50 }], 0)).toEqual({
      subtotalCents: 5000,
      taxCents: 0,
      totalCents: 5000,
    });
  });
});

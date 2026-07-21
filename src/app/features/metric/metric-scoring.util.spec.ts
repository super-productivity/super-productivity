import {
  calculateProductivityScore,
  calculateSustainabilityScore,
} from './metric-scoring.util';

const expectApproximately = (
  value: number,
  expected: number,
  tolerance: number,
): void => {
  expect(value).toBeGreaterThanOrEqual(expected - tolerance);
  expect(value).toBeLessThanOrEqual(expected + tolerance);
};

describe('metric-scoring.util', () => {
  describe('calculateProductivityScore', () => {
    it('returns a lower score for low impact days even with solid focus time', () => {
      const score = calculateProductivityScore(1, 240, 240);
      expectApproximately(score, 48, 3);
    });

    it('captures medium-low impact days accurately', () => {
      const score = calculateProductivityScore(2, 180, 300);
      expectApproximately(score, 58, 3);
    });

    it('rewards medium-high impact once the focus target is met', () => {
      const score = calculateProductivityScore(3, 240, 360);
      expectApproximately(score, 82, 3);
    });

    it('awards the maximum score for high impact days that meet the focus target', () => {
      const score = calculateProductivityScore(4, 240, 600);
      expect(score).toBe(100);
    });

    it('penalizes busywork days with low impact and low focus', () => {
      const score = calculateProductivityScore(1, 120, 200, 240);
      expectApproximately(score, 33, 3);
    });

    it('treats efficient high-impact days with slightly less focus as excellent', () => {
      const score = calculateProductivityScore(4, 180, 240, 240);
      expectApproximately(score, 90, 2);
    });

    it('keeps impact as the primary driver when focus time is constant', () => {
      const low = calculateProductivityScore(1, 240, 240);
      const high = calculateProductivityScore(4, 240, 600);
      expect(high - low).toBeGreaterThanOrEqual(50);
      expect(high - low).toBeLessThanOrEqual(55);
    });

    it('gives full but no extra focus credit beyond the target', () => {
      const atTarget = calculateProductivityScore(4, 240, 600);
      const beyondTarget = calculateProductivityScore(4, 360, 600);
      expect(atTarget).toBe(100);
      expect(beyondTarget).toBe(100);
    });

    it('never decreases when focus continues past the target', () => {
      const atTarget = calculateProductivityScore(3, 240, 360);
      const justPastTarget = calculateProductivityScore(3, 241, 360);
      const farPastTarget = calculateProductivityScore(3, 300, 360);
      expect(justPastTarget).toBeGreaterThanOrEqual(atTarget);
      expect(farPastTarget).toBeGreaterThanOrEqual(justPastTarget);
    });

    it('keeps progress as a secondary factor relative to consistent impact', () => {
      const lowFocus = calculateProductivityScore(2, 120, 180);
      const highFocus = calculateProductivityScore(2, 240, 360);
      expect(highFocus - lowFocus).toBeGreaterThanOrEqual(14);
      expect(highFocus - lowFocus).toBeLessThanOrEqual(20);
    });
  });

  describe('calculateSustainabilityScore', () => {
    it('establishes a balanced baseline for typical workdays', () => {
      const score = calculateSustainabilityScore(240, 420, 2);
      expectApproximately(score, 49, 3);
    });

    it('applies only a mild penalty when focus exceeds the target slightly', () => {
      const baseline = calculateSustainabilityScore(240, 420, 2);
      const excessiveFocus = calculateSustainabilityScore(300, 420, 2);
      expect(excessiveFocus).toBeLessThanOrEqual(baseline);
    });

    it('rewards high energy levels while keeping effort reasonable', () => {
      const score = calculateSustainabilityScore(240, 420, 3);
      expectApproximately(score, 73, 3);
    });

    it('penalizes very excessive focus more than mild excess', () => {
      const mildlyExcessive = calculateSustainabilityScore(300, 420, 2);
      const veryExcessive = calculateSustainabilityScore(360, 420, 2);
      expect(veryExcessive).toBeLessThan(mildlyExcessive);
    });

    it('keeps extreme focus scores within a reasonable range', () => {
      const score = calculateSustainabilityScore(480, 420, 2);
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThan(50);
    });

    it('penalizes overwork even when focus time is optimal', () => {
      const score = calculateSustainabilityScore(240, 600, 2);
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThan(40);
    });

    it('detects burnout risk when long days combine with low energy', () => {
      const score = calculateSustainabilityScore(360, 600, 1);
      expect(score).toBeLessThanOrEqual(30);
    });
  });
});

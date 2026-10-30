import {
  classifyGesture,
  CLAIM_THRESHOLD_PX,
  EDGE_RESISTANCE,
  getPanOffset,
  getReleaseDirection,
  getSettleDurationMs,
  getVelocityX,
  MAX_CLAIM_DELAY_MS,
} from './swipe-pager-gesture';

describe('swipe-pager-gesture', () => {
  describe('classifyGesture', () => {
    it('waits until the touch has moved past the threshold', () => {
      expect(classifyGesture(CLAIM_THRESHOLD_PX - 1, 0, 50)).toBeNull();
    });

    it('claims a mostly horizontal move', () => {
      expect(classifyGesture(-30, 10, 80)).toBe('horizontal');
    });

    it('leaves a vertical or diagonal move to scrolling', () => {
      expect(classifyGesture(5, 30, 80)).toBe('other');
      expect(classifyGesture(20, 18, 80)).toBe('other');
    });

    it('leaves a move after a long press to the drag', () => {
      expect(classifyGesture(40, 0, MAX_CLAIM_DELAY_MS + 1)).toBe('other');
    });
  });

  describe('getPanOffset', () => {
    it('follows the finger towards an existing page', () => {
      expect(getPanOffset(-100, false, true)).toBe(-100);
      expect(getPanOffset(100, true, false)).toBe(100);
    });

    it('resists towards a missing page', () => {
      expect(getPanOffset(100, false, true)).toBe(100 * EDGE_RESISTANCE);
      expect(getPanOffset(-100, true, false)).toBe(-100 * EDGE_RESISTANCE);
    });
  });

  describe('getReleaseDirection', () => {
    const base = { width: 400, hasPrev: true, hasNext: true };

    it('pages past a quarter of the width', () => {
      expect(getReleaseDirection({ ...base, deltaX: -120, velocityX: 0 })).toBe(1);
      expect(getReleaseDirection({ ...base, deltaX: 120, velocityX: 0 })).toBe(-1);
    });

    it('stays below a quarter of the width without a fling', () => {
      expect(getReleaseDirection({ ...base, deltaX: -60, velocityX: -0.1 })).toBe(0);
    });

    it('pages on a short fling', () => {
      expect(getReleaseDirection({ ...base, deltaX: -30, velocityX: -0.8 })).toBe(1);
    });

    it('cancels on a fling back, however far the page was dragged', () => {
      expect(getReleaseDirection({ ...base, deltaX: -300, velocityX: 0.8 })).toBe(0);
    });

    it('never pages towards a missing page', () => {
      expect(
        getReleaseDirection({ ...base, hasPrev: false, deltaX: 300, velocityX: 2 }),
      ).toBe(0);
      expect(
        getReleaseDirection({ ...base, hasNext: false, deltaX: -300, velocityX: -2 }),
      ).toBe(0);
    });
  });

  describe('getSettleDurationMs', () => {
    it('is faster for a faster release and stays bounded', () => {
      const slow = getSettleDurationMs(300, 0);
      const fast = getSettleDurationMs(300, 3);
      expect(fast).toBeLessThan(slow);
      expect(getSettleDurationMs(5000, 0)).toBe(280);
      expect(getSettleDurationMs(1, 10)).toBe(120);
    });
  });

  describe('getVelocityX', () => {
    it('measures only the recent motion', () => {
      const samples = [
        { x: 0, t: 0 },
        { x: 10, t: 200 },
        { x: 60, t: 250 },
        { x: 110, t: 300 },
      ];
      expect(getVelocityX(samples)).toBe(1);
    });

    it('is 0 without enough samples', () => {
      expect(getVelocityX([{ x: 5, t: 1 }])).toBe(0);
    });
  });
});

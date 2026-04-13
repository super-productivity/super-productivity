// describe('StringToMsPipe', () => {
//   it('create an instance', () => {
//     const pipe = new StringToMsPipe();
//     expect(pipe).toBeTruthy();
//   });
// });

import { stringToMs } from './string-to-ms.pipe';

describe('stringToMs', () => {
  it('should work', () => {
    expect(stringToMs('1h 10m')).toBe(4200000);
  });

  // @covers #463
  it('should not return NaN for just h', () => {
    expect(stringToMs('h')).toBe(0);
  });

  // @covers #3737
  it('should work improved', () => {
    // Case: no spaces.
    expect(stringToMs('1h10m')).toBe(4200000);

    // Case: missing last unit.
    expect(stringToMs('1h 10')).toBe(4200000);
    expect(stringToMs('1h10')).toBe(4200000);

    // Case: using floats (with dot or comma separator).
    expect(stringToMs('1.5h')).toBe(5400000);
    expect(stringToMs('1,5h')).toBe(5400000);

    // Case: combining floats with subunits (opinionated choice: adds up).
    expect(stringToMs('1,5h 10m')).toBe(6000000);
  });

  it('should accept decimals without leading 0', () => {
    expect(stringToMs('.5h')).toBe(30 * 60 * 1000);
    expect(stringToMs(',5h')).toBe(30 * 60 * 1000);
  });

  it('should accept full time stings', () => {
    // Case: hh:mm
    // eslint-disable-next-line no-mixed-operators
    expect(stringToMs('02:30')).toBe((2 * 60 + 30) * 60 * 1000);

    // Case: h:mm
    // eslint-disable-next-line no-mixed-operators
    expect(stringToMs('2:15')).toBe((2 * 60 + 15) * 60 * 1000);
  });

  it('should reject incomplete hh:m', () => {
    // Case h:m
    expect(stringToMs('1:5')).toBe(0);

    // Case hh:m
    expect(stringToMs('03:8')).toBe(0);
  });

  it('should interpret numbers without unit', () => {
    // Case: integer (greater 8) missing all units => treat as minutes
    expect(stringToMs('10')).toBe(10 * 60 * 1000);

    // Case: integer (less or equal 8) missing all units => treat as hours
    expect(stringToMs('8')).toBe(8 * 60 * 60 * 1000);

    // Case: fractional missing all units => treat as hours
    expect(stringToMs('.5')).toBe(30 * 60 * 1000);
    expect(stringToMs('1.5')).toBe((60 + 30) * 60 * 1000);
    // eslint-disable-next-line no-mixed-operators
    expect(stringToMs('10.5')).toBe((10 * 60 + 30) * 60 * 1000);
  });

  describe('zero values', () => {
    it('should handle 0m correctly', () => {
      expect(stringToMs('0m')).toBe(0);
    });

    it('should handle 0h correctly', () => {
      expect(stringToMs('0h')).toBe(0);
    });

    it('should handle 0s correctly', () => {
      expect(stringToMs('0s')).toBe(0);
    });

    it('should handle 0 without unit', () => {
      expect(stringToMs('0')).toBe(0);
    });

    it('should handle 00:00', () => {
      expect(stringToMs('00:00')).toBe(0);
    });

    it('should handle 0:00', () => {
      expect(stringToMs('0:00')).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should handle empty string', () => {
      expect(stringToMs('')).toBe(0);
    });

    it('should handle null', () => {
      expect(stringToMs(null as any)).toBe(0);
    });

    it('should handle undefined', () => {
      expect(stringToMs(undefined as any)).toBe(0);
    });

    it('should handle whitespace only', () => {
      expect(stringToMs('   ')).toBe(0);
    });

    it('should handle invalid format', () => {
      expect(stringToMs('abc')).toBe(0);
      expect(stringToMs('123abc')).toBe(0);
    });
  });

  describe('all time units', () => {
    it('should handle seconds', () => {
      expect(stringToMs('30s')).toBe(30000);
      expect(stringToMs('1.5s')).toBe(1500);
    });

    it('should handle minutes', () => {
      expect(stringToMs('30m')).toBe(1800000);
      expect(stringToMs('1.5m')).toBe(90000);
    });

    it('should handle hours', () => {
      expect(stringToMs('2h')).toBe(7200000);
      expect(stringToMs('1.5h')).toBe(5400000);
    });

    it('should not handle days (removed unit)', () => {
      expect(stringToMs('1d')).toBe(0);
      expect(stringToMs('0.5d')).toBe(0);
    });
  });

  describe('complex formats', () => {
    it('should handle all units combined', () => {
      expect(stringToMs('2h 3m 4s')).toBe(7384000);
    });

    it('should handle units in any order', () => {
      expect(stringToMs('3m 2h 4s')).toBe(7384000);
    });

    it('should handle repeated units (last wins)', () => {
      expect(stringToMs('1h 30m 45m')).toBe(6300000); // 1h + 45m (30m is overwritten)
    });
  });
});

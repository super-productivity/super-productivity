import { normalizeClockStr } from './normalize-clock-str';
import { isValidSplitTime } from './is-valid-split-time';

describe('normalizeClockStr', () => {
  it('leaves a canonical HH:MM untouched', () => {
    expect(normalizeClockStr('14:30')).toBe('14:30');
    expect(normalizeClockStr('09:00')).toBe('09:00');
  });

  it('drops a trailing seconds component (the #7802 recovery case)', () => {
    expect(normalizeClockStr('13:30:00')).toBe('13:30');
    expect(normalizeClockStr('13:30:45')).toBe('13:30');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeClockStr('  14:30  ')).toBe('14:30');
    expect(normalizeClockStr('14:30:00 ')).toBe('14:30');
  });

  it('makes a recovered seconds value pass isValidSplitTime', () => {
    expect(isValidSplitTime('13:30:00')).toBe(false);
    expect(isValidSplitTime(normalizeClockStr('13:30:00'))).toBe(true);
  });

  it('does NOT invent a valid time from genuine garbage', () => {
    // out-of-range / non-numeric / incomplete values stay invalid after
    // normalization — recovery only strips a stray seconds component
    ['abc', '25:00', '13:60', '12', '13:30:abc', '13:30:60', '13:30:00:00'].forEach(
      (bad) => {
        expect(isValidSplitTime(normalizeClockStr(bad))).toBe(false);
      },
    );
  });

  it('leaves malformed third segments untouched', () => {
    ['13:30:abc', '13:30:60', '13:30:00:00'].forEach((bad) => {
      expect(normalizeClockStr(bad)).toBe(bad);
      expect(isValidSplitTime(normalizeClockStr(bad))).toBe(false);
    });
  });
});

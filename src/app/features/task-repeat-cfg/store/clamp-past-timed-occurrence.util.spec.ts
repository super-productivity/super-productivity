import { clampPastTimedOccurrence } from './clamp-past-timed-occurrence.util';
import { getDbDateStr } from '../../../util/get-db-date-str';

describe('clampPastTimedOccurrence', () => {
  const addDays = (days: number): Date => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(12, 0, 0, 0);
    return d;
  };

  it('returns the occurrence unchanged for non-timed cfgs (#7344 preservation)', () => {
    const pastDay = addDays(-20);
    const result = clampPastTimedOccurrence(pastDay, { startTime: undefined });
    expect(result).toBe(pastDay);
  });

  it('clamps past occurrences to today at noon when cfg is timed (#7354)', () => {
    const pastDay = addDays(-20);
    const result = clampPastTimedOccurrence(pastDay, { startTime: '10:00' });
    expect(result).not.toBeNull();
    expect(getDbDateStr(result!)).toBe(getDbDateStr());
    expect(result!.getHours()).toBe(12);
    expect(result!.getMinutes()).toBe(0);
  });

  it('preserves today occurrences for timed cfgs', () => {
    const today = addDays(0);
    const result = clampPastTimedOccurrence(today, { startTime: '10:00' });
    expect(result).toBe(today);
  });

  it('preserves future occurrences for timed cfgs', () => {
    const future = addDays(30);
    const result = clampPastTimedOccurrence(future, { startTime: '10:00' });
    expect(result).toBe(future);
  });

  it('returns null when the input is null', () => {
    expect(clampPastTimedOccurrence(null, { startTime: '10:00' })).toBeNull();
    expect(clampPastTimedOccurrence(null, { startTime: undefined })).toBeNull();
  });
});

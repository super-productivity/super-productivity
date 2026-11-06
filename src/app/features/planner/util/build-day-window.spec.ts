import { buildDayWindow } from './build-day-window';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { findSpringForwardSunday } from '../../tasks/dst.test-helper';

// 2026-01-14 is a wednesday.
const WEDNESDAY = new Date(2026, 0, 14, 12, 0, 0, 0);
const ALL_WEEK_DAYS = [0, 1, 2, 3, 4, 5, 6];
const WORK_WEEK_DAYS = [1, 2, 3, 4, 5];

describe('buildDayWindow', () => {
  it('should return count consecutive days starting at the given date', () => {
    expect(buildDayWindow(WEDNESDAY, 7, ALL_WEEK_DAYS, getDbDateStr)).toEqual([
      '2026-01-14',
      '2026-01-15',
      '2026-01-16',
      '2026-01-17',
      '2026-01-18',
      '2026-01-19',
      '2026-01-20',
    ]);
  });

  it('should skip excluded week days and still return count days', () => {
    expect(buildDayWindow(WEDNESDAY, 5, WORK_WEEK_DAYS, getDbDateStr)).toEqual([
      '2026-01-14',
      '2026-01-15',
      '2026-01-16',
      // saturday and sunday are excluded, so the window reaches further out
      '2026-01-19',
      '2026-01-20',
    ]);
  });

  it('should return an empty window when no week day is included', () => {
    expect(buildDayWindow(WEDNESDAY, 7, [], getDbDateStr)).toEqual([]);
  });

  it('should not mutate the start date', () => {
    const start = new Date(2026, 0, 14, 23, 30, 0, 0);
    const startMs = start.getTime();

    buildDayWindow(start, 7, ALL_WEEK_DAYS, getDbDateStr);

    expect(start.getTime()).toBe(startMs);
  });

  it('should keep the window consecutive across a spring-forward day', () => {
    // A spring-forward day is 23h long, so stepping the window in +24h ms
    // increments from a late-evening anchor lands past it and the date
    // disappears from the window entirely.
    const gap = findSpringForwardSunday(2026);
    if (!gap) {
      // Timezone without a spring-forward transition (UTC, Tokyo).
      expect(gap).toBeNull();
      return;
    }
    const saturday = new Date(gap.sunday);
    saturday.setDate(saturday.getDate() - 1);
    saturday.setHours(23, 30, 0, 0);
    const monday = new Date(gap.sunday);
    monday.setDate(monday.getDate() + 1);

    const days = buildDayWindow(saturday, 3, ALL_WEEK_DAYS, getDbDateStr);

    expect(days).toEqual([
      getDbDateStr(saturday),
      getDbDateStr(gap.sunday),
      getDbDateStr(monday),
    ]);
    // no day skipped and none repeated
    expect(new Set(days).size).toBe(days.length);
  });
});

import { getSimpleCounterStreakDuration } from './get-simple-counter-streak-duration';
import { SimpleCounterCopy } from './simple-counter.model';
import { getDbDateStr } from '../../util/get-db-date-str';

/* eslint-disable @typescript-eslint/naming-convention */

// DST-safe helper: uses calendar arithmetic (setDate) instead of
// millisecond subtraction (Date.now() - N * 86400000) which breaks
// during DST transitions when a day is 23 or 25 hours.
const daysAgo = (n: number): Date => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
};

describe('getSimpleCounterStreakDuration()', () => {
  const yesterday = daysAgo(1);
  const Y_STR = getDbDateStr(yesterday);

  const twoDaysAgo = daysAgo(2);
  const TWO_DAYS_AGO_STR = getDbDateStr(twoDaysAgo);

  describe('specific-days mode (existing behavior)', () => {
    const T1: Partial<SimpleCounterCopy>[] = [
      {
        id: '1',
        countOnDay: {},
        streakWeekDays: {},
      },
      {
        id: '1',
        countOnDay: { [getDbDateStr()]: 1 },
        isTrackStreaks: true,
        streakMinValue: 2,

        streakWeekDays: { 0: true, 1: true, 2: true, 3: true, 4: true, 5: true, 6: true },
      },
      {
        id: '1',
        countOnDay: { [getDbDateStr()]: 1 },
        isTrackStreaks: true,
        streakMinValue: 1,
        streakWeekDays: {
          0: false,
          1: false,
          2: false,
          3: false,
          4: false,
          5: false,
          6: false,
        },
      },
    ];
    T1.forEach((sc: Partial<SimpleCounterCopy>) => {
      it('should return 0 if no streak', () => {
        expect(getSimpleCounterStreakDuration(sc as SimpleCounterCopy)).toBe(0);
      });
    });

    const T2: Partial<SimpleCounterCopy>[] = [
      {
        id: '1',
        countOnDay: { [getDbDateStr()]: 1 },
        isTrackStreaks: true,
        streakMinValue: 1,
        streakWeekDays: {
          0: true,
          1: true,
          2: true,
          3: true,
          4: true,
          5: true,
          6: true,
        },
      },
      {
        id: '1',
        countOnDay: { [getDbDateStr()]: 3, [Y_STR]: 3, [TWO_DAYS_AGO_STR]: 0 },
        isTrackStreaks: true,
        streakMinValue: 1,
        streakWeekDays: {
          0: true,
          1: true,
          2: true,
          3: true,
          4: true,
          5: true,
          6: true,
          ...{ [yesterday.getDay()]: false },
        },
      },
    ];

    T2.forEach((sc: Partial<SimpleCounterCopy>) => {
      it('should return 1 if streak', () => {
        expect(getSimpleCounterStreakDuration(sc as SimpleCounterCopy)).toBe(1);
      });
    });

    //
    const T3: Partial<SimpleCounterCopy>[] = [
      {
        id: '1',
        countOnDay: { [getDbDateStr()]: 1, [Y_STR]: 1 },
        isTrackStreaks: true,
        streakMinValue: 1,
        streakWeekDays: {
          0: true,
          1: true,
          2: true,
          3: true,
          4: true,
          5: true,
          6: true,
        },
      },
      {
        id: '1',
        countOnDay: { [getDbDateStr()]: 3, [Y_STR]: 3, [TWO_DAYS_AGO_STR]: 3 },
        isTrackStreaks: true,
        streakMinValue: 1,
        streakWeekDays: {
          0: true,
          1: true,
          2: true,
          3: true,
          4: true,
          5: true,
          6: true,
          ...{ [yesterday.getDay()]: false },
        },
      },
    ];

    T3.forEach((sc: Partial<SimpleCounterCopy>) => {
      it('should return 2 if streak', () => {
        expect(getSimpleCounterStreakDuration(sc as SimpleCounterCopy)).toBe(2);
      });
    });

    //
    const T4: Partial<SimpleCounterCopy>[] = [
      {
        id: '1',
        countOnDay: {
          [getDbDateStr()]: 1,
          [getDbDateStr(daysAgo(1))]: 1,
          [getDbDateStr(daysAgo(2))]: 1,
          [getDbDateStr(daysAgo(3))]: 1,
          [getDbDateStr(daysAgo(4))]: 1,
          [getDbDateStr(daysAgo(5))]: 1,
          [getDbDateStr(daysAgo(6))]: 1,
          [getDbDateStr(daysAgo(7))]: 1,
          [getDbDateStr(daysAgo(8))]: 1,
          [getDbDateStr(daysAgo(9))]: 1,
          [getDbDateStr(daysAgo(10))]: 1,
          [getDbDateStr(daysAgo(11))]: 1,
          [getDbDateStr(daysAgo(12))]: 1,
          [getDbDateStr(daysAgo(13))]: 1,
        },
        isTrackStreaks: true,
        streakMinValue: 1,
        streakWeekDays: {
          0: true,
          1: true,
          2: true,
          3: true,
          4: true,
          5: true,
          6: true,
        },
      },
      {
        id: '1',
        countOnDay: {
          [getDbDateStr()]: 1,
          [getDbDateStr(daysAgo(1))]: 1,
          [getDbDateStr(daysAgo(2))]: 1,
          [getDbDateStr(daysAgo(3))]: 1,
          [getDbDateStr(daysAgo(4))]: 0,
          [getDbDateStr(daysAgo(5))]: 1,
          [getDbDateStr(daysAgo(6))]: 1,
          [getDbDateStr(daysAgo(7))]: 1,
          [getDbDateStr(daysAgo(8))]: 1,
          [getDbDateStr(daysAgo(9))]: 1,
          [getDbDateStr(daysAgo(10))]: 1,
          [getDbDateStr(daysAgo(11))]: 0,
          [getDbDateStr(daysAgo(12))]: 1,
          [getDbDateStr(daysAgo(13))]: 1,
          [getDbDateStr(daysAgo(14))]: 1,
          [getDbDateStr(daysAgo(15))]: 1,
        },
        isTrackStreaks: true,
        streakMinValue: 1,
        streakWeekDays: {
          0: true,
          1: true,
          2: true,
          3: true,
          4: true,
          5: true,
          6: true,
          ...{ [daysAgo(4).getDay()]: false },
        },
      },
    ];

    T4.forEach((sc: Partial<SimpleCounterCopy>) => {
      it('should return 14 if streak', () => {
        expect(getSimpleCounterStreakDuration(sc as SimpleCounterCopy)).toBe(14);
      });
    });

    //
    const T5: Partial<SimpleCounterCopy>[] = [
      {
        id: '1',
        countOnDay: {
          [getDbDateStr(daysAgo(1))]: 1,
          [getDbDateStr(daysAgo(2))]: 1,
          [getDbDateStr(daysAgo(3))]: 1,
          [getDbDateStr(daysAgo(4))]: 1,
          [getDbDateStr(daysAgo(5))]: 1,
          [getDbDateStr(daysAgo(6))]: 1,
          [getDbDateStr(daysAgo(7))]: 1,
          [getDbDateStr(daysAgo(8))]: 1,
          [getDbDateStr(daysAgo(9))]: 1,
          [getDbDateStr(daysAgo(10))]: 1,
          [getDbDateStr(daysAgo(11))]: 1,
          [getDbDateStr(daysAgo(12))]: 1,
          [getDbDateStr(daysAgo(13))]: 1,
        },
        isTrackStreaks: true,
        streakMinValue: 1,
        streakWeekDays: {
          0: true,
          1: true,
          2: true,
          3: true,
          4: true,
          5: true,
          6: true,
        },
      },
      {
        id: '1',
        countOnDay: {
          [getDbDateStr()]: 1,
          [getDbDateStr(daysAgo(1))]: 2,
          [getDbDateStr(daysAgo(2))]: 2,
          [getDbDateStr(daysAgo(3))]: 2,
          [getDbDateStr(daysAgo(4))]: 0,
          [getDbDateStr(daysAgo(5))]: 2,
          [getDbDateStr(daysAgo(6))]: 2,
          [getDbDateStr(daysAgo(7))]: 2,
          [getDbDateStr(daysAgo(8))]: 2,
          [getDbDateStr(daysAgo(9))]: 2,
          [getDbDateStr(daysAgo(10))]: 2,
          [getDbDateStr(daysAgo(11))]: 0,
          [getDbDateStr(daysAgo(12))]: 2,
          [getDbDateStr(daysAgo(13))]: 2,
          [getDbDateStr(daysAgo(14))]: 2,
          [getDbDateStr(daysAgo(15))]: 2,
        },
        isTrackStreaks: true,
        streakMinValue: 2,
        streakWeekDays: {
          0: true,
          1: true,
          2: true,
          3: true,
          4: true,
          5: true,
          6: true,
          ...{ [daysAgo(4).getDay()]: false },
        },
      },
    ];

    T5.forEach((sc: Partial<SimpleCounterCopy>) => {
      it('should start counting at yesterday not today', () => {
        expect(getSimpleCounterStreakDuration(sc as SimpleCounterCopy)).toBe(13);
      });
    });

    const T6: Partial<SimpleCounterCopy>[] = [
      {
        id: '1',
        countOnDay: {
          [getDbDateStr(daysAgo(1))]: 0,
          [getDbDateStr(daysAgo(2))]: 1,
          [getDbDateStr(daysAgo(3))]: 1,
          [getDbDateStr(daysAgo(4))]: 1,
          [getDbDateStr(daysAgo(5))]: 1,
          [getDbDateStr(daysAgo(6))]: 1,
          [getDbDateStr(daysAgo(7))]: 1,
          [getDbDateStr(daysAgo(8))]: 1,
          [getDbDateStr(daysAgo(9))]: 1,
          [getDbDateStr(daysAgo(10))]: 1,
          [getDbDateStr(daysAgo(11))]: 1,
          [getDbDateStr(daysAgo(12))]: 1,
          [getDbDateStr(daysAgo(13))]: 1,
        },
        isTrackStreaks: true,
        streakMinValue: 1,
        streakWeekDays: {
          0: true,
          1: true,
          2: true,
          3: true,
          4: true,
          5: true,
          6: true,
        },
      },
      {
        id: '1',
        countOnDay: {
          [getDbDateStr()]: 1,
          [getDbDateStr(daysAgo(1))]: 0,
          [getDbDateStr(daysAgo(2))]: 2,
          [getDbDateStr(daysAgo(3))]: 2,
          [getDbDateStr(daysAgo(4))]: 0,
          [getDbDateStr(daysAgo(5))]: 2,
          [getDbDateStr(daysAgo(6))]: 2,
          [getDbDateStr(daysAgo(7))]: 2,
          [getDbDateStr(daysAgo(8))]: 2,
          [getDbDateStr(daysAgo(9))]: 2,
          [getDbDateStr(daysAgo(10))]: 2,
          [getDbDateStr(daysAgo(11))]: 0,
          [getDbDateStr(daysAgo(12))]: 2,
          [getDbDateStr(daysAgo(13))]: 2,
          [getDbDateStr(daysAgo(14))]: 2,
          [getDbDateStr(daysAgo(15))]: 2,
        },
        isTrackStreaks: true,
        streakMinValue: 2,
        streakWeekDays: {
          0: true,
          1: true,
          2: true,
          3: true,
          4: true,
          5: true,
          6: true,
          ...{ [daysAgo(4).getDay()]: false },
        },
      },
    ];

    T6.forEach((sc: Partial<SimpleCounterCopy>) => {
      it('should return 0 if streak, and 13 when edited', () => {
        expect(getSimpleCounterStreakDuration(sc as SimpleCounterCopy)).toBe(0);

        (sc as SimpleCounterCopy).countOnDay[getDbDateStr(daysAgo(1))] = 2;

        expect(getSimpleCounterStreakDuration(sc as SimpleCounterCopy)).toBe(13);
      });
    });

    const T7: Partial<SimpleCounterCopy>[] = [
      {
        id: '1',
        countOnDay: {
          [getDbDateStr(daysAgo(1))]: 1,
          [getDbDateStr(daysAgo(2))]: 1,
          [getDbDateStr(daysAgo(3))]: 1,
          [getDbDateStr(daysAgo(4))]: 1,
          [getDbDateStr(daysAgo(5))]: 1,
          [getDbDateStr(daysAgo(6))]: 1,
          [getDbDateStr(daysAgo(7))]: 1,
          [getDbDateStr(daysAgo(8))]: 1,
          [getDbDateStr(daysAgo(9))]: 1,
          [getDbDateStr(daysAgo(10))]: 1,
          [getDbDateStr(daysAgo(11))]: 1,
          [getDbDateStr(daysAgo(12))]: 1,
          [getDbDateStr(daysAgo(13))]: 1,
        },
        isTrackStreaks: true,
        streakMinValue: 1,
        streakWeekDays: {
          0: true,
          1: true,
          2: true,
          3: true,
          4: true,
          5: true,
          6: true,
        },
      },
      {
        id: '1',
        countOnDay: {
          [getDbDateStr()]: 1,
          [getDbDateStr(daysAgo(1))]: 2,
          [getDbDateStr(daysAgo(2))]: 2,
          [getDbDateStr(daysAgo(3))]: 2,
          [getDbDateStr(daysAgo(4))]: 0,
          [getDbDateStr(daysAgo(5))]: 2,
          [getDbDateStr(daysAgo(6))]: 2,
          [getDbDateStr(daysAgo(7))]: 2,
          [getDbDateStr(daysAgo(8))]: 2,
          [getDbDateStr(daysAgo(9))]: 2,
          [getDbDateStr(daysAgo(10))]: 2,
          [getDbDateStr(daysAgo(11))]: 0,
          [getDbDateStr(daysAgo(12))]: 2,
          [getDbDateStr(daysAgo(13))]: 2,
          [getDbDateStr(daysAgo(14))]: 2,
          [getDbDateStr(daysAgo(15))]: 2,
        },
        isTrackStreaks: true,
        streakMinValue: 2,
        streakWeekDays: {
          0: true,
          1: true,
          2: true,
          3: true,
          4: true,
          5: true,
          6: true,
          ...{ [daysAgo(4).getDay()]: false },
        },
      },
    ];

    T7.forEach((sc: Partial<SimpleCounterCopy>) => {
      it('should return 13 if streak, and 0 when edited', () => {
        expect(getSimpleCounterStreakDuration(sc as SimpleCounterCopy)).toBe(13);

        (sc as SimpleCounterCopy).countOnDay[getDbDateStr(daysAgo(1))] = 0;

        expect(getSimpleCounterStreakDuration(sc as SimpleCounterCopy)).toBe(0);
      });
    });
  });

  describe('weekly-frequency mode (new behavior)', () => {
    // Use a fixed reference date (Thursday, 2026-01-30 12:00:00) to ensure deterministic test results
    // regardless of what day of the week the tests actually run
    const FIXED_REFERENCE_DATE = new Date('2026-01-30T12:00:00.000Z');

    beforeEach(() => {
      jasmine.clock().install();
      jasmine.clock().mockDate(FIXED_REFERENCE_DATE);
    });

    afterEach(() => {
      jasmine.clock().uninstall();
    });

    it('should return 0 if no frequency specified', () => {
      const counter: Partial<SimpleCounterCopy> = {
        id: '1',
        countOnDay: {},
        isTrackStreaks: true,
        streakMode: 'weekly-frequency',
        streakMinValue: 1,
      };
      expect(getSimpleCounterStreakDuration(counter as SimpleCounterCopy)).toBe(0);
    });

    it('should return 0 if current week has no completions', () => {
      const counter: Partial<SimpleCounterCopy> = {
        id: '1',
        countOnDay: {},
        isTrackStreaks: true,
        streakMode: 'weekly-frequency',
        streakMinValue: 1,
        streakWeeklyFrequency: 3,
      };
      expect(getSimpleCounterStreakDuration(counter as SimpleCounterCopy)).toBe(0);
    });

    it('should return 1 week streak for current week with 3 completions (frequency = 3)', () => {
      const counter: Partial<SimpleCounterCopy> = {
        id: '1',
        countOnDay: {
          [getDbDateStr(daysAgo(1))]: 1,
          [getDbDateStr(daysAgo(2))]: 1,
          [getDbDateStr(daysAgo(3))]: 1,
        },
        isTrackStreaks: true,
        streakMode: 'weekly-frequency',
        streakMinValue: 1,
        streakWeeklyFrequency: 3,
      };
      expect(getSimpleCounterStreakDuration(counter as SimpleCounterCopy)).toBe(3);
    });

    it('should return 1 for last week with 3 completions when current week is incomplete', () => {
      const counter: Partial<SimpleCounterCopy> = {
        id: '1',
        countOnDay: {
          // Last week - 3 completions
          [getDbDateStr(daysAgo(7))]: 1,
          [getDbDateStr(daysAgo(9))]: 1,
          [getDbDateStr(daysAgo(10))]: 1,
          // This week - only 1 completion
          [getDbDateStr(daysAgo(1))]: 1,
        },
        isTrackStreaks: true,
        streakMode: 'weekly-frequency',
        streakMinValue: 1,
        streakWeeklyFrequency: 3,
      };
      expect(getSimpleCounterStreakDuration(counter as SimpleCounterCopy)).toBe(4);
    });

    it('should return 5 days when previous week failed frequency (2 days) and last week met it (5 days)', () => {
      const counter: Partial<SimpleCounterCopy> = {
        id: '1',
        countOnDay: {
          // Two weeks ago - 2 completions (FAILS frequency of 3)
          [getDbDateStr(daysAgo(14))]: 1,
          [getDbDateStr(daysAgo(15))]: 1,
          // Last week - 5 completions (MEETS frequency of 3)
          [getDbDateStr(daysAgo(7))]: 1,
          [getDbDateStr(daysAgo(8))]: 1,
          [getDbDateStr(daysAgo(9))]: 1,
          [getDbDateStr(daysAgo(10))]: 1,
          [getDbDateStr(daysAgo(11))]: 1,
        },
        isTrackStreaks: true,
        streakMode: 'weekly-frequency',
        streakMinValue: 1,
        streakWeeklyFrequency: 3,
      };
      expect(getSimpleCounterStreakDuration(counter as SimpleCounterCopy)).toBe(5);
    });

    it('should return 7 days when previous week met frequency (3 days) and last week met it (4 days)', () => {
      const counter: Partial<SimpleCounterCopy> = {
        id: '1',
        countOnDay: {
          // Two weeks ago - 3 completions (MEETS frequency of 3)
          [getDbDateStr(daysAgo(14))]: 1,
          [getDbDateStr(daysAgo(15))]: 1,
          [getDbDateStr(daysAgo(16))]: 1,
          // Last week - 4 completions (MEETS frequency of 3)
          [getDbDateStr(daysAgo(7))]: 1,
          [getDbDateStr(daysAgo(8))]: 1,
          [getDbDateStr(daysAgo(9))]: 1,
          [getDbDateStr(daysAgo(10))]: 1,
        },
        isTrackStreaks: true,
        streakMode: 'weekly-frequency',
        streakMinValue: 1,
        streakWeeklyFrequency: 3,
      };
      expect(getSimpleCounterStreakDuration(counter as SimpleCounterCopy)).toBe(7);
    });

    it('should break streak if one week does not meet frequency', () => {
      const counter: Partial<SimpleCounterCopy> = {
        id: '1',
        countOnDay: {
          // Three weeks ago - 3 completions
          [getDbDateStr(daysAgo(21))]: 1,
          [getDbDateStr(daysAgo(22))]: 1,
          [getDbDateStr(daysAgo(23))]: 1,
          // Two weeks ago - only 2 completions (breaks streak!)
          [getDbDateStr(daysAgo(14))]: 1,
          [getDbDateStr(daysAgo(15))]: 1,
          // Last week - 3 completions
          [getDbDateStr(daysAgo(7))]: 1,
          [getDbDateStr(daysAgo(8))]: 1,
          [getDbDateStr(daysAgo(9))]: 1,
        },
        isTrackStreaks: true,
        streakMode: 'weekly-frequency',
        streakMinValue: 1,
        streakWeeklyFrequency: 3,
      };
      expect(getSimpleCounterStreakDuration(counter as SimpleCounterCopy)).toBe(3);
    });

    it('should respect streakMinValue for completion threshold', () => {
      const counter: Partial<SimpleCounterCopy> = {
        id: '1',
        countOnDay: {
          // Last week - 3 days but only 2 meet the min value
          [getDbDateStr(daysAgo(7))]: 5,
          [getDbDateStr(daysAgo(8))]: 5,
          [getDbDateStr(daysAgo(9))]: 2, // below threshold
        },
        isTrackStreaks: true,
        streakMode: 'weekly-frequency',
        streakMinValue: 3, // minimum value to count
        streakWeeklyFrequency: 3,
      };
      expect(getSimpleCounterStreakDuration(counter as SimpleCounterCopy)).toBe(0);
    });
  });
});

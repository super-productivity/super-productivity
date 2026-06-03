import {
  getRecurringInstanceAppearsShift,
  getRecurringInstanceDueDate,
  RecurringDueCtx,
} from './recurring-due-date.util';
import { TaskRepeatCfg } from '../task-repeat-cfg.model';

type DueCfg = Partial<TaskRepeatCfg>;
const due = (cfg: DueCfg, ctx: RecurringDueCtx): string | null =>
  getRecurringInstanceDueDate(cfg as TaskRepeatCfg, ctx);

// 2024-06-12 is a Wednesday (UTC).
const APPEARS = '2024-06-12';

describe('getRecurringInstanceDueDate', () => {
  describe('ON_OCCURRENCE', () => {
    it('defaults to the appears day when no dueType is set', () => {
      expect(due({}, { appearsDate: APPEARS })).toBe(APPEARS);
    });
    it('returns the appears day explicitly', () => {
      expect(due({ dueType: 'ON_OCCURRENCE' }, { appearsDate: APPEARS })).toBe(APPEARS);
    });
    it('returns null for an unparseable appears day', () => {
      expect(due({}, { appearsDate: 'nope' })).toBeNull();
    });
  });

  describe('NONE', () => {
    it('has no due day', () => {
      expect(due({ dueType: 'NONE' }, { appearsDate: APPEARS })).toBeNull();
    });
  });

  describe('FIXED', () => {
    it('returns the configured fixed date', () => {
      expect(
        due({ dueType: 'FIXED', dueFixedDate: '2026-12-31' }, { appearsDate: APPEARS }),
      ).toBe('2026-12-31');
    });
    it('returns null when no fixed date is set', () => {
      expect(due({ dueType: 'FIXED' }, { appearsDate: APPEARS })).toBeNull();
    });
  });

  describe('PERIOD_END', () => {
    it('snaps to the end of the month (default period)', () => {
      expect(due({ dueType: 'PERIOD_END' }, { appearsDate: APPEARS })).toBe('2024-06-30');
    });
    it('snaps to the end of the quarter', () => {
      expect(
        due({ dueType: 'PERIOD_END', duePeriod: 'QUARTER' }, { appearsDate: APPEARS }),
      ).toBe('2024-06-30');
    });
    it('snaps to the end of the year', () => {
      expect(
        due({ dueType: 'PERIOD_END', duePeriod: 'YEAR' }, { appearsDate: APPEARS }),
      ).toBe('2024-12-31');
    });
    it('snaps to the end of a Monday-start week (Sunday)', () => {
      expect(
        due(
          { dueType: 'PERIOD_END', duePeriod: 'WEEK' },
          { appearsDate: APPEARS, firstDayOfWeek: 1 },
        ),
      ).toBe('2024-06-16');
    });
    it('snaps to the end of a Sunday-start week (Saturday)', () => {
      expect(
        due(
          { dueType: 'PERIOD_END', duePeriod: 'WEEK' },
          { appearsDate: APPEARS, firstDayOfWeek: 0 },
        ),
      ).toBe('2024-06-15');
    });
    it('handles February month-end in a leap year', () => {
      expect(due({ dueType: 'PERIOD_END' }, { appearsDate: '2024-02-10' })).toBe(
        '2024-02-29',
      );
    });
  });

  describe('UNTIL_NEXT', () => {
    it('is the day before the next occurrence', () => {
      expect(
        due(
          { dueType: 'UNTIL_NEXT' },
          { appearsDate: APPEARS, nextAppearsDate: '2024-06-19' },
        ),
      ).toBe('2024-06-18');
    });
    it('falls back to its own appears day when there is no next occurrence', () => {
      expect(due({ dueType: 'UNTIL_NEXT' }, { appearsDate: APPEARS })).toBe(APPEARS);
    });
  });

  describe('OFFSET', () => {
    it('adds an explicit day offset', () => {
      expect(due({ dueType: 'OFFSET', dueOffset: 3 }, { appearsDate: APPEARS })).toBe(
        '2024-06-15',
      );
    });
    it('uses the inherited gap when no explicit offset is set', () => {
      expect(
        due({ dueType: 'OFFSET' }, { appearsDate: APPEARS, inheritedOffsetDays: 5 }),
      ).toBe('2024-06-17');
    });
    it('explicit offset takes precedence over the inherited gap', () => {
      expect(
        due(
          { dueType: 'OFFSET', dueOffset: 1 },
          { appearsDate: APPEARS, inheritedOffsetDays: 5 },
        ),
      ).toBe('2024-06-13');
    });
    it('supports a week unit', () => {
      expect(
        due(
          { dueType: 'OFFSET', dueOffset: 2, dueOffsetUnit: 'WEEK' },
          { appearsDate: APPEARS },
        ),
      ).toBe('2024-06-26');
    });
    it('supports a business-day unit (skips the weekend)', () => {
      // Wed +3 business days → Thu, Fri, (skip Sat/Sun) Mon 2024-06-17.
      expect(
        due(
          { dueType: 'OFFSET', dueOffset: 3, dueOffsetUnit: 'BUSINESS_DAY' },
          { appearsDate: APPEARS },
        ),
      ).toBe('2024-06-17');
    });
    it('supports a negative offset', () => {
      expect(due({ dueType: 'OFFSET', dueOffset: -2 }, { appearsDate: APPEARS })).toBe(
        '2024-06-10',
      );
    });
    it('lead-time (anchor=DUE) leaves the rrule day as the due day', () => {
      expect(
        due(
          { dueType: 'OFFSET', dueAnchor: 'DUE', dueOffset: 3 },
          { appearsDate: APPEARS },
        ),
      ).toBe(APPEARS);
    });
  });

  describe('FROM_COMPLETION', () => {
    it('adds the offset to the actual completion day', () => {
      expect(
        due(
          { dueType: 'FROM_COMPLETION', dueOffset: 2 },
          { appearsDate: APPEARS, completionDate: '2024-06-20' },
        ),
      ).toBe('2024-06-22');
    });
    it('falls back to the appears day when there is no completion yet (preview)', () => {
      expect(
        due({ dueType: 'FROM_COMPLETION', dueOffset: 2 }, { appearsDate: APPEARS }),
      ).toBe('2024-06-14');
    });
  });
});

describe('getRecurringInstanceAppearsShift', () => {
  it('moves the appears day earlier for lead-time (anchor=DUE)', () => {
    expect(
      getRecurringInstanceAppearsShift(
        { dueType: 'OFFSET', dueAnchor: 'DUE', dueOffset: 3 } as TaskRepeatCfg,
        '2024-06-15',
      ),
    ).toBe('2024-06-12');
  });
  it('moves earlier by business days, skipping the weekend', () => {
    // Mon 2024-06-17 − 3 business days → Fri, Thu, Wed 2024-06-12.
    expect(
      getRecurringInstanceAppearsShift(
        {
          dueType: 'OFFSET',
          dueAnchor: 'DUE',
          dueOffset: 3,
          dueOffsetUnit: 'BUSINESS_DAY',
        } as TaskRepeatCfg,
        '2024-06-17',
      ),
    ).toBe('2024-06-12');
  });
  it('passes the due day through unchanged for non lead-time configs', () => {
    expect(
      getRecurringInstanceAppearsShift(
        { dueType: 'OFFSET', dueAnchor: 'APPEARS', dueOffset: 3 } as TaskRepeatCfg,
        '2024-06-15',
      ),
    ).toBe('2024-06-15');
    expect(
      getRecurringInstanceAppearsShift(
        { dueType: 'ON_OCCURRENCE' } as TaskRepeatCfg,
        APPEARS,
      ),
    ).toBe(APPEARS);
  });
});

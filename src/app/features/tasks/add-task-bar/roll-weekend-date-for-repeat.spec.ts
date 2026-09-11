import { rollWeekendDateForRepeat } from './roll-weekend-date-for-repeat';
import { AddTaskBarRepeat } from './add-task-bar.const';

describe('rollWeekendDateForRepeat', () => {
  const WORKDAYS: AddTaskBarRepeat = {
    type: 'PRESET',
    quickSetting: 'MONDAY_TO_FRIDAY',
  };
  // 2026-03-27 is a Friday, 03-28 the Saturday, 03-29 the Sunday and 03-30 the
  // Monday after it
  const FRIDAY = '2026-03-27';
  const SATURDAY = '2026-03-28';
  const SUNDAY = '2026-03-29';
  const MONDAY = '2026-03-30';

  it('should roll a Saturday to the Monday after it', () => {
    expect(rollWeekendDateForRepeat(SATURDAY, WORKDAYS)).toBe(MONDAY);
  });

  it('should roll a Sunday to the Monday after it', () => {
    expect(rollWeekendDateForRepeat(SUNDAY, WORKDAYS)).toBe(MONDAY);
  });

  it('should leave a day the schedule already lands on alone', () => {
    expect(rollWeekendDateForRepeat(FRIDAY, WORKDAYS)).toBe(FRIDAY);
    expect(rollWeekendDateForRepeat(MONDAY, WORKDAYS)).toBe(MONDAY);
  });

  it('should leave a weekend day alone for every other schedule', () => {
    expect(
      rollWeekendDateForRepeat(SATURDAY, { type: 'PRESET', quickSetting: 'DAILY' }),
    ).toBe(SATURDAY);
    expect(
      rollWeekendDateForRepeat(SATURDAY, {
        type: 'PRESET',
        quickSetting: 'WEEKLY_CURRENT_WEEKDAY',
      }),
    ).toBe(SATURDAY);
    expect(
      rollWeekendDateForRepeat(SATURDAY, {
        type: 'INTERVAL',
        repeatCycle: 'WEEKLY',
        repeatEvery: 2,
      }),
    ).toBe(SATURDAY);
    expect(rollWeekendDateForRepeat(SATURDAY, { type: 'DIALOG' })).toBe(SATURDAY);
    expect(rollWeekendDateForRepeat(SATURDAY, null)).toBe(SATURDAY);
  });

  // Guarded before `dateStrToUtcDate` is called, so these run in every build:
  // unguarded, the Invalid Date it hands back renders as the literal
  // "NaN-NaN-NaN", and every caller persists and syncs what it gets back.
  describe('anything that is not a YYYY-MM-DD calendar day', () => {
    it('should be handed back unchanged', () => {
      expect(rollWeekendDateForRepeat('2026-02-30', WORKDAYS)).toBe('2026-02-30');
      expect(rollWeekendDateForRepeat('not-a-date', WORKDAYS)).toBe('not-a-date');
      // Would otherwise slip past a guard on the parse result: an empty string
      // makes `dateStrToUtcDate` return *today* rather than an Invalid Date,
      // so the roll would answer with a day the caller never asked about.
      expect(rollWeekendDateForRepeat('', WORKDAYS)).toBe('');
    });
  });
});

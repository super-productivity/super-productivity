import { getIntervalRepeatUpdates } from './get-interval-repeat-updates';
import { getDefaultSkipOverdue } from './get-default-skip-overdue';
import { DEFAULT_TASK_REPEAT_CFG } from '../task-repeat-cfg.model';

describe('getIntervalRepeatUpdates', () => {
  // Wed Jan 17 2024
  const REF = new Date(2024, 0, 17);

  it('should map a daily interval to a CUSTOM config anchored on the reference date', () => {
    expect(getIntervalRepeatUpdates('DAILY', 3, REF)).toEqual({
      quickSetting: 'CUSTOM',
      repeatCycle: 'DAILY',
      repeatEvery: 3,
      startDate: '2024-01-17',
    });
  });

  it('should restrict a weekly interval to the reference weekday', () => {
    const updates = getIntervalRepeatUpdates('WEEKLY', 2, REF);
    expect(updates).toEqual({
      quickSetting: 'CUSTOM',
      repeatCycle: 'WEEKLY',
      repeatEvery: 2,
      startDate: '2024-01-17',
      monday: false,
      tuesday: false,
      wednesday: true,
      thursday: false,
      friday: false,
      saturday: false,
      sunday: false,
    });
  });

  it('should override the Mon-Fri weekday defaults for a weekly interval', () => {
    // Spreading only cycle + interval over the defaults would mean "every other
    // week, Monday through Friday" — the weekday flags are an independent filter
    const cfg = {
      ...DEFAULT_TASK_REPEAT_CFG,
      ...getIntervalRepeatUpdates('WEEKLY', 2, REF),
    };
    expect(cfg.monday).toBe(false);
    expect(cfg.friday).toBe(false);
    expect(cfg.wednesday).toBe(true);
  });

  it('should clear monthly anchors for a monthly interval', () => {
    expect(getIntervalRepeatUpdates('MONTHLY', 2, REF)).toEqual({
      quickSetting: 'CUSTOM',
      repeatCycle: 'MONTHLY',
      repeatEvery: 2,
      startDate: '2024-01-17',
      monthlyWeekOfMonth: undefined,
      monthlyWeekday: undefined,
      monthlyLastDay: undefined,
    });
  });

  it('should map a yearly interval', () => {
    expect(getIntervalRepeatUpdates('YEARLY', 5, REF)).toEqual({
      quickSetting: 'CUSTOM',
      repeatCycle: 'YEARLY',
      repeatEvery: 5,
      startDate: '2024-01-17',
    });
  });

  it('should keep skipOverdue off for every-N-days, so a missed instance stays visible', () => {
    const cfg = {
      ...DEFAULT_TASK_REPEAT_CFG,
      ...getIntervalRepeatUpdates('DAILY', 3, REF),
    };
    expect(getDefaultSkipOverdue(cfg)).toBe(false);
  });
});

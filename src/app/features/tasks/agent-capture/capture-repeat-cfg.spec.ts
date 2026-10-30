import { TaskReminderOptionId } from '../task.model';
import { parseCaptureRepeat, toCaptureRepeatCfg } from './capture-repeat-cfg';

describe('parseCaptureRepeat', () => {
  it('reads cycle, interval and weekdays', () => {
    expect(parseCaptureRepeat({ cycle: 'daily' })).toEqual({ cycle: 'DAILY', every: 1 });
    expect(parseCaptureRepeat({ cycle: 'yearly', every: 2 })).toEqual({
      cycle: 'YEARLY',
      every: 2,
    });
    expect(
      parseCaptureRepeat({ cycle: 'weekly', weekdays: ['fri', 'mon', 'sun'] }),
    ).toEqual({ cycle: 'WEEKLY', every: 1, weekdays: [0, 1, 5] });
  });

  it('drops anything invalid, so the task stays one-off', () => {
    for (const value of [
      undefined,
      'daily',
      [],
      {},
      { cycle: 'hourly' },
      { cycle: 'toString' },
      { cycle: 'daily', every: 0 },
      { cycle: 'daily', every: 100 },
      { cycle: 'daily', every: 1.5 },
      { cycle: 'daily', weekdays: ['mon'] },
      { cycle: 'weekly', weekdays: [] },
      { cycle: 'weekly', weekdays: ['monday'] },
    ]) {
      expect(parseCaptureRepeat(value)).toBeUndefined();
    }
  });
});

describe('toCaptureRepeatCfg', () => {
  const opts = {
    title: 'Water plants',
    projectId: 'INBOX_PROJECT',
    // A Friday.
    startDay: '2026-10-16',
    defaultEstimate: 0,
    remindOption: TaskReminderOptionId.m10,
  };

  it('repeats a plain weekly series on the start day only', () => {
    const cfg = toCaptureRepeatCfg({ cycle: 'WEEKLY', every: 1 }, opts);
    expect(cfg).toEqual(
      jasmine.objectContaining({
        repeatCycle: 'WEEKLY',
        repeatEvery: 1,
        startDate: '2026-10-16',
        monday: false,
        friday: true,
        title: 'Water plants',
        projectId: 'INBOX_PROJECT',
        tagIds: [],
        startTime: undefined,
        remindAt: undefined,
        skipOverdue: false,
      }),
    );
  });

  it('uses the given weekdays and interval', () => {
    const cfg = toCaptureRepeatCfg(
      { cycle: 'WEEKLY', every: 2, weekdays: [1, 3] },
      { ...opts, startTime: '09:30' },
    );
    expect(cfg).toEqual(
      jasmine.objectContaining({
        repeatEvery: 2,
        sunday: false,
        monday: true,
        tuesday: false,
        wednesday: true,
        friday: false,
        startTime: '09:30',
        remindAt: TaskReminderOptionId.m10,
      }),
    );
  });

  it('skips pile-up only for an everyday series, like the add-task bar', () => {
    expect(toCaptureRepeatCfg({ cycle: 'DAILY', every: 1 }, opts).skipOverdue).toBe(true);
    expect(toCaptureRepeatCfg({ cycle: 'DAILY', every: 2 }, opts).skipOverdue).toBe(
      false,
    );
    const monthly = toCaptureRepeatCfg({ cycle: 'MONTHLY', every: 1 }, opts);
    expect(monthly.repeatCycle).toBe('MONTHLY');
    expect(monthly.startDate).toBe('2026-10-16');
    expect(monthly.skipOverdue).toBe(false);
  });
});

import { TaskReminderOptionId } from '../task.model';
import {
  millisecondsDiffToDeadlineRemindOption,
  millisecondsDiffToRemindOption,
  remindOptionToMilliseconds,
} from './remind-option-to-milliseconds';

describe('remindOptionToMilliseconds roundtrip', () => {
  const DUE_DATE = new Date('2026-01-01T12:00:00Z').getTime();

  const options = [
    TaskReminderOptionId.AtStart,
    TaskReminderOptionId.m5,
    TaskReminderOptionId.m10,
    TaskReminderOptionId.m15,
    TaskReminderOptionId.m30,
    TaskReminderOptionId.h1,
  ];

  options.forEach((optId) => {
    it(`should roundtrip correctly for ${optId}`, () => {
      const remindAt = remindOptionToMilliseconds(DUE_DATE, optId);
      expect(remindAt).toBeDefined();
      const resultOptId = millisecondsDiffToRemindOption(DUE_DATE, remindAt);
      expect(resultOptId).toBe(optId);
    });
  });

  it('should handle quantization correctly (rounding to nearest bucket)', () => {
    // 7 minutes before -> should round to m5 (since it's < 10m but >= 5m)
    const m7 = 7 * 60 * 1000;
    const remindAt7m = DUE_DATE - m7;
    expect(millisecondsDiffToRemindOption(DUE_DATE, remindAt7m)).toBe(
      TaskReminderOptionId.m5,
    );

    // 12 minutes before -> should round to m10
    const m12 = 12 * 60 * 1000;
    const remindAt12m = DUE_DATE - m12;
    expect(millisecondsDiffToRemindOption(DUE_DATE, remindAt12m)).toBe(
      TaskReminderOptionId.m10,
    );

    // 3 minutes before -> should round to m5 (since it's closer to 5 than 0)
    const m3 = 3 * 60 * 1000;
    const remindAt3m = DUE_DATE - m3;
    expect(millisecondsDiffToRemindOption(DUE_DATE, remindAt3m)).toBe(
      TaskReminderOptionId.m5,
    );

    // 1 minute before -> should round to AtStart
    const m1 = 1 * 60 * 1000;
    const remindAt1m = DUE_DATE - m1;
    expect(millisecondsDiffToRemindOption(DUE_DATE, remindAt1m)).toBe(
      TaskReminderOptionId.AtStart,
    );
  });
});

describe('millisecondsDiffToDeadlineRemindOption', () => {
  const DEADLINE = new Date('2026-01-10T12:00:00Z').getTime();
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;
  const TWO_HOURS = 2 * HOUR;
  const TWENTY_HOURS = 20 * HOUR;
  const TWO_AND_HALF_DAYS = 2.5 * DAY;
  const THREE_DAYS = 3 * DAY;
  const SIX_DAYS = 6 * DAY;

  [
    TaskReminderOptionId.AtStart,
    TaskReminderOptionId.m30,
    TaskReminderOptionId.h1,
    TaskReminderOptionId.d1,
    TaskReminderOptionId.d3,
    TaskReminderOptionId.w1,
  ].forEach((optId) => {
    it(`should roundtrip correctly for ${optId}`, () => {
      const remindAt = remindOptionToMilliseconds(DEADLINE, optId);
      expect(remindAt).toBeDefined();
      expect(millisecondsDiffToDeadlineRemindOption(DEADLINE, remindAt)).toBe(optId);
    });
  });

  it('should snap in-between diffs to the nearest long-lead bucket', () => {
    expect(millisecondsDiffToDeadlineRemindOption(DEADLINE, DEADLINE - TWO_HOURS)).toBe(
      TaskReminderOptionId.h1,
    );
    expect(
      millisecondsDiffToDeadlineRemindOption(DEADLINE, DEADLINE - TWENTY_HOURS),
    ).toBe(TaskReminderOptionId.d1);
    expect(
      millisecondsDiffToDeadlineRemindOption(DEADLINE, DEADLINE - TWO_AND_HALF_DAYS),
    ).toBe(TaskReminderOptionId.d3);
    expect(millisecondsDiffToDeadlineRemindOption(DEADLINE, DEADLINE - SIX_DAYS)).toBe(
      TaskReminderOptionId.w1,
    );
  });

  it('should return DoNotRemind without a reminder', () => {
    expect(millisecondsDiffToDeadlineRemindOption(DEADLINE, undefined)).toBe(
      TaskReminderOptionId.DoNotRemind,
    );
  });

  it('should keep the due-date mapping capped at 1 hour', () => {
    // scheduled-task dialogs only offer up to 1h; they must not get day options
    expect(millisecondsDiffToRemindOption(DEADLINE, DEADLINE - THREE_DAYS)).toBe(
      TaskReminderOptionId.h1,
    );
  });
});

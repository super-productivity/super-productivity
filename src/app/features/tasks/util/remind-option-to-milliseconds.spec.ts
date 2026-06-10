import { TaskReminderOptionId } from '../task.model';
import {
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

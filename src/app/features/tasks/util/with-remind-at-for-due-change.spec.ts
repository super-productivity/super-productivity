import { withRemindAtForDueChange } from './with-remind-at-for-due-change';
import { TaskReminderOptionId } from '../task.model';

describe('withRemindAtForDueChange', () => {
  const MIN_10 = 10 * 60 * 1000;
  const MIN_30 = 30 * 60 * 1000;
  const MIN_60 = 60 * 60 * 1000;
  const oldDue = new Date('2025-01-20T14:00:00Z').getTime();
  const newDue = new Date('2025-01-21T09:00:00Z').getTime();
  const hasRemindAt = (changes: object): boolean =>
    Object.prototype.hasOwnProperty.call(changes, 'remindAt');

  it('leaves changes alone when dueWithTime is not part of them', () => {
    const changes = { title: 'renamed' };
    const res = withRemindAtForDueChange(
      { dueWithTime: oldDue, remindAt: oldDue },
      changes,
      TaskReminderOptionId.AtStart,
    );
    expect(res.changes).toBe(changes);
    expect(res.isClearRemindAt).toBeFalse();
  });

  it('leaves remindAt alone when dueWithTime is unchanged', () => {
    const res = withRemindAtForDueChange(
      { dueWithTime: oldDue, remindAt: undefined },
      { dueWithTime: oldDue, title: 'renamed' },
      TaskReminderOptionId.AtStart,
    );
    expect(hasRemindAt(res.changes)).toBeFalse();
    expect(res.isClearRemindAt).toBeFalse();
  });

  it('uses the default remind option on a first-time schedule', () => {
    const res = withRemindAtForDueChange(
      { dueWithTime: undefined, remindAt: undefined },
      { dueWithTime: newDue },
      TaskReminderOptionId.m10,
    );
    expect(res.changes.remindAt).toBe(newDue - MIN_10);
    expect(res.isClearRemindAt).toBeFalse();
  });

  it('keeps the existing reminder offset on a reschedule', () => {
    const res = withRemindAtForDueChange(
      { dueWithTime: oldDue, remindAt: oldDue - MIN_30 },
      { dueWithTime: newDue },
      TaskReminderOptionId.AtStart,
    );
    expect(res.changes.remindAt).toBe(newDue - MIN_30);
    expect(res.isClearRemindAt).toBeFalse();
  });

  it('keeps an already scheduled task reminder-less on a reschedule (no default)', () => {
    const changes = { dueWithTime: newDue };
    const res = withRemindAtForDueChange(
      { dueWithTime: oldDue, remindAt: undefined },
      changes,
      TaskReminderOptionId.m10,
    );
    expect(res.changes).toBe(changes);
    expect(res.isClearRemindAt).toBeFalse();
  });

  it('falls back to the default when the task had a reminder but no dueWithTime', () => {
    const res = withRemindAtForDueChange(
      { dueWithTime: undefined, remindAt: oldDue },
      { dueWithTime: newDue },
      TaskReminderOptionId.h1,
    );
    expect(res.changes.remindAt).toBe(newDue - MIN_60);
    expect(res.isClearRemindAt).toBeFalse();
  });

  it('sets no reminder on a first-time schedule when the default is DoNotRemind', () => {
    const changes = { dueWithTime: newDue };
    const res = withRemindAtForDueChange(
      { dueWithTime: undefined, remindAt: undefined },
      changes,
      TaskReminderOptionId.DoNotRemind,
    );
    expect(res.changes).toBe(changes);
    expect(res.isClearRemindAt).toBeFalse();
  });

  it('signals a clear when DoNotRemind replaces a reminder of a day-only task', () => {
    const changes = { dueWithTime: newDue, dueDay: null };
    const res = withRemindAtForDueChange(
      { dueWithTime: undefined, remindAt: oldDue },
      changes,
      TaskReminderOptionId.DoNotRemind,
    );
    expect(res.changes).toBe(changes);
    expect(res.isClearRemindAt).toBeTrue();
  });

  it('signals a clear when dueWithTime is cleared with undefined', () => {
    const changes = { dueWithTime: undefined };
    const res = withRemindAtForDueChange(
      { dueWithTime: oldDue, remindAt: oldDue },
      changes,
      TaskReminderOptionId.AtStart,
    );
    expect(res.changes).toBe(changes);
    expect(res.isClearRemindAt).toBeTrue();
  });

  it('signals a clear when dueWithTime is cleared with null (CalDAV shape)', () => {
    const changes = { dueWithTime: null, dueDay: null };
    const res = withRemindAtForDueChange(
      { dueWithTime: oldDue, remindAt: oldDue },
      changes,
      TaskReminderOptionId.AtStart,
    );
    expect(res.changes).toBe(changes);
    expect(res.isClearRemindAt).toBeTrue();
  });

  it('does not signal a clear when clearing a task that had no reminder', () => {
    const changes = { dueWithTime: null };
    const res = withRemindAtForDueChange(
      { dueWithTime: oldDue, remindAt: undefined },
      changes,
      TaskReminderOptionId.AtStart,
    );
    expect(res.changes).toBe(changes);
    expect(res.isClearRemindAt).toBeFalse();
  });

  it('never puts an undefined remindAt into changes (dropped by JSON on the wire)', () => {
    const { AtStart, DoNotRemind, m10 } = TaskReminderOptionId;
    const cases: Parameters<typeof withRemindAtForDueChange>[] = [
      [{ dueWithTime: oldDue, remindAt: oldDue }, { dueWithTime: null }, AtStart],
      [{ dueWithTime: oldDue, remindAt: oldDue }, { dueWithTime: undefined }, AtStart],
      [
        { dueWithTime: undefined, remindAt: oldDue },
        { dueWithTime: newDue },
        DoNotRemind,
      ],
      [{ dueWithTime: oldDue, remindAt: undefined }, { dueWithTime: newDue }, m10],
    ];
    for (const args of cases) {
      const res = withRemindAtForDueChange(...args);
      expect(hasRemindAt(res.changes)).withContext(JSON.stringify(args)).toBeFalse();
    }
  });

  it('does not mutate the input changes', () => {
    const changes = { dueWithTime: newDue };
    withRemindAtForDueChange(
      { dueWithTime: undefined, remindAt: undefined },
      changes,
      TaskReminderOptionId.AtStart,
    );
    expect(hasRemindAt(changes)).toBeFalse();
  });
});

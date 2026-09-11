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
    expect(res).toBe(changes);
  });

  it('leaves remindAt alone when dueWithTime is unchanged', () => {
    const res = withRemindAtForDueChange(
      { dueWithTime: oldDue, remindAt: undefined },
      { dueWithTime: oldDue, title: 'renamed' },
      TaskReminderOptionId.AtStart,
    );
    expect(hasRemindAt(res)).toBeFalse();
  });

  it('uses the default remind option when the task had no reminder', () => {
    const res = withRemindAtForDueChange(
      { dueWithTime: undefined, remindAt: undefined },
      { dueWithTime: newDue },
      TaskReminderOptionId.m10,
    );
    expect(res.remindAt).toBe(newDue - MIN_10);
  });

  it('keeps the existing reminder offset on a reschedule', () => {
    const res = withRemindAtForDueChange(
      { dueWithTime: oldDue, remindAt: oldDue - MIN_30 },
      { dueWithTime: newDue },
      TaskReminderOptionId.AtStart,
    );
    expect(res.remindAt).toBe(newDue - MIN_30);
  });

  it('falls back to the default when the task had a reminder but no dueWithTime', () => {
    const res = withRemindAtForDueChange(
      { dueWithTime: undefined, remindAt: oldDue },
      { dueWithTime: newDue },
      TaskReminderOptionId.h1,
    );
    expect(res.remindAt).toBe(newDue - MIN_60);
  });

  it('sets no reminder when the default is DoNotRemind', () => {
    const res = withRemindAtForDueChange(
      { dueWithTime: undefined, remindAt: undefined },
      { dueWithTime: newDue },
      TaskReminderOptionId.DoNotRemind,
    );
    expect(hasRemindAt(res)).toBeTrue();
    expect(res.remindAt).toBeUndefined();
  });

  it('clears remindAt when dueWithTime is cleared with undefined', () => {
    const res = withRemindAtForDueChange(
      { dueWithTime: oldDue, remindAt: oldDue },
      { dueWithTime: undefined },
      TaskReminderOptionId.AtStart,
    );
    expect(hasRemindAt(res)).toBeTrue();
    expect(res.remindAt).toBeUndefined();
  });

  it('clears remindAt when dueWithTime is cleared with null (CalDAV shape)', () => {
    const res = withRemindAtForDueChange(
      { dueWithTime: oldDue, remindAt: oldDue },
      { dueWithTime: null, dueDay: null },
      TaskReminderOptionId.AtStart,
    );
    expect(hasRemindAt(res)).toBeTrue();
    expect(res.remindAt).toBeUndefined();
  });

  it('does not add a remindAt key when clearing a task that had no reminder', () => {
    const changes = { dueWithTime: null };
    const res = withRemindAtForDueChange(
      { dueWithTime: oldDue, remindAt: undefined },
      changes,
      TaskReminderOptionId.AtStart,
    );
    expect(res).toBe(changes);
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

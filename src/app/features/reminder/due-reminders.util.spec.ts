import { getDueReminders, getRemindersToActivate } from './due-reminders.util';
import { ReminderCopy } from './reminder.model';

describe('due-reminders.util', () => {
  it('should return due reminders sorted by remindAt', () => {
    const reminders = [
      _reminder({ id: 'future', remindAt: 3000 }),
      _reminder({ id: 'older', remindAt: 1000 }),
      _reminder({ id: 'newer', remindAt: 1500 }),
    ];

    expect(getDueReminders(reminders, 2000).map((reminder) => reminder.id)).toEqual([
      'older',
      'newer',
    ]);
  });

  it('should activate all due task reminders when the oldest due reminder is a task', () => {
    const reminders = [
      _reminder({ id: 'task-1', remindAt: 1000, type: 'TASK' }),
      _reminder({ id: 'note-1', remindAt: 1500, type: 'NOTE' }),
      _reminder({ id: 'task-2', remindAt: 1700, type: 'TASK' }),
    ];

    expect(getRemindersToActivate(reminders).map((reminder) => reminder.id)).toEqual([
      'task-1',
      'task-2',
    ]);
  });

  it('should only activate the oldest reminder when it is a note reminder', () => {
    const reminders = [
      _reminder({ id: 'note-1', remindAt: 1000, type: 'NOTE' }),
      _reminder({ id: 'task-1', remindAt: 1500, type: 'TASK' }),
    ];

    expect(getRemindersToActivate(reminders).map((reminder) => reminder.id)).toEqual([
      'note-1',
    ]);
  });
});

const _reminder = (reminder: Partial<ReminderCopy>): ReminderCopy => ({
  id: 'id',
  remindAt: 1000,
  title: 'Reminder',
  type: 'TASK',
  relatedId: 'task',
  ...reminder,
});

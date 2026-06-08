interface ReminderLike {
  remindAt: number;
  type?: string;
}

export const getDueReminders = <T extends ReminderLike>(
  reminders: readonly T[],
  now: number = Date.now(),
): T[] =>
  reminders
    .filter((reminder) => reminder.remindAt < now)
    .sort((a, b) => a.remindAt - b.remindAt);

export const getRemindersToActivate = <T extends ReminderLike>(
  reminders: readonly T[],
  now: number = Date.now(),
): T[] => {
  const dueReminders = getDueReminders(reminders, now);
  if (!dueReminders.length) {
    return [];
  }

  const oldest = dueReminders[0];
  return oldest.type === 'TASK'
    ? dueReminders.filter((reminder) => reminder.type === 'TASK')
    : [oldest];
};

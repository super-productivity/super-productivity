import { ReminderCopy } from './reminder.model';
import { TaskCopy } from '../tasks/task.model';

export type LegacyTaskReminder = Pick<
  ReminderCopy,
  'id' | 'relatedId' | 'remindAt' | 'type'
>;

type MutableLegacyTask = Partial<TaskCopy> & Pick<TaskCopy, 'id'>;
type LegacyTaskReminderTaskState = {
  entities?: Record<string, MutableLegacyTask | undefined>;
};

export const migrateLegacyTaskRemindersIntoTasks = (
  taskState: LegacyTaskReminderTaskState,
  reminders: LegacyTaskReminder[] | null | undefined,
): void => {
  if (!taskState?.entities || !Array.isArray(reminders)) {
    return;
  }

  const tasks = Object.values(taskState.entities);
  for (const reminder of reminders) {
    if (reminder?.type !== 'TASK' || typeof reminder.remindAt !== 'number') {
      continue;
    }

    const task =
      (typeof reminder.relatedId === 'string'
        ? taskState.entities[reminder.relatedId]
        : undefined) ?? tasks.find((t) => t?.reminderId === reminder.id);

    if (!task || task.isDone) {
      continue;
    }

    task.remindAt = reminder.remindAt;
    if (typeof task.dueWithTime !== 'number') {
      task.dueWithTime = reminder.remindAt;
      delete task.dueDay;
    }
    delete task.reminderId;
  }
};

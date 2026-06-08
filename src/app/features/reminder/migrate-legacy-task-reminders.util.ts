import { ReminderCopy } from './reminder.model';
import { TaskCopy } from '../tasks/task.model';

export type LegacyTaskReminder = Pick<
  ReminderCopy,
  'id' | 'relatedId' | 'remindAt' | 'type'
>;

export interface LegacyTaskReminderMigrationResult {
  migratedTaskIds: string[];
  skippedNoteCount: number;
}

export interface LegacyTaskReminderTaskState {
  ids?: readonly (string | number)[];
  entities?: Record<string, MutableLegacyTask | undefined>;
}

type MutableLegacyTask = Partial<TaskCopy> & Pick<TaskCopy, 'id'>;

export const migrateLegacyTaskRemindersIntoTasks = (
  taskState: LegacyTaskReminderTaskState,
  reminders: LegacyTaskReminder[] | null | undefined,
): LegacyTaskReminderMigrationResult => {
  const migratedTaskIdSet = new Set<string>();
  let skippedNoteCount = 0;

  if (!taskState?.entities || !Array.isArray(reminders)) {
    return { migratedTaskIds: [], skippedNoteCount };
  }

  for (const reminder of reminders) {
    if (reminder?.type === 'NOTE') {
      skippedNoteCount++;
      continue;
    }

    if (reminder?.type !== 'TASK' || typeof reminder.remindAt !== 'number') {
      continue;
    }

    const task = _findTaskForLegacyReminder(taskState, reminder);
    if (!task || task.isDone) {
      continue;
    }

    task.remindAt = reminder.remindAt;
    if (typeof task.dueWithTime !== 'number') {
      task.dueWithTime = reminder.remindAt;
    }
    delete task.reminderId;
    migratedTaskIdSet.add(task.id);
  }

  return {
    migratedTaskIds: [...migratedTaskIdSet],
    skippedNoteCount,
  };
};

const _findTaskForLegacyReminder = (
  taskState: LegacyTaskReminderTaskState,
  reminder: LegacyTaskReminder,
): MutableLegacyTask | undefined => {
  const { entities } = taskState;
  if (!entities) {
    return undefined;
  }

  const taskByRelatedId =
    typeof reminder.relatedId === 'string' ? entities[reminder.relatedId] : undefined;

  if (taskByRelatedId) {
    return taskByRelatedId;
  }

  if (typeof reminder.id !== 'string') {
    return undefined;
  }

  const taskIds = Array.isArray(taskState.ids) ? taskState.ids : Object.keys(entities);
  for (const taskId of taskIds) {
    const task = entities[String(taskId)];
    if (task?.reminderId === reminder.id) {
      return task;
    }
  }

  return undefined;
};

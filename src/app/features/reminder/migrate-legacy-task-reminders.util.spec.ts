/* eslint-disable @typescript-eslint/naming-convention */
import { migrateLegacyTaskRemindersIntoTasks } from './migrate-legacy-task-reminders.util';
import { TaskCopy } from '../tasks/task.model';

describe('migrateLegacyTaskRemindersIntoTasks', () => {
  it('should migrate task reminders by relatedId', () => {
    const taskState = _taskState({
      'task-1': _task({ id: 'task-1', reminderId: 'reminder-1' }),
    });

    const result = migrateLegacyTaskRemindersIntoTasks(taskState, [
      {
        id: 'reminder-1',
        relatedId: 'task-1',
        remindAt: 1704110400000,
        type: 'TASK',
      },
    ]);

    expect(taskState.entities['task-1']?.remindAt).toBe(1704110400000);
    expect(taskState.entities['task-1']?.dueWithTime).toBe(1704110400000);
    expect(taskState.entities['task-1']?.reminderId).toBeUndefined();
    expect(result).toEqual({ migratedTaskIds: ['task-1'], skippedNoteCount: 0 });
  });

  it('should migrate task reminders by legacy reminderId fallback', () => {
    const taskState = _taskState({
      'task-1': _task({ id: 'task-1', reminderId: 'reminder-1' }),
    });

    const result = migrateLegacyTaskRemindersIntoTasks(taskState, [
      {
        id: 'reminder-1',
        relatedId: 'missing-task',
        remindAt: 1704110400000,
        type: 'TASK',
      },
    ]);

    expect(taskState.entities['task-1']?.remindAt).toBe(1704110400000);
    expect(result.migratedTaskIds).toEqual(['task-1']);
  });

  it('should not overwrite existing dueWithTime', () => {
    const taskState = _taskState({
      'task-1': _task({
        id: 'task-1',
        reminderId: 'reminder-1',
        dueWithTime: 1704100000000,
      }),
    });

    migrateLegacyTaskRemindersIntoTasks(taskState, [
      {
        id: 'reminder-1',
        relatedId: 'task-1',
        remindAt: 1704110400000,
        type: 'TASK',
      },
    ]);

    expect(taskState.entities['task-1']?.remindAt).toBe(1704110400000);
    expect(taskState.entities['task-1']?.dueWithTime).toBe(1704100000000);
  });

  it('should skip note reminders and done tasks', () => {
    const taskState = _taskState({
      'task-1': _task({ id: 'task-1' }),
      'task-2': _task({ id: 'task-2', isDone: true }),
    });

    const result = migrateLegacyTaskRemindersIntoTasks(taskState, [
      {
        id: 'reminder-1',
        relatedId: 'task-1',
        remindAt: 1704110400000,
        type: 'NOTE',
      },
      {
        id: 'reminder-2',
        relatedId: 'task-2',
        remindAt: 1704110400000,
        type: 'TASK',
      },
    ]);

    expect(taskState.entities['task-1']?.remindAt).toBeUndefined();
    expect(taskState.entities['task-2']?.remindAt).toBeUndefined();
    expect(result).toEqual({ migratedTaskIds: [], skippedNoteCount: 1 });
  });
});

const _taskState = (
  entities: Record<string, TaskCopy>,
): { ids: string[]; entities: Record<string, TaskCopy> } => ({
  ids: Object.keys(entities),
  entities,
});

const _task = (task: Partial<TaskCopy>): TaskCopy =>
  ({
    id: 'task',
    projectId: 'project',
    title: 'Task',
    subTaskIds: [],
    timeSpentOnDay: {},
    timeSpent: 0,
    timeEstimate: 0,
    isDone: false,
    tagIds: [],
    created: 1704000000000,
    attachments: [],
    ...task,
  }) as TaskCopy;

import { getMarkDoneTaskChanges } from './get-mark-done-task-changes.util';
import { Task } from '../task.model';

const task = (overrides: Partial<Task> = {}): Task =>
  ({
    id: 't1',
    parentId: undefined,
    dueDay: undefined,
    dueWithTime: undefined,
    ...overrides,
  }) as Task;

describe('getMarkDoneTaskChanges', () => {
  describe('auto-add enabled', () => {
    it('does not suppress the completion-day stamp for an unscheduled top-level task', () => {
      expect(getMarkDoneTaskChanges(task(), true)).toEqual({ isDone: true });
    });
  });

  describe('auto-add disabled', () => {
    it('suppresses the stamp with an explicit null dueDay for an unscheduled top-level task', () => {
      expect(getMarkDoneTaskChanges(task(), false)).toEqual({
        isDone: true,
        dueDay: null,
      });
    });

    it('does not touch dueDay of a task already scheduled for a day', () => {
      expect(getMarkDoneTaskChanges(task({ dueDay: '2026-06-18' }), false)).toEqual({
        isDone: true,
      });
    });

    it('does not touch dueDay of a task scheduled with a time', () => {
      expect(getMarkDoneTaskChanges(task({ dueWithTime: 1718000000000 }), false)).toEqual(
        {
          isDone: true,
        },
      );
    });

    it('does not suppress for a subtask (subtasks are never auto-stamped)', () => {
      expect(getMarkDoneTaskChanges(task({ parentId: 'parent' }), false)).toEqual({
        isDone: true,
      });
    });
  });
});

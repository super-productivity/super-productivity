import { getMarkDoneTaskChanges } from './get-mark-done-task-changes.util';
import { Task } from '../task.model';

const TODAY = '2026-06-18';

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
    it('freezes the completion day for an unscheduled top-level task', () => {
      expect(getMarkDoneTaskChanges(task(), true, TODAY)).toEqual({
        isDone: true,
        dueDay: TODAY,
      });
    });
  });

  describe('auto-add disabled', () => {
    it('opts out with an explicit null dueDay for an unscheduled top-level task', () => {
      expect(getMarkDoneTaskChanges(task(), false, TODAY)).toEqual({
        isDone: true,
        dueDay: null,
      });
    });

    it('does not touch dueDay of a task already scheduled for a day', () => {
      expect(
        getMarkDoneTaskChanges(task({ dueDay: '2026-06-01' }), false, TODAY),
      ).toEqual({
        isDone: true,
      });
    });

    it('does not touch dueDay of a task scheduled with a time', () => {
      expect(
        getMarkDoneTaskChanges(task({ dueWithTime: 1718000000000 }), false, TODAY),
      ).toEqual({ isDone: true });
    });

    it('does not stamp a subtask (subtasks are never auto-stamped)', () => {
      expect(getMarkDoneTaskChanges(task({ parentId: 'parent' }), false, TODAY)).toEqual({
        isDone: true,
      });
    });
  });

  describe('scheduled task with auto-add enabled', () => {
    it('leaves an existing schedule untouched', () => {
      expect(getMarkDoneTaskChanges(task({ dueDay: '2026-06-01' }), true, TODAY)).toEqual(
        {
          isDone: true,
        },
      );
    });
  });
});

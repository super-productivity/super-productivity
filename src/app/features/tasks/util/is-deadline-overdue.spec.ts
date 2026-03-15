import { isDeadlineOverdue } from './is-deadline-overdue';
import { Task } from '../task.model';

const createTask = (overrides: Partial<Task> = {}): Task =>
  ({
    id: 'task1',
    isDone: false,
    deadlineDay: undefined,
    deadlineWithTime: undefined,
    ...overrides,
  }) as Task;

describe('isDeadlineOverdue', () => {
  const TODAY_STR = '2026-03-15';

  describe('done tasks', () => {
    it('should return false when task is done even with overdue deadlineDay', () => {
      const task = createTask({ isDone: true, deadlineDay: '2020-01-01' });
      expect(isDeadlineOverdue(task, TODAY_STR)).toBe(false);
    });

    it('should return false when task is done even with overdue deadlineWithTime', () => {
      const task = createTask({ isDone: true, deadlineWithTime: 1 });
      expect(isDeadlineOverdue(task, TODAY_STR)).toBe(false);
    });
  });

  describe('deadlineWithTime', () => {
    it('should return true when deadlineWithTime is in the past', () => {
      const pastTimestamp = Date.now() - 60_000;
      const task = createTask({ deadlineWithTime: pastTimestamp });
      expect(isDeadlineOverdue(task, TODAY_STR)).toBe(true);
    });

    it('should return false when deadlineWithTime is in the future', () => {
      const futureTimestamp = Date.now() + 60_000;
      const task = createTask({ deadlineWithTime: futureTimestamp });
      expect(isDeadlineOverdue(task, TODAY_STR)).toBe(false);
    });

    it('should take precedence over deadlineDay when both are set', () => {
      const futureTimestamp = Date.now() + 60_000;
      const task = createTask({
        deadlineWithTime: futureTimestamp,
        deadlineDay: '2020-01-01',
      });
      expect(isDeadlineOverdue(task, TODAY_STR)).toBe(false);
    });
  });

  describe('deadlineDay', () => {
    it('should return true when deadlineDay is before todayStr', () => {
      const task = createTask({ deadlineDay: '2026-03-14' });
      expect(isDeadlineOverdue(task, TODAY_STR)).toBe(true);
    });

    it('should return false when deadlineDay equals todayStr', () => {
      const task = createTask({ deadlineDay: '2026-03-15' });
      expect(isDeadlineOverdue(task, TODAY_STR)).toBe(false);
    });

    it('should return false when deadlineDay is after todayStr', () => {
      const task = createTask({ deadlineDay: '2026-03-16' });
      expect(isDeadlineOverdue(task, TODAY_STR)).toBe(false);
    });
  });

  describe('no deadline', () => {
    it('should return false when task has no deadline fields', () => {
      const task = createTask();
      expect(isDeadlineOverdue(task, TODAY_STR)).toBe(false);
    });
  });
});

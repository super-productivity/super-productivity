import {
  getLogicalTodayStartMs,
  isTaskOverdue,
  isTaskOverdueByThreshold,
} from './is-task-overdue';
import { Task } from '../task.model';

const createTask = (overrides: Partial<Task> = {}): Task =>
  ({
    id: 'task1',
    dueDay: undefined,
    dueWithTime: undefined,
    ...overrides,
  }) as Task;

describe('isTaskOverdue', () => {
  const TODAY_STR = '2026-03-15';
  const NO_OFFSET = 0;

  describe('dueDay', () => {
    it('is overdue when dueDay is before todayStr', () => {
      expect(
        isTaskOverdue(createTask({ dueDay: '2026-03-14' }), TODAY_STR, NO_OFFSET),
      ).toBe(true);
    });

    it('is not overdue when dueDay equals todayStr', () => {
      expect(
        isTaskOverdue(createTask({ dueDay: '2026-03-15' }), TODAY_STR, NO_OFFSET),
      ).toBe(false);
    });

    it('is not overdue when dueDay is after todayStr', () => {
      expect(
        isTaskOverdue(createTask({ dueDay: '2026-03-16' }), TODAY_STR, NO_OFFSET),
      ).toBe(false);
    });

    it('is not overdue when dueDay is not a valid YYYY-MM-DD string', () => {
      expect(
        isTaskOverdue(createTask({ dueDay: '3/14/2026' }), TODAY_STR, NO_OFFSET),
      ).toBe(false);
    });
  });

  describe('dueWithTime', () => {
    // Boundary is local start-of-day (dateStrToUtcDate returns local midnight),
    // so build timestamps with local Date constructors to stay timezone-safe.
    it('is overdue when dueWithTime is before the start of today', () => {
      const ts = new Date(2026, 2, 14, 23, 0, 0).getTime();
      expect(isTaskOverdue(createTask({ dueWithTime: ts }), TODAY_STR, NO_OFFSET)).toBe(
        true,
      );
    });

    it('is not overdue when dueWithTime is later today', () => {
      const ts = new Date(2026, 2, 15, 10, 0, 0).getTime();
      expect(isTaskOverdue(createTask({ dueWithTime: ts }), TODAY_STR, NO_OFFSET)).toBe(
        false,
      );
    });

    it('respects the start-of-next-day offset', () => {
      // A 4h offset pushes the logical start of "today" forward, so a moment
      // just after midnight still belongs to the previous logical day → overdue.
      const offset = 4 * 60 * 60 * 1000;
      const justAfterMidnight = new Date(2026, 2, 15, 1, 0, 0).getTime();
      expect(
        isTaskOverdue(createTask({ dueWithTime: justAfterMidnight }), TODAY_STR, offset),
      ).toBe(true);
      expect(
        isTaskOverdue(
          createTask({ dueWithTime: justAfterMidnight }),
          TODAY_STR,
          NO_OFFSET,
        ),
      ).toBe(false);
    });
  });

  describe('no due date', () => {
    it('is not overdue when the task has no due fields', () => {
      expect(isTaskOverdue(createTask(), TODAY_STR, NO_OFFSET)).toBe(false);
    });
  });

  describe('shared threshold contract', () => {
    it('getLogicalTodayStartMs returns local midnight shifted by the offset', () => {
      const localMidnight = new Date(2026, 2, 15).getTime();
      expect(getLogicalTodayStartMs(TODAY_STR, NO_OFFSET)).toBe(localMidnight);
      const offset = 4 * 60 * 60 * 1000;
      expect(getLogicalTodayStartMs(TODAY_STR, offset)).toBe(localMidnight + offset);
    });

    it('isTaskOverdue delegates to isTaskOverdueByThreshold with the computed threshold', () => {
      // Guards against the two overdue definitions drifting: isTaskOverdue must
      // equal the threshold predicate fed the same logical start-of-today.
      const offset = 4 * 60 * 60 * 1000;
      const threshold = getLogicalTodayStartMs(TODAY_STR, offset);
      const cases: Partial<Task>[] = [
        { dueDay: '2026-03-14' },
        { dueDay: '2026-03-15' },
        { dueWithTime: new Date(2026, 2, 15, 1, 0, 0).getTime() },
        {},
      ];
      cases.forEach((overrides) => {
        const task = createTask(overrides);
        expect(isTaskOverdue(task, TODAY_STR, offset)).toBe(
          isTaskOverdueByThreshold(task, TODAY_STR, threshold),
        );
      });
    });
  });
});

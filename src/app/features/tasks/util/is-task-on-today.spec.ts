import { isTaskOnToday } from './is-task-on-today';
import { Task } from '../task.model';

const createTask = (overrides: Partial<Task> = {}): Task =>
  ({
    id: 'task1',
    dueDay: undefined,
    dueWithTime: undefined,
    ...overrides,
  }) as Task;

/** Local-midnight ms for a YYYY-MM-DD, so the fixtures don't depend on the TZ. */
const localMs = (dateStr: string, h = 0, m = 0): number => {
  const [y, mo, d] = dateStr.split('-').map(Number);
  return new Date(y, mo - 1, d, h, m).getTime();
};

describe('isTaskOnToday', () => {
  const TODAY_STR = '2026-03-15';
  const NO_OFFSET = 0;

  describe('dueDay', () => {
    it('is on today when dueDay equals todayStr', () => {
      expect(
        isTaskOnToday(createTask({ dueDay: '2026-03-15' }), TODAY_STR, NO_OFFSET),
      ).toBe(true);
    });

    it('is not on today when dueDay is before todayStr', () => {
      expect(
        isTaskOnToday(createTask({ dueDay: '2026-03-14' }), TODAY_STR, NO_OFFSET),
      ).toBe(false);
    });

    it('is not on today when dueDay is after todayStr', () => {
      expect(
        isTaskOnToday(createTask({ dueDay: '2026-03-16' }), TODAY_STR, NO_OFFSET),
      ).toBe(false);
    });
  });

  describe('dueWithTime', () => {
    it('is on today when dueWithTime falls on todayStr', () => {
      expect(
        isTaskOnToday(
          createTask({ dueWithTime: localMs('2026-03-15', 9) }),
          TODAY_STR,
          NO_OFFSET,
        ),
      ).toBe(true);
    });

    it('is not on today when dueWithTime falls on another day', () => {
      expect(
        isTaskOnToday(
          createTask({ dueWithTime: localMs('2026-03-16', 9) }),
          TODAY_STR,
          NO_OFFSET,
        ),
      ).toBe(false);
    });

    it('wins over a dueDay that disagrees', () => {
      expect(
        isTaskOnToday(
          createTask({ dueDay: '2026-03-10', dueWithTime: localMs('2026-03-15', 9) }),
          TODAY_STR,
          NO_OFFSET,
        ),
      ).toBe(true);
    });
  });

  describe('startOfNextDayDiffMs', () => {
    const OFFSET_4H = 4 * 60 * 60 * 1000;

    it('counts the small hours as still belonging to the previous logical day', () => {
      // 02:00 on the 16th is before a 04:00 start-of-next-day, so it is still
      // the 15th — matching DateService.isToday().
      expect(
        isTaskOnToday(
          createTask({ dueWithTime: localMs('2026-03-16', 2) }),
          TODAY_STR,
          OFFSET_4H,
        ),
      ).toBe(true);
    });

    it('does not shift a task past the offset back onto today', () => {
      expect(
        isTaskOnToday(
          createTask({ dueWithTime: localMs('2026-03-16', 6) }),
          TODAY_STR,
          OFFSET_4H,
        ),
      ).toBe(false);
    });
  });

  describe('unscheduled', () => {
    it('is not on today when neither field is set', () => {
      expect(isTaskOnToday(createTask(), TODAY_STR, NO_OFFSET)).toBe(false);
    });

    it('is not on today for a zero dueWithTime', () => {
      expect(isTaskOnToday(createTask({ dueWithTime: 0 }), TODAY_STR, NO_OFFSET)).toBe(
        false,
      );
    });
  });
});

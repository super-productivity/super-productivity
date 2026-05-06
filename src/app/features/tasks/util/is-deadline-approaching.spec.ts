import { isDeadlineApproaching } from './is-deadline-approaching';
import { Task } from '../task.model';
import { getDbDateStr } from '../../../util/get-db-date-str';

const createTask = (overrides: Partial<Task> = {}): Task =>
  ({
    id: 'task1',
    isDone: false,
    deadlineDay: undefined,
    deadlineWithTime: undefined,
    ...overrides,
  }) as Task;

describe('isDeadlineApproaching', () => {
  const TODAY_STR = '2026-03-15';

  describe('done tasks', () => {
    it('returns false when task is done even for a near deadline', () => {
      const task = createTask({ isDone: true, deadlineDay: '2026-03-16' });
      expect(isDeadlineApproaching(task, TODAY_STR)).toBe(false);
    });
  });

  describe('deadlineDay (3-day window)', () => {
    it('returns true when deadlineDay is today (0 days away)', () => {
      const task = createTask({ deadlineDay: '2026-03-15' });
      expect(isDeadlineApproaching(task, TODAY_STR)).toBe(true);
    });

    it('returns true when deadlineDay is tomorrow (1 day away)', () => {
      const task = createTask({ deadlineDay: '2026-03-16' });
      expect(isDeadlineApproaching(task, TODAY_STR)).toBe(true);
    });

    it('returns true when deadlineDay is 2 days away', () => {
      const task = createTask({ deadlineDay: '2026-03-17' });
      expect(isDeadlineApproaching(task, TODAY_STR)).toBe(true);
    });

    it('returns false when deadlineDay is 3 days away (default color)', () => {
      const task = createTask({ deadlineDay: '2026-03-18' });
      expect(isDeadlineApproaching(task, TODAY_STR)).toBe(false);
    });

    it('returns false when deadlineDay is overdue (red color)', () => {
      const task = createTask({ deadlineDay: '2026-03-14' });
      expect(isDeadlineApproaching(task, TODAY_STR)).toBe(false);
    });

    it('returns false when deadlineDay is malformed', () => {
      const task = createTask({ deadlineDay: '3/15/2026' });
      expect(isDeadlineApproaching(task, TODAY_STR)).toBe(false);
    });
  });

  describe('deadlineWithTime (uses actual wall clock)', () => {
    // realTodayStr is captured per-test to avoid a midnight-rollover flake
    // between describe-time and it-time if the suite straddles local midnight.
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;

    it('returns true when deadlineWithTime is later today', () => {
      const now = Date.now();
      const task = createTask({ deadlineWithTime: now + 60_000 });
      expect(isDeadlineApproaching(task, getDbDateStr(now))).toBe(true);
    });

    it('returns true when deadlineWithTime is ~1 day away', () => {
      const now = Date.now();
      const task = createTask({ deadlineWithTime: now + ONE_DAY_MS });
      expect(isDeadlineApproaching(task, getDbDateStr(now))).toBe(true);
    });

    it('returns false when deadlineWithTime is in the past (overdue)', () => {
      const now = Date.now();
      const task = createTask({ deadlineWithTime: now - 60_000 });
      expect(isDeadlineApproaching(task, getDbDateStr(now))).toBe(false);
    });

    it('returns false when deadlineWithTime is 5 days away (default color)', () => {
      const now = Date.now();
      const fiveDaysMs = 5 * ONE_DAY_MS;
      const task = createTask({ deadlineWithTime: now + fiveDaysMs });
      expect(isDeadlineApproaching(task, getDbDateStr(now))).toBe(false);
    });
  });

  describe('no deadline', () => {
    it('returns false when task has no deadline fields', () => {
      expect(isDeadlineApproaching(createTask(), TODAY_STR)).toBe(false);
    });
  });
});

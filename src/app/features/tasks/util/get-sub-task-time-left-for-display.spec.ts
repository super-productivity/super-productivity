import { Task } from '../task.model';
import { createTask } from '../task.test-helper';
import { getSubTasksTotalTimeSpent } from '../pipes/sub-task-total-time-spent.pipe';
import { getSubTaskTimeLeftForDisplay } from './get-sub-task-time-left-for-display';
import { msToString } from '../../../ui/duration/ms-to-string.pipe';

const MINUTE = 60000;

const subTask = (
  id: string,
  timeEstimate: number,
  timeSpent: number,
  isDone = false,
): Task => createTask({ id, parentId: 'P', timeEstimate, timeSpent, isDone });

// Independent oracle: read a rendered duration ('1h 15m', '2m', '-') back as minutes.
const renderedMinutes = (rendered: string): number => {
  const hours = /(\d+)h/.exec(rendered);
  const minutes = /(\d+)m/.exec(rendered);
  return (hours ? +hours[1] * 60 : 0) + (minutes ? +minutes[1] : 0);
};

// What the parent row puts on screen: 'Σ time spent / ⏳ time left'.
const renderedPair = (subTasks: Task[]): string =>
  `${msToString(getSubTasksTotalTimeSpent(subTasks))} / ${msToString(getSubTaskTimeLeftForDisplay(subTasks))}`;

const renderedPairInMinutes = (subTasks: Task[]): number =>
  renderedMinutes(msToString(getSubTasksTotalTimeSpent(subTasks))) +
  renderedMinutes(msToString(getSubTaskTimeLeftForDisplay(subTasks)));

describe('getSubTaskTimeLeftForDisplay', () => {
  describe('while the two cells are halves of one total', () => {
    it('should render a pair that adds up to the sub task estimates', () => {
      // reported case: 2m and 1m sub tasks, 2998ms tracked on the first one
      expect(
        renderedPairInMinutes([subTask('a', 2 * MINUTE, 2998), subTask('b', MINUTE, 0)]),
      ).toBe(3);
      // reported case: 1:15 estimated, 15m44s tracked
      expect(
        renderedPairInMinutes([
          subTask('a', 60 * MINUTE, 944000),
          subTask('b', 15 * MINUTE, 0),
        ]),
      ).toBe(75);
    });

    it('should keep counting down without jumping back up while time is tracked', () => {
      const rendered: string[] = [];
      for (let spentMs = 2998; spentMs <= 182998; spentMs += 1000) {
        rendered.push(
          msToString(
            getSubTaskTimeLeftForDisplay([
              subTask('a', 2 * MINUTE, spentMs),
              subTask('b', MINUTE, 0),
            ]),
          ),
        );
      }
      const steps = rendered.filter((val, i) => i > 0 && val !== rendered[i - 1]);
      // sub task b is never tracked, so a minute always remains
      expect(rendered[0]).toBe('3m');
      expect(steps).toEqual(['2m', '1m']);
    });

    it('should not hide a remainder below a minute behind the empty placeholder', () => {
      // 1m + 2m sub tasks with 90s tracked: 1m30s left, and the pair still reads 3m
      const subTasks = [subTask('a', MINUTE, 0), subTask('b', 2 * MINUTE, 90000)];
      expect(renderedPair(subTasks)).toBe('1m / 2m');
    });

    it('should stay consistent for estimates that are not whole minutes', () => {
      // '90s' and '1.5m' are accepted by the duration input
      expect(renderedPairInMinutes([subTask('a', 90000, 10000)])).toBe(
        renderedMinutes(msToString(90000)),
      );
    });
  });

  // A done sub task's unspent estimate is dropped and an over-run is clamped to 0,
  // while the spent sum keeps counting both. The cells are then no longer two halves
  // of one total, so the time left is shown as-is instead of borrowing from the pair.
  describe('once a sub task is done or over its estimate', () => {
    it('should drop the unspent estimate of a sub task finished early', () => {
      // a is done after 30s of a 2m estimate: its remaining 1m30s is gone for good
      const subTasks = [
        subTask('a', 2 * MINUTE, 30000, true),
        subTask('b', 3 * MINUTE, 0),
      ];
      expect(renderedPair(subTasks)).toBe('- / 3m');
    });

    it('should clamp a sub task that has run over its estimate', () => {
      // a is 1m40s past its 5m estimate, so it contributes no time left, not a negative
      const subTasks = [
        subTask('a', 5 * MINUTE, 400000),
        subTask('b', 2 * MINUTE, 40000),
      ];
      expect(renderedPair(subTasks)).toBe('7m / 1m');
    });

    it('should never let the time left jump back up while an over-run sub task is tracked', () => {
      // Borrowing the partial minute here would flip the cell twice a minute, because
      // the time left stops shrinking once the tracked sub task is clamped at 0.
      const wentBackUp: string[] = [];
      let previous = Number.MAX_SAFE_INTEGER;
      for (let overRunMs = 300000; overRunMs <= 540000; overRunMs += 1000) {
        const timeLeft = getSubTaskTimeLeftForDisplay([
          subTask('a', 5 * MINUTE, overRunMs),
          subTask('b', 10 * MINUTE, 200000),
        ]);
        if (timeLeft > previous) {
          wentBackUp.push(`${msToString(timeLeft)} at ${overRunMs}ms tracked`);
        }
        previous = timeLeft;
      }
      expect(wentBackUp).toEqual([]);
    });
  });

  it('should show nothing left when there are no sub tasks', () => {
    expect(getSubTaskTimeLeftForDisplay([])).toBe(0);
  });
});

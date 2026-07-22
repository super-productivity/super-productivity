import { Task } from '../task.model';
import { createTask } from '../task.test-helper';
import { taskAdapter } from '../store/task.adapter';
import { initialTaskState } from '../store/task.reducer';
import { reCalcTimeEstimateForParentIfParent } from '../store/task.reducer.util';
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

// The parent timeEstimate the reducer would store for these sub tasks.
const storedTimeLeft = (subTasks: Task[]): number => {
  const parent = createTask({ id: 'P', subTaskIds: subTasks.map((t) => t.id) });
  const state = taskAdapter.setAll([parent, ...subTasks], initialTaskState);
  const recalculated = reCalcTimeEstimateForParentIfParent('P', state).entities[
    'P'
  ] as Task;
  return recalculated.timeEstimate;
};

// Independent oracle: read a rendered duration ('1h 15m', '2m', '-') back as minutes.
const renderedMinutes = (rendered: string): number => {
  if (rendered === '-') {
    return 0;
  }
  const hours = /(\d+)h/.exec(rendered);
  const minutes = /(\d+)m/.exec(rendered);
  return (hours ? +hours[1] * 60 : 0) + (minutes ? +minutes[1] : 0);
};

// What the parent row puts on screen: 'Σ time spent / ⏳ time left'.
const renderedPairInMinutes = (subTasks: Task[]): number =>
  renderedMinutes(msToString(getSubTasksTotalTimeSpent(subTasks))) +
  renderedMinutes(msToString(getSubTaskTimeLeftForDisplay(subTasks)));

describe('getSubTaskTimeLeftForDisplay', () => {
  it('should sum the time left exactly like the reducer does', () => {
    const configurations = [
      [subTask('a', 2 * MINUTE, 2998), subTask('b', MINUTE, 0)],
      [subTask('a', 2 * MINUTE, 150000, true), subTask('b', 3 * MINUTE, 30000)],
      [subTask('a', 5 * MINUTE, 340000), subTask('b', 2 * MINUTE, 40000)],
      [subTask('a', MINUTE, MINUTE, true)],
    ];
    configurations.forEach((subTasks) => {
      const timeSpent = getSubTasksTotalTimeSpent(subTasks);
      const floorMin = (ms: number): number => Math.floor(ms / MINUTE) * MINUTE;
      const fromStoredValue =
        floorMin(timeSpent + storedTimeLeft(subTasks)) - floorMin(timeSpent);
      expect(getSubTaskTimeLeftForDisplay(subTasks)).toBe(fromStoredValue);
    });
  });

  describe('while no sub task is done or over its estimate', () => {
    it('should render a pair that adds up to the total estimate', () => {
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

    it('should never hide a remainder below a minute behind the empty placeholder', () => {
      // 1m + 2m sub tasks with 90s tracked: 1m30s left, and the pair still reads 3m
      const subTasks = [subTask('a', MINUTE, 0), subTask('b', 2 * MINUTE, 90000)];
      expect(msToString(getSubTaskTimeLeftForDisplay(subTasks))).toBe('2m');
      expect(renderedPairInMinutes(subTasks)).toBe(3);
    });
  });

  // Once a sub task is done its unspent estimate is dropped, and an over-run is
  // clamped to 0, so the pair can no longer add up to the original estimate. It must
  // still add up to what is actually on the clock.
  describe('once a sub task is done or over its estimate', () => {
    const renderedTotal = (subTasks: Task[]): number =>
      renderedMinutes(
        msToString(getSubTasksTotalTimeSpent(subTasks) + storedTimeLeft(subTasks)),
      );

    it('should add up to time spent plus time left for a done sub task', () => {
      // a: 2m estimated, ran 2m30s, done -> its estimate is dropped
      const subTasks = [
        subTask('a', 2 * MINUTE, 150000, true),
        subTask('b', 3 * MINUTE, 30000),
      ];
      expect(renderedPairInMinutes(subTasks)).toBe(renderedTotal(subTasks));
      expect(renderedPairInMinutes(subTasks)).toBe(5);
    });

    it('should add up to time spent plus time left for an over-run sub task', () => {
      // a: 5m estimated, already at 5m40s -> its remainder is clamped to 0
      const subTasks = [
        subTask('a', 5 * MINUTE, 340000),
        subTask('b', 2 * MINUTE, 40000),
      ];
      expect(renderedPairInMinutes(subTasks)).toBe(renderedTotal(subTasks));
      expect(renderedPairInMinutes(subTasks)).toBe(7);
    });
  });

  it('should count down without jumping back up while time is tracked', () => {
    const rendered: string[] = [];
    for (let spentMs = 2998; spentMs <= 182998; spentMs += 1000) {
      const subTasks = [subTask('a', 2 * MINUTE, spentMs), subTask('b', MINUTE, 0)];
      rendered.push(msToString(getSubTaskTimeLeftForDisplay(subTasks)));
      // and the pair keeps matching the work it represents at every tick
      expect(renderedPairInMinutes(subTasks)).toBe(
        renderedMinutes(
          msToString(getSubTasksTotalTimeSpent(subTasks) + storedTimeLeft(subTasks)),
        ),
      );
    }
    const steps = rendered.filter((val, i) => i > 0 && val !== rendered[i - 1]);
    // sub task b is never tracked, so a minute always remains
    expect(rendered[0]).toBe('3m');
    expect(steps).toEqual(['2m', '1m']);
  });

  it('should stay consistent for estimates that are not whole minutes', () => {
    // '90s' and '1.5m' are accepted by the duration input
    expect(renderedPairInMinutes([subTask('a', 90000, 10000)])).toBe(
      renderedMinutes(msToString(90000)),
    );
  });

  it('should show nothing left when nothing is left', () => {
    expect(getSubTaskTimeLeftForDisplay([subTask('a', MINUTE, MINUTE, true)])).toBe(0);
    expect(getSubTaskTimeLeftForDisplay([])).toBe(0);
  });
});

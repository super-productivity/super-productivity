import * as fromSelectors from './planner.selectors';
import { PlannerState } from './planner.reducer';
import { Task, TaskWithDueTime } from '../../tasks/task.model';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { dateStrToUtcDate } from '../../../util/date-str-to-utc-date';
import { getDateTimeFromClockString } from '../../../util/get-date-time-from-clock-string';
import { sumSubTaskTimeLeft } from '../../tasks/util/sum-sub-task-time-left';

// Regression for #10894: a parent's `timeEstimate` already holds the time left
// of all its sub tasks. Since #9019, sub tasks keep their own planner days when
// the parent is planned, so a sub task planned on its own (another day, Today,
// the same day, or with a time) was counted once by itself and once more inside
// its parent.
describe('Planner Selectors - #10894 parent and sub task double-count', () => {
  const today = getDbDateStr();
  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrow = getDbDateStr(tomorrowDate);
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = getDbDateStr(yesterdayDate);
  const MIN_20 = 20 * 60 * 1000;

  const createMockTask = (overrides: Partial<Task> & { id: string }): Task => {
    const { id, ...rest } = overrides;
    return {
      id,
      title: `Task ${id}`,
      created: Date.now(),
      isDone: false,
      subTaskIds: [],
      tagIds: [],
      projectId: 'project1',
      timeSpentOnDay: {},
      timeEstimate: 0,
      timeSpent: 0,
      attachments: [],
      ...rest,
    };
  };

  const defaultScheduleConfig = {
    isWorkStartEndEnabled: false,
    workStart: '09:00',
    workEnd: '17:00',
    isLunchBreakEnabled: false,
    lunchBreakStart: '12:00',
    lunchBreakEnd: '13:00',
  };

  const plannerState = (days: Record<string, string[]>): PlannerState => ({
    days,
    addPlannedTasksDialogLastShown: undefined,
  });

  // Parent A with sub tasks B and C (20m each); A's estimate is derived the
  // same way the task reducer derives it.
  const createFamily = (
    b: Partial<Task> = {},
    c: Partial<Task> = {},
    a: Partial<Task> = {},
  ): Task[] => {
    const subB = createMockTask({ id: 'B', parentId: 'A', timeEstimate: MIN_20, ...b });
    const subC = createMockTask({ id: 'C', parentId: 'A', timeEstimate: MIN_20, ...c });
    const parent = createMockTask({
      id: 'A',
      subTaskIds: ['B', 'C'],
      timeEstimate: sumSubTaskTimeLeft([subB, subC]),
      ...a,
    });
    return [parent, subB, subC];
  };

  const getDayEstimates = (
    tasks: Task[],
    todayListTaskIds: string[],
    days: Record<string, string[]>,
    allPlannedTasks: TaskWithDueTime[] = [],
  ): Record<string, number> => {
    const selector = fromSelectors.selectPlannerDays(
      [today, tomorrow],
      [],
      todayListTaskIds,
      [],
      allPlannedTasks,
      today,
    );
    const result = selector.projector(
      new Map(tasks.map((t) => [t.id, t])),
      plannerState(days),
      defaultScheduleConfig,
      0,
    );
    return { today: result[0].timeEstimate, tomorrow: result[1].timeEstimate };
  };

  it('variant A: sub task on Today is not counted again by its parent planned for tomorrow', () => {
    // B -> today, C -> tomorrow, then A -> tomorrow (C collapses under A).
    const tasks = createFamily(
      { dueDay: today },
      { dueDay: tomorrow },
      { dueDay: tomorrow },
    );

    const est = getDayEstimates(tasks, ['B'], { [tomorrow]: ['A'] });

    expect(est.today).toBe(MIN_20);
    expect(est.tomorrow).toBe(MIN_20);
  });

  it('variant B: sub task planned on the same day as its parent is counted once', () => {
    // B -> today, A -> tomorrow, then C -> tomorrow.
    const tasks = createFamily(
      { dueDay: today },
      { dueDay: tomorrow },
      { dueDay: tomorrow },
    );

    const est = getDayEstimates(tasks, ['B'], { [tomorrow]: ['A', 'C'] });

    expect(est.today).toBe(MIN_20);
    expect(est.tomorrow).toBe(MIN_20);
  });

  it('parent on Today does not count a sub task planned for tomorrow', () => {
    const tasks = createFamily(
      { dueDay: today },
      { dueDay: tomorrow },
      { dueDay: today },
    );

    const est = getDayEstimates(tasks, ['A'], { [tomorrow]: ['C'] });

    expect(est.today).toBe(MIN_20);
    expect(est.tomorrow).toBe(MIN_20);
  });

  it('still counts the full parent estimate when no sub task is planned on its own', () => {
    const tasks = createFamily({}, {}, { dueDay: tomorrow });

    const est = getDayEstimates(tasks, [], { [tomorrow]: ['A'] });

    expect(est.today).toBe(0);
    expect(est.tomorrow).toBe(2 * MIN_20);
  });

  it('a done sub task planned elsewhere is not subtracted twice', () => {
    // Done sub tasks are already excluded from the parent's estimate.
    const tasks = createFamily(
      { dueDay: today, isDone: true },
      { dueDay: tomorrow },
      { dueDay: tomorrow },
    );

    const est = getDayEstimates(tasks, ['B'], { [tomorrow]: ['A'] });

    expect(est.today).toBe(0);
    expect(est.tomorrow).toBe(MIN_20);
  });

  it('a sub task scheduled with a time is counted in its time slot only', () => {
    const dueWithTime = getDateTimeFromClockString(
      '10:00',
      dateStrToUtcDate(today).getTime(),
    );
    const tasks = createFamily({ dueWithTime }, {}, { dueDay: tomorrow });

    const est = getDayEstimates(tasks, ['B'], { [tomorrow]: ['A'] }, [
      tasks[1] as TaskWithDueTime,
    ]);

    expect(est.today).toBe(MIN_20);
    expect(est.tomorrow).toBe(MIN_20);
  });

  it('uses the time left of a partly tracked sub task', () => {
    const tasks = createFamily(
      { dueDay: today, timeSpent: 5 * 60 * 1000 },
      {},
      { dueDay: tomorrow },
    );

    const est = getDayEstimates(tasks, ['B'], { [tomorrow]: ['A'] });

    expect(est.today).toBe(15 * 60 * 1000);
    expect(est.tomorrow).toBe(MIN_20);
  });

  // Overdue sub tasks are listed (and totalled) in the Overdue section, so the
  // parent leaves them out whether they were scheduled by day or with a time.
  it('an overdue sub task with a past day is not counted again by its parent', () => {
    const tasks = createFamily({ dueDay: yesterday }, {}, { dueDay: tomorrow });

    const est = getDayEstimates(tasks, [], { [tomorrow]: ['A'] });

    expect(est.today).toBe(0);
    expect(est.tomorrow).toBe(MIN_20);
  });

  // A parent with a time slot is counted through its slot, not the day list,
  // so it needs the same correction.
  describe('parent scheduled with a time', () => {
    const at10 = (day: string): number =>
      getDateTimeFromClockString('10:00', dateStrToUtcDate(day).getTime());

    it('does not count a sub task planned for Today again', () => {
      const tasks = createFamily({ dueDay: today }, {}, { dueWithTime: at10(tomorrow) });

      const est = getDayEstimates(tasks, ['B'], {}, [tasks[0] as TaskWithDueTime]);

      expect(est.today).toBe(MIN_20);
      expect(est.tomorrow).toBe(MIN_20);
    });

    it('counts a sub task listed on the same day once', () => {
      const tasks = createFamily(
        { dueDay: today },
        { dueDay: tomorrow },
        { dueWithTime: at10(tomorrow) },
      );

      const est = getDayEstimates(tasks, ['B'], { [tomorrow]: ['C'] }, [
        tasks[0] as TaskWithDueTime,
      ]);

      expect(est.today).toBe(MIN_20);
      expect(est.tomorrow).toBe(MIN_20);
    });

    it('does not count a sub task planned for tomorrow on Today', () => {
      const tasks = createFamily({}, { dueDay: tomorrow }, { dueWithTime: at10(today) });

      const est = getDayEstimates(tasks, [], { [tomorrow]: ['C'] }, [
        tasks[0] as TaskWithDueTime,
      ]);

      expect(est.today).toBe(MIN_20);
      expect(est.tomorrow).toBe(MIN_20);
    });

    it('still counts the full estimate when no sub task is planned on its own', () => {
      const tasks = createFamily({}, {}, { dueWithTime: at10(tomorrow) });

      const est = getDayEstimates(tasks, [], {}, [tasks[0] as TaskWithDueTime]);

      expect(est.today).toBe(0);
      expect(est.tomorrow).toBe(2 * MIN_20);
    });
  });

  it('an overdue sub task with a past time is not counted again by its parent', () => {
    const dueWithTime = getDateTimeFromClockString(
      '10:00',
      dateStrToUtcDate(yesterday).getTime(),
    );
    const tasks = createFamily({ dueWithTime }, {}, { dueDay: tomorrow });

    const est = getDayEstimates(tasks, [], { [tomorrow]: ['A'] });

    expect(est.today).toBe(0);
    expect(est.tomorrow).toBe(MIN_20);
  });
});

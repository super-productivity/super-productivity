import { selectAndroidWidgetNextDayPlans } from './android-widget-next-days.selectors';
import {
  DEFAULT_TASK_REPEAT_CFG,
  TaskRepeatCfg,
} from '../../task-repeat-cfg/task-repeat-cfg.model';
import { PlannerState } from '../../planner/store/planner.reducer';

// Due every day since the 1st, last created on Friday 2026-07-17 (the specs' today).
const repeatCfg = (id: string, partial: Partial<TaskRepeatCfg> = {}): TaskRepeatCfg => ({
  ...DEFAULT_TASK_REPEAT_CFG,
  id,
  title: `Repeat ${id}`,
  repeatCycle: 'DAILY',
  startDate: '2026-07-01',
  lastTaskCreationDay: '2026-07-17',
  ...partial,
});

// #11944: what the device already knows about the days after today.
describe('selectAndroidWidgetNextDayPlans', () => {
  const FRIDAY = '2026-07-17';
  const HOUR = 60 * 60 * 1000;

  type Snapshots = Parameters<typeof selectAndroidWidgetNextDayPlans.projector>[0];
  const snapshots = (
    tasks: { id: string; dueDay?: string; dueWithTime?: number; parentId?: string }[],
  ): Snapshots =>
    Object.fromEntries(
      tasks.map((t) => [
        t.id,
        {
          isDone: false,
          dueDay: null,
          dueWithTime: null,
          deadlineDay: null,
          deadlineWithTime: null,
          parentId: null,
          subTaskIds: [],
          ...t,
        },
      ]),
    );
  const planner = (days: PlannerState['days'] = {}): PlannerState =>
    ({ days }) as PlannerState;

  it('should cover the seven days after today', () => {
    const plans = selectAndroidWidgetNextDayPlans.projector({}, planner(), [], FRIDAY, 0);
    expect(plans.map((plan) => plan.dayStr)).toEqual([
      '2026-07-18',
      '2026-07-19',
      '2026-07-20',
      '2026-07-21',
      '2026-07-22',
      '2026-07-23',
      '2026-07-24',
    ]);
  });

  it('should continue into the next month and year', () => {
    const plans = selectAndroidWidgetNextDayPlans.projector(
      {},
      planner(),
      [],
      '2026-12-30',
      0,
    );
    expect(plans.slice(0, 3).map((plan) => plan.dayStr)).toEqual([
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
    ]);
  });

  it("should list a day's tasks in the planner's order, then timed ones by start time", () => {
    const plans = selectAndroidWidgetNextDayPlans.projector(
      snapshots([
        { id: 'a', dueDay: '2026-07-18' },
        { id: 'late', dueWithTime: new Date(2026, 6, 18, 15).getTime() },
        { id: 'b', dueDay: '2026-07-18' },
        { id: 'early', dueWithTime: new Date(2026, 6, 18, 9).getTime() },
        { id: 'sunday', dueDay: '2026-07-19' },
        { id: 'today', dueDay: FRIDAY },
        { id: 'unplanned' },
      ]),
      planner({ ['2026-07-18']: ['b', 'a'] }),
      [],
      FRIDAY,
      0,
    );
    expect(plans[0].taskIds).toEqual(['b', 'a', 'early', 'late']);
    expect(plans[1].taskIds).toEqual(['sunday']);
    expect(plans[2].taskIds).toEqual([]);
  });

  it('should leave out a sub task whose parent is due the same day', () => {
    const plans = selectAndroidWidgetNextDayPlans.projector(
      snapshots([
        { id: 'parent', dueDay: '2026-07-18' },
        { id: 'sub', dueDay: '2026-07-18', parentId: 'parent' },
      ]),
      planner(),
      [],
      FRIDAY,
      0,
    );
    expect(plans[0].taskIds).toEqual(['parent']);
  });

  it('should put a start before the start-of-next-day time on the day before', () => {
    const plans = selectAndroidWidgetNextDayPlans.projector(
      snapshots([{ id: 'night', dueWithTime: new Date(2026, 6, 19, 2).getTime() }]),
      planner(),
      [],
      FRIDAY,
      4 * HOUR,
    );
    expect(plans[0].taskIds).toEqual(['night']);
    expect(plans[1].taskIds).toEqual([]);
  });

  it('should list the recurring tasks due on each day', () => {
    const everyMonday: Partial<TaskRepeatCfg> = {
      repeatCycle: 'WEEKLY',
      monday: true,
      tuesday: false,
      wednesday: false,
      thursday: false,
      friday: false,
    };
    const plans = selectAndroidWidgetNextDayPlans.projector(
      {},
      planner(),
      [repeatCfg('daily'), repeatCfg('monday', everyMonday)],
      FRIDAY,
      0,
    );
    const dueOn = (dayStr: string): string[] =>
      (plans.find((plan) => plan.dayStr === dayStr)?.repeatCfgs ?? []).map((c) => c.id);
    expect(dueOn('2026-07-18')).toEqual(['daily']);
    // 2026-07-20 is the Monday
    expect(dueOn('2026-07-20')).toEqual(['daily', 'monday']);
    expect(dueOn('2026-07-21')).toEqual(['daily']);
  });

  it('should leave out recurring tasks it cannot promise or name', () => {
    const plans = selectAndroidWidgetNextDayPlans.projector(
      {},
      planner(),
      [
        repeatCfg('paused', { isPaused: true }),
        // due only once the previous instance is done, which is not known ahead
        repeatCfg('waiting', { waitForCompletion: true }),
        repeatCfg('untitled', { title: null }),
      ],
      FRIDAY,
      0,
    );
    expect(plans.flatMap((plan) => plan.repeatCfgs)).toEqual([]);
  });
});

import { mapScheduleDaysToTrays, withScheduleDayTray } from './with-schedule-day-tray';
import { mapToScheduleDays } from './map-to-schedule-days';
import { ScheduleDay } from '../schedule.model';
import { TaskCopy, TaskWithDueTime } from '../../tasks/task.model';
import { TaskRepeatCfg } from '../../task-repeat-cfg/task-repeat-cfg.model';

const H = 60 * 60 * 1000;
const MON = '2026-01-05';
const TUE = '2026-01-06';

const fakeTask = (id: string, add: Partial<TaskCopy> = {}): TaskCopy =>
  ({
    id,
    title: id,
    tagIds: [],
    subTaskIds: [],
    timeSpent: 0,
    timeEstimate: H,
    dueDay: MON,
    ...add,
  }) as TaskCopy;

const fakeDailyRepeatCfg = (
  id: string,
  add: Partial<TaskRepeatCfg> = {},
): TaskRepeatCfg =>
  ({
    id,
    title: id,
    startDate: '2025-01-01',
    lastTaskCreationDay: '2025-12-31',
    monday: true,
    tuesday: true,
    wednesday: true,
    thursday: true,
    friday: true,
    saturday: true,
    sunday: true,
    repeatCycle: 'DAILY',
    repeatEvery: 1,
    defaultEstimate: H / 2,
    ...add,
  }) as Partial<TaskRepeatCfg> as TaskRepeatCfg;

const fakeDay = (dayDate: string): ScheduleDay => ({
  dayDate,
  entries: [],
  beyondBudgetTasks: [],
  isToday: false,
});

const PARAMS = {
  tasks: [] as TaskCopy[],
  plannerTasks: [] as TaskCopy[],
  repeatCfgs: [] as TaskRepeatCfg[],
  budgetMs: 8 * H,
  isCapacityLimited: true,
};

describe('withScheduleDayTray()', () => {
  it('holds the tasks due that day and the planner tasks of that day, each once', () => {
    const a = fakeTask('A');
    const b = fakeTask('B', { dueDay: TUE });
    const c = fakeTask('C');
    const r = withScheduleDayTray(fakeDay(MON), {
      ...PARAMS,
      tasks: [a, b, c],
      plannerTasks: [c, fakeTask('P', { dueDay: undefined })],
    });
    expect(r.tray?.tasks.map((t) => t.id)).toEqual(['A', 'C', 'P']);
  });

  it('counts what is left of each estimate, and nothing for a task without one', () => {
    const r = withScheduleDayTray(fakeDay(MON), {
      ...PARAMS,
      tasks: [
        fakeTask('A', { timeEstimate: 2 * H, timeSpent: H / 2 }),
        fakeTask('B', { timeEstimate: 0 }),
      ],
    });
    expect(r.tray?.plannedMs).toBe(1.5 * H);
    expect(r.tray?.freeMs).toBe(6.5 * H);
    expect(r.beyondBudgetTasks).toEqual([]);
  });

  it('reports the overrun as negative free time and marks the tasks that do not fit', () => {
    const r = withScheduleDayTray(fakeDay(MON), {
      ...PARAMS,
      budgetMs: 2 * H,
      tasks: [
        fakeTask('A', { timeEstimate: 1.5 * H }),
        fakeTask('B', { timeEstimate: H }),
        fakeTask('C', { timeEstimate: H }),
      ],
    });
    expect(r.tray?.freeMs).toBe(-1.5 * H);
    expect(r.beyondBudgetTasks.map((t) => t.id)).toEqual(['B', 'C']);
    // over capacity keeps every task on its day
    expect(r.tray?.tasks.map((t) => t.id)).toEqual(['A', 'B', 'C']);
  });

  it('has no free time and nothing beyond budget while work hours are off', () => {
    const r = withScheduleDayTray(fakeDay(MON), {
      ...PARAMS,
      isCapacityLimited: false,
      budgetMs: H,
      tasks: [fakeTask('A', { timeEstimate: 3 * H })],
    });
    expect(r.tray?.plannedMs).toBe(3 * H);
    expect(r.tray?.freeMs).toBeUndefined();
    expect(r.beyondBudgetTasks).toEqual([]);
  });

  it('adds repeating tasks due that day until their instance exists', () => {
    const repeatCfgs = [fakeDailyRepeatCfg('R1'), fakeDailyRepeatCfg('R2')];
    const r = withScheduleDayTray(fakeDay(MON), {
      ...PARAMS,
      repeatCfgs,
      tasks: [fakeTask('A', { repeatCfgId: 'R1' })],
    });
    expect(r.tray?.repeatCfgs.map((cfg) => cfg.id)).toEqual(['R2']);
    // 1h task + 30m projection
    expect(r.tray?.plannedMs).toBe(1.5 * H);
  });
});

describe('mapToScheduleDays() in tray mode', () => {
  const at = (hours: number): number => new Date(2026, 0, 5, hours, 0, 0, 0).getTime();
  const map = (
    tasks: TaskCopy[],
    scheduledTasks: TaskWithDueTime[],
    isTray: boolean,
  ): ScheduleDay[] =>
    mapToScheduleDays(
      at(14),
      [MON, TUE],
      tasks,
      scheduledTasks,
      [],
      [],
      [],
      null,
      {},
      { startTime: '9:00', endTime: '17:00' },
      undefined,
      at(14),
      0,
      [],
      isTray ? { isCapacityLimited: true } : undefined,
    );
  const timed = fakeTask('T', {
    dueDay: undefined,
    dueWithTime: at(15),
    timeEstimate: H,
  }) as TaskWithDueTime;

  it('keeps untimed tasks out of the grid and measures them against the work time left', () => {
    const r = map([fakeTask('A'), fakeTask('B', { dueDay: TUE })], [timed], true);

    expect(r[0].entries.map((entry) => entry.id)).toEqual(['T']);
    expect(r[1].entries).toEqual([]);
    expect(r[0].tray?.tasks.map((t) => t.id)).toEqual(['A']);
    expect(r[1].tray?.tasks.map((t) => t.id)).toEqual(['B']);
    // today 14:00–17:00 is 3h, minus the 1h timed task, minus 1h planned
    expect(r[0].tray?.freeMs).toBe(H);
    // tomorrow 9:00–17:00 is 8h, minus 1h planned
    expect(r[1].tray?.freeMs).toBe(7 * H);
  });

  it('leaves auto-placement as it is', () => {
    const r = map([fakeTask('A')], [timed], false);

    expect(r[0].tray).toBeUndefined();
    expect(r[0].entries.map((entry) => entry.id)).toContain('A');
    expect(mapScheduleDaysToTrays(r)).toBeNull();
  });

  it('maps the trays by day', () => {
    const trays = mapScheduleDaysToTrays(map([fakeTask('A')], [], true));

    expect(Object.keys(trays || {})).toEqual([MON, TUE]);
    expect(trays?.[MON].tasks.map((t) => t.id)).toEqual(['A']);
  });
});

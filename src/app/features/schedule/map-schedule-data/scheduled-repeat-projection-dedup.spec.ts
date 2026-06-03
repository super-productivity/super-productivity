import { mapToScheduleDays } from './map-to-schedule-days';
import { TaskCopy, TaskWithDueTime } from '../../tasks/task.model';
import { TaskRepeatCfg } from '../../task-repeat-cfg/task-repeat-cfg.model';
import { getDbDateStr } from '../../../util/get-db-date-str';

const H = 60 * 60 * 1000;
const DAY = 24 * H;

const fakeTask = (id: string, add?: Partial<TaskCopy>): TaskCopy =>
  ({
    tagIds: [],
    subTaskIds: [],
    timeSpent: 0,
    timeEstimate: H,
    ...add,
    id,
  }) as TaskCopy;

const fakePlanned = (
  id: string,
  dueWithTime: number,
  add?: Partial<TaskWithDueTime>,
): TaskWithDueTime =>
  ({
    ...fakeTask(id, add),
    dueWithTime,
    reminderId: 'R_ID',
  }) as TaskWithDueTime;

const fakeCfg = (id: string, add?: Partial<TaskRepeatCfg>): TaskRepeatCfg =>
  ({
    startTime: '10:00',
    monday: true,
    tuesday: true,
    wednesday: true,
    thursday: true,
    friday: true,
    saturday: true,
    sunday: true,
    repeatCycle: 'DAILY',
    repeatEvery: 1,
    defaultEstimate: H,
    isPaused: false,
    ...add,
    id,
  }) as Partial<TaskRepeatCfg> as TaskRepeatCfg;

/**
 * Regression for #7853: a timed recurring task scheduled for a future date
 * showed up twice in the Schedule — once as the concrete `ScheduledTask`
 * instance and once as the cfg's `ScheduledRepeatProjection`. The projection
 * for a day must be suppressed when a concrete instance of the same repeat cfg
 * is already scheduled on that day, regardless of where the cfg's
 * `lastTaskCreationDay` anchor happens to sit.
 */
describe('scheduled repeat projection dedup (#7853)', () => {
  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);
  const now = todayMidnight.getTime();

  const addDays = (ts: number, days: number): number => {
    const offset = days * DAY;
    return ts + offset;
  };
  const futureDayTs = addDays(now, 3);
  const futureDayStr = getDbDateStr(futureDayTs);
  const tenHours = 10 * H;
  const futureAt10 = futureDayTs + tenHours;
  const dayDates = Array.from({ length: 5 }, (_, i) => getDbDateStr(addDays(now, i)));

  const entryCountForFutureDay = (lastTaskCreationDay: string): number => {
    const task = fakePlanned('T1', futureAt10, { repeatCfgId: 'R1', timeEstimate: H });
    const cfg = fakeCfg('R1', { startDate: futureDayStr, lastTaskCreationDay });

    const days = mapToScheduleDays(
      now,
      dayDates,
      [],
      [task],
      [cfg],
      [],
      [],
      null,
      {},
      undefined,
      undefined,
      now,
    );
    const day = days.find((d) => d.dayDate === futureDayStr);
    return (day?.entries ?? []).length;
  };

  it('renders a single entry when the anchor matches the scheduled day', () => {
    expect(entryCountForFutureDay(futureDayStr)).toBe(1);
  });

  it('does not duplicate when the anchor lags behind to today', () => {
    expect(entryCountForFutureDay(getDbDateStr(now))).toBe(1);
  });

  it('does not duplicate when the anchor lags behind by one day', () => {
    expect(entryCountForFutureDay(getDbDateStr(addDays(futureDayTs, -1)))).toBe(1);
  });
});

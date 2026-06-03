import { mapToScheduleDays } from './map-to-schedule-days';
import { TaskCopy, TaskWithDueTime } from '../../tasks/task.model';
import { TaskRepeatCfg } from '../../task-repeat-cfg/task-repeat-cfg.model';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { SVEType } from '../schedule.const';

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

  // Mirrors the exact repro from discussion #7853 (Exhibit 1 video): on a
  // Wednesday, "Gym (Rest)" is scheduled for the upcoming Sunday at 06:00, then
  // made into a "Every week on Sunday" recurring task. The Sunday column showed
  // the 06:00 instance AND a repeat projection. With the cfg's default anchor
  // (lastTaskCreationDay = creation day = the Wednesday) the projection is not
  // suppressed by the anchor, so the concrete-instance guard must catch it.
  describe('weekly-on-Sunday repro from the video', () => {
    // Fixed dates matching the recording: Wed Jun 3 2026 → Sun Jun 7 2026.
    const wed = new Date(2026, 5, 3, 0, 0, 0, 0).getTime();
    const sunTs = new Date(2026, 5, 7, 0, 0, 0, 0).getTime();
    const sunStr = getDbDateStr(sunTs);
    const sunAt6 = new Date(2026, 5, 7, 6, 0, 0, 0).getTime();
    const week = Array.from({ length: 5 }, (_, i) =>
      getDbDateStr(new Date(2026, 5, 3 + i, 0, 0, 0, 0).getTime()),
    );

    const sundayEntries = (): { type: SVEType; id: string }[] => {
      const task = fakePlanned('GYM', sunAt6, {
        repeatCfgId: 'GYM_CFG',
        timeEstimate: H,
      });
      const cfg = fakeCfg('GYM_CFG', {
        startTime: '06:00',
        repeatCycle: 'WEEKLY',
        monday: false,
        tuesday: false,
        wednesday: false,
        thursday: false,
        friday: false,
        saturday: false,
        sunday: true,
        startDate: sunStr,
        // cfg keeps its creation-day anchor (the Wednesday), not the Sunday
        lastTaskCreationDay: getDbDateStr(wed),
      });

      const days = mapToScheduleDays(
        wed,
        week,
        [],
        [task],
        [cfg],
        [],
        [],
        null,
        {},
        undefined,
        undefined,
        wed,
      );
      const day = days.find((d) => d.dayDate === sunStr);
      return (day?.entries ?? []).map((e) => ({
        type: e.type,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        id: (e.data as any)?.id,
      }));
    };

    it('shows only the concrete instance on the recurring Sunday', () => {
      const entries = sundayEntries();
      expect(entries.length).toBe(1);
      expect(entries[0].type).toBe(SVEType.ScheduledTask);
      expect(entries[0].id).toBe('GYM');
    });
  });
});

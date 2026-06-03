import { mapToScheduleDays } from './map-to-schedule-days';
import { TaskCopy, TaskWithDueTime } from '../../tasks/task.model';
import { TaskRepeatCfg } from '../../task-repeat-cfg/task-repeat-cfg.model';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { SVEType } from '../schedule.const';

const H = 60 * 60 * 1000;

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
  // Fixed calendar dates (Wed Jun 3 2026 → Sun Jun 7 2026) so day strings are
  // deterministic regardless of when CI runs. Build days via the (y, m, d+i)
  // constructor — NOT fixed-millisecond arithmetic — so a DST boundary on the
  // run day can never collapse or skip a day in the sequence.
  const dayTs = (offset: number, hour = 0): number =>
    new Date(2026, 5, 3 + offset, hour, 0, 0, 0).getTime();
  const now = dayTs(0);
  const futureOffset = 3;
  const futureDayStr = getDbDateStr(dayTs(futureOffset));
  const futureAt10 = dayTs(futureOffset, 10);
  const dayDates = Array.from({ length: 5 }, (_, i) => getDbDateStr(dayTs(i)));

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
    expect(entryCountForFutureDay(getDbDateStr(dayTs(futureOffset - 1)))).toBe(1);
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
        id: (e.data as TaskCopy)?.id,
      }));
    };

    it('shows only the concrete instance on the recurring Sunday', () => {
      const entries = sundayEntries();
      expect(entries.length).toBe(1);
      expect(entries[0].type).toBe(SVEType.ScheduledTask);
      expect(entries[0].id).toBe('GYM');
    });
  });

  // The untimed projection path (create-schedule-days.ts) is structurally
  // identical to the timed one and duplicates the same way when the anchor lags.
  // It is not reachable via the reporter's flow (the Planner workaround keeps the
  // anchor aligned), but the render-layer guard is symmetric defense-in-depth.
  describe('untimed (all-day) repeat projection dedup', () => {
    const wed = new Date(2026, 5, 3, 0, 0, 0, 0).getTime();
    const futureStr = getDbDateStr(new Date(2026, 5, 6, 0, 0, 0, 0).getTime());
    const week = Array.from({ length: 5 }, (_, i) =>
      getDbDateStr(new Date(2026, 5, 3 + i, 0, 0, 0, 0).getTime()),
    );

    const futureEntries = (): { type: SVEType; id: string }[] => {
      // Concrete untimed instance carries dueDay (no dueWithTime) + repeatCfgId.
      const task = fakeTask('U1', { dueDay: futureStr, repeatCfgId: 'UCFG' });
      // Untimed cfg: no startTime → unScheduledTaskRepeatCfgs; anchor lags to today.
      const cfg = fakeCfg('UCFG', {
        startTime: undefined,
        startDate: futureStr,
        lastTaskCreationDay: getDbDateStr(wed),
      });

      const days = mapToScheduleDays(
        wed,
        week,
        [task],
        [],
        [],
        [cfg],
        [],
        null,
        {},
        undefined,
        undefined,
        wed,
      );
      const day = days.find((d) => d.dayDate === futureStr);
      return (day?.entries ?? []).map((e) => ({
        type: e.type,
        id: (e.data as TaskCopy)?.id,
      }));
    };

    it('shows only the concrete instance, not the projection', () => {
      const entries = futureEntries();
      expect(entries.length).toBe(1);
      expect(entries.some((e) => e.type === SVEType.RepeatProjection)).toBe(false);
      expect(entries[0].id).toBe('U1');
    });
  });
});

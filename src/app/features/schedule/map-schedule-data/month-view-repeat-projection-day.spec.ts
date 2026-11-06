import { mapToScheduleDays } from './map-to-schedule-days';
import { TaskRepeatCfg } from '../../task-repeat-cfg/task-repeat-cfg.model';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { SVEType } from '../schedule.const';

const H = 60 * 60 * 1000;
const h = (hr: number): number => hr * H;

// Mid-day on the 1st. Month view's daysToShow[0] is the first *grid* cell --
// the start of the week containing the 1st -- so day 0 sits in the previous
// month while contextNow stays on the selected date. Week view has no such gap.
const NOW = new Date(1970, 0, 1, 9, 0, 0, 0).getTime();
const MONTH_GRID = ['1969-12-30', '1969-12-31', '1970-01-01', '1970-01-02'];

const repeatCfg = (add?: Partial<TaskRepeatCfg>): TaskRepeatCfg =>
  ({
    id: 'R_MONTHLY',
    startDate: '1969-01-01',
    startTime: undefined,
    lastTaskCreationDay: getDbDateStr(new Date(1969, 11, 31).getTime()),
    monday: true,
    tuesday: true,
    wednesday: true,
    thursday: true,
    friday: true,
    saturday: true,
    sunday: true,
    repeatCycle: 'MONTHLY',
    repeatEvery: 1,
    defaultEstimate: h(1),
    ...add,
  }) as Partial<TaskRepeatCfg> as TaskRepeatCfg;

const projectionDays = (cfg: TaskRepeatCfg, dayDates: string[]): (string | undefined)[] =>
  mapToScheduleDays(
    NOW,
    dayDates,
    [],
    [],
    [],
    [cfg],
    [],
    null,
    {},
    undefined,
    undefined,
    NOW,
  )
    .flatMap((d) => d.entries)
    .filter((e) => e.type.startsWith('RepeatProjection'))
    .map((e) => e.plannedForDay);

describe('untimed repeat projections resolve to the day they are due', () => {
  // createScheduleDays looked up "which cfgs are due" with `startTime`, which is
  // `now` for day 0. That only equals day 0 while day 0 contains now -- true in
  // week view, false in month view. The monthly occurrence therefore also
  // rendered on grid cell 0, stamped plannedForDay of that cell, and the repeat
  // dialog resolves targetDate from plannedForDay -- so "skip instance" wrote
  // the grid cell's date into the synced deletedInstanceDates and left the real
  // occurrence in place.
  it('does not project a monthly occurrence onto month view grid cell 0', () => {
    expect(projectionDays(repeatCfg(), MONTH_GRID)).toEqual(['1970-01-01']);
  });

  // Guards the fix against being "corrected" back: week view's day 0 IS now's
  // day, and every other spec uses a midnight `now`, where the two anchors
  // coincide and the difference is invisible.
  it('still projects on week view day 0 when now is mid-day', () => {
    expect(
      projectionDays(repeatCfg({ id: 'R_DAILY', repeatCycle: 'DAILY' }), [
        '1970-01-01',
        '1970-01-02',
      ]),
    ).toEqual(['1970-01-01', '1970-01-02']);
  });
});

describe('timed repeat projections cover the whole rendered range', () => {
  const timedDailyCfg = (add?: Partial<TaskRepeatCfg>): TaskRepeatCfg =>
    ({
      id: 'R_TIMED_DAILY',
      startDate: '1969-12-01',
      startTime: '10:00',
      lastTaskCreationDay: '1970-01-15',
      monday: true,
      tuesday: true,
      wednesday: true,
      thursday: true,
      friday: true,
      saturday: true,
      sunday: true,
      repeatCycle: 'DAILY',
      repeatEvery: 1,
      defaultEstimate: h(1),
      isPaused: false,
      ...add,
    }) as Partial<TaskRepeatCfg> as TaskRepeatCfg;

  const timedProjectionDays = (
    cfg: TaskRepeatCfg,
    dayDates: string[],
    now: number,
    realNow: number,
  ): string[] =>
    mapToScheduleDays(
      now,
      dayDates,
      [],
      [],
      [cfg],
      [],
      [],
      null,
      {},
      undefined,
      undefined,
      realNow,
    )
      .flatMap((d) =>
        d.entries
          .filter((e) => e.type === SVEType.ScheduledRepeatProjection)
          .map(() => d.dayDate),
      )
      .sort();

  // The blocker window (timed repeat projections, work-hours blocks) used to
  // span a fixed 10 days from `now`. With contextNow anchored to the month
  // grid's first cell, a mid-grid today left the window entirely in already
  // materialized days and the upcoming occurrences vanished from the month.
  it('projects a timed daily repeat onto month days beyond 10 days from the anchor', () => {
    // 4-week grid Mon 1969-12-29 .. Sun 1970-01-25; today sits mid-grid.
    const grid = Array.from({ length: 28 }, (_, i) =>
      getDbDateStr(new Date(1969, 11, 29 + i).getTime()),
    );
    const dayZeroMidnight = new Date(1969, 11, 29).getTime();
    const realToday = new Date(1970, 0, 15, 12, 0, 0).getTime();

    expect(
      timedProjectionDays(timedDailyCfg(), grid, dayZeroMidnight, realToday),
    ).toEqual(
      Array.from({ length: 10 }, (_, i) =>
        getDbDateStr(new Date(1970, 0, 16 + i).getTime()),
      ),
    );
  });

  // A range shorter than the old 10-day window must keep its behavior: only
  // the rendered days ever consumed blocks, and the real today is still
  // skipped (its instance is materialized as a concrete task).
  it('still projects onto tomorrow only in a 2-day week-style range', () => {
    const midDayNow = new Date(1970, 0, 1, 9, 0, 0).getTime();

    expect(
      timedProjectionDays(
        timedDailyCfg({ lastTaskCreationDay: '1969-12-31' }),
        ['1970-01-01', '1970-01-02'],
        midDayNow,
        midDayNow,
      ),
    ).toEqual(['1970-01-02']);
  });
});

import { mapToScheduleDays } from './map-to-schedule-days';
import {
  DEFAULT_TASK_REPEAT_CFG,
  TaskRepeatCfg,
} from '../../task-repeat-cfg/task-repeat-cfg.model';
import { ScheduleDay, ScheduleWorkStartEndCfg } from '../schedule.model';
import { SVEType } from '../schedule.const';
import { getDbDateStr } from '../../../util/get-db-date-str';

const H = 60 * 60 * 1000;
const h = (hr: number): number => hr * H;
const at = (dayDate: string, hour: number): number => {
  const [y, m, d] = dayDate.split('-').map(Number);
  return new Date(y, m - 1, d, hour, 0, 0, 0).getTime();
};

// 1970-01-01 is a Thursday. The app never projects today (today's instance is
// created at startup and lastTaskCreationDay moves to today), so each range
// opens the day before the repeat's day.
const THURSDAY = '1970-01-01';
const FRIDAY = '1970-01-02';
const SATURDAY = '1970-01-03';
const SUNDAY = '1970-01-04';
const MONDAY = '1970-01-05';
const weekFrom = (dayDate: string): string[] => {
  const [y, m, d] = dayDate.split('-').map(Number);
  return Array.from({ length: 7 }, (_, i) =>
    getDbDateStr(new Date(y, m - 1, d + i).getTime()),
  );
};

const WORK_HOURS: ScheduleWorkStartEndCfg = { startTime: '9:00', endTime: '17:00' };
// ISO weekdays as Intl.Locale#getWeekInfo().weekend reports them (1 = Mon … 7 = Sun)
const SAT_SUN = [6, 7];

// Same shape as `selectTaskRepeatCfgsWithAndWithoutStartTime().withoutStartTime`:
// a stored cfg without a start time whose instance for day 0 already exists.
const untimedRepeatCfg = (
  lastTaskCreationDay: string,
  add: Partial<TaskRepeatCfg>,
): TaskRepeatCfg => ({
  ...DEFAULT_TASK_REPEAT_CFG,
  id: 'R1',
  title: 'untimed repeat',
  startDate: '1969-01-01',
  lastTaskCreationDay,
  startTime: undefined,
  ...add,
});

const FRIDAY_ONLY: Partial<TaskRepeatCfg> = {
  repeatCycle: 'WEEKLY',
  monday: false,
  tuesday: false,
  wednesday: false,
  thursday: false,
  friday: true,
  saturday: false,
  sunday: false,
};

const schedule = (cfg: TaskRepeatCfg, dayDates: string[]): ScheduleDay[] => {
  const now = at(dayDates[0], 9);
  return mapToScheduleDays(
    now,
    dayDates,
    [],
    [],
    [],
    [cfg],
    [],
    null,
    {},
    WORK_HOURS,
    undefined,
    now,
    0,
    SAT_SUN,
  );
};

const byDay = (days: ScheduleDay[], dayDate: string): ScheduleDay =>
  days.find((d) => d.dayDate === dayDate)!;

const projections = (
  day: ScheduleDay,
): { type: SVEType; start: number; duration: number; plannedForDay?: string }[] =>
  day.entries
    .filter((e) => e.type.startsWith('RepeatProjection'))
    .map(({ type, start, duration, plannedForDay }) => ({
      type,
      start,
      duration,
      plannedForDay,
    }));

const continuations = (
  day: ScheduleDay,
): { start: number; duration: number; sourceOccurrenceDate?: string }[] =>
  day.entries
    .filter(
      (e) =>
        e.type === SVEType.RepeatProjectionSplitContinued ||
        e.type === SVEType.RepeatProjectionSplitContinuedLast,
    )
    .map(({ start, duration, sourceOccurrenceDate }) => ({
      start,
      duration,
      sourceOccurrenceDate,
    }));

describe('untimed repeat projections skip the weekend when they flow across days (#9418)', () => {
  it('moves the part cut off by work end past Saturday and Sunday to Monday', () => {
    const days = schedule(
      untimedRepeatCfg(THURSDAY, { ...FRIDAY_ONLY, defaultEstimate: h(12) }),
      weekFrom(THURSDAY),
    );

    expect(projections(byDay(days, FRIDAY))).toEqual([
      {
        type: SVEType.RepeatProjectionSplit,
        start: at(FRIDAY, 9),
        duration: h(8),
        plannedForDay: FRIDAY,
      },
    ]);
    expect(projections(byDay(days, SATURDAY))).toEqual([]);
    expect(projections(byDay(days, SUNDAY))).toEqual([]);
    expect(continuations(byDay(days, MONDAY))).toEqual([
      { start: at(MONDAY, 9), duration: h(4), sourceOccurrenceDate: FRIDAY },
    ]);
    expect(projections(byDay(days, MONDAY)).length).toBe(1);
  });

  it('leaves a repeat that is due on a weekend day in its own right in place', () => {
    const days = schedule(
      untimedRepeatCfg(THURSDAY, { repeatCycle: 'DAILY', defaultEstimate: h(10) }),
      weekFrom(THURSDAY),
    );

    // Saturday and Sunday still show their own occurrence, only the overflow
    // carried in from earlier days is held back.
    for (const weekendDay of [SATURDAY, SUNDAY]) {
      expect(projections(byDay(days, weekendDay))).toEqual([
        {
          type: SVEType.RepeatProjectionSplit,
          start: at(weekendDay, 9),
          duration: h(8),
          plannedForDay: weekendDay,
        },
      ]);
    }
    // Monday opens with the held overflow of Friday, Saturday and Sunday, in
    // that order, before its own occurrence.
    expect(continuations(byDay(days, MONDAY))).toEqual([
      { start: at(MONDAY, 9), duration: h(2), sourceOccurrenceDate: FRIDAY },
      { start: at(MONDAY, 11), duration: h(2), sourceOccurrenceDate: SATURDAY },
      { start: at(MONDAY, 13), duration: h(2), sourceOccurrenceDate: SUNDAY },
    ]);
    expect(projections(byDay(days, MONDAY))[3]).toEqual({
      type: SVEType.RepeatProjectionSplit,
      start: at(MONDAY, 15),
      duration: h(2),
      plannedForDay: MONDAY,
    });
  });

  it('shows held work on the last rendered day when the range ends on a weekend', () => {
    // Week view opened on a Monday ends on Sunday. Friday's overflow cannot wait
    // for a weekday inside the range, so it renders on Sunday as it always did.
    const LAST_MONDAY = '1969-12-29';
    const days = schedule(
      untimedRepeatCfg(LAST_MONDAY, { ...FRIDAY_ONLY, defaultEstimate: h(12) }),
      weekFrom(LAST_MONDAY),
    );

    expect(projections(byDay(days, FRIDAY)).map((p) => p.duration)).toEqual([h(8)]);
    expect(projections(byDay(days, SATURDAY))).toEqual([]);
    expect(continuations(byDay(days, SUNDAY))).toEqual([
      { start: at(SUNDAY, 9), duration: h(4), sourceOccurrenceDate: FRIDAY },
    ]);
  });
});

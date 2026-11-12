import { mapToScheduleDays } from './map-to-schedule-days';
import { TaskRepeatCfg } from '../../task-repeat-cfg/task-repeat-cfg.model';
import { DEFAULT_TASK, Task } from '../../tasks/task.model';
import { SVE } from '../schedule.model';
import { SVEType } from '../schedule.const';

// #9418: untimed work that overflows a work day must skip the locale's weekend.
// The only work that crosses days is an untimed repeat projection split by the
// work-hours blocker; Today tasks carry dueDay and stay on their day.
const H = 60 * 60 * 1000;
const SAT_SUN = [6, 0];
const FRI_SAT = [5, 6];
const WORK_HOURS = { startTime: '9:00', endTime: '17:00' };

const weeklyCfg = (day: 'thursday' | 'friday' | 'saturday'): TaskRepeatCfg =>
  ({
    id: 'R1',
    startDate: '2026-01-01',
    startTime: undefined,
    lastTaskCreationDay: '2026-01-01',
    monday: false,
    tuesday: false,
    wednesday: false,
    thursday: false,
    friday: false,
    saturday: false,
    sunday: false,
    [day]: true,
    repeatCycle: 'WEEKLY',
    repeatEvery: 1,
    defaultEstimate: 6 * H,
  }) as Partial<TaskRepeatCfg> as TaskRepeatCfg;

const todayTask = (dueDay: string): Task =>
  ({
    ...DEFAULT_TASK,
    id: 'T1',
    projectId: 'p',
    timeEstimate: 1 * H,
    dueDay,
  }) as Task;

const schedule = (
  now: number,
  dayDates: string[],
  opts: { cfg?: TaskRepeatCfg; tasks?: Task[]; weekendDays: number[] },
): SVE[][] =>
  mapToScheduleDays(
    now,
    dayDates,
    opts.tasks ?? [],
    [],
    [],
    opts.cfg ? [opts.cfg] : [],
    [],
    null,
    {},
    WORK_HOURS,
    undefined,
    now,
    0,
    opts.weekendDays,
  ).map((d) =>
    d.entries.filter(
      (e) => e.type !== SVEType.WorkdayEnd && e.type !== SVEType.WorkdayStart,
    ),
  );

const startsAndDurations = (entries: SVE[]): [number, number][] =>
  entries.map((e) => [e.start, e.duration]);

describe('weekend skip for work flowing across days (#9418)', () => {
  it('continues a Friday repeat overflow on Monday for a Sat/Sun weekend', () => {
    // Fri 2026-01-23 14:00: 3h of work hours left, the repeat needs 6h
    const now = new Date(2026, 0, 23, 14, 0).getTime();
    const days = schedule(now, ['2026-01-23', '2026-01-24', '2026-01-25', '2026-01-26'], {
      cfg: weeklyCfg('friday'),
      weekendDays: SAT_SUN,
    });

    expect(startsAndDurations(days[0])).toEqual([[now, 3 * H]]);
    expect(days[1]).toEqual([]);
    expect(days[2]).toEqual([]);
    expect(startsAndDurations(days[3])).toEqual([
      [new Date(2026, 0, 26, 9, 0).getTime(), 3 * H],
    ]);
  });

  it('continues a Thursday repeat overflow on Sunday for a Fri/Sat weekend', () => {
    // Thu 2026-01-22 14:00
    const now = new Date(2026, 0, 22, 14, 0).getTime();
    const days = schedule(now, ['2026-01-22', '2026-01-23', '2026-01-24', '2026-01-25'], {
      cfg: weeklyCfg('thursday'),
      weekendDays: FRI_SAT,
    });

    expect(startsAndDurations(days[0])).toEqual([[now, 3 * H]]);
    expect(days[1]).toEqual([]);
    expect(days[2]).toEqual([]);
    expect(startsAndDurations(days[3])).toEqual([
      [new Date(2026, 0, 25, 9, 0).getTime(), 3 * H],
    ]);
  });

  it('keeps today’s tasks and repeats on today when today is a weekend day', () => {
    // Sat 2026-01-24 10:00
    const now = new Date(2026, 0, 24, 10, 0).getTime();
    const days = schedule(now, ['2026-01-24', '2026-01-25', '2026-01-26'], {
      cfg: weeklyCfg('saturday'),
      tasks: [todayTask('2026-01-24')],
      weekendDays: SAT_SUN,
    });

    expect(days[0].map((e) => e.type).sort()).toEqual([
      SVEType.RepeatProjection,
      SVEType.TaskPlannedForDay,
    ]);
  });
});

import {
  buildPastWorkCalendarEntries,
  PAST_WORK_CAL_PROVIDER_ID,
} from './build-past-work-calendar-entries';
import { DEFAULT_TASK, Task } from '../../tasks/task.model';
import { TimeTrackingState } from '../../time-tracking/time-tracking.model';
import { parseDbDateStr } from '../../../util/parse-db-date-str';
import { ScheduleFromCalendarEvent } from '../schedule.model';

const H = (h: number): number => h * 60 * 60 * 1000;
const M = (m: number): number => m * 60 * 1000;

const DAY = '2026-04-28';

const makeTask = (
  id: string,
  timeSpentOnDay: Record<string, number>,
  created = 1000,
): Task =>
  ({
    ...DEFAULT_TASK,
    id,
    title: `Task ${id}`,
    projectId: 'p1',
    created,
    timeSpentOnDay,
  }) as Task;

const dayStart = (dateStr: string, hour = 9): number => {
  const d = parseDbDateStr(dateStr);
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
};

describe('buildPastWorkCalendarEntries()', () => {
  describe('empty / no-data cases', () => {
    it('returns [] for empty days array', () => {
      expect(buildPastWorkCalendarEntries([], [], [], undefined, undefined)).toEqual([]);
    });

    it('returns [] when no task has time on the given day', () => {
      const otherDay = '2026-04-27';
      const task = makeTask('t1', { [otherDay]: H(1) });
      const result = buildPastWorkCalendarEntries(
        [DAY],
        [task],
        [],
        undefined,
        undefined,
      );
      expect(result).toEqual([]);
    });

    it('skips days with no tasks silently', () => {
      const task = makeTask('t1', { [DAY]: H(1) });
      const result = buildPastWorkCalendarEntries(
        ['2026-04-25', DAY, '2026-04-30'],
        [task],
        [],
        undefined,
        undefined,
      );
      expect(result.length).toBe(1);
    });
  });

  describe('entry shape', () => {
    it('produces one group per day that has tracked time', () => {
      const task = makeTask('t1', { [DAY]: H(1) });
      const result = buildPastWorkCalendarEntries(
        [DAY],
        [task],
        [],
        undefined,
        undefined,
      );
      expect(result.length).toBe(1);
    });

    it('sets calProviderId to PAST_WORK_CAL_PROVIDER_ID', () => {
      const task = makeTask('t1', { [DAY]: H(1) });
      const items = buildPastWorkCalendarEntries(
        [DAY],
        [task],
        [],
        undefined,
        undefined,
      )[0].items as ScheduleFromCalendarEvent[];
      expect(items[0].calProviderId).toBe(PAST_WORK_CAL_PROVIDER_ID);
    });

    it('sets isReferenceCalendar = true', () => {
      const task = makeTask('t1', { [DAY]: H(1) });
      const items = buildPastWorkCalendarEntries(
        [DAY],
        [task],
        [],
        undefined,
        undefined,
      )[0].items as ScheduleFromCalendarEvent[];
      expect(items[0].isReferenceCalendar).toBeTrue();
    });

    it('uses task title as entry title', () => {
      const task = makeTask('abc', { [DAY]: H(1) });
      const items = buildPastWorkCalendarEntries(
        [DAY],
        [task],
        [],
        undefined,
        undefined,
      )[0].items as ScheduleFromCalendarEvent[];
      expect(items[0].title).toBe('Task abc');
    });

    it('sets duration from timeSpentOnDay', () => {
      const task = makeTask('t1', { [DAY]: M(90) });
      const items = buildPastWorkCalendarEntries(
        [DAY],
        [task],
        [],
        undefined,
        undefined,
      )[0].items as ScheduleFromCalendarEvent[];
      expect(items[0].duration).toBe(M(90));
    });

    it('generates unique id per task+day combination', () => {
      const t1 = makeTask('t1', { [DAY]: H(1) });
      const t2 = makeTask('t2', { [DAY]: H(1) });
      const items = buildPastWorkCalendarEntries(
        [DAY],
        [t1, t2],
        [],
        undefined,
        undefined,
      )[0].items as ScheduleFromCalendarEvent[];
      expect(items[0].id).toBe(`${PAST_WORK_CAL_PROVIDER_ID}-t1-${DAY}`);
      expect(items[1].id).toBe(`${PAST_WORK_CAL_PROVIDER_ID}-t2-${DAY}`);
    });
  });

  describe('stacking / sequencing', () => {
    it('stacks tasks sequentially from work start', () => {
      const t1 = makeTask('t1', { [DAY]: H(1) }, 100);
      const t2 = makeTask('t2', { [DAY]: H(2) }, 200);
      const start = dayStart(DAY, 9);
      const items = buildPastWorkCalendarEntries(
        [DAY],
        [t1, t2],
        [],
        undefined,
        undefined,
      )[0].items as ScheduleFromCalendarEvent[];
      expect(items[0].start).toBe(start);
      expect(items[1].start).toBe(start + H(1));
    });

    it('sorts tasks by created timestamp', () => {
      const tLate = makeTask('tLate', { [DAY]: H(1) }, 2000);
      const tEarly = makeTask('tEarly', { [DAY]: H(1) }, 1000);
      const items = buildPastWorkCalendarEntries(
        [DAY],
        [tLate, tEarly],
        [],
        undefined,
        undefined,
      )[0].items as ScheduleFromCalendarEvent[];
      expect(items[0].title).toBe('Task tEarly');
      expect(items[1].title).toBe('Task tLate');
    });
  });

  describe('work start resolution', () => {
    it('defaults to 9:00 when no ttState and no timelineCfg', () => {
      const task = makeTask('t1', { [DAY]: H(1) });
      const items = buildPastWorkCalendarEntries(
        [DAY],
        [task],
        [],
        undefined,
        undefined,
      )[0].items as ScheduleFromCalendarEvent[];
      expect(items[0].start).toBe(dayStart(DAY, 9));
    });

    it('uses timelineCfg.workStart when isWorkStartEndEnabled', () => {
      const task = makeTask('t1', { [DAY]: H(1) });
      const items = buildPastWorkCalendarEntries([DAY], [task], [], undefined, {
        isWorkStartEndEnabled: true,
        workStart: '07:30',
      } as any)[0].items as ScheduleFromCalendarEvent[];
      const d = parseDbDateStr(DAY);
      d.setHours(7, 30, 0, 0);
      expect(items[0].start).toBe(d.getTime());
    });

    it('uses earliest session start from ttState.project', () => {
      const task = makeTask('t1', { [DAY]: H(1) });
      const d = parseDbDateStr(DAY);
      d.setHours(8, 15, 0, 0);
      const sessionStart = d.getTime();
      const ttState: TimeTrackingState = {
        project: { p1: { [DAY]: { s: sessionStart } } as any },
        tag: {},
      };
      const items = buildPastWorkCalendarEntries([DAY], [task], [], ttState, undefined)[0]
        .items as ScheduleFromCalendarEvent[];
      expect(items[0].start).toBe(sessionStart);
    });

    it('picks the earliest start across multiple projects', () => {
      const task = makeTask('t1', { [DAY]: H(1) });
      const d1 = parseDbDateStr(DAY);
      d1.setHours(10, 0, 0, 0);
      const d2 = parseDbDateStr(DAY);
      d2.setHours(8, 0, 0, 0);
      const ttState: TimeTrackingState = {
        project: {
          p1: { [DAY]: { s: d1.getTime() } } as any,
          p2: { [DAY]: { s: d2.getTime() } } as any,
        },
        tag: {},
      };
      const items = buildPastWorkCalendarEntries([DAY], [task], [], ttState, undefined)[0]
        .items as ScheduleFromCalendarEvent[];
      expect(items[0].start).toBe(d2.getTime());
    });

    it('ttState takes priority over timelineCfg', () => {
      const task = makeTask('t1', { [DAY]: H(1) });
      const d = parseDbDateStr(DAY);
      d.setHours(6, 0, 0, 0);
      const sessionStart = d.getTime();
      const ttState: TimeTrackingState = {
        project: { p1: { [DAY]: { s: sessionStart } } as any },
        tag: {},
      };
      const items = buildPastWorkCalendarEntries([DAY], [task], [], ttState, {
        isWorkStartEndEnabled: true,
        workStart: '09:00',
      } as any)[0].items as ScheduleFromCalendarEvent[];
      expect(items[0].start).toBe(sessionStart);
    });
  });

  describe('archive tasks', () => {
    it('includes archive tasks when they have time on the day', () => {
      const archived = makeTask('arch1', { [DAY]: H(1) });
      const items = buildPastWorkCalendarEntries(
        [DAY],
        [],
        [archived],
        undefined,
        undefined,
      )[0].items as ScheduleFromCalendarEvent[];
      expect(items.length).toBe(1);
      expect(items[0].title).toBe('Task arch1');
    });

    it('merges current and archive tasks for the same day', () => {
      const current = makeTask('c1', { [DAY]: H(1) }, 100);
      const archived = makeTask('a1', { [DAY]: H(1) }, 200);
      const items = buildPastWorkCalendarEntries(
        [DAY],
        [current],
        [archived],
        undefined,
        undefined,
      )[0].items as ScheduleFromCalendarEvent[];
      expect(items.length).toBe(2);
    });
  });

  describe('multiple days', () => {
    it('produces one group per day with tasks', () => {
      const DAY2 = '2026-04-29';
      const t1 = makeTask('t1', { [DAY]: H(1) });
      const t2 = makeTask('t2', { [DAY2]: H(2) });
      const result = buildPastWorkCalendarEntries(
        [DAY, DAY2],
        [t1, t2],
        [],
        undefined,
        undefined,
      );
      expect(result.length).toBe(2);
    });

    it('each day group contains only its own tasks', () => {
      const DAY2 = '2026-04-29';
      const t1 = makeTask('t1', { [DAY]: H(1) });
      const t2 = makeTask('t2', { [DAY2]: H(2) });
      const result = buildPastWorkCalendarEntries(
        [DAY, DAY2],
        [t1, t2],
        [],
        undefined,
        undefined,
      );
      expect(result[0].items.length).toBe(1);
      expect(result[1].items.length).toBe(1);
    });
  });
});

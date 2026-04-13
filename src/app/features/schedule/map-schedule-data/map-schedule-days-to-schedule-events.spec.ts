import { mapScheduleDaysToScheduleEvents } from './map-schedule-days-to-schedule-events';
import { FH, SVEType } from '../schedule.const';
import { ScheduleDay, SVETask } from '../schedule.model';
import { TaskCopy } from '../../tasks/task.model';

const H = 60 * 60 * 1000;

const FAKE_DAY: ScheduleDay = {
  dayDate: '2020-12-12',
  entries: [],
  isToday: false,
  beyondBudgetTasks: [],
};
const FAKE_TASK_ENTRY: SVETask = {
  id: 'XXX',
  data: {
    title: 'TITLE',
    timeEstimate: 66,
    timeSpent: 0,
    id: 'XXX',
    tagIds: [],
    subTaskIds: [],
  } as Partial<TaskCopy> as TaskCopy,
  duration: H,
  start: new Date(2020, 0, 1, 0, 0).getUTCMilliseconds(),
  type: SVEType.Task,
};

const fakeDay = (additional?: Partial<ScheduleDay>): ScheduleDay => {
  return {
    ...FAKE_DAY,
    ...additional,
  };
};

const fakeTaskEntry = (
  id = 'XXX',
  additional?: Partial<SVETask>,
  additionalTaskData?: Partial<TaskCopy>,
): SVETask => {
  return {
    ...FAKE_TASK_ENTRY,
    ...additional,
    data: {
      ...FAKE_TASK_ENTRY.data,
      ...additionalTaskData,
      title: `${id}_TITLE`,
      id,
    },
    id,
  };
};

describe('mapScheduleDaysToScheduleEvents()', () => {
  it('should return eventsFlat and beyondBudgetDays', () => {
    const res = mapScheduleDaysToScheduleEvents([], FH);
    expect(res).toEqual({ eventsFlat: [], beyondBudgetDays: [] });
  });

  it('should return eventsFlat and beyondBudgetDays', () => {
    const res = mapScheduleDaysToScheduleEvents(
      [
        fakeDay({
          entries: [
            fakeTaskEntry('AAA', {
              start: new Date(2020, 0, 1, 5, 0).getTime(),
              duration: H,
            }),
            fakeTaskEntry('BBB', {
              start: new Date(2020, 0, 1, 6, 0).getTime(),
              duration: 0.5 * H,
            }),
          ],
        }),
      ],
      FH,
    );
    expect(res).toEqual({
      beyondBudgetDays: [[]],
      eventsFlat: [
        {
          data: {
            id: 'AAA',
            subTaskIds: [],
            tagIds: [],
            timeEstimate: 66,
            timeSpent: 0,
            title: 'AAA_TITLE',
          },
          dayOfMonth: undefined,
          plannedForDay: undefined,
          id: 'AAA',
          startHours: 5,
          style: 'grid-column: 2;  grid-row: 61 / span 12',
          timeLeftInHours: 1,
          type: 'Task',
        },
        {
          data: {
            id: 'BBB',
            subTaskIds: [],
            tagIds: [],
            timeEstimate: 66,
            timeSpent: 0,
            title: 'BBB_TITLE',
          },
          dayOfMonth: undefined,
          plannedForDay: undefined,
          id: 'BBB',
          startHours: 6,
          style: 'grid-column: 2;  grid-row: 73 / span 6',
          timeLeftInHours: 0.5,
          type: 'Task',
        },
      ],
    } as any);
  });

  it('should detect overlap for two zero-duration events at the same time', () => {
    const startTime = new Date(2020, 0, 1, 9, 0).getTime();
    const res = mapScheduleDaysToScheduleEvents(
      [
        fakeDay({
          entries: [
            fakeTaskEntry('AAA', { start: startTime, duration: 0 }),
            fakeTaskEntry('BBB', { start: startTime, duration: 0 }),
          ],
        }),
      ],
      FH,
    );
    expect(res.eventsFlat[1].overlap).toEqual({ count: 1, offset: 1 });
  });

  it('should detect overlap for three zero-duration events at the same time', () => {
    const startTime = new Date(2020, 0, 1, 9, 0).getTime();
    const res = mapScheduleDaysToScheduleEvents(
      [
        fakeDay({
          entries: [
            fakeTaskEntry('AAA', { start: startTime, duration: 0 }),
            fakeTaskEntry('BBB', { start: startTime, duration: 0 }),
            fakeTaskEntry('CCC', { start: startTime, duration: 0 }),
          ],
        }),
      ],
      FH,
    );
    expect(res.eventsFlat[1].overlap).toEqual({ count: 1, offset: 1 });
    expect(res.eventsFlat[2].overlap).toEqual({ count: 2, offset: 2 });
  });

  it('should detect overlap for two events with normal duration at the same time', () => {
    const startTime = new Date(2020, 0, 1, 9, 0).getTime();
    const res = mapScheduleDaysToScheduleEvents(
      [
        fakeDay({
          entries: [
            fakeTaskEntry('AAA', { start: startTime, duration: H }),
            fakeTaskEntry('BBB', { start: startTime, duration: H }),
          ],
        }),
      ],
      FH,
    );
    expect(res.eventsFlat[1].overlap).toEqual({ count: 1, offset: 1 });
  });

  it('should NOT detect overlap for two zero-duration events at different times', () => {
    const res = mapScheduleDaysToScheduleEvents(
      [
        fakeDay({
          entries: [
            fakeTaskEntry('AAA', {
              start: new Date(2020, 0, 1, 9, 0).getTime(),
              duration: 0,
            }),
            fakeTaskEntry('BBB', {
              start: new Date(2020, 0, 1, 10, 0).getTime(),
              duration: 0,
            }),
          ],
        }),
      ],
      FH,
    );
    expect(res.eventsFlat[1].overlap).toBeUndefined();
  });
});

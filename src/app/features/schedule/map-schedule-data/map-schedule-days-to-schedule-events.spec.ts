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
          id: 'BBB',
          startHours: 6,
          style: 'grid-column: 2;  grid-row: 73 / span 6',
          timeLeftInHours: 0.5,
          type: 'Task',
        },
      ],
    } as any);
  });
});

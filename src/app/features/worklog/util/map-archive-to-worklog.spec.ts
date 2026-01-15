import { arrayToDictionary } from '../../../util/array-to-dictionary';
import { DEFAULT_TASK, Task, TaskCopy } from '../../tasks/task.model';
import { mapArchiveToWorklog } from './map-archive-to-worklog';
import { Dictionary, EntityState } from '@ngrx/entity';
import { Worklog } from '../worklog.model';

/* eslint-disable @typescript-eslint/naming-convention */
const START_END_ALL = {
  workStart: {
    '1200-05-05': 10713600000,
  },
  workEnd: {
    '2022-05-08': 1651968000000,
  },
};

const fakeTaskStateFromArray = (tasks: TaskCopy[]): EntityState<Task> => {
  const dict = arrayToDictionary(tasks) as Dictionary<TaskCopy>;
  return {
    entities: dict,
    ids: Object.keys(dict),
  } as EntityState<Task>;
};

describe('mapArchiveToWorklog', () => {
  it('should work for single task with multiple days', () => {
    const ts = fakeTaskStateFromArray([
      {
        ...DEFAULT_TASK,
        projectId: 'P1',
        title: 'A',
        id: 'A',
        timeSpent: 13332,
        timeSpentOnDay: {
          '2015-01-15': 9999,
          '2018-02-16': 3333,
        },
      },
    ]);

    const r = mapArchiveToWorklog(ts, [], START_END_ALL, 1, 'en-US');
    const w: Worklog = r.worklog;

    expect(r.totalTimeSpent).toBe(13332);

    expect(w[2015].timeSpent).toBe(9999);
    expect(w[2015].ent[1].timeSpent).toBe(9999);
    expect(w[2015].ent[1].daysWorked).toBe(1);
    expect(w[2015].ent[1].ent[15].timeSpent).toBe(9999);
    expect(w[2015].ent[1].ent[15].dayStr).toBe('Thu');
    expect(w[2015].ent[1].ent[15].dateStr).toBe('2015-01-15');
    expect(w[2015].ent[1].ent[15].logEntries.length).toBe(1);

    expect(w[2018].timeSpent).toBe(3333);
    expect(w[2018].ent[2].timeSpent).toBe(3333);
    expect(w[2018].ent[2].daysWorked).toBe(1);
    expect(w[2018].ent[2].ent[16].timeSpent).toBe(3333);
    expect(w[2018].ent[2].ent[16].dayStr).toBe('Fri');
    expect(w[2018].ent[2].ent[16].dateStr).toBe('2018-02-16');
    expect(w[2018].ent[2].ent[16].logEntries.length).toBe(1);
  });

  it('should work for parent task with sub tasks on separate days', () => {
    const ts = fakeTaskStateFromArray([
      {
        ...DEFAULT_TASK,
        projectId: 'P1',
        title: 'A',
        id: 'A',
        subTaskIds: ['SUB_B', 'SUB_C'],
        timeSpent: 13332,
        timeSpentOnDay: {
          '2015-01-15': 9999,
          '2018-02-16': 3333,
        },
      },
      {
        ...DEFAULT_TASK,
        projectId: 'P1',
        title: 'SUB_B',
        id: 'SUB_B',
        parentId: 'A',
        timeSpentOnDay: {
          '2015-01-15': 9999,
        },
      },
      {
        ...DEFAULT_TASK,
        projectId: 'P1',
        title: 'SUB_C',
        id: 'SUB_C',
        parentId: 'A',
        timeSpentOnDay: {
          '2018-02-16': 3333,
        },
      },
    ]);

    const r = mapArchiveToWorklog(ts, [], START_END_ALL, 1, 'en-US');
    const w: Worklog = r.worklog;

    expect(r.totalTimeSpent).toBe(13332);

    expect(w[2015].timeSpent).toBe(9999);
    expect(w[2015].ent[1].timeSpent).toBe(9999);
    expect(w[2015].ent[1].daysWorked).toBe(1);
    expect(w[2015].ent[1].ent[15].timeSpent).toBe(9999);
    expect(w[2015].ent[1].ent[15].logEntries.length).toBe(2);
    expect(w[2015].ent[1].ent[15].logEntries[0].task.id).toBe('A');
    expect(w[2015].ent[1].ent[15].logEntries[1].task.id).toBe('SUB_B');
    expect(w[2015].ent[1].ent[15].logEntries[1].parentId).toBe('A');

    expect(w[2018].timeSpent).toBe(3333);
    expect(w[2018].ent[2].timeSpent).toBe(3333);
    expect(w[2018].ent[2].daysWorked).toBe(1);
    expect(w[2018].ent[2].ent[16].timeSpent).toBe(3333);
    expect(w[2018].ent[2].ent[16].logEntries.length).toBe(2);
    expect(w[2018].ent[2].ent[16].logEntries[0].task.id).toBe('A');
    expect(w[2018].ent[2].ent[16].logEntries[1].task.id).toBe('SUB_C');
    expect(w[2018].ent[2].ent[16].logEntries[1].parentId).toBe('A');
  });

  it('should sort sub tasks directly after their parent', () => {
    const ts = fakeTaskStateFromArray([
      {
        ...DEFAULT_TASK,
        projectId: 'P1',
        title: 'PT1',
        id: 'PT1',
        subTaskIds: ['SUB_A', 'SUB_B'],
        timeSpent: 10000,
        timeSpentOnDay: {
          '2015-01-15': 10000,
        },
      },
      {
        ...DEFAULT_TASK,
        projectId: 'P1',
        title: 'MT1',
        id: 'MT1',
        subTaskIds: [],
        timeSpent: 3333,
        timeSpentOnDay: {
          '2015-01-15': 3333,
        },
      },
      {
        ...DEFAULT_TASK,
        projectId: 'P1',
        title: 'SUB_A',
        id: 'SUB_A',
        parentId: 'PT1',
        timeSpent: 4000,
        timeSpentOnDay: {
          '2015-01-15': 4000,
        },
      },
      {
        ...DEFAULT_TASK,
        projectId: 'P1',
        title: 'SUB_B',
        id: 'SUB_B',
        parentId: 'PT1',
        timeSpent: 6000,
        timeSpentOnDay: {
          '2015-01-15': 6000,
        },
      },
    ]);

    const r = mapArchiveToWorklog(ts, [], START_END_ALL, 1, 'en-US');
    const w: Worklog = r.worklog;

    expect(r.totalTimeSpent).toBe(13333);
    expect(w[2015].timeSpent).toBe(13333);
    expect(w[2015].ent[1].timeSpent).toBe(13333);
    expect(w[2015].ent[1].ent[15].timeSpent).toBe(13333);

    expect(w[2015].ent[1].ent[15].logEntries.length).toBe(4);
    // With alphabetical sorting: MT1 comes before PT1
    expect(w[2015].ent[1].ent[15].logEntries[0].task.id).toBe('MT1');
    expect(w[2015].ent[1].ent[15].logEntries[1].task.id).toBe('PT1');
    expect(w[2015].ent[1].ent[15].logEntries[2].task.id).toBe('SUB_A');
    expect(w[2015].ent[1].ent[15].logEntries[3].task.id).toBe('SUB_B');
  });

  it('should work for sub tasks and parents spanning over multiple days', () => {
    const ts = fakeTaskStateFromArray([
      {
        ...DEFAULT_TASK,
        projectId: 'P1',
        title: 'PT1',
        id: 'PT1',
        subTaskIds: ['SUB_A', 'SUB_B', 'SUB_C'],
        timeSpent: 48106885,
        timeSpentOnDay: {
          '2021-06-06': 6000,
          '2021-06-07': 7000,
          '2021-06-08': 8366,
        },
        doneOn: 21366,
        isDone: true,
      },
      {
        ...DEFAULT_TASK,
        projectId: 'P1',
        title: 'SUB_A',
        id: 'SUB_A',
        parentId: 'PT1',
        timeSpent: 21000,
        timeSpentOnDay: {
          '2021-06-06': 6000,
          '2021-06-07': 7000,
          '2021-06-08': 8000,
        },
        doneOn: 1623170868065,
        isDone: true,
      },
      {
        ...DEFAULT_TASK,
        projectId: 'P1',
        title: 'SUB_B',
        id: 'SUB_B',
        parentId: 'PT1',
        timeSpentOnDay: {
          '2021-06-08': 300,
        },
        timeSpent: 300,
        timeEstimate: 0,
        isDone: true,
        doneOn: 1623170868065,
      },
      {
        ...DEFAULT_TASK,
        projectId: 'P1',
        title: 'SUB_C',
        id: 'SUB_C',
        parentId: 'PT1',
        subTaskIds: [],
        timeSpentOnDay: {
          '2021-06-08': 66,
        },
        timeSpent: 66,
        timeEstimate: 0,
        isDone: true,
        doneOn: 1623171125611,
      },
    ]);

    const r = mapArchiveToWorklog(ts, [], START_END_ALL, 1, 'en-US');
    const w: Worklog = r.worklog;

    expect(r.totalTimeSpent).toBe(21366);
    expect(w[2021].timeSpent).toBe(21366);
    expect(w[2021].ent[6].timeSpent).toBe(21366);

    expect(w[2021].ent[6].ent[6].timeSpent).toBe(6000);
    expect(w[2021].ent[6].ent[6].logEntries.length).toBe(2);
    expect(w[2021].ent[6].ent[6].logEntries[0].task.id).toBe('PT1');
    expect(w[2021].ent[6].ent[6].logEntries[1].task.id).toBe('SUB_A');

    expect(w[2021].ent[6].ent[7].timeSpent).toBe(7000);
    expect(w[2021].ent[6].ent[7].logEntries.length).toBe(2);
    expect(w[2021].ent[6].ent[7].logEntries[0].task.id).toBe('PT1');
    expect(w[2021].ent[6].ent[7].logEntries[1].task.id).toBe('SUB_A');

    expect(w[2021].ent[6].ent[8].timeSpent).toBe(8366);
    expect(w[2021].ent[6].ent[8].logEntries.length).toBe(4);
    expect(w[2021].ent[6].ent[8].logEntries[0].task.id).toBe('PT1');
    expect(w[2021].ent[6].ent[8].logEntries[1].task.id).toBe('SUB_A');
    // With alphabetical sorting: SUB_B comes before SUB_C
    expect(w[2021].ent[6].ent[8].logEntries[2].task.id).toBe('SUB_B');
    expect(w[2021].ent[6].ent[8].logEntries[3].task.id).toBe('SUB_C');
  });

  it('should work for sub tasks with zero time worked', () => {
    const ts = fakeTaskStateFromArray([
      {
        ...DEFAULT_TASK,
        projectId: 'P1',
        title: 'PT1',
        id: 'PT1',
        subTaskIds: ['SUB_A', 'SUB_B', 'SUB_C'],
        timeSpent: 48106885,
        timeSpentOnDay: {
          '2021-06-06': 6000,
          '2021-06-07': 7000,
          '2021-06-08': 8366,
        },
        doneOn: 21366,
        isDone: true,
      },
      {
        ...DEFAULT_TASK,
        projectId: 'P1',
        title: 'SUB_A',
        id: 'SUB_A',
        parentId: 'PT1',
        timeSpent: 21000,
        timeSpentOnDay: {
          '2021-06-06': 6000,
          '2021-06-07': 7000,
          '2021-06-08': 8000,
          '2021-06-09': 0,
        },
        doneOn: 1623170868065,
        isDone: true,
      },
      {
        ...DEFAULT_TASK,
        projectId: 'P1',
        title: 'SUB_B',
        id: 'SUB_B',
        parentId: 'PT1',
        timeSpentOnDay: {
          '2021-06-08': 300,
        },
        timeSpent: 300,
        timeEstimate: 0,
        isDone: true,
        doneOn: 1623170868065,
      },
      {
        ...DEFAULT_TASK,
        projectId: 'P1',
        title: 'SUB_C',
        id: 'SUB_C',
        parentId: 'PT1',
        subTaskIds: [],
        timeSpentOnDay: {
          '2021-06-07': 0,
          '2021-06-08': 66,
        },
        timeSpent: 66,
        timeEstimate: 0,
        isDone: true,
        doneOn: 1623171125611,
      },
    ]);

    const r = mapArchiveToWorklog(ts, [], START_END_ALL, 1, 'en-US');
    const w: Worklog = r.worklog;

    expect(r.totalTimeSpent).toBe(21366);
    expect(w[2021].timeSpent).toBe(21366);
    expect(w[2021].ent[6].timeSpent).toBe(21366);

    expect(w[2021].ent[6].ent[6].timeSpent).toBe(6000);
    expect(w[2021].ent[6].ent[6].logEntries.length).toBe(2);
    expect(w[2021].ent[6].ent[6].logEntries[0].task.id).toBe('PT1');
    expect(w[2021].ent[6].ent[6].logEntries[1].task.id).toBe('SUB_A');

    expect(w[2021].ent[6].ent[7].timeSpent).toBe(7000);
    expect(w[2021].ent[6].ent[7].logEntries.length).toBe(2);
    expect(w[2021].ent[6].ent[7].logEntries[0].task.id).toBe('PT1');
    expect(w[2021].ent[6].ent[7].logEntries[1].task.id).toBe('SUB_A');

    expect(w[2021].ent[6].ent[8].timeSpent).toBe(8366);
    expect(w[2021].ent[6].ent[8].logEntries.length).toBe(4);
    expect(w[2021].ent[6].ent[8].logEntries[0].task.id).toBe('PT1');
    expect(w[2021].ent[6].ent[8].logEntries[1].task.id).toBe('SUB_A');
    // With alphabetical sorting: SUB_B comes before SUB_C
    expect(w[2021].ent[6].ent[8].logEntries[2].task.id).toBe('SUB_B');
    expect(w[2021].ent[6].ent[8].logEntries[3].task.id).toBe('SUB_C');
  });
});

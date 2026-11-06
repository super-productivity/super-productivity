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
  it('places an untracked independently tagged subtask on its own date when its parent is outside the context', () => {
    const state = fakeTaskStateFromArray([
      {
        ...DEFAULT_TASK,
        id: 'subtask',
        projectId: 'INBOX_PROJECT',
        parentId: 'outside-context',
        tagIds: ['own-tag'],
        created: new Date(2026, 9, 20, 12).getTime(),
        doneOn: new Date(2026, 9, 21, 12).getTime(),
      },
      {
        ...DEFAULT_TASK,
        id: 'logged',
        projectId: 'INBOX_PROJECT',
        timeSpentOnDay: { '2026-10-21': 600000 },
      },
    ]);
    const { worklog } = mapArchiveToWorklog(
      state,
      [],
      { workStart: {}, workEnd: {} },
      1,
      'en-US',
    );
    expect(
      worklog[2026].ent[10].ent[21].logEntries.map((entry) => entry.task.id),
    ).toEqual(['logged', 'subtask']);
    expect(state.entities.subtask?.timeSpentOnDay).toEqual({});
  });

  it('should preserve restore flags for every day of active and archived tasks', () => {
    const taskState = fakeTaskStateFromArray(
      ['active', 'archived'].map((id) => ({
        ...DEFAULT_TASK,
        id,
        title: id,
        projectId: 'INBOX',
        timeSpentOnDay: { '2024-01-01': 1000, '2024-01-02': 2000 },
      })),
    );
    const noRestoreIds = ['missing', 'active', 'active'];
    Object.freeze(noRestoreIds);

    const { worklog, totalTimeSpent } = mapArchiveToWorklog(
      taskState,
      noRestoreIds,
      { workStart: {}, workEnd: {} },
      1,
      'en-US',
    );

    expect(totalTimeSpent).toBe(6000);
    for (const day of [1, 2]) {
      expect(
        worklog[2024].ent[1].ent[day].logEntries.map((entry) => ({
          id: entry.task.id,
          isNoRestore: entry.isNoRestore,
        })),
      ).toEqual([
        { id: 'active', isNoRestore: true },
        { id: 'archived', isNoRestore: false },
      ]);
    }
  });

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

describe('mapArchiveToWorklog weeks crossing a month boundary (#9950)', () => {
  const taskWithDays = (timeSpentOnDay: { [dateStr: string]: number }): TaskCopy => ({
    ...DEFAULT_TASK,
    projectId: 'P1',
    title: 'A',
    id: 'A',
    timeSpentOnDay,
  });
  const map = (
    timeSpentOnDay: { [dateStr: string]: number },
    firstDayOfWeek: number = 1,
  ): Worklog =>
    mapArchiveToWorklog(
      fakeTaskStateFromArray([taskWithDays(timeSpentOnDay)]),
      [],
      { workStart: {}, workEnd: {} },
      firstDayOfWeek,
      'en-US',
    ).worklog;

  it('should show the whole week in every month it has worked days in', () => {
    // Mon 2026-08-31 – Sun 2026-09-06 is ISO week 36
    const w = map({ '2026-08-31': 1000, '2026-09-01': 2000, '2026-09-06': 4000 });

    expect(w[2026].ent[8].weeks.length).toBe(1);
    expect(w[2026].ent[9].weeks.length).toBe(1);
    const week = w[2026].ent[9].weeks[0];
    expect(w[2026].ent[8].weeks[0]).toEqual(week);
    expect(week.weekNr).toBe(36);
    expect(week.timeSpent).toBe(7000);
    expect(week.daysWorked).toBe(3);
    expect(week.start).toBe(31);
    expect(week.end).toBe(6);
    expect(week.startDateStr).toBe('2026-08-31');
    expect(week.endDateStr).toBe('2026-09-06');
    expect(Object.values(week.ent).map((d) => d.dateStr)).toEqual(
      jasmine.arrayWithExactContents(['2026-08-31', '2026-09-01', '2026-09-06']),
    );
    // month totals stay calendar-month based
    expect(w[2026].ent[8].timeSpent).toBe(1000);
    expect(w[2026].ent[9].timeSpent).toBe(6000);
  });

  it('should not list the week in a month it has no worked days in', () => {
    const w = map({ '2026-08-31': 500, '2026-09-14': 2000 });

    expect(w[2026].ent[8].weeks.map((wk) => wk.weekNr)).toEqual([36]);
    expect(w[2026].ent[8].weeks[0].endDateStr).toBe('2026-09-06');
    expect(w[2026].ent[9].weeks.map((wk) => wk.weekNr)).toEqual([38]);
  });

  it('should keep weeks in date order within a month', () => {
    const w = map({ '2026-09-01': 1000, '2026-09-10': 1000, '2026-09-28': 1000 });

    expect(w[2026].ent[9].weeks.map((wk) => wk.weekNr)).toEqual([36, 37, 40]);
  });

  it('should respect a Sunday first day of week', () => {
    // Sun 2026-08-30 – Sat 2026-09-05; Sun 2026-09-06 starts the next week
    const w = map({ '2026-08-30': 1000, '2026-09-05': 2000, '2026-09-06': 4000 }, 0);

    expect(w[2026].ent[8].weeks.map((wk) => wk.timeSpent)).toEqual([3000]);
    expect(w[2026].ent[9].weeks.map((wk) => wk.timeSpent)).toEqual([3000, 4000]);
    expect(w[2026].ent[9].weeks[0].startDateStr).toBe('2026-08-30');
    expect(w[2026].ent[9].weeks[0].endDateStr).toBe('2026-09-05');
    expect(w[2026].ent[9].weeks[1].startDateStr).toBe('2026-09-06');
  });

  it('should keep a week crossing the year boundary whole', () => {
    // Mon 2026-12-28 – Sun 2027-01-03
    const w = map({ '2026-12-31': 1000, '2027-01-01': 2000 });

    expect(w[2026].ent[12].weeks.map((wk) => wk.timeSpent)).toEqual([3000]);
    expect(w[2027].ent[1].weeks.map((wk) => wk.timeSpent)).toEqual([3000]);
    expect(w[2027].ent[1].weeks[0].startDateStr).toBe('2026-12-28');
  });
});

describe('mapArchiveToWorklog weeks with malformed day keys', () => {
  // production devError only logs invalid date strings, so mapping must carry on;
  // the global confirm spy (src/test.ts) decides whether devError throws
  beforeEach(() => (window.confirm as jasmine.Spy).and.returnValue(false));
  afterEach(() => (window.confirm as jasmine.Spy).and.returnValue(true));

  it('should skip days without a valid date when building weeks', () => {
    const ts = fakeTaskStateFromArray([
      {
        ...DEFAULT_TASK,
        projectId: 'P1',
        title: 'A',
        id: 'A',
        timeSpentOnDay: { undefined: 1000, '2026-09': 1000, '2026-09-01': 2000 },
      },
    ]);

    const w = mapArchiveToWorklog(ts, [], START_END_ALL, 1, 'en-US').worklog;

    expect(w[2026].ent[9].weeks.map((wk) => wk.weekNr)).toEqual([36]);
    expect(w[2026].ent[9].weeks[0].timeSpent).toBe(2000);
  });
});

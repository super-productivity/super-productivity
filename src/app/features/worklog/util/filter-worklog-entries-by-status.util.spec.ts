import {
  filterWorklogEntriesByStatus,
  filterWorklogByTaskStatus,
  getTimeSpentForWorklogEntries,
} from './filter-worklog-entries-by-status.util';
import { Worklog, WorklogDataForDay } from '../worklog.model';
import { DEFAULT_TASK, Task } from '../../tasks/task.model';

/* eslint-disable @typescript-eslint/naming-convention */

const createEntry = (
  id: string,
  isDone: boolean,
  timeSpent: number = 1000,
  subTaskIds: string[] = [],
): WorklogDataForDay => ({
  timeSpent,
  task: {
    ...DEFAULT_TASK,
    id,
    title: id,
    isDone,
    subTaskIds,
  } as Task,
  isNoRestore: false,
});

describe('filterWorklogEntriesByStatus', () => {
  const doneEntry = createEntry('done', true);
  const undoneEntry = createEntry('undone', false);
  const entries = [doneEntry, undoneEntry];

  it('keeps all entries for the all filter', () => {
    expect(filterWorklogEntriesByStatus(entries, 'ALL')).toBe(entries);
  });

  it('keeps completed entries for the done filter', () => {
    expect(filterWorklogEntriesByStatus(entries, 'DONE')).toEqual([doneEntry]);
  });

  it('keeps uncompleted entries for the undone filter', () => {
    expect(filterWorklogEntriesByStatus(entries, 'UNDONE')).toEqual([undoneEntry]);
  });
});

describe('getTimeSpentForWorklogEntries', () => {
  it('sums leaf task time and skips parent summary rows', () => {
    const entries = [
      createEntry('parent', true, 3000, ['child']),
      createEntry('child', true, 2000),
      createEntry('standalone', false, 1000),
    ];

    expect(getTimeSpentForWorklogEntries(entries)).toBe(3000);
  });

  it('skips parent summary rows even when no child row is visible', () => {
    expect(
      getTimeSpentForWorklogEntries([createEntry('parent', true, 3000, ['child'])]),
    ).toBe(0);
  });
});

describe('filterWorklogByTaskStatus', () => {
  const doneEntry = createEntry('done', true, 2000);
  const undoneEntry = createEntry('undone', false, 1000);
  const worklog: Worklog = {
    2026: {
      daysWorked: 1,
      monthWorked: 1,
      timeSpent: 3000,
      ent: {
        2: {
          daysWorked: 1,
          timeSpent: 3000,
          ent: {
            1: {
              dateStr: '2026-02-01',
              dayStr: 'Sun',
              logEntries: [doneEntry, undoneEntry],
              timeSpent: 3000,
              workEnd: 2,
              workStart: 1,
            },
          },
          weeks: [
            {
              daysWorked: 1,
              end: 7,
              ent: {
                1: {
                  dateStr: '2026-02-01',
                  dayStr: 'Sun',
                  logEntries: [doneEntry, undoneEntry],
                  timeSpent: 3000,
                  workEnd: 2,
                  workStart: 1,
                },
              },
              start: 1,
              timeSpent: 3000,
              weekNr: 6,
            },
          ],
        },
      },
    },
  };

  it('returns the original data for the all filter', () => {
    const data = { worklog, totalTimeSpent: 3000 };

    expect(filterWorklogByTaskStatus(data, 'ALL')).toBe(data);
  });

  it('filters nested worklog data and recalculates totals', () => {
    const filtered = filterWorklogByTaskStatus({ worklog, totalTimeSpent: 3000 }, 'DONE');

    expect(filtered.totalTimeSpent).toBe(2000);
    expect(filtered.worklog[2026].timeSpent).toBe(2000);
    expect(filtered.worklog[2026].ent[2].timeSpent).toBe(2000);
    expect(filtered.worklog[2026].ent[2].weeks[0].timeSpent).toBe(2000);
    expect(filtered.worklog[2026].ent[2].ent[1].logEntries).toEqual([doneEntry]);
  });

  it('removes empty days, weeks, months, and years', () => {
    const filtered = filterWorklogByTaskStatus(
      { worklog, totalTimeSpent: 3000 },
      'UNDONE',
    );

    expect(filtered.totalTimeSpent).toBe(1000);
    expect(filtered.worklog[2026].daysWorked).toBe(1);
    expect(filtered.worklog[2026].monthWorked).toBe(1);
    expect(filtered.worklog[2026].ent[2].weeks.length).toBe(1);
    expect(filtered.worklog[2026].ent[2].ent[1].logEntries).toEqual([undoneEntry]);
  });

  it('does not inflate filtered totals when only a parent summary row remains visible', () => {
    const parentDone = createEntry('parent', true, 3000, ['child']);
    const childUndone = createEntry('child', false, 3000);
    const data: Worklog = {
      2026: {
        daysWorked: 1,
        monthWorked: 1,
        timeSpent: 3000,
        ent: {
          2: {
            daysWorked: 1,
            timeSpent: 3000,
            ent: {
              1: {
                dateStr: '2026-02-01',
                dayStr: 'Sun',
                logEntries: [parentDone, childUndone],
                timeSpent: 3000,
                workEnd: 2,
                workStart: 1,
              },
            },
            weeks: [
              {
                daysWorked: 1,
                end: 7,
                ent: {
                  1: {
                    dateStr: '2026-02-01',
                    dayStr: 'Sun',
                    logEntries: [parentDone, childUndone],
                    timeSpent: 3000,
                    workEnd: 2,
                    workStart: 1,
                  },
                },
                start: 1,
                timeSpent: 3000,
                weekNr: 6,
              },
            ],
          },
        },
      },
    };

    const filtered = filterWorklogByTaskStatus(
      { worklog: data, totalTimeSpent: 3000 },
      'DONE',
    );

    expect(filtered.totalTimeSpent).toBe(0);
    expect(filtered.worklog[2026].timeSpent).toBe(0);
    expect(filtered.worklog[2026].ent[2].timeSpent).toBe(0);
    expect(filtered.worklog[2026].ent[2].weeks[0].timeSpent).toBe(0);
    expect(filtered.worklog[2026].ent[2].ent[1].logEntries).toEqual([parentDone]);
  });
});

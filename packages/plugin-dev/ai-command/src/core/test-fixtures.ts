// Shared fixtures for the core specs. Times are local, like the app's.

import type { Day, Snapshot, TaskLike } from './types';

export const TODAY = '2026-11-03'; // a Tuesday
export const localTs = (day: string, hour: number): number => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, hour).getTime();
};

export const DAY: Day = {
  todayStr: TODAY,
  startOfNextDayDiffMs: 0,
  nowMs: localTs(TODAY, 12),
};

export const task = (id: string, extra: Partial<TaskLike> = {}): TaskLike => ({
  id,
  title: `Task ${id}`,
  isDone: false,
  timeEstimate: 0,
  timeSpent: 0,
  projectId: 'p1',
  tagIds: [],
  subTaskIds: [],
  ...extra,
});

export const snapshot = (tasks: TaskLike[], extra: Partial<Snapshot> = {}): Snapshot => ({
  tasks,
  projects: [
    { id: 'p1', title: 'Inbox' },
    { id: 'p2', title: 'Website' },
  ],
  tags: [
    { id: 'TODAY', title: 'Today' },
    { id: 'g1', title: 'errands' },
    { id: 'g2', title: 'calls' },
  ],
  day: DAY,
  selectionIds: [],
  currentTaskId: null,
  ...extra,
});

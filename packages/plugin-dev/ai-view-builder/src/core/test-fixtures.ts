import type {
  ActiveWorkContext,
  PluginDayContext,
  Project,
  Tag,
  Task,
} from '@super-productivity/plugin-api';
import type { ModelEnv } from './model';

// Shared fixtures for the core specs. Thursday 2026-10-29 is "today", the
// day starts at 04:00 and weeks start on Monday.

export const DAY: PluginDayContext = {
  todayStr: '2026-10-29',
  startOfNextDayDiffMs: 4 * 60 * 60 * 1000,
  firstDayOfWeek: 1,
};

export const task = (id: string, overrides: Partial<Task> = {}): Task => ({
  id,
  title: `Task ${id}`,
  timeEstimate: 0,
  timeSpent: 0,
  isDone: false,
  projectId: 'p-work',
  tagIds: [],
  parentId: null,
  created: 1,
  subTaskIds: [],
  ...overrides,
});

export const PROJECTS = [
  { id: 'p-work', title: 'Work', taskIds: ['b', 'a'], backlogTaskIds: [] },
  { id: 'p-home', title: 'Home', taskIds: [], backlogTaskIds: [] },
] as unknown as Project[];

export const TAGS = [
  { id: 't-doing', title: 'Doing', taskIds: [] },
  { id: 't-urgent', title: 'Urgent', taskIds: [] },
  { id: 't-important', title: 'Important', taskIds: [] },
] as unknown as Tag[];

export const env = (tasks: Task[], overrides: Partial<ModelEnv> = {}): ModelEnv => ({
  tasks,
  projects: PROJECTS,
  tags: TAGS,
  day: DAY,
  context: null as ActiveWorkContext | null,
  currentTaskId: null,
  ...overrides,
});

/** Local timestamp for a date and hour. */
export const at = (dateStr: string, hour: number): number => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d, hour).getTime();
};

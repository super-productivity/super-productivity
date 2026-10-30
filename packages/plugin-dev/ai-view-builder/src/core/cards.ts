import type { Project, Tag, Task } from '@super-productivity/plugin-api';
import { FieldName } from './spec';
import {
  addDays,
  deadlineOf,
  dueDayOf,
  parseDateStr,
  priorityOf,
  QueryEnv,
} from './query';

// What one task looks like as a card. Chips, estimate and due get their own
// slots (like a task row in Super Productivity) instead of one line of text.

export interface ModelEnv extends QueryEnv {
  currentTaskId: string | null;
}

export interface Chip {
  label: string;
  /** A validated CSS color, so the renderer can use it as is. */
  color?: string;
}

export interface CardModel {
  id: string;
  title: string;
  isDone: boolean;
  isTracking: boolean;
  isSubTask: boolean;
  /** Project first, then tags. */
  chips: Chip[];
  estimate?: string;
  due?: { text: string; overdue: boolean };
  /** The remaining fields: time spent, deadline, priority. */
  meta: string[];
}

/** What a card shows when the view does not say; `fields: []` shows none. */
export const DEFAULT_FIELDS: FieldName[] = ['project', 'tags', 'estimate', 'due'];

export const formatDuration = (ms: number): string => {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
};

/** Today and its neighbours by name, any other day as a short local date. */
export const formatDay = (day: string, todayStr: string): string => {
  if (day === todayStr) return 'Today';
  if (day === addDays(todayStr, 1)) return 'Tomorrow';
  if (day === addDays(todayStr, -1)) return 'Yesterday';
  return parseDateStr(day).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
};

/** Total estimate of the tasks, or undefined when none has one. */
export const sumEstimate = (tasks: Task[]): string | undefined => {
  const ms = tasks.reduce((acc, t) => acc + (t.timeEstimate || 0), 0);
  return ms > 0 ? formatDuration(ms) : undefined;
};

/** Total of what is left to do on the open tasks, or undefined when nothing is. */
export const sumRemaining = (tasks: Task[]): string | undefined => {
  const ms = tasks.reduce(
    (acc, t) =>
      t.isDone ? acc : acc + Math.max(0, (t.timeEstimate || 0) - (t.timeSpent || 0)),
    0,
  );
  return ms > 0 ? formatDuration(ms) : undefined;
};

// Colors come from user data; only plain color notations are passed on.
const COLOR = /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([\d\s.,%/-]+\))$/i;

const safeColor = (value: unknown): string | undefined =>
  typeof value === 'string' && COLOR.test(value.trim()) ? value.trim() : undefined;

const primaryOf = (theme: unknown): unknown =>
  typeof theme === 'object' && theme !== null
    ? (theme as Record<string, unknown>).primary
    : undefined;

export const projectColor = (project: Project): string | undefined =>
  safeColor(primaryOf(project.theme));

export const tagColor = (tag: Tag): string | undefined =>
  safeColor(tag.color) ?? safeColor(primaryOf(tag.theme));

const chipsOf = (task: Task, fields: FieldName[], env: QueryEnv): Chip[] => {
  const chips: Chip[] = [];
  const project = fields.includes('project')
    ? env.projects.find((p) => p.id === task.projectId)
    : undefined;
  if (project) {
    chips.push({ label: project.title, color: projectColor(project) });
  }
  if (!fields.includes('tags')) return chips;
  for (const id of task.tagIds) {
    const tag = env.tags.find((t) => t.id === id);
    if (tag) {
      chips.push({ label: tag.title, color: tagColor(tag) });
    }
  }
  return chips;
};

const metaOf = (task: Task, fields: FieldName[], env: QueryEnv): string[] => {
  const out: string[] = [];
  if (fields.includes('timeSpent') && task.timeSpent > 0) {
    out.push(`${formatDuration(task.timeSpent)} spent`);
  }
  const deadline = fields.includes('deadline') ? deadlineOf(task, env.day) : null;
  if (deadline) out.push(`deadline ${formatDay(deadline, env.day.todayStr)}`);
  const priority = fields.includes('priority') ? priorityOf(task) : 'none';
  if (priority !== 'none') out.push(`${priority} priority`);
  return out;
};

export const toCard = (task: Task, fields: FieldName[], env: ModelEnv): CardModel => {
  const card: CardModel = {
    id: task.id,
    title: task.title,
    isDone: task.isDone,
    isTracking: env.currentTaskId === task.id,
    isSubTask: !!task.parentId,
    chips: chipsOf(task, fields, env),
    meta: metaOf(task, fields, env),
  };
  if (fields.includes('estimate') && task.timeEstimate > 0) {
    card.estimate = formatDuration(task.timeEstimate);
  }
  const due = fields.includes('due') ? dueDayOf(task, env.day) : null;
  if (due) {
    card.due = {
      text: formatDay(due, env.day.todayStr),
      overdue: due < env.day.todayStr && !task.isDone,
    };
  }
  return card;
};

const norm = (s: string): string => s.trim().toLowerCase();

/** Inside one project every card would carry the same chip, so it is left out. */
const isProjectScope = (scope: string | undefined, env: QueryEnv): boolean =>
  (scope === '@current' && env.context?.type === 'PROJECT') ||
  (!!scope && env.projects.some((p) => norm(p.title) === norm(scope)));

/**
 * The fields a part shows: its own list, or the defaults. The defaults leave
 * out the project chip in a view of one project; an explicit list is obeyed.
 */
export const fieldsFor = (
  fields: unknown,
  scope: string | undefined,
  env: QueryEnv,
): FieldName[] => {
  if (Array.isArray(fields)) return fields as FieldName[];
  return isProjectScope(scope, env)
    ? DEFAULT_FIELDS.filter((f) => f !== 'project')
    : DEFAULT_FIELDS;
};

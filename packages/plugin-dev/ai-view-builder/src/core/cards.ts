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
  /** The Material icon name the project or tag is set to, if any. */
  icon?: string;
}

/** The time block of a row: spent over estimate, or a parent's sub-task totals. */
export interface CardTime {
  spent?: string;
  estimate?: string;
  /** Parents only: what the open sub-tasks still have left. */
  left?: string;
  isParent: boolean;
}

export interface CardModel {
  id: string;
  title: string;
  isDone: boolean;
  isTracking: boolean;
  isSubTask: boolean;
  /** Project first, then tags. */
  chips: Chip[];
  /** Whether `chips[0]` is the project; it is drawn with a glyph, tags with a dot. */
  hasProjectChip: boolean;
  estimate?: string;
  due?: { text: string; overdue: boolean };
  /** The remaining fields: deadline, priority. */
  meta: string[];
  time?: CardTime;
  /** Share of the estimate used up, 0-100; only for tasks with an estimate. */
  progress?: number;
  hasNotes: boolean;
  isRepeating: boolean;
  attachments: number;
  /** Sub-tasks not listed on their own in the same part, in the parent's order. */
  subTasks: CardModel[];
  /** Done and total of all sub-tasks, listed or not. */
  subCount?: { done: number; total: number };
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

// Only set when there is one, so a chip without an icon keeps its two keys.
const chipOf = (
  label: string,
  color: string | undefined,
  icon: string | null | undefined,
): Chip => (icon ? { label, color, icon } : { label, color });

const chipsOf = (task: Task, fields: FieldName[], env: QueryEnv): Chip[] => {
  const chips: Chip[] = [];
  const project = fields.includes('project')
    ? env.projects.find((p) => p.id === task.projectId)
    : undefined;
  if (project) {
    chips.push(chipOf(project.title, projectColor(project), project.icon));
  }
  if (!fields.includes('tags')) return chips;
  for (const id of task.tagIds) {
    const tag = env.tags.find((t) => t.id === id);
    if (tag) {
      chips.push(chipOf(tag.title, tagColor(tag), tag.icon));
    }
  }
  return chips;
};

const metaOf = (task: Task, fields: FieldName[], env: QueryEnv): string[] => {
  const out: string[] = [];
  const deadline = fields.includes('deadline') ? deadlineOf(task, env.day) : null;
  if (deadline) out.push(`deadline ${formatDay(deadline, env.day.todayStr)}`);
  const priority = fields.includes('priority') ? priorityOf(task) : 'none';
  if (priority !== 'none') out.push(`${priority} priority`);
  return out;
};

const subTasksOf = (task: Task, env: QueryEnv): Task[] =>
  task.subTaskIds
    .map((id) => env.tasks.find((t) => t.id === id))
    .filter((t): t is Task => !!t);

const leftOf = (t: Task): number =>
  t.isDone ? 0 : Math.max(0, (t.timeEstimate || 0) - (t.timeSpent || 0));

const sum = (tasks: Task[], f: (t: Task) => number): number =>
  tasks.reduce((acc, t) => acc + f(t), 0);

/**
 * Like a task row in Super Productivity, the estimate readout carries the time
 * spent next to it, so either field turns the time block on.
 */
const timeOf = (task: Task, subs: Task[], fields: FieldName[]): CardTime | undefined => {
  if (!fields.includes('estimate') && !fields.includes('timeSpent')) return undefined;
  if (subs.length) {
    const spent = sum(subs, (t) => t.timeSpent || 0);
    const left = sum(subs, leftOf);
    if (!spent && !left) return undefined;
    return {
      isParent: true,
      spent: spent > 0 ? formatDuration(spent) : undefined,
      left: left > 0 ? formatDuration(left) : undefined,
    };
  }
  const time: CardTime = { isParent: false };
  if (task.timeSpent > 0) time.spent = formatDuration(task.timeSpent);
  if (fields.includes('estimate') && task.timeEstimate > 0) {
    time.estimate = formatDuration(task.timeEstimate);
  }
  return time.spent || time.estimate ? time : undefined;
};

const NONE: ReadonlySet<string> = new Set();

/**
 * `listed` are the tasks the part lists on their own; they are not nested again
 * under their parent. Sub-tasks do not show their project, as in a task row.
 */
export const toCard = (
  task: Task,
  fields: FieldName[],
  env: ModelEnv,
  listed: ReadonlySet<string> = NONE,
): CardModel => {
  const subs = subTasksOf(task, env);
  const subFields = fields.filter((f) => f !== 'project');
  const card: CardModel = {
    id: task.id,
    title: task.title,
    isDone: task.isDone,
    isTracking: env.currentTaskId === task.id,
    isSubTask: !!task.parentId,
    chips: chipsOf(task, fields, env),
    hasProjectChip:
      fields.includes('project') && env.projects.some((p) => p.id === task.projectId),
    meta: metaOf(task, fields, env),
    hasNotes: !!task.notes?.trim(),
    isRepeating: !!task.repeatCfgId,
    attachments: task.attachments?.length ?? 0,
    subTasks: subs
      .filter((t) => !listed.has(t.id))
      .map((t) => toCard(t, subFields, env, listed)),
  };
  const time = timeOf(task, subs, fields);
  if (time) card.time = time;
  if (subs.length) {
    card.subCount = { done: subs.filter((t) => t.isDone).length, total: subs.length };
  }
  if (fields.includes('estimate') && task.timeEstimate > 0) {
    card.estimate = formatDuration(task.timeEstimate);
  }
  if (task.timeEstimate > 0) {
    card.progress = Math.min(100, Math.round((100 * task.timeSpent) / task.timeEstimate));
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

/** The cards of a part's tasks, with each task's sub-tasks nested under it. */
export const cardsOf = (
  tasks: Task[],
  fields: FieldName[],
  env: ModelEnv,
): CardModel[] => {
  const listed = new Set(tasks.map((t) => t.id));
  return tasks.map((t) => toCard(t, fields, env, listed));
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

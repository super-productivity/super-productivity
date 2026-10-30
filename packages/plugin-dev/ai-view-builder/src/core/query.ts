import type {
  ActiveWorkContext,
  PluginDayContext,
  Project,
  Tag,
  Task,
} from '@super-productivity/plugin-api';
import { DEFAULT_LIMIT, PriorityName, Query } from './spec';

export interface QueryEnv {
  tasks: Task[];
  archivedTasks?: Task[];
  projects: Project[];
  tags: Tag[];
  day: PluginDayContext;
  context: ActiveWorkContext | null;
}

export interface QueryResult {
  tasks: Task[];
  problems: string[];
}

// ---------- dates (logical day) ----------

const pad = (n: number): string => String(n).padStart(2, '0');

const toDateStr = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const parseDateStr = (s: string): Date => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export const addDays = (dateStr: string, days: number): string => {
  const d = parseDateStr(dateStr);
  d.setDate(d.getDate() + days);
  return toDateStr(d);
};

/** The logical day of a timestamp: before the start of the next day, still the previous date. */
export const logicalDayOf = (ts: number, day: PluginDayContext): string =>
  toDateStr(new Date(ts - day.startOfNextDayDiffMs));

export const weekRange = (day: PluginDayContext): { start: string; end: string } => {
  const today = parseDateStr(day.todayStr);
  const offset = (today.getDay() - day.firstDayOfWeek + 7) % 7;
  const start = addDays(day.todayStr, -offset);
  return { start, end: addDays(start, 6) };
};

/** The day a task is due, or null. A due time wins over a due day (ARCHITECTURE Decision #2). */
export const dueDayOf = (task: Task, day: PluginDayContext): string | null => {
  if (typeof task.dueWithTime === 'number') {
    return logicalDayOf(task.dueWithTime, day);
  }
  return task.dueDay || null;
};

export const deadlineOf = (task: Task, day: PluginDayContext): string | null => {
  if (typeof task.deadlineWithTime === 'number') {
    return logicalDayOf(task.deadlineWithTime, day);
  }
  return task.deadlineDay || null;
};

export const priorityOf = (task: Task): PriorityName => {
  switch (task.priority) {
    case 3:
    case 'high':
      return 'high';
    case 2:
    case 'medium':
      return 'medium';
    case 1:
    case 'low':
      return 'low';
    default:
      return 'none';
  }
};

const PRIORITY_RANK: Record<PriorityName, number> = {
  high: 0,
  medium: 1,
  low: 2,
  none: 3,
};

// ---------- names ----------

const norm = (s: string): string => s.trim().toLowerCase();

/** Resolves tag names to ids; names that match nothing are reported. */
export const resolveTagIds = (
  names: string[],
  tags: Tag[],
  problems: string[],
): string[] => {
  const ids: string[] = [];
  for (const name of names) {
    const matches = tags.filter((t) => norm(t.title) === norm(name));
    if (!matches.length) {
      problems.push(`No tag named "${name}"`);
    }
    ids.push(...matches.map((t) => t.id));
  }
  return ids;
};

interface ScopeFilter {
  test: (t: Task) => boolean;
  order: string[] | null;
}

const scopeFilter = (
  scope: string | undefined,
  env: QueryEnv,
  problems: string[],
): ScopeFilter => {
  if (!scope || norm(scope) === 'all') {
    return { test: () => true, order: null };
  }
  if (scope === '@current') {
    const ctx = env.context;
    if (!ctx) {
      return { test: () => true, order: null };
    }
    if (ctx.type === 'PROJECT') {
      return { test: (t) => t.projectId === ctx.id, order: ctx.taskIds };
    }
    if (ctx.type === 'TODAY') {
      return {
        test: (t) => dueDayOf(t, env.day) === env.day.todayStr,
        order: ctx.taskIds,
      };
    }
    return { test: (t) => t.tagIds.includes(ctx.id), order: ctx.taskIds };
  }
  if (norm(scope) === 'today') {
    return { test: (t) => dueDayOf(t, env.day) === env.day.todayStr, order: null };
  }
  const projects = env.projects.filter((p) => norm(p.title) === norm(scope));
  if (projects.length) {
    if (projects.length > 1) {
      problems.push(`Several projects are named "${scope}"; showing all of them`);
    }
    const ids = new Set(projects.map((p) => p.id));
    return {
      test: (t) => !!t.projectId && ids.has(t.projectId),
      order: projects.length === 1 ? projects[0].taskIds : null,
    };
  }
  const tagIds = new Set(resolveTagIds([scope], env.tags, []));
  if (tagIds.size) {
    return { test: (t) => t.tagIds.some((id) => tagIds.has(id)), order: null };
  }
  problems.push(`No project or tag named "${scope}"`);
  return { test: () => false, order: null };
};

// ---------- matching ----------

const matchesDue = (task: Task, due: Query['due'], env: QueryEnv): boolean => {
  if (!due || due === 'any') return true;
  const d = dueDayOf(task, env.day);
  const today = env.day.todayStr;
  switch (due) {
    case 'today':
      return d === today;
    case 'tomorrow':
      return d === addDays(today, 1);
    case 'overdue':
      return !!d && d < today && !task.isDone;
    case 'thisWeek': {
      const { start, end } = weekRange(env.day);
      return !!d && d >= start && d <= end;
    }
    case 'none':
      return !d;
  }
  return true;
};

const matchesDoneOn = (task: Task, doneOn: Query['doneOn'], env: QueryEnv): boolean => {
  if (!doneOn) return true;
  if (!task.isDone || typeof task.doneOn !== 'number') return false;
  const d = logicalDayOf(task.doneOn, env.day);
  if (doneOn === 'today') return d === env.day.todayStr;
  const { start, end } = weekRange(env.day);
  return d >= start && d <= end;
};

// ---------- sorting ----------

const compareNullableStr = (a: string | null, b: string | null): number => {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
};

const sortTasks = (
  tasks: Task[],
  q: Query,
  order: string[] | null,
  env: QueryEnv,
): Task[] => {
  const sorted = [...tasks];
  const key = q.sort ?? 'context';
  let cmp: (a: Task, b: Task) => number;
  switch (key) {
    case 'due':
      cmp = (a, b) => compareNullableStr(dueDayOf(a, env.day), dueDayOf(b, env.day));
      break;
    case 'deadline':
      cmp = (a, b) => compareNullableStr(deadlineOf(a, env.day), deadlineOf(b, env.day));
      break;
    case 'priority':
      cmp = (a, b) => PRIORITY_RANK[priorityOf(a)] - PRIORITY_RANK[priorityOf(b)];
      break;
    case 'title':
      cmp = (a, b) => a.title.localeCompare(b.title);
      break;
    case 'estimate':
      cmp = (a, b) => (a.timeEstimate || 0) - (b.timeEstimate || 0);
      break;
    case 'timeSpent':
      cmp = (a, b) => (a.timeSpent || 0) - (b.timeSpent || 0);
      break;
    case 'created':
      cmp = (a, b) => (a.created || 0) - (b.created || 0);
      break;
    default: {
      // The project's, tag's or Today's own order; tasks outside it by creation.
      const index = new Map((order ?? []).map((id, i) => [id, i]));
      cmp = (a, b) => {
        const ia = index.get(a.id);
        const ib = index.get(b.id);
        if (ia !== undefined && ib !== undefined) return ia - ib;
        if (ia !== undefined) return -1;
        if (ib !== undefined) return 1;
        return (a.created || 0) - (b.created || 0);
      };
    }
  }
  sorted.sort(cmp);
  return q.sortDir === 'desc' ? sorted.reverse() : sorted;
};

// ---------- query ----------

/** Done tasks leave the active list when the day is finished, so asking for
 * what was done in a period must look in the archive too. */
export const loadsArchive = (q: Query): boolean =>
  q.includeArchived === true || q.doneOn !== undefined;

const withArchive = (env: QueryEnv): Task[] => {
  const active = new Set(env.tasks.map((t) => t.id));
  // A task can be in both for a moment while the archive cache is refreshed.
  return [...env.tasks, ...(env.archivedTasks ?? []).filter((t) => !active.has(t.id))];
};

export interface RunOptions {
  /** For sums over the whole result: no limit, and an extra filter to apply first. */
  aggregate?: { filter?: (t: Task) => boolean };
}

export const runQuery = (
  q: Query,
  env: QueryEnv,
  options: RunOptions = {},
): QueryResult => {
  const problems: string[] = [];
  const scope = scopeFilter(q.scope, env, problems);
  const tagIds = q.tags?.length ? resolveTagIds(q.tags, env.tags, problems) : [];
  const notTagIds = new Set(
    q.notTags?.length ? resolveTagIds(q.notTags, env.tags, problems) : [],
  );
  const wantedPriorities = q.priority?.length ? new Set(q.priority) : null;
  const text = q.text?.trim() ? norm(q.text) : null;
  const parentsOnly = q.parentsOnly !== false;
  const source = loadsArchive(q) ? withArchive(env) : env.tasks;

  const matched = source.filter((t) => {
    if (parentsOnly && t.parentId) return false;
    if (!scope.test(t)) return false;
    if (q.isDone !== undefined && t.isDone !== q.isDone) return false;
    if (!matchesDue(t, q.due, env)) return false;
    if (!matchesDoneOn(t, q.doneOn, env)) return false;
    if (q.tags?.length) {
      const has = (id: string): boolean => t.tagIds.includes(id);
      // A name that resolved to nothing can never match under "all".
      const allResolved = tagIds.length >= q.tags.length;
      if (
        q.tagsMatch === 'any' ? !tagIds.some(has) : !allResolved || !tagIds.every(has)
      ) {
        return false;
      }
    }
    if (t.tagIds.some((id) => notTagIds.has(id))) return false;
    if (wantedPriorities && !wantedPriorities.has(priorityOf(t))) return false;
    if (q.hasEstimate !== undefined && t.timeEstimate > 0 !== q.hasEstimate) return false;
    if (q.hasDeadline !== undefined && !!deadlineOf(t, env.day) !== q.hasDeadline) {
      return false;
    }
    if (options.aggregate?.filter && !options.aggregate.filter(t)) return false;
    if (text && !norm(t.title).includes(text)) return false;
    return true;
  });

  const sorted = sortTasks(matched, q, scope.order, env);
  // A sum over the result must not lose tasks to the display limit.
  if (options.aggregate) return { tasks: sorted, problems };
  return { tasks: sorted.slice(0, Math.min(q.limit ?? DEFAULT_LIMIT, 500)), problems };
};

/** Whether a query needs archived tasks, which are loaded only when asked for. */
export const needsArchive = (queries: Query[]): boolean => queries.some(loadsArchive);

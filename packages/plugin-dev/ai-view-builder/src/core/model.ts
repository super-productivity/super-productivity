import type { Task } from '@super-productivity/plugin-api';
import { Component, FieldName, ViewSpec } from './spec';
import {
  addDays,
  deadlineOf,
  dueDayOf,
  priorityOf,
  QueryEnv,
  runQuery,
  weekRange,
} from './query';
import { columnMatches } from './board';

// Spec + data → a plain tree the DOM renderer draws. Kept free of the DOM so
// it is testable and so two models can be compared to skip redundant redraws.

export interface CardModel {
  id: string;
  title: string;
  isDone: boolean;
  isTracking: boolean;
  isSubTask: boolean;
  meta: string[];
}

export interface GroupModel {
  key: string;
  label: string | null;
  cards: CardModel[];
}

export type NodeModel =
  | {
      kind: 'container';
      cid: string;
      layout: 'stack' | 'columns';
      title?: string;
      children: NodeModel[];
    }
  | {
      kind: 'taskList';
      cid: string;
      title?: string;
      groups: GroupModel[];
      emptyText: string;
      problems: string[];
    }
  | {
      kind: 'board';
      cid: string;
      title?: string;
      columnsPerRow: number | null;
      columns: { id: string; title: string; cards: CardModel[] }[];
      problems: string[];
    }
  | { kind: 'metric'; cid: string; title: string; value: string; problems: string[] }
  | { kind: 'text'; cid: string; text: string }
  | { kind: 'placeholder'; cid: string; message: string };

export interface ModelEnv extends QueryEnv {
  currentTaskId: string | null;
}

const MAX_DEPTH = 8;

export const formatDuration = (ms: number): string => {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
};

const formatDay = (day: string, env: ModelEnv): string => {
  const today = env.day.todayStr;
  if (day === today) return 'Today';
  if (day === addDays(today, 1)) return 'Tomorrow';
  if (day === addDays(today, -1)) return 'Yesterday';
  return day;
};

const cardMeta = (task: Task, fields: FieldName[], env: ModelEnv): string[] => {
  const out: string[] = [];
  for (const field of fields) {
    switch (field) {
      case 'project': {
        const p = env.projects.find((x) => x.id === task.projectId);
        if (p) out.push(p.title);
        break;
      }
      case 'tags': {
        const names = task.tagIds
          .map((id) => env.tags.find((t) => t.id === id)?.title)
          .filter((n): n is string => !!n);
        if (names.length) out.push(names.map((n) => `#${n}`).join(' '));
        break;
      }
      case 'estimate':
        if (task.timeEstimate > 0) out.push(`est. ${formatDuration(task.timeEstimate)}`);
        break;
      case 'timeSpent':
        if (task.timeSpent > 0) out.push(`${formatDuration(task.timeSpent)} spent`);
        break;
      case 'due': {
        const d = dueDayOf(task, env.day);
        if (d) out.push(`due ${formatDay(d, env)}`);
        break;
      }
      case 'deadline': {
        const d = deadlineOf(task, env.day);
        if (d) out.push(`deadline ${formatDay(d, env)}`);
        break;
      }
      case 'priority': {
        const p = priorityOf(task);
        if (p !== 'none') out.push(`${p} priority`);
        break;
      }
    }
  }
  return out;
};

const toCard = (task: Task, fields: FieldName[], env: ModelEnv): CardModel => ({
  id: task.id,
  title: task.title,
  isDone: task.isDone,
  isTracking: env.currentTaskId === task.id,
  isSubTask: !!task.parentId,
  meta: cardMeta(task, fields, env),
});

const groupTasks = (
  tasks: Task[],
  groupBy: Component['groupBy'],
  fields: FieldName[],
  env: ModelEnv,
): GroupModel[] => {
  const card = (t: Task): CardModel => toCard(t, fields, env);
  if (!groupBy || groupBy === 'none') {
    return [{ key: 'all', label: null, cards: tasks.map(card) }];
  }
  const groups = new Map<string, GroupModel>();
  const add = (key: string, label: string, task: Task): void => {
    if (!groups.has(key)) groups.set(key, { key, label, cards: [] });
    groups.get(key)!.cards.push(card(task));
  };
  for (const t of tasks) {
    switch (groupBy) {
      case 'project': {
        const p = env.projects.find((x) => x.id === t.projectId);
        add(p?.id ?? 'none', p?.title ?? 'No project', t);
        break;
      }
      case 'tag': {
        const tagTitles = t.tagIds
          .map((id) => env.tags.find((x) => x.id === id))
          .filter((x): x is NonNullable<typeof x> => !!x);
        if (!tagTitles.length) add('none', 'No tag', t);
        tagTitles.forEach((tag) => add(tag.id, tag.title, t));
        break;
      }
      case 'priority': {
        const p = priorityOf(t);
        add(p, p === 'none' ? 'No priority' : `${p[0].toUpperCase()}${p.slice(1)}`, t);
        break;
      }
      case 'due': {
        const d = dueDayOf(t, env.day);
        const today = env.day.todayStr;
        const { end } = weekRange(env.day);
        if (!d) add('5-none', 'No date', t);
        else if (d < today) add('0-overdue', 'Overdue', t);
        else if (d === today) add('1-today', 'Today', t);
        else if (d === addDays(today, 1)) add('2-tomorrow', 'Tomorrow', t);
        else if (d <= end) add('3-week', 'This week', t);
        else add('4-later', 'Later', t);
        break;
      }
    }
  }
  const list = [...groups.values()];
  if (groupBy === 'due' || groupBy === 'priority') {
    const rank: Record<string, number> = { high: 0, medium: 1, low: 2, none: 3 };
    list.sort((a, b) =>
      groupBy === 'due' ? a.key.localeCompare(b.key) : rank[a.key] - rank[b.key],
    );
  }
  return list;
};

const measureValue = (
  tasks: Task[],
  measure: Component['measure'],
  env: ModelEnv,
): string => {
  const sum = (f: (t: Task) => number): number => tasks.reduce((acc, t) => acc + f(t), 0);
  switch (measure) {
    case 'timeSpentToday':
      return formatDuration(sum((t) => t.timeSpentOnDay?.[env.day.todayStr] ?? 0));
    case 'timeSpent':
      return formatDuration(sum((t) => t.timeSpent || 0));
    case 'estimate':
      return formatDuration(sum((t) => t.timeEstimate || 0));
    case 'remaining':
      return formatDuration(
        sum((t) =>
          t.isDone ? 0 : Math.max(0, (t.timeEstimate || 0) - (t.timeSpent || 0)),
        ),
      );
    default:
      return String(tasks.length);
  }
};

const fieldsOf = (c: Component): FieldName[] =>
  Array.isArray(c.fields) ? (c.fields as FieldName[]) : [];

const buildNode = (
  spec: ViewSpec,
  cid: string,
  env: ModelEnv,
  seen: Set<string>,
  depth: number,
): NodeModel => {
  const c = spec.components[cid];
  if (!c) {
    return { kind: 'placeholder', cid, message: 'Being added…' };
  }
  if (seen.has(cid) || depth > MAX_DEPTH) {
    return {
      kind: 'placeholder',
      cid,
      message: 'This part repeats itself and is not shown.',
    };
  }
  const nextSeen = new Set(seen).add(cid);
  const query = typeof c.query === 'string' ? spec.queries[c.query] : undefined;
  const missingQuery = typeof c.query === 'string' && !query;
  switch (c.type) {
    case 'stack':
    case 'columns':
      return {
        kind: 'container',
        cid,
        layout: c.type,
        title: c.title,
        children: (c.children ?? []).map((child) =>
          buildNode(spec, child, env, nextSeen, depth + 1),
        ),
      };
    case 'taskList': {
      const result = query ? runQuery(query, env) : { tasks: [], problems: [] };
      const limited = c.limit ? result.tasks.slice(0, c.limit) : result.tasks;
      return {
        kind: 'taskList',
        cid,
        title: c.title,
        groups: groupTasks(limited, c.groupBy, fieldsOf(c), env),
        emptyText: c.emptyText || 'Nothing here.',
        problems: missingQuery ? ['Being set up…'] : result.problems,
      };
    }
    case 'board': {
      const result = query ? runQuery(query, env) : { tasks: [], problems: [] };
      return {
        kind: 'board',
        cid,
        title: c.title,
        columnsPerRow: typeof c.columnsPerRow === 'number' ? c.columnsPerRow : null,
        columns: (c.columns ?? []).map((col) => ({
          id: col.id,
          title: col.title,
          cards: result.tasks
            .filter((t) => columnMatches(t, col, env.tags))
            .map((t) => toCard(t, fieldsOf(c), env)),
        })),
        problems: missingQuery ? ['Being set up…'] : result.problems,
      };
    }
    case 'metric': {
      const result = query
        ? runQuery({ ...query, limit: 500 }, env)
        : { tasks: [], problems: [] };
      return {
        kind: 'metric',
        cid,
        title: c.title || '',
        value: query ? measureValue(result.tasks, c.measure, env) : '–',
        problems: result.problems,
      };
    }
    case 'text':
      return { kind: 'text', cid, text: typeof c.text === 'string' ? c.text : '' };
    default:
      return {
        kind: 'placeholder',
        cid,
        message: 'This part needs a newer version of AI View Builder.',
      };
  }
};

export const buildModel = (spec: ViewSpec, env: ModelEnv): NodeModel | null =>
  spec.root ? buildNode(spec, spec.root, env, new Set(), 0) : null;

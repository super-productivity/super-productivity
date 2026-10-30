import type { Task } from '@super-productivity/plugin-api';
import { Component, FieldName, ViewSpec } from './spec';
import {
  addDays,
  dueDayOf,
  needsArchive,
  priorityOf,
  runQuery,
  weekRange,
} from './query';
import { columnMatches } from './board';
import {
  CardModel,
  fieldsFor,
  formatDuration,
  ModelEnv,
  sumEstimate,
  toCard,
} from './cards';
import { AgendaNode, BreakdownNode, buildAgenda, buildBreakdown } from './parts';
import { rangeOfWeek, timeSpentIn } from './time';

// Spec + data → a plain tree the DOM renderer draws. Kept free of the DOM so
// it is testable and so two models can be compared to skip redundant redraws.

export interface GroupModel {
  key: string;
  label: string | null;
  cards: CardModel[];
  /** Summed estimate of the cards; absent when none has one. */
  estimate?: string;
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
      columns: { id: string; title: string; cards: CardModel[]; estimate?: string }[];
      problems: string[];
    }
  | AgendaNode
  | BreakdownNode
  | { kind: 'metric'; cid: string; title: string; value: string; problems: string[] }
  | { kind: 'text'; cid: string; text: string }
  | { kind: 'placeholder'; cid: string; message: string };

const MAX_DEPTH = 8;

interface GroupKey {
  key: string;
  label: string;
}

/** The groups a task belongs to; a tag grouping can list a task several times. */
const groupKeysOf = (
  t: Task,
  groupBy: NonNullable<Component['groupBy']>,
  env: ModelEnv,
): GroupKey[] => {
  switch (groupBy) {
    case 'project': {
      const p = env.projects.find((x) => x.id === t.projectId);
      return [{ key: p?.id ?? 'none', label: p?.title ?? 'No project' }];
    }
    case 'tag': {
      const tags = t.tagIds
        .map((id) => env.tags.find((x) => x.id === id))
        .filter((x): x is NonNullable<typeof x> => !!x);
      return tags.length
        ? tags.map((tag) => ({ key: tag.id, label: tag.title }))
        : [{ key: 'none', label: 'No tag' }];
    }
    case 'priority': {
      const p = priorityOf(t);
      return [
        {
          key: p,
          label: p === 'none' ? 'No priority' : `${p[0].toUpperCase()}${p.slice(1)}`,
        },
      ];
    }
    case 'due': {
      const d = dueDayOf(t, env.day);
      const today = env.day.todayStr;
      if (!d) return [{ key: '5-none', label: 'No date' }];
      if (d < today) return [{ key: '0-overdue', label: 'Overdue' }];
      if (d === today) return [{ key: '1-today', label: 'Today' }];
      if (d === addDays(today, 1)) return [{ key: '2-tomorrow', label: 'Tomorrow' }];
      if (d <= weekRange(env.day).end) return [{ key: '3-week', label: 'This week' }];
      return [{ key: '4-later', label: 'Later' }];
    }
    default:
      return [{ key: 'all', label: '' }];
  }
};

const makeGroup = (
  key: string,
  label: string | null,
  tasks: Task[],
  fields: FieldName[],
  env: ModelEnv,
): GroupModel => ({
  key,
  label,
  cards: tasks.map((t) => toCard(t, fields, env)),
  estimate: sumEstimate(tasks),
});

const groupTasks = (
  tasks: Task[],
  groupBy: Component['groupBy'],
  fields: FieldName[],
  env: ModelEnv,
): GroupModel[] => {
  if (!groupBy || groupBy === 'none') {
    return [makeGroup('all', null, tasks, fields, env)];
  }
  const groups = new Map<string, { label: string; tasks: Task[] }>();
  for (const t of tasks) {
    for (const { key, label } of groupKeysOf(t, groupBy, env)) {
      if (!groups.has(key)) groups.set(key, { label, tasks: [] });
      groups.get(key)!.tasks.push(t);
    }
  }
  const list = [...groups].map(([key, g]) =>
    makeGroup(key, g.label, g.tasks, fields, env),
  );
  const rank: Record<string, number> = { high: 0, medium: 1, low: 2, none: 3 };
  if (groupBy === 'due') list.sort((a, b) => a.key.localeCompare(b.key));
  if (groupBy === 'priority') list.sort((a, b) => rank[a.key] - rank[b.key]);
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
    case 'timeSpentThisWeek':
      return formatDuration(sum((t) => timeSpentIn(t, rangeOfWeek(env.day))));
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
      const fields = fieldsFor(c.fields, query?.scope, env);
      return {
        kind: 'taskList',
        cid,
        title: c.title,
        groups: groupTasks(limited, c.groupBy, fields, env),
        emptyText: c.emptyText || 'Nothing here.',
        problems: missingQuery ? ['Being set up…'] : result.problems,
      };
    }
    case 'board': {
      const result = query ? runQuery(query, env) : { tasks: [], problems: [] };
      const fields = fieldsFor(c.fields, query?.scope, env);
      return {
        kind: 'board',
        cid,
        title: c.title,
        columnsPerRow: typeof c.columnsPerRow === 'number' ? c.columnsPerRow : null,
        columns: (c.columns ?? []).map((col) => {
          const { cards, estimate } = makeGroup(
            col.id,
            col.title,
            result.tasks.filter((t) => columnMatches(t, col, env.tags)),
            fields,
            env,
          );
          return { id: col.id, title: col.title, cards, estimate };
        }),
        problems: missingQuery ? ['Being set up…'] : result.problems,
      };
    }
    case 'agenda':
      return buildAgenda(cid, c, query, env);
    case 'timeBreakdown':
      return buildBreakdown(cid, c, query, env);
    case 'metric': {
      // Time tracked on tasks archived earlier in the week still counts.
      const withArchive =
        c.measure === 'timeSpentThisWeek' ? { includeArchived: true } : {};
      const result = query
        ? runQuery({ ...query, ...withArchive }, env, { aggregate: {} })
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

/** Whether drawing the view needs the archive, which is loaded only when asked for. */
export const specNeedsArchive = (spec: ViewSpec): boolean =>
  needsArchive(Object.values(spec.queries)) ||
  Object.values(spec.components).some(
    (c) => c.type === 'timeBreakdown' || c.measure === 'timeSpentThisWeek',
  );

export const buildModel = (spec: ViewSpec, env: ModelEnv): NodeModel | null =>
  spec.root ? buildNode(spec, spec.root, env, new Set(), 0) : null;

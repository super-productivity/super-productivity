import type { PluginDayContext, Task } from '@super-productivity/plugin-api';
import { Component, MAX_AGENDA_DAYS, Query, RangeName } from './spec';
import { addDays, dueDayOf, parseDateStr, runQuery } from './query';
import {
  CardModel,
  fieldsFor,
  formatDuration,
  ModelEnv,
  projectColor,
  sumRemaining,
  tagColor,
  toCard,
} from './cards';
import { DayRange, daysIn, rangeOfLastDays, rangeOfWeek, timeSpentIn } from './time';

// The two parts that are not a plain list of cards: an agenda of the coming
// days and a breakdown of tracked time. Both are models like the rest, so
// they are tested without the DOM.

export interface AgendaDay {
  key: string;
  label: string;
  /** Short date; empty for the overdue row. */
  date: string;
  cards: CardModel[];
  /** What is left to do that day, from the estimates of its open tasks. */
  planned?: string;
  isOverdue: boolean;
}

export interface AgendaNode {
  kind: 'agenda';
  cid: string;
  title?: string;
  days: AgendaDay[];
  problems: string[];
}

export interface BreakdownRow {
  key: string;
  label: string;
  value: string;
  /** Bar length relative to the longest row. */
  percent: number;
  color?: string;
}

export interface BreakdownNode {
  kind: 'timeBreakdown';
  cid: string;
  title?: string;
  total: string;
  rows: BreakdownRow[];
  emptyText: string;
  problems: string[];
}

const NO_RESULT = { tasks: [] as Task[], problems: ['Being set up…'] };

// ---------- agenda ----------

const agendaDays = (c: Component): number =>
  Number.isInteger(c.days) ? Math.min(Math.max(c.days as number, 1), MAX_AGENDA_DAYS) : 3;

const weekday = (day: string, style: 'long' | 'short'): string =>
  parseDateStr(day).toLocaleDateString(undefined, { weekday: style });

const dayLabel = (day: string, index: number): string => {
  if (index === 0) return 'Today';
  return index === 1 ? 'Tomorrow' : weekday(day, 'long');
};

const makeDay = (
  key: string,
  label: string,
  date: string,
  tasks: Task[],
  fields: ReturnType<typeof fieldsFor>,
  env: ModelEnv,
): AgendaDay => ({
  key,
  label,
  date,
  cards: tasks.map((t) => toCard(t, fields, env)),
  planned: sumRemaining(tasks),
  isOverdue: key === 'overdue',
});

export const buildAgenda = (
  cid: string,
  c: Component,
  query: Query | undefined,
  env: ModelEnv,
): AgendaNode => {
  const result = query ? runQuery(query, env) : NO_RESULT;
  // The day is the heading, so a card does not repeat its due date.
  const fields = Array.isArray(c.fields)
    ? fieldsFor(c.fields, query?.scope, env)
    : fieldsFor(undefined, query?.scope, env).filter((f) => f !== 'due');
  const today = env.day.todayStr;
  const byDay = new Map<string, Task[]>();
  const overdue: Task[] = [];
  for (const t of result.tasks) {
    const due = dueDayOf(t, env.day);
    if (!due) continue;
    if (due >= today) byDay.set(due, [...(byDay.get(due) ?? []), t]);
    else if (c.showOverdue === true && !t.isDone) overdue.push(t);
  }
  const days = Array.from({ length: agendaDays(c) }, (_, i) => {
    const day = addDays(today, i);
    const date = parseDateStr(day).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
    });
    return makeDay(day, dayLabel(day, i), date, byDay.get(day) ?? [], fields, env);
  });
  if (overdue.length)
    days.unshift(makeDay('overdue', 'Overdue', '', overdue, fields, env));
  return { kind: 'agenda', cid, title: c.title, days, problems: result.problems };
};

// ---------- time breakdown ----------

export const rangeFor = (
  name: RangeName | undefined,
  day: PluginDayContext,
): DayRange => {
  switch (name) {
    case 'today':
      return { start: day.todayStr, end: day.todayStr };
    case 'last7Days':
      return rangeOfLastDays(7, day);
    default:
      return rangeOfWeek(day);
  }
};

interface Bucket {
  key: string;
  label: string;
  ms: number;
  color?: string;
}

const bucketsBy = (
  by: Component['by'],
  tasks: Task[],
  range: DayRange,
  env: ModelEnv,
): Bucket[] => {
  if (by === 'day') {
    return daysIn(range).map((day) => ({
      key: day,
      label: `${weekday(day, 'short')} ${parseDateStr(day).getDate()}`,
      ms: tasks.reduce((sum, t) => sum + (t.timeSpentOnDay?.[day] ?? 0), 0),
    }));
  }
  const buckets = new Map<string, Bucket>();
  const add = (
    key: string,
    label: string,
    color: string | undefined,
    ms: number,
  ): void => {
    const bucket = buckets.get(key) ?? { key, label, ms: 0, color };
    bucket.ms += ms;
    buckets.set(key, bucket);
  };
  for (const t of tasks) {
    const ms = timeSpentIn(t, range);
    if (by === 'tag') {
      // A task with several tags counts for each of them.
      const tags = t.tagIds.flatMap((id) => env.tags.filter((x) => x.id === id));
      if (!tags.length) add('none', 'No tag', undefined, ms);
      tags.forEach((tag) => add(tag.id, tag.title, tagColor(tag), ms));
    } else {
      const p = env.projects.find((x) => x.id === t.projectId);
      add(p?.id ?? 'none', p?.title ?? 'No project', p && projectColor(p), ms);
    }
  }
  return [...buckets.values()].sort((a, b) => b.ms - a.ms);
};

export const buildBreakdown = (
  cid: string,
  c: Component,
  query: Query | undefined,
  env: ModelEnv,
): BreakdownNode => {
  const range = rangeFor(c.range, env.day);
  // Time on tasks archived earlier in the period still counts.
  const result = query
    ? runQuery({ ...query, includeArchived: true }, env, {
        aggregate: { filter: (t) => timeSpentIn(t, range) > 0 },
      })
    : NO_RESULT;
  const totalMs = result.tasks.reduce((sum, t) => sum + timeSpentIn(t, range), 0);
  const buckets = totalMs > 0 ? bucketsBy(c.by, result.tasks, range, env) : [];
  const longest = Math.max(1, ...buckets.map((b) => b.ms));
  return {
    kind: 'timeBreakdown',
    cid,
    title: c.title,
    total: formatDuration(totalMs),
    rows: buckets.map((b) => ({
      key: b.key,
      label: b.label,
      value: b.ms > 0 ? formatDuration(b.ms) : '',
      percent: b.ms > 0 ? Math.max(2, Math.round((100 * b.ms) / longest)) : 0,
      color: b.color,
    })),
    emptyText: 'No time tracked in this period.',
    problems: result.problems,
  };
};

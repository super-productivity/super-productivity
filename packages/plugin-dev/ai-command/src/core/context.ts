// Builds what one request sends (§ 6.1 of the plan): the day, names, and the
// tasks on the radar, under aliases (t1, t2…) so real ids never leave the
// device and the model can only name tasks it was shown.

import {
  addDays,
  deadlineDayOf,
  freeMinutesToday,
  plannedDayOf,
  weekdayOf,
  whenOf,
} from './day';
import type { Context, Named, SentTask, Snapshot, TaskLike } from './types';

export const MAX_RADAR = 80;
export const MAX_MATCHES = 30;
const DEADLINE_HORIZON_DAYS = 7;
const MIN_WORD_LENGTH = 3;
// Words that would match almost every title. English only for now; other
// languages just match a little more broadly.
const STOP_WORDS = new Set(
  'the and for with all this that these those from into onto out off are was has have not but you your our its move put set add make mark task tasks done today tomorrow week day'.split(
    ' ',
  ),
);
// Virtual tags: membership is derived from due dates, never stored in tagIds.
export const VIRTUAL_TAG_IDS = new Set(['TODAY', 'KANBAN_IN_PROGRESS']);

const PRIORITY_LABELS: Record<string, string> = {
  1: 'low',
  2: 'medium',
  3: 'high',
  low: 'low',
  medium: 'medium',
  high: 'high',
};

export const wordsOf = (text: string): string[] =>
  (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter(
    (w) => w.length >= MIN_WORD_LENGTH,
  );

export const requestWords = (request: string): string[] => [
  ...new Set(wordsOf(request).filter((w) => !STOP_WORDS.has(w))),
];

const isOnRadar = (t: TaskLike, s: Snapshot): boolean => {
  if (t.isDone) return false;
  const when = whenOf(t, s.day);
  if (when === 'today' || when === 'overdue') return true;
  const deadline = deadlineDayOf(t, s.day);
  return !!deadline && deadline <= addDays(s.day.todayStr, DEADLINE_HORIZON_DAYS);
};

/** Today first, then overdue, then upcoming deadlines, so the cap keeps the day. */
const radarRank = (t: TaskLike, s: Snapshot): number => {
  const when = whenOf(t, s.day);
  return when === 'today' ? 0 : when === 'overdue' ? 1 : 2;
};

export const radarTasks = (s: Snapshot): TaskLike[] =>
  s.tasks
    .filter((t) => isOnRadar(t, s))
    .map((t, i) => ({ t, i, r: radarRank(t, s) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .slice(0, MAX_RADAR)
    .map(({ t }) => t);

const nameWords = (list: Named[]): Map<string, string[]> =>
  new Map(list.map((n) => [n.id, wordsOf(n.title)]));

/** How many of the request's words a task's title, project or tags contain (prefix match). */
export const matchScorer = (s: Snapshot, words: string[]): ((t: TaskLike) => number) => {
  const projectWords = nameWords(s.projects);
  const tagWords = nameWords(s.tags);
  return (t) => {
    const taskWords = [
      ...wordsOf(t.title),
      ...(t.projectId ? projectWords.get(t.projectId) || [] : []),
      ...t.tagIds.flatMap((id) => tagWords.get(id) || []),
    ];
    return words.filter((w) => taskWords.some((tw) => tw.startsWith(w))).length;
  };
};

const matchedTasks = (s: Snapshot, request: string): TaskLike[] => {
  const score = matchScorer(s, requestWords(request));
  return s.tasks
    .map((t) => ({ t, n: score(t) }))
    .filter(({ n }) => n > 0)
    .sort((a, b) => b.n - a.n || (b.t.created || 0) - (a.t.created || 0))
    .map(({ t }) => t);
};

/** Radar, then the selection, then up to 30 open matches; subtasks bring their parent. */
const pickTasks = (s: Snapshot, matches: TaskLike[]): TaskLike[] => {
  const byId = new Map(s.tasks.map((t) => [t.id, t]));
  const picked = new Map<string, TaskLike>();
  radarTasks(s).forEach((t) => picked.set(t.id, t));
  s.selectionIds.forEach(
    (id) => byId.has(id) && picked.set(id, byId.get(id) as TaskLike),
  );
  matches
    .filter((t) => !t.isDone && !picked.has(t.id))
    .slice(0, MAX_MATCHES)
    .forEach((t) => picked.set(t.id, t));
  [...picked.values()].forEach((t) => {
    const parent = t.parentId ? byId.get(t.parentId) : undefined;
    if (parent && !picked.has(parent.id)) picked.set(parent.id, parent);
  });
  return [...picked.values()];
};

const titlesById = (list: Named[]): Map<string, string> =>
  new Map(list.map((n) => [n.id, n.title]));

interface Lookup {
  aliases: Map<string, string>;
  projects: Map<string, string>;
  tags: Map<string, string>;
}

const toSent = (t: TaskLike, s: Snapshot, names: Lookup): SentTask => {
  const tagNames = t.tagIds
    .filter((id) => !VIRTUAL_TAG_IDS.has(id))
    .map((id) => names.tags.get(id));
  const sent: SentTask = {
    id: names.aliases.get(t.id) as string,
    title: t.title,
    when: whenOf(t, s.day),
  };
  if (t.isDone) sent.done = true;
  const due = plannedDayOf(t, s.day);
  if (due) sent.due = due;
  const deadline = deadlineDayOf(t, s.day);
  if (deadline) sent.deadline = deadline;
  if (t.timeEstimate) sent.estimateMin = Math.round(t.timeEstimate / 60000);
  if (t.timeSpent) sent.spentMin = Math.round(t.timeSpent / 60000);
  if (t.priority != null && PRIORITY_LABELS[t.priority])
    sent.priority = PRIORITY_LABELS[t.priority];
  if (t.repeatCfgId) sent.repeats = true;
  if (t.dueWithTime || t.remindAt) sent.fixedTime = true;
  const parent = t.parentId ? names.aliases.get(t.parentId) : undefined;
  if (parent) sent.parent = parent;
  if (t.projectId && names.projects.has(t.projectId))
    sent.project = names.projects.get(t.projectId);
  if (tagNames.some(Boolean)) sent.tags = tagNames.filter((n): n is string => !!n);
  if (s.selectionIds.includes(t.id)) sent.selected = true;
  return sent;
};

/** Builds the request context. `request` drives the on-device text search. */
export const buildContext = (s: Snapshot, request: string): Context => {
  const matches = matchedTasks(s, request);
  const tasks = pickTasks(s, matches);
  const idToAlias = new Map(tasks.map((t, i) => [t.id, `t${i + 1}`]));
  const aliasToId = new Map([...idToAlias].map(([id, alias]) => [alias, id]));
  const names = {
    aliases: idToAlias,
    projects: titlesById(s.projects),
    tags: titlesById(s.tags),
  };
  return {
    sent: {
      day: {
        today: s.day.todayStr,
        weekday: weekdayOf(s.day.todayStr),
        tomorrow: addDays(s.day.todayStr, 1),
        freeMinutesToday: freeMinutesToday(s.tasks, s.day),
      },
      projects: s.projects.map((p) => p.title),
      tags: s.tags.filter((t) => !VIRTUAL_TAG_IDS.has(t.id)).map((t) => t.title),
      tasks: tasks.map((t) => toSent(t, s, names)),
    },
    aliasToId,
    idToAlias,
    matchedIds: new Set(matches.map((t) => t.id).filter((id) => idToAlias.has(id))),
    snapshot: s,
  };
};

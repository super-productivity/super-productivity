// The one validator of § 6.3, shared by the app and the eval. It maps aliases
// back to ids and drops every row that breaks a rule, with a plain note.

import { VIRTUAL_TAG_IDS } from './context';
import { deadlineDayOf, isDayStr, plannedDayOf } from './day';
import { parseCalls, type RawAdd, type RawShow, type RawUpdate } from './parse-calls';
import { stampOf } from './stamp';
import type {
  AddRow,
  ChangeRow,
  Context,
  DeleteRow,
  Named,
  Proposal,
  TaskLike,
  ToolCall,
  UpdateRow,
} from './types';

export const MAX_CHANGES = 50;
export const MAX_SELECTION = 20;
const MAX_TITLE = 500;
const MAX_REASON = 100;
const MAX_NOTE = 5000;
const MAX_ESTIMATE_MIN = 7 * 24 * 60;

interface Env {
  ctx: Context;
  byId: Map<string, TaskLike>;
  used: Set<string>;
  refs: Map<string, AddRow>;
  keys: { n: number };
}

type Checked<T> = { row: T } | { note: string } | null;

const nextKey = (env: Env): string => `r${++env.keys.n}`;

export const quoted = (title: string): string =>
  `“${title.length > 60 ? `${title.slice(0, 57)}…` : title}”`;

const findName = (list: Named[], name: string): Named | undefined =>
  list.find((n) => n.title.trim().toLowerCase() === name.trim().toLowerCase());

const realTags = (env: Env): Named[] =>
  env.ctx.snapshot.tags.filter((t) => !VIRTUAL_TAG_IDS.has(t.id));

/** Tag ids for names, or null if one doesn't exist (v1 creates no tags). */
const resolveTags = (env: Env, names: string[]): string[] | null => {
  const ids = names.map((n) => findName(realTags(env), n)?.id);
  return ids.every(Boolean) ? [...new Set(ids as string[])] : null;
};

const titleProblem = (title: string): string | null =>
  !title.trim()
    ? 'the title is empty'
    : title.length > MAX_TITLE
      ? 'the title is too long'
      : null;

const dayProblem = (day: string, todayStr: string): string | null =>
  !isDayStr(day)
    ? 'the day is not a date'
    : day < todayStr
      ? 'the day is in the past'
      : null;

const estimateProblem = (min: number): string | null =>
  !Number.isInteger(min) || min < 0 || min > MAX_ESTIMATE_MIN
    ? 'the estimate is out of range'
    : null;

const addParent = (env: Env, raw: RawAdd, row: AddRow): string | null => {
  if (!raw.parent) return null;
  const parentAdd = env.refs.get(raw.parent);
  const parent = env.byId.get(env.ctx.aliasToId.get(raw.parent) || '');
  if (!parentAdd && !parent) return 'its parent task is unknown';
  if (parentAdd?.parentId || parentAdd?.parentRef || parent?.parentId)
    return 'a subtask cannot have subtasks';
  if (parentAdd) row.parentRef = raw.parent;
  if (parent && !parentAdd) row.parentId = parent.id;
  return null;
};

/** Subtasks take their parent's project and carry no tags, so both are ignored there. */
const addPlacement = (env: Env, raw: RawAdd, row: AddRow): string | null => {
  if (row.parentId || row.parentRef) return null;
  if (raw.project) {
    const project = findName(env.ctx.snapshot.projects, raw.project);
    if (!project) return `there is no project ${quoted(raw.project)}`;
    row.projectId = project.id;
  }
  if (raw.tags?.length) {
    const tagIds = resolveTags(env, raw.tags);
    if (!tagIds) return 'a tag does not exist';
    row.tagIds = tagIds;
  }
  return null;
};

const checkAdd = (env: Env, raw: RawAdd): Checked<AddRow> => {
  const title = raw.title.trim();
  const row: AddRow = { kind: 'add', key: nextKey(env), ref: raw.ref, title };
  const today = env.ctx.snapshot.day.todayStr;
  const problem =
    (env.refs.has(raw.ref) ? 'the answer added it twice' : null) ||
    titleProblem(title) ||
    (raw.day !== undefined ? dayProblem(raw.day, today) : null) ||
    (raw.estimateMin !== undefined ? estimateProblem(raw.estimateMin) : null) ||
    addParent(env, raw, row) ||
    addPlacement(env, raw, row);
  if (problem)
    return { note: `Skipped adding ${quoted(title || 'a task')}: ${problem}.` };
  if (raw.day) row.dueDay = raw.day;
  if (raw.estimateMin) row.timeEstimate = raw.estimateMin * 60000;
  if (raw.note?.trim()) row.note = raw.note.trim().slice(0, MAX_NOTE);
  env.refs.set(raw.ref, row);
  return { row };
};

interface UpdateInput {
  env: Env;
  task: TaskLike;
  raw: RawUpdate;
  row: UpdateRow;
}

const updateTitle = ({ task, raw, row }: UpdateInput): string | null => {
  const title = raw.title?.trim();
  if (title === undefined || title === task.title) return null;
  row.title = title;
  return titleProblem(title);
};

const updateDay = ({ env, task, raw, row }: UpdateInput): string | null => {
  if (raw.day === undefined) return null;
  const { day } = env.ctx.snapshot;
  const dueDay = raw.day === 'none' ? null : raw.day;
  if (dueDay === plannedDayOf(task, day)) return null;
  if (task.dueWithTime || task.remindAt) return 'it has a fixed time or reminder';
  const deadline = deadlineDayOf(task, day);
  if (dueDay && dueDay > day.todayStr && deadline && deadline <= day.todayStr) {
    return 'its deadline is today or earlier';
  }
  row.dueDay = dueDay;
  return dueDay ? dayProblem(dueDay, day.todayStr) : null;
};

const updateSimple = ({ task, raw, row }: UpdateInput): string | null => {
  if (
    raw.estimateMin !== undefined &&
    raw.estimateMin * 60000 !== (task.timeEstimate || 0)
  ) {
    row.timeEstimate = raw.estimateMin * 60000;
    if (estimateProblem(raw.estimateMin)) return estimateProblem(raw.estimateMin);
  }
  if (raw.done !== undefined && raw.done !== !!task.isDone) row.isDone = raw.done;
  const note = raw.appendNote?.trim();
  if (note) row.appendNote = note.slice(0, MAX_NOTE);
  return null;
};

const updateProject = ({ env, task, raw, row }: UpdateInput): string | null => {
  if (raw.project === undefined) return null;
  const project = findName(env.ctx.snapshot.projects, raw.project);
  if (!project) return `there is no project ${quoted(raw.project)}`;
  if (project.id === task.projectId) return null;
  if (task.repeatCfgId) return 'it repeats, and moving it would move the whole series';
  if (task.parentId) return 'it is a subtask';
  row.projectId = project.id;
  return null;
};

const updateTags = ({ env, task, raw, row }: UpdateInput): string | null => {
  if (raw.tags === undefined) return null;
  const tagIds = resolveTags(env, raw.tags);
  if (!tagIds) return 'a tag does not exist';
  // Keep any virtual tag id an old task may still carry; the model never sees them.
  const next = [...tagIds, ...task.tagIds.filter((id) => VIRTUAL_TAG_IDS.has(id))];
  if ([...next].sort().join() !== [...task.tagIds].sort().join()) row.tagIds = next;
  return null;
};

const UPDATE_CHECKS = [updateTitle, updateDay, updateSimple, updateProject, updateTags];
const ROW_META = ['kind', 'key', 'taskId', 'stamp'];

const targetOf = (env: Env, alias: string): TaskLike | { note: string } => {
  const task = env.byId.get(env.ctx.aliasToId.get(alias) || '');
  if (!task) return { note: 'Skipped a change to a task the AI was not shown.' };
  if (env.used.has(task.id))
    return { note: `Skipped a second change to ${quoted(task.title)}.` };
  env.used.add(task.id);
  return task;
};

const checkUpdate = (env: Env, raw: RawUpdate): Checked<UpdateRow> => {
  const task = targetOf(env, raw.id);
  if ('note' in task) return task;
  const row: UpdateRow = {
    kind: 'update',
    key: nextKey(env),
    taskId: task.id,
    stamp: stampOf(task),
  };
  for (const check of UPDATE_CHECKS) {
    const problem = check({ env, task, raw, row });
    if (problem)
      return { note: `Skipped a change to ${quoted(task.title)}: ${problem}.` };
  }
  return Object.keys(row).some((k) => !ROW_META.includes(k)) ? { row } : null;
};

const checkDelete = (env: Env, raw: { id: string }): Checked<DeleteRow> => {
  const task = targetOf(env, raw.id);
  if ('note' in task) return task;
  return {
    row: { kind: 'delete', key: nextKey(env), taskId: task.id, stamp: stampOf(task) },
  };
};

const checkSelection = (
  env: Env,
  raw: RawShow | undefined,
  dropped: string[],
): Proposal['selection'] => {
  if (!raw) return null;
  const seen = new Set<string>();
  const items = raw.items.flatMap(({ id, reason }) => {
    const taskId = env.ctx.aliasToId.get(id);
    if (!taskId || seen.has(taskId)) return [];
    seen.add(taskId);
    if (reason.trim().length > MAX_REASON) {
      dropped.push(
        `Left ${quoted(env.byId.get(taskId)?.title || '')} out of the list: its reason was too long.`,
      );
      return [];
    }
    return [{ taskId, reason: reason.trim() }];
  });
  return {
    title: raw.title.trim().slice(0, MAX_REASON) || 'Tasks',
    items: items.slice(0, MAX_SELECTION),
  };
};

/** Adds whose parent is another new task go after it, whatever order the model used. */
const parentsFirst = (adds: RawAdd[]): RawAdd[] => {
  const refs = new Set(adds.map((a) => a.ref));
  const isChild = (a: RawAdd): boolean =>
    !!a.parent && refs.has(a.parent) && a.parent !== a.ref;
  return [...adds.filter((a) => !isChild(a)), ...adds.filter(isChild)];
};

const collect = <T>(results: Checked<T>[], dropped: string[]): T[] =>
  results.flatMap((r) => (!r ? [] : 'note' in r ? (dropped.push(r.note), []) : [r.row]));

/** A day plan moves tasks onto or off today (overdue counts as today, § 6.4) and changes nothing else. */
const isTodayMove = (row: ChangeRow, env: Env): boolean => {
  if (
    row.kind !== 'update' ||
    !Object.keys(row).every((k) => ROW_META.includes(k) || k === 'dueDay')
  ) {
    return false;
  }
  const { day } = env.ctx.snapshot;
  const from = plannedDayOf(env.byId.get(row.taskId) as TaskLike, day);
  return (!!from && from <= day.todayStr) || row.dueDay === day.todayStr;
};

const EMPTY: Omit<Proposal, 'isTooMany'> = {
  changes: [],
  selection: null,
  say: null,
  dropped: [],
  isDayPlan: false,
};

/** Validates the model's calls into a proposal. `errors` are schema failures, worth one retry. */
export const validateCalls = (
  ctx: Context,
  calls: ToolCall[],
): { proposal: Proposal; errors: string[] } => {
  const parsed = parseCalls(calls);
  if (parsed.adds.length + parsed.updates.length + parsed.deletes.length > MAX_CHANGES) {
    return { proposal: { ...EMPTY, isTooMany: true }, errors: [] };
  }
  const env: Env = {
    ctx,
    byId: new Map(ctx.snapshot.tasks.map((t) => [t.id, t])),
    used: new Set(),
    refs: new Map(),
    keys: { n: 0 },
  };
  const dropped: string[] = [];
  const changes: ChangeRow[] = [
    ...collect(
      parentsFirst(parsed.adds).map((a) => checkAdd(env, a)),
      dropped,
    ),
    ...collect(
      parsed.updates.map((u) => checkUpdate(env, u)),
      dropped,
    ),
    ...collect(
      parsed.deletes.map((d) => checkDelete(env, d)),
      dropped,
    ),
  ];
  const selection = checkSelection(env, parsed.shows[parsed.shows.length - 1], dropped);
  const say =
    parsed.says
      .map((s) => s.trim())
      .filter(Boolean)
      .join(' ') || null;
  const isDayPlan = changes.length > 0 && changes.every((r) => isTodayMove(r, env));
  return {
    proposal: { changes, selection, say, dropped, isTooMany: false, isDayPlan },
    errors: parsed.errors,
  };
};

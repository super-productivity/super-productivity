import type { PluginCreateTaskData, Tag, Task } from '@super-productivity/plugin-api';
import type { MissingTag } from './board';
import { columnMatches } from './board';
import type { NodeModel } from './model';
import { addDays, QueryEnv, runQuery } from './query';
import type { Query } from './spec';
import { aliasOf, normName, tagsNamed } from './tag-aliases';

// What a task added in a lane (a board column, an agenda day, a group of a
// list) is created with, so that it shows up in that lane afterwards. A lane
// whose filter creation cannot satisfy gets no "Add": a task that vanishes
// after Enter would look like a bug. Nothing here writes; the UI makes the one
// addTask call (and creates a missing built-in tag first).

/** The lane's own filter and the fields its place in the view fixes. */
export interface Lane {
  /** A board column: the tags it requires and excludes, and its done state. */
  tags?: string[];
  notTags?: string[];
  isDone?: boolean;
  /** An agenda day or a group of a list: what belongs to that place. */
  tagIds?: string[];
  projectId?: string;
  dueDay?: string;
}

export interface Creation {
  /** Existing tags, and built-in ones that `missingTags` creates first. */
  tagIds: string[];
  missingTags: MissingTag[];
  projectId?: string;
  dueDay?: string;
}

export interface AddTarget {
  /** Names the lane's input; unique within a view. */
  key: string;
  creation: Creation;
}

interface Wanted {
  ids: string[];
  missing: MissingTag[];
}

/** Tags by name. Only a built-in alias can be missing: the rest is the user's. */
const wantedTags = (names: string[], tags: Tag[]): Wanted => {
  const ids: string[] = [];
  const missing: MissingTag[] = [];
  for (const name of names) {
    const found = tagsNamed(name, tags);
    const alias = aliasOf(name);
    if (found.length) ids.push(...found.map((t) => t.id));
    else if (alias) {
      ids.push(alias.id);
      missing.push(alias);
    }
  }
  return { ids, missing };
};

type Fixed = Pick<Creation, 'projectId' | 'dueDay'> & { tagIds?: string[] };

/** The fields a scope pins down; a scope that names no single place pins none. */
const scopeFields = (scope: string | undefined, env: QueryEnv): Fixed => {
  const today = env.day.todayStr;
  if (!scope || normName(scope) === 'all') return {};
  if (scope === '@current') {
    const ctx = env.context;
    if (!ctx) return {};
    if (ctx.type === 'PROJECT') return { projectId: ctx.id };
    return ctx.type === 'TODAY' ? { dueDay: today } : { tagIds: [ctx.id] };
  }
  if (normName(scope) === 'today') return { dueDay: today };
  const projects = env.projects.filter((p) => normName(p.title) === normName(scope));
  // Several projects of one name: creation would have to guess; the host default decides.
  if (projects.length) return projects.length === 1 ? { projectId: projects[0].id } : {};
  return { tagIds: tagsNamed(scope, env.tags).map((t) => t.id) };
};

/** The day a `today` or `tomorrow` filter asks for; other filters name no single day. */
const dueDayFor = (due: Query['due'], env: QueryEnv): string | undefined => {
  if (due === 'today') return env.day.todayStr;
  return due === 'tomorrow' ? addDays(env.day.todayStr, 1) : undefined;
};

const unique = (ids: string[]): string[] => [...new Set(ids)];

const draftOf = (query: Query, lane: Lane, env: QueryEnv): Creation => {
  const scope = scopeFields(query.scope, env);
  // "Any of" asks for one of them; the first is the one the lists show first.
  const queryNames =
    query.tagsMatch === 'any' ? (query.tags ?? []).slice(0, 1) : query.tags;
  const fromQuery = wantedTags(queryNames ?? [], env.tags);
  const fromLane = wantedTags(lane.tags ?? [], env.tags);
  const missing = new Map(
    [...fromQuery.missing, ...fromLane.missing].map((m) => [m.id, m]),
  );
  const projectId = lane.projectId ?? scope.projectId;
  const dueDay = lane.dueDay ?? dueDayFor(query.due, env) ?? scope.dueDay;
  return {
    tagIds: unique([
      // Any one tag of the scope puts a task in it.
      ...(scope.tagIds ?? []).slice(0, 1),
      ...fromQuery.ids,
      ...fromLane.ids,
      ...(lane.tagIds ?? []),
    ]),
    missingTags: [...missing.values()],
    ...(projectId ? { projectId } : {}),
    ...(dueDay ? { dueDay } : {}),
  };
};

/** A task as creation would make it: nothing but these fields. */
const probeOf = (c: Creation): Task =>
  ({
    id: 'new-task',
    title: '',
    isDone: false,
    timeEstimate: 0,
    timeSpent: 0,
    tagIds: c.tagIds,
    projectId: c.projectId ?? null,
    parentId: null,
    subTaskIds: [],
    created: 0,
    ...(c.dueDay ? { dueDay: c.dueDay } : {}),
  }) as unknown as Task;

/** The built-in tags that do not exist yet count as existing for the check. */
const withMissing = (tags: Tag[], missing: MissingTag[]): Tag[] => [
  ...tags,
  ...missing.map((m) => ({ id: m.id, title: m.title, taskIds: [] }) as unknown as Tag),
];

/**
 * What a task added in `lane` gets, or null when the lane cannot take one:
 * the new task would not match the query and the lane (done, overdue, a text
 * or priority filter, an estimate...), so it would not appear.
 */
export const creationFor = (
  query: Query | undefined,
  lane: Lane,
  env: QueryEnv,
): Creation | null => {
  if (!query || lane.isDone === true) return null;
  const creation = draftOf(query, lane, env);
  const probe = probeOf(creation);
  const known = { ...env, tags: withMissing(env.tags, creation.missingTags) };
  if (!runQuery(query, { ...known, tasks: [probe] }).tasks.length) return null;
  const column = { id: 'lane', title: '', ...lane };
  return columnMatches(probe, column, known.tags) ? creation : null;
};

/** The one addTask call for a title typed into the lane. */
export const newTaskData = (creation: Creation, title: string): PluginCreateTaskData => ({
  title,
  ...(creation.tagIds.length ? { tagIds: creation.tagIds } : {}),
  ...(creation.projectId ? { projectId: creation.projectId } : {}),
  ...(creation.dueDay ? { dueDay: creation.dueDay } : {}),
});

export const addKey = (cid: string, laneKey: string): string => `lane:${cid}:${laneKey}`;

/** The add target of a lane, or undefined when it takes no new tasks. */
export const addTargetFor = (
  cid: string,
  laneKey: string,
  query: Query | undefined,
  lane: Lane,
  env: QueryEnv,
): AddTarget | undefined => {
  const creation = creationFor(query, lane, env);
  return creation ? { key: addKey(cid, laneKey), creation } : undefined;
};

/** What a group of a list pins down: its project, its tag or its due day. */
export const groupLane = (
  groupBy: string | undefined,
  key: string,
  env: QueryEnv,
): Lane | null => {
  switch (groupBy) {
    case 'project':
      // A task without a project cannot be made here: the host would give it one.
      return key === 'none' ? null : { projectId: key };
    case 'tag':
      return key === 'none' ? {} : { tagIds: [key] };
    case 'due':
      if (key === '1-today') return { dueDay: env.day.todayStr };
      if (key === '2-tomorrow') return { dueDay: addDays(env.day.todayStr, 1) };
      return key === '5-none' ? {} : null;
    case 'priority':
      return key === 'none' ? {} : null;
    default:
      return {};
  }
};

const targetsOf = (node: NodeModel): (AddTarget | undefined)[] => {
  switch (node.kind) {
    case 'container':
      return node.children.flatMap(targetsOf);
    case 'taskList':
      return node.groups.map((g) => g.add);
    case 'board':
      return node.columns.map((c) => c.add);
    case 'agenda':
      return node.days.map((d) => d.add);
    default:
      return [];
  }
};

/** The add target a lane's input belongs to, read from the model on screen. */
export const findAddTarget = (model: NodeModel | null, key: string): AddTarget | null =>
  (model && targetsOf(model).find((t) => t?.key === key)) || null;

// Applies ticked rows through existing plugin API calls (§ 8): adds (parents
// first), then changes, then deletes. One row is one call, plus one more for a
// project move, so each is an ordinary op that syncs like a manual edit.

import { describeRow } from './describe';
import { isSameStamp, stampOf } from './stamp';
import type {
  AddRow,
  AppliedRow,
  ChangeRow,
  DeleteRow,
  Snapshot,
  TaskLike,
  UpdateRow,
} from './types';

export interface WriteApi {
  getTasks(): Promise<TaskLike[]>;
  addTask(data: Record<string, unknown>): Promise<string>;
  updateTask(
    id: string,
    updates: Record<string, unknown>,
    options?: { isIgnoreShortSyntax?: boolean },
  ): Promise<void>;
  deleteTask(id: string): Promise<void>;
}

interface ApplyEnv {
  api: WriteApi;
  current: Map<string, TaskLike>;
  refIds: Map<string, string>;
  snapshot: Snapshot;
}

const ORDER: Record<ChangeRow['kind'], number> = { add: 0, update: 1, delete: 2 };

const errorText = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

/** Re-reads the task; a row whose task changed or vanished since the proposal is skipped. */
const staleProblem = (row: UpdateRow | DeleteRow, env: ApplyEnv): string | null => {
  const task = env.current.get(row.taskId);
  if (!task) return 'It was deleted in the meantime.';
  return isSameStamp(stampOf(task), row.stamp)
    ? null
    : 'It changed in the meantime. Ask again.';
};

const applyAdd = async (row: AddRow, env: ApplyEnv): Promise<string> => {
  const parentId = row.parentRef ? env.refIds.get(row.parentRef) : row.parentId;
  if (row.parentRef && !parentId) throw new Error('Its parent task was not added.');
  const id = await env.api.addTask({
    title: row.title,
    projectId: row.projectId,
    tagIds: row.tagIds,
    dueDay: row.dueDay,
    timeEstimate: row.timeEstimate,
    parentId,
    notes: row.note,
    // Titles come from a model: keep them verbatim, never parse #tags or @dates.
    isIgnoreShortSyntax: true,
  });
  env.refIds.set(row.ref, id);
  return id;
};

const updatesOf = (row: UpdateRow, task: TaskLike): Record<string, unknown> => {
  const updates: Record<string, unknown> = {};
  if (row.title !== undefined) updates.title = row.title;
  // null unplans; undefined would be dropped and change nothing.
  if (row.dueDay !== undefined) updates.dueDay = row.dueDay;
  if (row.timeEstimate !== undefined) updates.timeEstimate = row.timeEstimate;
  if (row.isDone !== undefined) updates.isDone = row.isDone;
  if (row.tagIds) updates.tagIds = row.tagIds;
  if (row.appendNote) {
    const notes = (task.notes || '').trimEnd();
    updates.notes = notes ? `${notes}\n\n${row.appendNote}` : row.appendNote;
  }
  return updates;
};

const applyUpdate = async (row: UpdateRow, env: ApplyEnv): Promise<void> => {
  const task = env.current.get(row.taskId) as TaskLike;
  const updates = updatesOf(row, task);
  if (Object.keys(updates).length) {
    await env.api.updateTask(row.taskId, updates, { isIgnoreShortSyntax: true });
  }
  // A project move is its own call: it moves subtasks too, like the UI.
  if (row.projectId) await env.api.updateTask(row.taskId, { projectId: row.projectId });
};

const applyRow = async (row: ChangeRow, env: ApplyEnv): Promise<AppliedRow> => {
  const text = describeRow(row, env.snapshot);
  const what = row.kind === 'add' ? ['Added', ...text.what] : text.what;
  const base = { key: row.key, title: text.title, what };
  try {
    if (row.kind === 'add') return { ...base, taskId: await applyAdd(row, env) };
    const problem = staleProblem(row, env);
    if (problem) return { ...base, taskId: row.taskId, error: problem };
    if (row.kind === 'update') await applyUpdate(row, env);
    else await env.api.deleteTask(row.taskId);
    return { ...base, taskId: row.kind === 'delete' ? null : row.taskId };
  } catch (err) {
    return {
      ...base,
      taskId: row.kind === 'add' ? null : row.taskId,
      error: errorText(err),
    };
  }
};

/**
 * Applies rows one after another. A failed row is reported and the rest go on:
 * each row is independent, so a partial apply leaves valid state.
 */
export const applyRows = async (
  api: WriteApi,
  rows: ChangeRow[],
  snapshot: Snapshot,
): Promise<AppliedRow[]> => {
  const env: ApplyEnv = {
    api,
    current: new Map((await api.getTasks()).map((t) => [t.id, t])),
    refIds: new Map(),
    snapshot,
  };
  const ordered = [...rows].sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
  const results: AppliedRow[] = [];
  for (const row of ordered) results.push(await applyRow(row, env));
  return results;
};

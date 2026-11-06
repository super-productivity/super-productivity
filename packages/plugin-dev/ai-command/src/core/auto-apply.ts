// "Apply without review" (§ 8.1 of the plan): a proposal applies at once only
// if every row passes. Otherwise the change list is shown as usual.

import type { ChangeRow, Context, Proposal, TaskLike } from './types';

export const MAX_AUTO_CHANGES = 10;

interface RuleEnv {
  /** Tasks the user's own words or the on-screen selection named; never the radar alone. */
  named: Set<string>;
  byId: Map<string, TaskLike>;
  currentTaskId: string | null;
}

/** Marking these done triggers other ops: a dismissed reminder, a done parent, the next task started. */
const isDoneSafe = (t: TaskLike, env: RuleEnv): boolean =>
  !t.remindAt &&
  !t.dueWithTime &&
  t.id !== env.currentTaskId &&
  !t.parentId &&
  !t.subTaskIds?.length;

const isAutoRow = (row: ChangeRow, env: RuleEnv): boolean => {
  if (row.kind === 'delete') return false;
  if (row.kind === 'add') return !row.parentId || env.named.has(row.parentId);
  const task = env.byId.get(row.taskId);
  if (!task || !env.named.has(row.taskId) || row.projectId) return false;
  return row.isDone !== true || isDoneSafe(task, env);
};

export const canApplyWithoutReview = (p: Proposal, ctx: Context): boolean => {
  if (
    p.isTooMany ||
    p.dropped.length ||
    !p.changes.length ||
    p.changes.length > MAX_AUTO_CHANGES
  ) {
    return false;
  }
  const env: RuleEnv = {
    named: new Set([...ctx.matchedIds, ...ctx.snapshot.selectionIds]),
    byId: new Map(ctx.snapshot.tasks.map((t) => [t.id, t])),
    currentTaskId: ctx.snapshot.currentTaskId,
  };
  return p.changes.every((row) => isAutoRow(row, env));
};

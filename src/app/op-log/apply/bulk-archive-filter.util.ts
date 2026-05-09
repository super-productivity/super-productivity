import { ActionType, Operation } from '../core/operation.types';
import { OpLog } from '../../core/log';

/**
 * Walks `taskIds` (and `backlogTaskIds` for PROJECT) on a TAG/PROJECT
 * LWW Update payload and removes entries that match `shouldRemove` or
 * whose type isn't `string`. Returns a cleaned copy when anything was
 * removed, or `undefined` when no rewrite is needed.
 *
 * Single source of truth for "filter taskIds out of a TAG/PROJECT LWW
 * payload" — used by:
 *  - `stripBatchArchivedTaskIdsFromLwwPayload` (predicate: in same-batch
 *    archive set; runs in the bulk meta-reducer pre-apply)
 *  - `filterOrphanedTaskIdsFromEntityData` in lww-update.meta-reducer.ts
 *    (predicate: not in live taskState.ids; runs in the consumer reducer)
 *
 * The two callers run at different layers because their predicates
 * resolve at different times — the shared helper is the array-walking
 * + payload-cloning + warn-logging core.
 */
export const filterTaskIdArraysFromTagOrProjectPayload = (
  payload: Record<string, unknown>,
  entityType: string,
  shouldRemove: (id: string) => boolean,
  logCtx: { warnMessage: string; entityId?: string },
): Record<string, unknown> | undefined => {
  if (entityType !== 'TAG' && entityType !== 'PROJECT') return undefined;

  const filterArrayKey = (
    key: string,
  ): { cleaned: string[]; removed: unknown[] } | undefined => {
    const value = payload[key];
    if (!Array.isArray(value)) return undefined;
    // First pass: detect whether any entry would be removed (non-string
    // or matching predicate). Skip cleaned[] allocation in the common
    // case (TAG/PROJECT with thousands of taskIds, no removals).
    let needsRewrite = false;
    for (const id of value) {
      if (typeof id !== 'string' || shouldRemove(id)) {
        needsRewrite = true;
        break;
      }
    }
    if (!needsRewrite) return undefined;
    const cleaned: string[] = [];
    const removed: unknown[] = [];
    for (const id of value) {
      if (typeof id !== 'string' || shouldRemove(id)) {
        removed.push(id);
        continue;
      }
      cleaned.push(id);
    }
    return { cleaned, removed };
  };

  const taskIdsResult = filterArrayKey('taskIds');
  const backlogResult =
    entityType === 'PROJECT' ? filterArrayKey('backlogTaskIds') : undefined;
  if (!taskIdsResult && !backlogResult) return undefined;

  const newPayload: Record<string, unknown> = { ...payload };
  if (taskIdsResult) newPayload.taskIds = taskIdsResult.cleaned;
  if (backlogResult) newPayload.backlogTaskIds = backlogResult.cleaned;
  OpLog.warn(logCtx.warnMessage, {
    entityId: logCtx.entityId,
    taskIdsRemoved: taskIdsResult?.removed,
    backlogTaskIdsRemoved: backlogResult?.removed,
  });
  return newPayload;
};

// Task NgRx feature key. Hardcoded here (rather than imported from
// features/tasks) to keep this op-log infrastructure file free of feature
// imports. Kept in sync with `TASK_FEATURE_NAME` in
// features/tasks/store/task.reducer.ts.
const TASK_FEATURE_KEY = 'tasks';

const harvestSubTaskIdsFromTaskLike = (taskLike: unknown, sink: Set<string>): void => {
  if (!taskLike || typeof taskLike !== 'object') return;
  const subTasks = (taskLike as { subTasks?: unknown }).subTasks;
  if (Array.isArray(subTasks)) {
    for (const st of subTasks) {
      const id = (st as { id?: unknown } | null)?.id;
      if (typeof id === 'string') sink.add(id);
    }
  }
  const subTaskIds = (taskLike as { subTaskIds?: unknown }).subTaskIds;
  if (Array.isArray(subTaskIds)) {
    for (const id of subTaskIds) {
      if (typeof id === 'string') sink.add(id);
    }
  }
};

/**
 * Issue #7330: `moveToArchive` declares only top-level task IDs in
 * `op.entityIds`, but the reducer cascades to subtasks via
 * `[t.id, ...t.subTasks.map(st => st.id)]`. `deleteTask` carries a single
 * `TaskWithSubTasks` and its reducer cascades the same way. `deleteTasks`
 * (DELETE_MULTIPLE) only carries flat `taskIds` in its payload, so subtask
 * cascade must be derived from `state` at pre-scan time — mirroring what
 * `handleDeleteTasks` does at apply time. Without this helper, a co-batched
 * TAG/PROJECT LWW Update referencing an archived/deleted subtask would
 * still leak through the strip below.
 *
 * Adds the parent op's cascaded subtask IDs to `sink`.
 */
export const collectCascadedSubTaskIds = (
  op: Operation,
  sink: Set<string>,
  state: unknown,
): void => {
  if (op.actionType === ActionType.TASK_SHARED_DELETE_MULTIPLE) {
    // Bulk delete payload has no embedded subtask info; look them up from
    // the initial batch state by parent entityId.
    if (!op.entityIds || op.entityIds.length === 0) return;
    if (!state || typeof state !== 'object') return;
    const taskFeature = (state as Record<string, unknown>)[TASK_FEATURE_KEY];
    if (!taskFeature || typeof taskFeature !== 'object') return;
    const entities = (taskFeature as { entities?: unknown }).entities;
    if (!entities || typeof entities !== 'object') return;
    const entityMap = entities as Record<string, unknown>;
    for (const parentId of op.entityIds) {
      harvestSubTaskIdsFromTaskLike(entityMap[parentId], sink);
    }
    return;
  }

  if (
    op.actionType !== ActionType.TASK_SHARED_MOVE_TO_ARCHIVE &&
    op.actionType !== ActionType.TASK_SHARED_DELETE
  ) {
    return;
  }
  const payload = op.payload;
  if (!payload || typeof payload !== 'object') return;
  // op payloads use MultiEntityPayload format ({ actionPayload, entityChanges })
  // for these action types; unwrap to the action body. Guard against a
  // malformed `actionPayload: null` which would otherwise throw on the next
  // property access. (#7521)
  const p = payload as Record<string, unknown>;
  const candidateInner =
    'actionPayload' in p ? (p.actionPayload as unknown) : (p as unknown);
  if (!candidateInner || typeof candidateInner !== 'object') return;
  const inner = candidateInner as Record<string, unknown>;

  // moveToArchive: { tasks: TaskWithSubTasks[] }
  const tasks = (inner as { tasks?: unknown }).tasks;
  if (Array.isArray(tasks)) {
    for (const t of tasks) harvestSubTaskIdsFromTaskLike(t, sink);
  }
  // deleteTask: { task: TaskWithSubTasks }
  harvestSubTaskIdsFromTaskLike((inner as { task?: unknown }).task, sink);
};

/**
 * Issue #7330: `lwwUpdateMetaReducer`'s orphan filter only sees taskState as
 * it is when each op runs. A TAG LWW Update applied before its sibling
 * archive op in the same batch escapes the filter, leaving TODAY_TAG (or any
 * tag/project) referencing a task the very next op removes — user-visible as
 * "archived tasks reappear in today's view" on hibernate-wake.
 *
 * Returns a new Operation with cleaned `taskIds` / `backlogTaskIds`, or the
 * input op unchanged when no rewrite is needed. Wraps the shared
 * `filterTaskIdArraysFromTagOrProjectPayload` helper.
 */
export const stripBatchArchivedTaskIdsFromLwwPayload = (
  op: Operation,
  isLww: boolean,
  archivingOrDeletingEntityIds: Set<string>,
): Operation => {
  if (!isLww) return op;
  const payload = op.payload;
  if (!payload || typeof payload !== 'object') return op;
  const newPayload = filterTaskIdArraysFromTagOrProjectPayload(
    payload as Record<string, unknown>,
    op.entityType,
    (id) => archivingOrDeletingEntityIds.has(id),
    {
      warnMessage:
        `bulkOperationsMetaReducer: Stripped same-batch-archived task IDs from ` +
        `${op.entityType}:${op.entityId} LWW Update payload`,
      entityId: op.entityId,
    },
  );
  return newPayload ? { ...op, payload: newPayload } : op;
};

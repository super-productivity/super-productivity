import { ActionType, Operation, OpType } from '../core/operation.types';
import { OpLog } from '../../core/log';
import { isLwwUpdateActionType } from '../core/lww-update-action-types';

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
type TaskEntityMap = Record<string, unknown>;

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

const getTaskEntityMap = (state: unknown): TaskEntityMap | undefined => {
  if (!state || typeof state !== 'object') return undefined;
  const taskFeature = (state as Record<string, unknown>)[TASK_FEATURE_KEY];
  if (!taskFeature || typeof taskFeature !== 'object') return undefined;
  const entities = (taskFeature as { entities?: unknown }).entities;
  if (!entities || typeof entities !== 'object') return undefined;
  return entities as TaskEntityMap;
};

const addString = (value: unknown, sink: Set<string>): void => {
  if (typeof value === 'string') sink.add(value);
};

const unwrapActionPayloadObject = (
  payload: unknown,
): Record<string, unknown> | undefined => {
  if (!payload || typeof payload !== 'object') return undefined;
  const p = payload as Record<string, unknown>;
  const candidate = 'actionPayload' in p ? (p.actionPayload as unknown) : p;
  return candidate && typeof candidate === 'object'
    ? (candidate as Record<string, unknown>)
    : undefined;
};

const cloneTaskEntityMap = (state: unknown): TaskEntityMap => {
  const entityMap = getTaskEntityMap(state);
  if (!entityMap) return {};
  return { ...entityMap };
};

const harvestTaskEntityMapSubTaskIdsForParents = (
  parentIds: Set<string>,
  entityMap: TaskEntityMap,
  sink: Set<string>,
  options: {
    includeParentIdBackRefs: boolean;
  },
): void => {
  if (parentIds.size === 0) return;

  for (const parentId of parentIds) {
    harvestSubTaskIdsFromTaskLike(entityMap[parentId], sink);
  }

  if (!options.includeParentIdBackRefs) return;

  // Mirror deleteTaskHelper's defensive path: the parent payload/subTaskIds can
  // be stale while child.parentId is already present in state.
  for (const taskLike of Object.values(entityMap)) {
    if (!taskLike || typeof taskLike !== 'object') continue;
    const task = taskLike as { id?: unknown; parentId?: unknown };
    if (
      typeof task.id === 'string' &&
      typeof task.parentId === 'string' &&
      parentIds.has(task.parentId)
    ) {
      sink.add(task.id);
    }
  }
};

const upsertTaskProjectionFromTaskLike = (
  projection: TaskEntityMap,
  taskLike: unknown,
  fallbackId?: string,
): void => {
  if (!taskLike || typeof taskLike !== 'object') return;
  const task = taskLike as Record<string, unknown>;
  const id = typeof task.id === 'string' ? task.id : fallbackId;
  if (!id) return;
  const prev = projection[id];
  projection[id] = {
    ...(prev && typeof prev === 'object' ? (prev as Record<string, unknown>) : {}),
    ...task,
    id,
  };

  const subTasks = task.subTasks;
  if (Array.isArray(subTasks)) {
    for (const subTask of subTasks) {
      upsertTaskProjectionFromTaskLike(projection, subTask);
    }
  }
};

const upsertTaskProjectionFromTaskOrUpdate = (
  projection: TaskEntityMap,
  taskLike: unknown,
  fallbackId?: string,
): void => {
  if (!taskLike || typeof taskLike !== 'object') return;
  const task = taskLike as Record<string, unknown>;
  const id = typeof task.id === 'string' ? task.id : fallbackId;
  const changes = task.changes;
  if (id && changes && typeof changes === 'object') {
    upsertTaskProjectionFromTaskLike(projection, { ...(changes as object), id }, id);
    return;
  }
  upsertTaskProjectionFromTaskLike(projection, taskLike, fallbackId);
};

const isTaskLwwUpdateOp = (op: Operation): boolean =>
  op.entityType === 'TASK' && isLwwUpdateActionType(op.actionType);

/**
 * Lightweight task-state projection for archive/delete pre-scan only.
 *
 * Reducer anchors: `deleteTaskHelper` in task.reducer.util.ts and
 * `handleDeleteTasks` in task-shared-crud.reducer.ts. Audit this when adding a
 * TASK action that can change `parentId`, `subTaskIds`, or embedded `subTasks`
 * before a same-batch archive/delete op.
 */
const applyTaskProjectionFromOp = (op: Operation, projection: TaskEntityMap): void => {
  if (op.entityType !== 'TASK') return;
  if (op.opType === OpType.Delete) {
    if (Array.isArray(op.entityIds)) {
      for (const id of op.entityIds) delete projection[id];
    }
    if (op.entityId) delete projection[op.entityId];
    return;
  }

  const payload = unwrapActionPayloadObject(op.payload);
  if (!payload) return;

  upsertTaskProjectionFromTaskOrUpdate(projection, payload.task, op.entityId);

  const tasks = payload.tasks;
  if (Array.isArray(tasks)) {
    for (const task of tasks) upsertTaskProjectionFromTaskOrUpdate(projection, task);
  }

  const subTasks = payload.subTasks;
  if (Array.isArray(subTasks)) {
    for (const subTask of subTasks) {
      upsertTaskProjectionFromTaskOrUpdate(projection, subTask);
    }
  }

  // TASK LWW Update stores the task partial directly in payload. Other
  // direct-looking task actions like unscheduleTask are commands, not entities.
  if (isTaskLwwUpdateOp(op)) {
    upsertTaskProjectionFromTaskOrUpdate(projection, payload, op.entityId);
  }
};

const isTaskArchiveOrDeleteOp = (op: Operation): boolean =>
  op.actionType === ActionType.TASK_SHARED_MOVE_TO_ARCHIVE ||
  op.actionType === ActionType.TASK_SHARED_DELETE ||
  op.actionType === ActionType.TASK_SHARED_DELETE_MULTIPLE;

const addOperationEntityIds = (op: Operation, sink: Set<string>): void => {
  if (Array.isArray(op.entityIds)) {
    for (const id of op.entityIds) addString(id, sink);
  }
  addString(op.entityId, sink);
};

/**
 * Issue #7330: archive/delete ops declare only top-level task IDs in
 * `op.entityIds`, but reducers can cascade to subtasks. `moveToArchive` and
 * `deleteTask` remove task entities via `deleteTaskHelper`, including its
 * defensive `child.parentId` state scan. `deleteTasks` (DELETE_MULTIPLE) only
 * uses parent.subTaskIds from state. Without this helper, a co-batched
 * TAG/PROJECT LWW Update referencing an archived/deleted subtask would still
 * leak through the strip below.
 *
 * Adds the parent op's cascaded subtask IDs to `sink`.
 */
export const collectCascadedSubTaskIds = (
  op: Operation,
  sink: Set<string>,
  taskEntityMap: TaskEntityMap,
): void => {
  const parentIds = new Set<string>();
  addOperationEntityIds(op, parentIds);

  if (op.actionType === ActionType.TASK_SHARED_DELETE_MULTIPLE) {
    // Bulk delete payload has no embedded subtask info; look up parent.subTaskIds
    // from the projected task state, mirroring handleDeleteTasks at apply time.
    harvestTaskEntityMapSubTaskIdsForParents(parentIds, taskEntityMap, sink, {
      includeParentIdBackRefs: false,
    });
    return;
  }

  if (
    op.actionType !== ActionType.TASK_SHARED_MOVE_TO_ARCHIVE &&
    op.actionType !== ActionType.TASK_SHARED_DELETE
  ) {
    return;
  }
  // op payloads use MultiEntityPayload format ({ actionPayload, entityChanges })
  // for these action types; unwrap to the action body. Guard against a
  // malformed `actionPayload: null` which would otherwise throw on the next
  // property access. (#7521)
  const inner = unwrapActionPayloadObject(op.payload);
  if (!inner) return;

  // moveToArchive: { tasks: TaskWithSubTasks[] }
  const tasks = (inner as { tasks?: unknown }).tasks;
  if (Array.isArray(tasks)) {
    for (const t of tasks) {
      harvestSubTaskIdsFromTaskLike(t, sink);
      if (t && typeof t === 'object') addString((t as { id?: unknown }).id, parentIds);
    }
  }
  // deleteTask: { task: TaskWithSubTasks }
  const task = (inner as { task?: unknown }).task;
  harvestSubTaskIdsFromTaskLike(task, sink);
  if (task && typeof task === 'object')
    addString((task as { id?: unknown }).id, parentIds);

  harvestTaskEntityMapSubTaskIdsForParents(parentIds, taskEntityMap, sink, {
    includeParentIdBackRefs: true,
  });
};

/**
 * Build the same-batch archive/delete filter set using a lightweight task-state
 * projection. This keeps the pre-scan aligned with reducer order: if an earlier
 * operation in the same bulk batch creates or LWW-updates a child with
 * `parentId`, a later stale `moveToArchive` / `deleteTask` sees that child just
 * like `deleteTaskHelper` would when the archive/delete action actually runs.
 */
export const collectArchivingOrDeletingEntityIdsFromBatch = (
  operations: Operation[],
  state: unknown,
): Set<string> => {
  // Archive-free hydration/sync batches are common; skip projection work for them.
  if (!operations.some(isTaskArchiveOrDeleteOp)) return new Set<string>();

  const archivingOrDeletingEntityIds = new Set<string>();
  const projectedTaskEntities = cloneTaskEntityMap(state);

  for (const op of operations) {
    if (isTaskArchiveOrDeleteOp(op)) {
      const removedByThisOp = new Set<string>();
      addOperationEntityIds(op, removedByThisOp);
      collectCascadedSubTaskIds(op, removedByThisOp, projectedTaskEntities);
      for (const id of removedByThisOp) {
        archivingOrDeletingEntityIds.add(id);
        delete projectedTaskEntities[id];
      }
      continue;
    }

    applyTaskProjectionFromOp(op, projectedTaskEntities);
  }

  return archivingOrDeletingEntityIds;
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

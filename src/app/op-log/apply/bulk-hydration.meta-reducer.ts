import { Action, ActionReducer } from '@ngrx/store';
import { bulkApplyOperations } from './bulk-hydration.action';
import { convertOpToAction } from './operation-converter.util';
import { ActionType, Operation } from '../core/operation.types';
import { isLwwUpdateActionType } from '../core/lww-update-action-types';
import { OpLog } from '../../core/log';

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
 * `handleDeleteTasks` does at apply time. Without this helper, a
 * co-batched TAG/PROJECT LWW Update referencing an archived/deleted
 * subtask would still leak through the strip below.
 */
const collectCascadedSubTaskIds = (
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
 */
const stripBatchArchivedTaskIdsFromLwwPayload = (
  op: Operation,
  isLww: boolean,
  archivingOrDeletingEntityIds: Set<string>,
): Operation => {
  if (!isLww) return op;
  if (op.entityType !== 'TAG' && op.entityType !== 'PROJECT') return op;
  const payload = op.payload;
  if (!payload || typeof payload !== 'object') return op;
  const p = payload as Record<string, unknown>;

  const stripIds = (
    key: string,
  ): { cleaned: string[]; removed: string[] } | undefined => {
    const value = p[key];
    if (!Array.isArray(value)) return undefined;
    const cleaned: string[] = [];
    const removed: string[] = [];
    for (const id of value) {
      if (typeof id !== 'string') {
        cleaned.push(id);
        continue;
      }
      if (archivingOrDeletingEntityIds.has(id)) removed.push(id);
      else cleaned.push(id);
    }
    return removed.length === 0 ? undefined : { cleaned, removed };
  };

  const taskIdsResult = stripIds('taskIds');
  const backlogResult =
    op.entityType === 'PROJECT' ? stripIds('backlogTaskIds') : undefined;
  if (!taskIdsResult && !backlogResult) return op;

  const newPayload: Record<string, unknown> = { ...p };
  if (taskIdsResult) newPayload.taskIds = taskIdsResult.cleaned;
  if (backlogResult) newPayload.backlogTaskIds = backlogResult.cleaned;
  OpLog.warn(
    `bulkOperationsMetaReducer: Stripped same-batch-archived task IDs from ` +
      `${op.entityType}:${op.entityId} LWW Update payload`,
    {
      taskIdsRemoved: taskIdsResult?.removed,
      backlogTaskIdsRemoved: backlogResult?.removed,
    },
  );
  return { ...op, payload: newPayload };
};

/**
 * Meta-reducer that applies multiple operations in a single reducer pass.
 *
 * Used for:
 * - Local hydration: Apply tail operations at startup
 * - Remote sync: Apply operations from other clients
 *
 * Instead of dispatching 500 individual actions (which causes 500 store updates),
 * this meta-reducer applies all operations in one dispatch.
 *
 * The approach works because:
 * 1. Each operation is converted to its NgRx action via convertOpToAction()
 * 2. Each action goes through the full reducer chain (including meta-reducers)
 * 3. Final state is returned after all operations are applied
 *
 * Key benefit for remote sync: Effects don't see individual actions because they
 * only see the bulk action type, which no effect listens for. This eliminates
 * the need for LOCAL_ACTIONS filtering on action-based effects.
 *
 * Performance impact: 500 dispatches → 1 dispatch = ~10-50x faster
 *
 * IMPORTANT considerations:
 * - Meta-reducer order is critical: this MUST be positioned AFTER
 *   operationCaptureMetaReducer in the metaReducers array (see main.ts).
 *   This ensures converted actions don't get re-captured.
 * - The synchronous loop could block the main thread for 10,000+ operations.
 *   Not tested at that scale. If needed, consider chunking with requestIdleCallback.
 */
export const bulkOperationsMetaReducer = <T>(
  reducer: ActionReducer<T>,
): ActionReducer<T> => {
  return (state: T | undefined, action: Action): T => {
    if (action.type === bulkApplyOperations.type) {
      const { operations } = action as ReturnType<typeof bulkApplyOperations>;

      // Pre-scan: collect entity IDs being archived or deleted in this batch.
      // LWW Update ops for these entities must be skipped to prevent
      // lwwUpdateMetaReducer.addOne() from resurrecting archived/deleted tasks.
      const archivingOrDeletingEntityIds = new Set<string>();
      for (const op of operations) {
        if (
          op.actionType === ActionType.TASK_SHARED_MOVE_TO_ARCHIVE ||
          op.actionType === ActionType.TASK_SHARED_DELETE ||
          op.actionType === ActionType.TASK_SHARED_DELETE_MULTIPLE
        ) {
          if (op.entityIds) {
            for (const id of op.entityIds) {
              archivingOrDeletingEntityIds.add(id);
            }
          } else if (op.entityId) {
            archivingOrDeletingEntityIds.add(op.entityId);
          }
          collectCascadedSubTaskIds(op, archivingOrDeletingEntityIds, state);
        }
      }

      let currentState = state;
      const hasArchives = archivingOrDeletingEntityIds.size > 0;
      for (const op of operations) {
        const isLww = hasArchives && isLwwUpdateActionType(op.actionType);
        // Skip LWW Updates whose entityId itself is archived/deleted in this batch
        // (covers TASK; for TAG/PROJECT entityId is the tag/project id, not a task).
        if (isLww && op.entityId && archivingOrDeletingEntityIds.has(op.entityId)) {
          OpLog.normal(
            `bulkOperationsMetaReducer: Skipping LWW Update for ` +
              `${op.entityType}:${op.entityId} — entity archived/deleted in same batch`,
          );
          continue;
        }
        const opForApply = hasArchives
          ? stripBatchArchivedTaskIdsFromLwwPayload(
              op,
              isLww,
              archivingOrDeletingEntityIds,
            )
          : op;
        const opAction = convertOpToAction(opForApply);
        currentState = reducer(currentState, opAction);
      }
      return currentState as T;
    }
    return reducer(state, action);
  };
};

/**
 * @deprecated Use bulkOperationsMetaReducer instead. Kept for backwards compatibility.
 */
export const bulkHydrationMetaReducer = bulkOperationsMetaReducer;

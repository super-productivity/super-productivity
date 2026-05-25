import { Action, ActionReducer } from '@ngrx/store';
import { bulkApplyOperations } from './bulk-hydration.action';
import { convertOpToAction } from './operation-converter.util';
import { isLwwUpdateActionType } from '../core/lww-update-action-types';
import {
  collectArchivingOrDeletingEntityIdsFromBatch,
  stripBatchArchivedTaskIdsFromLwwPayload,
} from './bulk-archive-filter.util';
import { OpLog } from '../../core/log';

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
 *
 * Issue #7330: payload-archaeology helpers (cascade subtask harvest, in-batch
 * archived-task strip) live in bulk-archive-filter.util.ts so this file can
 * stay focused on dispatch.
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
      const archivingOrDeletingEntityIds = collectArchivingOrDeletingEntityIdsFromBatch(
        operations,
        state,
      );

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

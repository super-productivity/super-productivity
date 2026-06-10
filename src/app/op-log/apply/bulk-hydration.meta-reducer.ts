import { Action, ActionReducer } from '@ngrx/store';
import { bulkApplyOperations } from './bulk-hydration.action';
import { convertOpToAction } from './operation-converter.util';
import { isLwwUpdateActionType } from '../core/lww-update-action-types';
import {
  collectArchivingOrDeletingEntityIdsFromBatch,
  stripBatchArchivedTaskIdsFromLwwPayload,
} from './bulk-archive-filter.util';
import { OpLog } from '../../core/log';
import { runWithBulkReplayLoggingSuppressed } from '../../util/bulk-replay-log-guard';

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
      const { operations, localClientId } = action as ReturnType<
        typeof bulkApplyOperations
      >;

      // Pre-scan: collect entity IDs being archived or deleted in this batch.
      // LWW Update ops for these entities must be skipped to prevent
      // lwwUpdateMetaReducer.addOne() from resurrecting archived/deleted tasks.
      const archivingOrDeletingEntityIds = collectArchivingOrDeletingEntityIdsFromBatch(
        operations,
        state,
      );

      const hasArchives = archivingOrDeletingEntityIds.size > 0;
      // Apply every op in one synchronous reducer pass. Suppress the action
      // logger's per-op console line for the duration (see bulk-replay-log-guard):
      // this is a single dispatch, and the caller (hydrator / applier) already
      // logs an "applying N ops" summary, so per-op `[a]` lines are just noise.
      const finalState = runWithBulkReplayLoggingSuppressed(() => {
        let currentState = state;
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
          // Mark ops authored by a DIFFERENT client so reducers can preserve
          // per-device "local-only" settings against remote overwrites — while
          // replaying the device's OWN ops faithfully.
          //
          // When localClientId is unknown we leave the flag unset (own-op
          // semantics: apply faithfully, don't preserve). In practice this only
          // happens before the clientId cache is warm — i.e. a never-synced or
          // cold-booting device. A device that actually has foreign ops to apply
          // has already resolved its clientId (download/upload/vector-clock all
          // require it), so genuine remote applies always carry it and stay
          // protected. The unset fallback deliberately favours own-op fidelity:
          // the alternative (blanket-preserve, the old `isRemote` gate) is what
          // silently nulled the device's own syncProvider on replay. The
          // residual risk — a foreign op adopting another device's provider/
          // isEnabled/isEncryptionEnabled — needs a transient IndexedDB failure
          // on a cold boot and is user-recoverable, strictly narrower than the
          // own-settings data-loss this replaces.
          const isApplyingFromOtherClient =
            !!localClientId && op.clientId !== localClientId;
          const finalAction = isApplyingFromOtherClient
            ? { ...opAction, meta: { ...opAction.meta, isApplyingFromOtherClient: true } }
            : opAction;
          currentState = reducer(currentState, finalAction);
        }
        return currentState;
      });
      return finalState as T;
    }
    return reducer(state, action);
  };
};

/**
 * @deprecated Use bulkOperationsMetaReducer instead. Kept for backwards compatibility.
 */
export const bulkHydrationMetaReducer = bulkOperationsMetaReducer;

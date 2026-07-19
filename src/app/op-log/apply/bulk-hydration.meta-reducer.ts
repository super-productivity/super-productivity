import { Action, ActionReducer } from '@ngrx/store';
import { bulkApplyOperations } from './bulk-hydration.action';
import { convertOpToAction } from './operation-converter.util';
import { isLwwUpdateActionType } from '../core/lww-update-action-types';
import { isLwwUpdatePayload } from '../core/operation.types';
import {
  collectTaskRemovalEntityIdsFromBatch,
  isTaskArchiveOrDeleteOp,
  stripBatchArchivedTaskIdsFromLwwPayload,
} from './bulk-archive-filter.util';
import { OpLog } from '../../core/log';
import { runWithBulkReplayLoggingSuppressed } from '../../util/bulk-replay-log-guard';
import { reportBulkReplayReducerFailure } from './bulk-replay-failure-collector';
import { isFullStateOpType } from '../core/operation.types';

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
      const {
        operations,
        localClientId,
        atomicReplayGroups = [],
      } = action as ReturnType<typeof bulkApplyOperations>;

      // Apply every op in one synchronous reducer pass. Suppress the action
      // logger's per-op console line for the duration (see bulk-replay-log-guard):
      // this is a single dispatch, and the caller (hydrator / applier) already
      // logs an "applying N ops" summary, so per-op `[a]` lines are just noise.
      const finalState = runWithBulkReplayLoggingSuppressed(() => {
        const failedOpIds = new Set<string>();
        const atomicGroupByOpId = new Map<string, string[]>();
        for (const group of atomicReplayGroups) {
          for (const opId of group) {
            atomicGroupByOpId.set(opId, group);
          }
        }
        const reportFailure = (
          op: (typeof operations)[number],
          error: unknown,
        ): boolean => {
          if (failedOpIds.has(op.id)) {
            return false;
          }
          failedOpIds.add(op.id);
          reportBulkReplayReducerFailure(op, error);
          OpLog.err(
            `bulkOperationsMetaReducer: Skipping reducer-failed operation ${op.id}`,
            { name: error instanceof Error ? error.name : 'UnknownError' },
          );
          return true;
        };
        const excludeAtomicGroup = (opId: string): boolean => {
          const group = atomicGroupByOpId.get(opId);
          if (!group) {
            return false;
          }
          for (const groupedOpId of group) {
            failedOpIds.add(groupedOpId);
          }
          return true;
        };

        // An archive/delete op affects how earlier LWW updates are replayed. If
        // that archive reducer fails, discard the speculative pass and replay
        // from the original state without the failed archive intent. Reducers
        // are pure, and retries occur only on the exceptional failure path.
        while (true) {
          const candidateOps = operations.filter((op) => !failedOpIds.has(op.id));
          let archivingOrDeletingEntityIds: Set<string>;
          let archivingEntityIds: Set<string>;
          try {
            const taskRemovalIds = collectTaskRemovalEntityIdsFromBatch(
              candidateOps,
              state,
            );
            archivingOrDeletingEntityIds = taskRemovalIds.all;
            archivingEntityIds = taskRemovalIds.archiving;
          } catch (error) {
            const unsafeArchiveOps = candidateOps.filter(isTaskArchiveOrDeleteOp);
            for (const op of unsafeArchiveOps) {
              reportFailure(op, error);
              excludeAtomicGroup(op.id);
            }
            continue;
          }

          const hasArchives = archivingOrDeletingEntityIds.size > 0;
          let currentState = state;
          let shouldReplayWithoutFailedOperations = false;
          for (const op of candidateOps) {
            try {
              const isLww = hasArchives && isLwwUpdateActionType(op.actionType);
              const recreatesEntityAfterDelete =
                isLww &&
                isLwwUpdatePayload(op.payload) &&
                op.payload.recreatesEntityAfterDelete === true &&
                (!op.entityId || !archivingEntityIds.has(op.entityId));
              // Skip LWW Updates whose entityId itself is archived/deleted in this batch
              // (covers TASK; for TAG/PROJECT entityId is the tag/project id, not a task).
              if (
                isLww &&
                !recreatesEntityAfterDelete &&
                op.entityId &&
                archivingOrDeletingEntityIds.has(op.entityId)
              ) {
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
                ? {
                    ...opAction,
                    meta: { ...opAction.meta, isApplyingFromOtherClient: true },
                  }
                : opAction;
              currentState = reducer(currentState, finalAction);
            } catch (error) {
              const isNewFailure = reportFailure(op, error);
              if (isFullStateOpType(op.opType)) {
                // A full-state operation replaces the entire model. Continuing
                // from the pre-import state would expose a projection that never
                // existed in the log, so discard the speculative batch.
                return state;
              }
              if (excludeAtomicGroup(op.id)) {
                // The children of a split migration represent one durable
                // intent. Discard this speculative pass and replay without all
                // siblings so the resulting state is reconstructible.
                shouldReplayWithoutFailedOperations = true;
                break;
              }
              if (isNewFailure && isTaskArchiveOrDeleteOp(op)) {
                shouldReplayWithoutFailedOperations = true;
              }
            }
          }
          if (!shouldReplayWithoutFailedOperations) {
            return currentState;
          }
        }
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

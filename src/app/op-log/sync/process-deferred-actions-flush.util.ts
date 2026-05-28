import { Injector } from '@angular/core';
import { OperationLogEffects } from '../capture/operation-log.effects';

/**
 * Flushes deferred local actions after a remote-apply step has finished
 * its crash-safety bookkeeping (markApplied, mergeRemoteOpClocks).
 *
 * The host explicitly drives this flush — rather than relying on the
 * sync-core coordinator's finally block — because the flush must run
 * AFTER mergeRemoteOpClocks so deferred local ops get vector clocks
 * that dominate the just-applied remote ops. See #7700.
 *
 * `OperationLogEffects` is resolved lazily via Injector to avoid a
 * compile-time circular dep between the sync services and the effect.
 *
 * @param injector  Angular injector — pass `this.injector` from the host
 *                  service (RemoteOpsProcessingService / ConflictResolutionService).
 * @param callerHoldsOperationLogLock  True when the host currently holds
 *                  the sp_op_log lock; the flush then runs inline rather
 *                  than re-acquiring (non-reentrant lock would deadlock).
 */
export const processDeferredActionsAfterRemoteApply = async (
  injector: Injector,
  callerHoldsOperationLogLock: boolean,
): Promise<void> => {
  await injector.get(OperationLogEffects).processDeferredActions({
    callerHoldsOperationLogLock,
  });
};

import { inject, Injectable, Injector } from '@angular/core';
import { Store } from '@ngrx/store';
import { replayOperationBatch } from '@sp/sync-core';
import type {
  ActionDispatchPort,
  OperationApplyPort,
  SyncActionLike,
} from '@sp/sync-core';
import { Operation } from '../core/operation.types';
import { convertOpToAction } from './operation-converter.util';
import { OpLog } from '../../core/log';
import {
  ArchiveOperationHandler,
  isArchiveAffectingAction,
} from './archive-operation-handler.service';
import { HydrationStateService } from './hydration-state.service';
import { remoteArchiveDataApplied } from '../../features/archive/store/archive.actions';
import { bulkApplyOperations } from './bulk-hydration.action';
import { OperationLogEffects } from '../capture/operation-log.effects';
import { ApplyOperationsResult, ApplyOperationsOptions } from '../core/types/apply.types';

// Re-export for consumers that import from this service
export type {
  ApplyOperationsResult,
  ApplyOperationsOptions,
} from '../core/types/apply.types';

/**
 * Service responsible for applying operations to the local NgRx store.
 *
 * Uses bulk dispatch (bulkApplyOperations) to apply all operations in a single
 * NgRx store update. This provides two key benefits:
 *
 * 1. Performance: 500 operations = 1 dispatch instead of 500 dispatches
 * 2. Effect isolation: Effects don't see individual actions, only the bulk action
 *    which no effect listens for. This eliminates the need for LOCAL_ACTIONS
 *    filtering on action-based effects.
 *
 * Operations are applied in the order they arrive from the sync server,
 * which guarantees correct dependency ordering. Each client uploads ops
 * in causal order (can't create a child before parent), and the server
 * assigns sequence numbers in upload order.
 */
@Injectable({
  providedIn: 'root',
})
export class OperationApplierService implements OperationApplyPort<Operation> {
  private store: ActionDispatchPort<SyncActionLike> = inject(Store);
  private archiveOperationHandler = inject(ArchiveOperationHandler);
  private hydrationState = inject(HydrationStateService);
  // Use Injector to avoid circular dependency: OperationLogEffects depends on services
  // that may depend on this service indirectly through the Store.
  private injector = inject(Injector);

  /**
   * Apply operations to the NgRx store using bulk dispatch.
   *
   * All operations are applied in a single NgRx dispatch via bulkApplyOperations.
   * After the state is updated, archive operations are processed sequentially.
   *
   * @param ops Operations to apply
   * @param options Configuration options. Use `isLocalHydration: true` for
   *                replaying local operations (skips archive handling).
   * @returns Result containing applied operations and optionally the failed operation.
   *          Callers should:
   *          - Mark `appliedOps` as applied (they've been dispatched to NgRx)
   *          - Mark the failed op and any remaining ops as failed
   */
  async applyOperations(
    ops: Operation[],
    options: ApplyOperationsOptions = {},
  ): Promise<ApplyOperationsResult> {
    if (ops.length === 0) {
      return { appliedOps: [] };
    }

    const isLocalHydration = options.isLocalHydration ?? false;

    if (isLocalHydration) {
      OpLog.normal(
        `OperationApplierService: Hydrating ${ops.length} local operations (bulk dispatch)`,
      );
    } else {
      OpLog.normal(
        `OperationApplierService: Applying ${ops.length} remote operations (bulk dispatch)`,
      );
    }

    const result = await replayOperationBatch({
      ops,
      applyOptions: options,
      dispatcher: this.store,
      createBulkApplyAction: (operations) => bulkApplyOperations({ operations }),
      remoteApplyWindow: this.hydrationState,
      deferredLocalActions: {
        processDeferredActions: () =>
          this.injector.get(OperationLogEffects).processDeferredActions(),
      },
      archiveSideEffects: this.archiveOperationHandler,
      operationToAction: convertOpToAction,
      isArchiveAffectingAction,
      onRemoteArchiveDataApplied: () => {
        // Dispatch action to signal archive data was applied (for potential future use)
        // Note: The refreshWorklogAfterRemoteArchiveOps effect that used to listen to
        // this action is now disabled to prevent UI freezes during bulk archive sync.
        this.store.dispatch(remoteArchiveDataApplied());
      },
      onArchiveSideEffectError: ({ op, processedCount, error }) => {
        OpLog.err(
          `OperationApplierService: Failed archive handling for operation ${op.id}. ` +
            `${processedCount} ops were processed before this failure.`,
          error,
        );
      },
      onPostSyncCooldownError: (e) => {
        OpLog.err('OperationApplierService: startPostSyncCooldown failed', e);
      },
    });

    if (!result.failedOp) {
      OpLog.normal('OperationApplierService: Finished applying operations.');
    }

    return result;
  }
}

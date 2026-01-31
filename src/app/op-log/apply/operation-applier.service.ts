import { inject, Injectable, Injector } from '@angular/core';
import { Store } from '@ngrx/store';
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
export class OperationApplierService {
  private store = inject(Store);
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

    // Mark that we're applying remote operations to suppress selector-based effects
    this.hydrationState.startApplyingRemoteOps();
    try {
      // STEP 1: Bulk dispatch all operations in a single NgRx update
      // The bulkOperationsMetaReducer iterates through ops and applies each action.
      // Effects don't see individual actions - they only see bulkApplyOperations
      // which no effect listens for.
      this.store.dispatch(bulkApplyOperations({ operations: ops }));

      // Yield to event loop to ensure store update is processed
      await new Promise((resolve) => setTimeout(resolve, 0));

      // STEP 2: Handle archive operations (only for remote sync, not local hydration)
      // Archive data lives in IndexedDB, not NgRx state, so we need to persist it separately.
      if (!isLocalHydration) {
        const archiveResult = await this._processArchiveOperations(ops);
        if (archiveResult.failedOp) {
          return archiveResult;
        }

        // Dispatch action to signal archive data was applied (for potential future use)
        // Note: The refreshWorklogAfterRemoteArchiveOps effect that used to listen to
        // this action is now disabled to prevent UI freezes during bulk archive sync.
        if (archiveResult.hadArchiveAffectingOp) {
          this.store.dispatch(remoteArchiveDataApplied());
        }
      }
    } finally {
      // Start cooldown BEFORE ending remote ops flag to eliminate the timing gap
      // where isInSyncWindow() returns false and selector-based effects can fire.
      // Only needed for remote ops - local hydration doesn't cause the timing gap issue.
      // Wrapped in try-catch so endApplyingRemoteOps() always runs even if this fails.
      if (!isLocalHydration) {
        try {
          this.hydrationState.startPostSyncCooldown();
        } catch (e) {
          OpLog.err('OperationApplierService: startPostSyncCooldown failed', e);
        }
      }

      this.hydrationState.endApplyingRemoteOps();

      // Process any user actions that were buffered during sync replay.
      // These get fresh vector clocks that include the newly-applied remote ops.
      await this.injector.get(OperationLogEffects).processDeferredActions();
    }

    OpLog.normal('OperationApplierService: Finished applying operations.');
    return { appliedOps: ops };
  }

  /**
   * Process archive operations after bulk state dispatch.
   * Archive data lives in IndexedDB and needs to be persisted separately.
   *
   * The archive handler is called for all operations - it internally decides
   * which operations need archive storage updates.
   */
  private async _processArchiveOperations(ops: Operation[]): Promise<{
    appliedOps: Operation[];
    hadArchiveAffectingOp: boolean;
    failedOp?: { op: Operation; error: Error };
  }> {
    const appliedOps: Operation[] = [];
    let hadArchiveAffectingOp = false;

    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      try {
        const action = convertOpToAction(op);

        // Call handler for all operations - it internally checks if action affects archive
        await this.archiveOperationHandler.handleOperation(action);

        // Track if any archive-affecting operations were processed (for UI refresh)
        if (isArchiveAffectingAction(action)) {
          hadArchiveAffectingOp = true;
          // Yield after EACH archive-affecting operation to prevent UI freeze.
          // Archive operations involve slow IndexedDB writes that can block the event loop.
          await new Promise((resolve) => setTimeout(resolve, 0));
        }

        appliedOps.push(op);
      } catch (e) {
        OpLog.err(
          `OperationApplierService: Failed archive handling for operation ${op.id}. ` +
            `${appliedOps.length} ops were processed before this failure.`,
          e,
        );

        return {
          appliedOps,
          hadArchiveAffectingOp,
          failedOp: {
            op,
            error: e instanceof Error ? e : new Error(String(e)),
          },
        };
      }
    }

    // Final yield after processing all operations to ensure last operation completes
    if (ops.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    return { appliedOps, hadArchiveAffectingOp };
  }
}

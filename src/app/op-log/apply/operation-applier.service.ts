import { inject, Injectable, Injector } from '@angular/core';
import { Store } from '@ngrx/store';
import { replayOperationBatch } from '@sp/sync-core';
import type {
  ActionDispatchPort,
  OperationApplyPort,
  RemoteApplyWindowPort,
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
import { CLIENT_ID_PROVIDER } from '../util/client-id.provider';
import { OperationLogEffects } from '../capture/operation-log.effects';
import { ApplyOperationsResult, ApplyOperationsOptions } from '../core/types/apply.types';
import {
  BulkReplayReducerFailure,
  runWithBulkReplayFailureCollector,
} from './bulk-replay-failure-collector';

// Re-export for consumers that import from this service
export type {
  ApplyOperationsResult,
  ApplyOperationsOptions,
} from '../core/types/apply.types';

const CALLER_MANAGED_REMOTE_APPLY_WINDOW: RemoteApplyWindowPort = {
  startApplyingRemoteOps: () => undefined,
  startPostSyncCooldown: () => undefined,
  endApplyingRemoteOps: () => undefined,
};

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
  private clientIdProvider = inject(CLIENT_ID_PROVIDER);
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

    // Identify THIS device so the bulk meta-reducer can tell own-op replay apart
    // from genuinely remote ops (preserves per-device local-only sync settings
    // only against another client's ops, never while replaying our own).
    //
    // Use loadClientId (lenient — returns null, never throws). Do NOT switch to
    // getOrGenerateClientId to "fail safe": applyRemoteOperations appends the
    // incoming ops as PENDING before calling this applier and only marks them
    // applied/failed from the returned result, so a throw here would strand those
    // appended ops — a same-session retry then skips them as duplicates. That is
    // worse than the unprotected-foreign-op leak it would prevent. The leak is
    // unreachable on this path anyway: applying remote ops means the clientId was
    // already resolved (download/vector-clocks need it), so the cached read
    // returns it. A null only happens off this path (cold-boot hydration), where
    // the unset flag's own-op default is the safe direction. See meta-reducer.
    const localClientId = (await this.clientIdProvider.loadClientId()) ?? undefined;

    const reducerFailures: BulkReplayReducerFailure[] = [];
    const result = await replayOperationBatch({
      ops,
      applyOptions: {
        isLocalHydration,
        skipReducerDispatch: options.skipReducerDispatch,
      },
      dispatcher: {
        dispatch: (action) =>
          runWithBulkReplayFailureCollector(
            (failure) => reducerFailures.push(failure),
            () => this.store.dispatch(action),
          ),
      },
      createBulkApplyAction: (operations) =>
        bulkApplyOperations({ operations, localClientId }),
      getReducerFailures: () => reducerFailures,
      remoteApplyWindow: options.remoteApplyWindowAlreadyOpen
        ? CALLER_MANAGED_REMOTE_APPLY_WINDOW
        : this.hydrationState,
      deferredLocalActions: {
        processDeferredActions: () =>
          options.skipDeferredLocalActions
            ? undefined
            : this.injector.get(OperationLogEffects).processDeferredActions(),
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
      onReducersCommitted: options.onReducersCommitted,
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

    if (result.reducerFailures?.length) {
      OpLog.err(
        `OperationApplierService: Skipped ${result.reducerFailures.length} reducer-failed operation(s).`,
      );
    }

    return result;
  }
}

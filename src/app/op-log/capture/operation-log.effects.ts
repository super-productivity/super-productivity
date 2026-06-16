import { inject, Injectable } from '@angular/core';
import { createEffect } from '@ngrx/effects';
import type { DeferredLocalActionsPort } from '@sp/sync-core';
import { ALL_ACTIONS } from '../../util/local-actions.token';
import { concatMap, filter } from 'rxjs/operators';
import { LockService } from '../sync/lock.service';
import { LockAcquisitionTimeoutError } from '../core/errors/sync-errors';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import {
  isPersistentAction,
  PersistentAction,
} from '../core/persistent-action.interface';
import { uuidv7 } from '../../util/uuid-v7';
import { devError } from '../../util/dev-error';
import { incrementVectorClock } from '../../core/util/vector-clock';
import { MultiEntityPayload, Operation, ActionType } from '../core/operation.types';
import { OperationLogCompactionService } from '../persistence/operation-log-compaction.service';
import { OpLog } from '../../core/log';
import { SnackService } from '../../core/snack/snack.service';
import { T } from '../../t.const';
import { validateOperationPayload } from '../validation/validate-operation-payload';
import { VectorClockService } from '../sync/vector-clock.service';
import {
  COMPACTION_THRESHOLD,
  LOCK_NAMES,
  MAX_COMPACTION_FAILURES,
} from '../core/operation-log.const';
import { CURRENT_SCHEMA_VERSION } from '../persistence/schema-migration.service';
import { OperationCaptureService } from './operation-capture.service';
import { ImmediateUploadService } from '../sync/immediate-upload.service';
import { getDeferredActions, isDeferredAction } from './operation-capture.meta-reducer';
import { ClientIdService } from '../../core/util/client-id.service';
import { SuperSyncStatusService } from '../sync/super-sync-status.service';

interface WriteOperationOptions {
  callerHoldsOperationLogLock?: boolean;
}

/**
 * NgRx Effects for persisting application state changes as operations to the
 * `OperationLogStoreService`. It listens for specific NgRx actions marked
 * as 'persistent' (via `PersistentActionMeta`), converts them into `Operation`
 * objects, and writes them to the IndexedDB log. This effect handles concurrency
 * control via `LockService` and ensures that remote operations (from sync)
 * are not re-logged.
 */
@Injectable()
export class OperationLogEffects implements DeferredLocalActionsPort {
  private compactionFailures = 0;
  /** Circuit breaker: prevents recursive quota exceeded handling */
  private isHandlingQuotaExceeded = false;
  /** Counter for total operations written. Used for high-volume sync debugging. */
  private writeCount = 0;
  /**
   * PERF: In-memory compaction counter to avoid IndexedDB transaction on every operation.
   * The persistent counter in state_cache is only used for cross-tab/restart recovery.
   * Initialized lazily from persisted value on first operation.
   */
  private inMemoryCompactionCounter: number | null = null;
  /**
   * Dedupe timestamp for the storage-quota snackbar. #7700: when quota fires
   * inside the deferred-action retry loop, the retry loop calls handleQuotaExceeded
   * up to MAX_RETRIES times — without dedupe the user would see 3 identical
   * STORAGE_QUOTA_EXCEEDED snacks plus the final DEFERRED_ACTION_FAILED.
   */
  private lastStorageQuotaSnackAt = 0;
  /** Suppression window for duplicate storage-quota snackbars. */
  private readonly STORAGE_QUOTA_SNACK_DEDUPE_MS = 5000;
  // Uses ALL_ACTIONS because this effect captures all persistent actions and handles isRemote filtering internally
  private actions$ = inject(ALL_ACTIONS);
  private lockService = inject(LockService);
  private opLogStore = inject(OperationLogStoreService);
  private vectorClockService = inject(VectorClockService);
  private clientIdService = inject(ClientIdService);
  private compactionService = inject(OperationLogCompactionService);
  private snackService = inject(SnackService);
  private operationCaptureService = inject(OperationCaptureService);
  private immediateUploadService = inject(ImmediateUploadService);
  private superSyncStatusService = inject(SuperSyncStatusService);

  /**
   * Effect that persists local user actions to the operation log.
   *
   * Filters out:
   * 1. Non-persistent actions (actions without PersistentActionMeta)
   * 2. Remote actions (actions replayed from sync, marked with isRemote: true)
   * 3. Deferred actions (buffered during sync, processed later by processDeferredActions)
   *
   * Note: We do NOT filter by `isApplyingRemoteOps()` here because of a race
   * condition: the meta-reducer may capture (increment the pending counter for)
   * an action before sync starts, but the effect processes it after sync starts.
   * Filtering by isApplyingRemoteOps would skip the action while its pending
   * count stays elevated, causing flushPendingWrites to time out. Instead, we use
   * isDeferredAction() — a stable, per-action property decided at meta-reducer
   * time — which precisely identifies actions that were buffered (not counted) by
   * the meta-reducer. This keeps the increment set (meta-reducer) and the
   * decrement set (this effect) identical, so the counter always balances.
   */
  persistOperation$ = createEffect(
    () =>
      this.actions$.pipe(
        filter(
          (action): action is PersistentAction =>
            isPersistentAction(action) &&
            !action.meta.isRemote &&
            !isDeferredAction(action),
        ),
        // concatMap for sequential, ordered processing (one write at a time).
        concatMap((action) => this.writeOperationFromEffect(action)),
      ),
    { dispatch: false },
  );

  /**
   * Effect-path wrapper around {@link writeOperation}.
   *
   * #8306: a thrown write (e.g. a `LockAcquisitionTimeoutError`) must NOT error
   * the `persistOperation$` stream. If it did, `concatMap` would tear down and
   * silently drop every action buffered behind it, no snackbar would fire for
   * them, and after NgRx's default 10 resubscribes the effect would die until
   * reload. So we catch here — `writeOperation` already surfaced the failure to
   * the user via a sticky snackbar — and the stream lives on.
   *
   * The `finally` decrements the pending counter exactly once per dispatched
   * action, regardless of success, failure, or internal quota-retry recursion.
   * This is what frees `flushPendingWrites()`: the counter cannot leak even when
   * the write throws (the structural fix for the #8306 flush wedge).
   *
   * NOTE: the deferred-action path (`processDeferredActions` → `writeOperation`)
   * deliberately does NOT go through here — it keeps `writeOperation`'s throw so
   * its own retry loop can react (#7700), and its actions were never counted.
   */
  private async writeOperationFromEffect(action: PersistentAction): Promise<void> {
    try {
      await this.writeOperation(action);
    } catch (e) {
      // Already surfaced to the user inside writeOperation; swallow so the
      // shared effect stream is never torn down by a single failed write.
      OpLog.err('OperationLogEffects: persist failed (handled; stream preserved)', e);
    } finally {
      this.operationCaptureService.decrementPending();
    }
  }

  /**
   * Persists a single action as an operation.
   *
   * @param isDeferredWrite when true, the action was buffered during the sync
   *   window and is being flushed by `processDeferredActions`. Deferred writes
   *   emit `entityChanges: []` (matching the pre-counter behaviour — deferred
   *   actions were never run through the extractor) and are NOT tracked by the
   *   pending counter (they were never incremented). Throws on lock timeout so
   *   the deferred retry loop can react (#7700).
   */
  private async writeOperation(
    action: PersistentAction,
    isDeferredWrite = false,
    options: WriteOperationOptions = {},
  ): Promise<void> {
    const operationTimestamp = Date.now();

    // Validate that at least one entity identifier exists for non-bulk operations
    // Bulk operations with entityType 'ALL' don't need specific entity IDs
    // This catches programming errors early - all persistent actions must have entity identifiers
    // Also validates entityId is not empty/whitespace to match server-side validation
    const isBulkAllOperation = action.meta.entityType === 'ALL';
    const hasValidEntityId =
      action.meta.entityId &&
      typeof action.meta.entityId === 'string' &&
      action.meta.entityId.trim().length > 0;
    const hasValidEntityIds =
      action.meta.entityIds?.length &&
      action.meta.entityIds.every(
        (id: unknown) => id && typeof id === 'string' && (id as string).trim().length > 0,
      );
    if (!isBulkAllOperation && !hasValidEntityId && !hasValidEntityIds) {
      // No queue bookkeeping needed here: the effect wrapper's `finally`
      // decrements the pending counter for this action even on early return.
      devError(
        `[OperationLogEffects] Action ${action.type} has invalid entityId/entityIds (${action.meta.entityId}) - skipping persistence`,
      );
      return;
    }

    // Extract payload (everything except type and meta)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { type, meta, ...rawActionPayload } = action;

    // Use the action's declared opType from meta. We don't derive from entity changes because
    // some operations have different semantic meaning than their state changes suggest.
    // E.g., moveToArchive is UPDATE (tasks moved, not deleted) but shows as DELETE in state.
    const opType = action.meta.opType;

    // Validate action type exists in ActionType enum
    // This catches mismatches during development when new actions are added but not registered
    if (!Object.values(ActionType).includes(action.type as ActionType)) {
      devError(
        `[OperationLogEffects] Unknown action type: ${action.type} - not in ActionType enum`,
      );
      // Continue anyway - the action will still be persisted and may work
      // This is a warning, not a blocker, since the enum may not be exhaustive
    }

    try {
      const writeInsideOperationLogLock = async (): Promise<void> => {
        // Always read from ClientIdService while holding the write lock.
        // Clean-slate and backup import rotate the clientId while holding this
        // same lock; reading here prevents a queued operation from capturing
        // the old id before waiting behind a destructive replacement.
        // getOrGenerateClientId() throws on a transient IndexedDB read failure
        // rather than minting a fresh id — the catch below treats that as a
        // retryable persistence failure.
        const clientId = await this.clientIdService.getOrGenerateClientId();

        // MULTI-TAB SAFETY: Clear vector clock cache to ensure fresh read after other tabs
        // may have written while we were waiting for the lock. Each tab has its own in-memory
        // cache, so Tab B's cache could be stale if Tab A wrote while Tab B was waiting.
        this.opLogStore.clearVectorClockCache();

        // Compute entity changes from the action (for TIME_TRACKING and TASK time
        // sync; empty array for everything else, where the action payload suffices).
        // extractEntityChanges is a pure function of the action, so it is safe to
        // call here and idempotent across the quota-retry path. Deferred writes
        // emit [] to preserve the pre-counter behaviour (they were buffered without
        // being run through the extractor).
        const entityChanges = isDeferredWrite
          ? []
          : this.operationCaptureService.extractEntityChanges(action);

        const actionPayload = this.addReplayDateFieldsToActionPayload(
          action,
          rawActionPayload,
          operationTimestamp,
        );

        // Create multi-entity payload with action payload and computed changes
        const multiEntityPayload: MultiEntityPayload = {
          actionPayload: actionPayload as Record<string, unknown>,
          entityChanges,
        };
        const currentClock = await this.vectorClockService.getCurrentVectorClock();
        // Client ops carry full vector clocks (no pruning). The server prunes
        // AFTER comparison but BEFORE storage (see CLAUDE.md #13). Client-side
        // pruning is harmful: it drops client IDs that the server may still
        // track, causing false CONCURRENT results in compareVectorClocks.
        const newClock = incrementVectorClock(currentClock, clientId);

        // For bulk operations, entityIds is provided but entityId may not be.
        // The server requires entityId for non-full-state operations.
        // Use the first entityId from the array as the primary entityId if not explicitly set.
        const entityIds =
          action.meta.entityIds ??
          (action.meta.entityId ? [action.meta.entityId] : undefined);
        const entityId = action.meta.entityId ?? entityIds?.[0];

        const op: Operation = {
          id: uuidv7(),
          // NgRx action.type is string, but it matches ActionType enum values
          actionType: action.type as ActionType,
          opType,
          entityType: action.meta.entityType,
          entityId,
          entityIds,
          payload: multiEntityPayload,
          clientId: clientId,
          vectorClock: newClock,
          timestamp: operationTimestamp,
          schemaVersion: CURRENT_SCHEMA_VERSION,
        };

        // CHECKPOINT A: Validate payload before persisting
        const validationResult = validateOperationPayload(op);
        if (!validationResult.success) {
          OpLog.err('[OperationLogEffects] Invalid operation payload', {
            error: validationResult.error,
            actionType: action.type,
            opType: op.opType,
            entityType: op.entityType,
          });
          // State may be inconsistent (action dispatched to reducers but not persisted).
          // NOTE: deliberately does NOT feed the rating-prompt suppression signal
          // (recordCriticalErrorTime) — that is fed by GlobalErrorHandler and the
          // validateState seam only; snackbar-surfaced conditions are out of scope
          // by design. See util/critical-error-signal.ts.
          this.snackService.open({
            type: 'ERROR',
            msg: T.F.SYNC.S.INVALID_OPERATION_PAYLOAD,
            actionStr: T.PS.RELOAD,
            actionFn: (): void => {
              window.location.reload();
            },
          });
          return; // Skip persisting invalid operation
        }

        // Log warnings if any (but still persist)
        if (validationResult.warnings?.length) {
          OpLog.warn('[OperationLogEffects] Operation payload warnings', {
            warnings: validationResult.warnings,
            actionType: action.type,
          });
        }

        // 1. Write to SUP_OPS with atomic vector clock update (SINGLE TRANSACTION)
        // PERF: This consolidates what was previously two separate IndexedDB writes
        // (one to SUP_OPS, one to pf.META_MODEL) into a single atomic transaction,
        // reducing disk I/O by ~50% on mobile devices.
        // The op.vectorClock already contains the incremented clock (from newClock above).
        await this.opLogStore.appendWithVectorClockUpdate(op, 'local');

        // Mark that we have pending ops (not yet uploaded) for UI indicator
        this.superSyncStatusService.updatePendingOpsStatus(true);

        // Track write count for high-volume debugging
        this.writeCount++;
        if (this.writeCount % 50 === 0) {
          OpLog.normal(
            `OperationLogEffects: Wrote ${this.writeCount} operations to IndexedDB`,
          );
        }

        // 1b. Trigger immediate upload to SuperSync (async, non-blocking)
        this.immediateUploadService.trigger();

        // 2. Check if compaction is needed
        // PERF: Use in-memory counter instead of IndexedDB transaction on every operation.
        // Initialize from persisted value on first use (for crash recovery).
        if (this.inMemoryCompactionCounter === null) {
          this.inMemoryCompactionCounter = await this.opLogStore.getCompactionCounter();
        }
        this.inMemoryCompactionCounter++;
        if (this.inMemoryCompactionCounter >= COMPACTION_THRESHOLD) {
          // Trigger compaction asynchronously (don't block write operation)
          // Counter is reset in compaction service on success
          this.triggerCompaction();
        }
      };

      if (options.callerHoldsOperationLogLock) {
        await writeInsideOperationLogLock();
      } else {
        // The pending counter is only decremented by the effect wrapper's
        // `finally`, which runs AFTER this request resolves (i.e. after the
        // IndexedDB write committed and the lock was released). So the count
        // cannot reach 0 before the write is durable, and flushPendingWrites()
        // (phase 1 polls the count, phase 2 re-acquires this lock) can never
        // report "all flushed" while a write is still pending or in flight.
        await this.lockService.request(
          LOCK_NAMES.OPERATION_LOG,
          writeInsideOperationLogLock,
        );
      }
    } catch (e) {
      // 4.1.1 Error Handling for Optimistic Updates
      OpLog.err('OperationLogEffects: Failed to persist operation', e);
      if (e instanceof LockAcquisitionTimeoutError) {
        // #7700: do NOT silently swallow lock timeouts. Pre-fix, a reentrant
        // sp_op_log timeout was caught here, the user got a snackbar, and the
        // deferred action vanished from the op log. Notify, then re-throw so
        // processDeferredActions's retry loop retries. Defense in depth: even
        // if a future caller forgets callerHoldsOperationLogLock, the bug is
        // loud instead of silent.
        //
        // #8306: the effect path catches this throw in writeOperationFromEffect
        // — the shared persistOperation$ stream must NOT be torn down by one
        // failed write — while still showing the sticky snackbar below.
        this.notifyUserAndTriggerRollback();
        throw e;
      }
      if (this.isQuotaExceededError(e)) {
        // Circuit breaker: prevent recursive quota handling
        if (this.isHandlingQuotaExceeded) {
          OpLog.err(
            'OperationLogEffects: Quota exceeded during retry - aborting to prevent loop',
          );
          this.notifyUserAndTriggerRollback();
        } else {
          await this.handleQuotaExceeded(action, isDeferredWrite, options);
        }
      } else {
        this.notifyUserAndTriggerRollback();
      }
    }
  }

  /**
   * Triggers compaction asynchronously without blocking the main operation.
   * This is called after COMPACTION_THRESHOLD operations have been written.
   * Tracks failures and notifies user after MAX_COMPACTION_FAILURES consecutive failures.
   * Counter is reset by compaction service on success.
   */
  private triggerCompaction(): void {
    OpLog.normal('OperationLogEffects: Triggering compaction...');
    this.compactionService
      .compact()
      .then(() => {
        this.compactionFailures = 0;
        // Reset in-memory counter on successful compaction
        this.inMemoryCompactionCounter = 0;
      })
      .catch((e) => {
        OpLog.err('OperationLogEffects: Compaction failed', e);
        devError('Compaction failed: ' + e);
        this.compactionFailures++;
        if (this.compactionFailures >= MAX_COMPACTION_FAILURES) {
          this.snackService.open({
            type: 'ERROR',
            msg: T.F.SYNC.S.COMPACTION_FAILED,
            actionStr: T.PS.RELOAD,
            actionFn: (): void => {
              window.location.reload();
            },
          });
        }
      });
  }

  /**
   * Shows a persistent error notification when persistence fails.
   * Uses duration: 0 to make the snackbar sticky until user acts.
   * This is critical because the user needs to reload - their state
   * has diverged from what's persisted to disk.
   */
  private notifyUserAndTriggerRollback(): void {
    this.snackService.open({
      type: 'ERROR',
      msg: T.F.SYNC.S.PERSIST_FAILED,
      actionStr: T.PS.RELOAD,
      actionFn: (): void => {
        window.location.reload();
      },
      config: {
        duration: 0, // Sticky - don't auto-dismiss critical errors
      },
    });
  }

  /**
   * Checks if an error is a QuotaExceededError from IndexedDB.
   * This happens when the browser storage quota is exceeded.
   */
  private isQuotaExceededError(e: unknown): boolean {
    if (e instanceof DOMException) {
      // Standard quota exceeded error names
      return (
        e.name === 'QuotaExceededError' ||
        e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || // Firefox
        e.code === 22 // Legacy Safari
      );
    }
    return false;
  }

  private addReplayDateFieldsToActionPayload(
    action: PersistentAction,
    actionPayload: Record<string, unknown>,
    operationTimestamp: number,
  ): Record<string, unknown> {
    if (action.type !== ActionType.TASK_SHARED_UPDATE) {
      return actionPayload;
    }

    const task = actionPayload['task'];
    if (typeof task !== 'object' || task === null) {
      return actionPayload;
    }

    const taskUpdate = task as Record<string, unknown>;
    const changes = taskUpdate['changes'];
    if (typeof changes !== 'object' || changes === null) {
      return actionPayload;
    }

    const taskChanges = changes as Record<string, unknown>;
    if (taskChanges['isDone'] !== true) {
      return actionPayload;
    }

    return {
      ...actionPayload,
      task: {
        ...taskUpdate,
        changes: {
          ...taskChanges,
          doneOn:
            typeof taskChanges['doneOn'] === 'number'
              ? taskChanges['doneOn']
              : operationTimestamp,
        },
      },
    };
  }

  /**
   * Handles storage quota exceeded by triggering emergency compaction
   * and retrying the failed operation.
   *
   * Uses LockService for cross-tab coordination to ensure only one tab
   * handles quota exceeded at a time. Uses instance flag to prevent
   * recursive calls within the same tab.
   */
  private async handleQuotaExceeded(
    action: PersistentAction,
    isDeferredWrite = false,
    options: WriteOperationOptions = {},
  ): Promise<void> {
    OpLog.err(
      'OperationLogEffects: Storage quota exceeded, attempting emergency compaction',
    );

    // Use lock for cross-tab coordination - only one tab handles quota at a time
    let bailReason: Error | null = null;
    await this.lockService.request('sp_quota_exceeded', async () => {
      if (options.callerHoldsOperationLogLock) {
        OpLog.err(
          'OperationLogEffects: Skipping emergency compaction because operation-log lock is already held',
        );
        this.showStorageQuotaExceededError();
        // Bail loud: we cannot recover here (compaction would deadlock).
        // Capture the failure and re-throw OUTSIDE the cross-tab lock so the
        // deferred-action retry loop surfaces DEFERRED_ACTION_FAILED rather
        // than treating the dropped write as a success. Throwing from inside
        // a LockService callback is fine, but we keep it outside for clarity.
        bailReason = new Error(
          'Storage quota exceeded while operation-log lock is held — emergency compaction skipped',
        );
        return;
      }

      const compactionSucceeded = await this.compactionService.emergencyCompact();

      if (compactionSucceeded) {
        try {
          // Set circuit breaker before retry to prevent recursive handling
          this.isHandlingQuotaExceeded = true;
          // Retry the failed operation after compaction freed space.
          // #8307 (structural): there is no longer a positional dequeue to
          // double-consume — entityChanges is recomputed by the pure, idempotent
          // extractEntityChanges() inside writeOperation, so the retry simply
          // re-extracts the same changes. Pass isDeferredWrite through unchanged.
          await this.writeOperation(action, isDeferredWrite, options);
          this.snackService.open({
            type: 'SUCCESS',
            msg: T.F.SYNC.S.STORAGE_RECOVERED_AFTER_COMPACTION,
          });
          return;
        } catch (retryErr) {
          OpLog.err('OperationLogEffects: Retry after compaction also failed', retryErr);
        } finally {
          // Always clear circuit breaker
          this.isHandlingQuotaExceeded = false;
        }
      } else {
        OpLog.err('OperationLogEffects: Emergency compaction failed');
      }

      // Compaction failed or retry failed - show error with action
      this.showStorageQuotaExceededError();
    });
    if (bailReason !== null) {
      throw bailReason;
    }
  }

  private showStorageQuotaExceededError(): void {
    const now = Date.now();
    if (now - this.lastStorageQuotaSnackAt < this.STORAGE_QUOTA_SNACK_DEDUPE_MS) {
      return;
    }
    this.lastStorageQuotaSnackAt = now;
    this.snackService.open({
      type: 'ERROR',
      msg: T.F.SYNC.S.STORAGE_QUOTA_EXCEEDED,
      actionStr: T.PS.RELOAD,
      actionFn: (): void => {
        window.location.reload();
      },
    });
  }

  /**
   * Processes actions that were buffered during sync replay.
   *
   * When users interact with the app during sync (creating tasks, marking done, etc.),
   * the meta-reducer buffers these actions instead of capturing them immediately.
   * This is because immediate capture would create operations with superseded vector clocks
   * that don't include the newly-applied remote operations.
   *
   * After sync completes, this method is called to:
   * 1. Retrieve buffered actions from the meta-reducer
   * 2. Create operations for each action with fresh vector clocks
   * 3. Persist them to IndexedDB
   *
   * The fresh vector clocks include all remote operations just applied, preventing
   * immediate conflicts when these operations are uploaded.
   *
   * Includes retry logic with exponential backoff to handle transient failures
   * (e.g., IndexedDB quota temporarily exceeded).
   *
   * Called after sync operations are applied and remote op bookkeeping is complete.
   */
  async processDeferredActions(options: WriteOperationOptions = {}): Promise<void> {
    const deferredActions = getDeferredActions();
    if (deferredActions.length === 0) {
      return;
    }

    OpLog.normal(
      `OperationLogEffects: Processing ${deferredActions.length} deferred action(s) from sync window`,
    );

    const MAX_RETRIES = 3;
    const BASE_DELAY_MS = 100;
    let failedCount = 0;

    for (const action of deferredActions) {
      let lastError: unknown;
      let success = false;

      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          // isDeferredWrite=true: deferred actions were buffered (never counted),
          // emit entityChanges: [], and keep writeOperation's throw so this retry
          // loop can react.
          await this.writeOperation(action, true, options);
          success = true;
          break;
        } catch (e) {
          lastError = e;
          if (attempt < MAX_RETRIES - 1) {
            // Exponential backoff: 100ms, 200ms, 400ms
            const delay = BASE_DELAY_MS * Math.pow(2, attempt);
            OpLog.warn(
              `OperationLogEffects: Retrying deferred action (attempt ${attempt + 1}/${MAX_RETRIES})`,
              { actionType: action.type, delay },
            );
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }
      }

      if (!success) {
        failedCount++;
        // Log error after all retries exhausted, continue processing remaining actions
        OpLog.err(
          `OperationLogEffects: Failed to process deferred action after ${MAX_RETRIES} retries`,
          { actionType: action.type, error: lastError },
        );
      }
    }

    // Show notification if any actions failed
    if (failedCount > 0) {
      this.snackService.open({
        type: 'ERROR',
        msg: T.F.SYNC.S.DEFERRED_ACTION_FAILED,
        actionStr: T.PS.RELOAD,
        actionFn: (): void => {
          window.location.reload();
        },
        config: {
          duration: 0, // Sticky - don't auto-dismiss critical errors
        },
      });
    }
  }
}

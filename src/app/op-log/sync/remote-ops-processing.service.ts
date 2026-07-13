import { inject, Injectable, Injector } from '@angular/core';
import { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import { applyRemoteOperations } from '@sp/sync-core';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import {
  ConflictResult,
  EntityConflict,
  extractFullStateFromPayload,
  FULL_STATE_OP_TYPES,
  isWrappedFullStatePayload,
  Operation,
  VectorClock,
} from '../core/operation.types';
import { OpLog } from '../../core/log';
import { OperationApplierService } from '../apply/operation-applier.service';
import { ConflictResolutionService } from './conflict-resolution.service';
import { ValidateStateService } from '../validation/validate-state.service';
import { SyncSessionValidationService } from './sync-session-validation.service';
import { VectorClockService } from './vector-clock.service';
import {
  MIN_SUPPORTED_SCHEMA_VERSION,
  SchemaMigrationService,
  getOperationSchemaVersion,
} from '../persistence/schema-migration.service';
import { SnackService } from '../../core/snack/snack.service';
import { T } from '../../t.const';
import { LOCK_NAMES } from '../core/operation-log.const';
import { LockService } from './lock.service';
import { OperationLogCompactionService } from '../persistence/operation-log-compaction.service';
import { SyncImportFilterService } from './sync-import-filter.service';
import { OperationWriteFlushService } from './operation-write-flush.service';
import { processDeferredActionsAfterRemoteApply } from './process-deferred-actions-flush.util';
import { IncompleteRemoteOperationsError } from '../core/errors/sync-errors';
import { selectSyncConfig } from '../../features/config/store/global-config.reducer';
import {
  applyLocalOnlySyncSettingsToAppData,
  LocalOnlySyncSettings,
} from '../../features/config/local-only-sync-settings.util';

/**
 * Handles the core pipeline for processing remote operations.
 *
 * Responsibilities:
 * - Schema migration (receiver-side)
 * - SYNC_IMPORT filtering
 * - Conflict detection via vector clocks
 * - Applying non-conflicting operations with crash safety
 * - State validation after sync (Checkpoint D)
 *
 * This service is used by OperationLogSyncService after downloading
 * remote operations or receiving piggybacked operations from upload.
 */
@Injectable({
  providedIn: 'root',
})
export class RemoteOpsProcessingService {
  private store = inject(Store);
  private opLogStore = inject(OperationLogStoreService);
  private operationApplier = inject(OperationApplierService);
  private conflictResolutionService = inject(ConflictResolutionService);
  private validateStateService = inject(ValidateStateService);
  private sessionValidation = inject(SyncSessionValidationService);
  private vectorClockService = inject(VectorClockService);
  private schemaMigrationService = inject(SchemaMigrationService);
  private snackService = inject(SnackService);
  private lockService = inject(LockService);
  private compactionService = inject(OperationLogCompactionService);
  private syncImportFilterService = inject(SyncImportFilterService);
  private writeFlushService = inject(OperationWriteFlushService);
  private injector = inject(Injector);

  /** Flag to show version-incompatibility warnings only once per session */
  private _hasWarnedVersionBlockThisSession = false;

  /** Flag to show migration failure warning only once per session */
  private _hasWarnedMigrationFailureThisSession = false;

  /**
   * Core pipeline for processing remote operations.
   *
   * ## Processing Steps
   * 1. **Schema Migration** - Migrate ops to current schema version
   * 2. **SYNC_IMPORT Filtering** - Discard ops invalidated by full-state imports
   * 3. **Full-State Check** - Skip conflict detection for SYNC_IMPORT/BACKUP_IMPORT
   * 4. **Conflict Detection** - Compare vector clocks with local pending ops
   * 5. **Resolution/Application**:
   *    - If conflicts: Present dialog, piggyback non-conflicting ops
   *    - If no conflicts: Apply ops directly
   * 6. **Validation** - Checkpoint D: validate and repair state
   *
   * @param remoteOps - Operations received from remote storage
   * @returns Object with processing results including filter metadata
   */
  async processRemoteOps(
    remoteOps: Operation[],
    options?: {
      skipConflictDetection?: boolean;
      callerHoldsOperationLogLock?: boolean;
    },
  ): Promise<{
    localWinOpsCreated: number;
    allOpsFilteredBySyncImport: boolean;
    filteredOpCount: number;
    filteringImport?: Operation;
    isLocalUnsyncedImport: boolean;
    blockedByIncompatibleOp: boolean;
    /**
     * Full-state operations whose application completed (or was already
     * deduplicated as applied) before this result was returned. Populated even
     * when a later incompatible op blocks the remaining batch suffix.
     */
    committedFullStateOpIds?: string[];
  }> {
    // Validation failure surfaces via the SyncSessionValidationService latch
    // (#7330). `validateAfterSync` and the conflict-resolution validation path
    // both flip the latch on failure; the sync wrapper reads it once before
    // deciding IN_SYNC vs ERROR. No need to thread the boolean through this
    // return shape.
    // ─────────────────────────────────────────────────────────────────────────
    // STEP 1: Schema Migration (Receiver-Side)
    // Migrate ops from older schema versions to current version.
    //
    // Blocking semantics: an op that cannot be terminally processed here —
    // below MIN_SUPPORTED_SCHEMA_VERSION, from a NEWER schema version (real
    // migrations rename/split fields, so a future op applied verbatim corrupts
    // state), or throwing during migration — STOPS the batch at that op. Ops
    // before the block are processed normally; the blocked op and everything
    // after are neither stored nor applied. Callers must NOT advance the
    // server cursor when `blockedByIncompatibleOp` is true, so the blocked op
    // is re-downloaded and retried after an app update / migration fix instead
    // of being skipped forever (already-processed prefix ops are deduplicated
    // by the appliedOpIds download filter). Ops migrated to `null` are an
    // intentional terminal drop and do NOT block.
    // ─────────────────────────────────────────────────────────────────────────
    const currentVersion = this.schemaMigrationService.getCurrentVersion();
    const migratedOps: Operation[] = [];
    const droppedEntityIds = new Set<string>();
    let blockReason:
      | 'VERSION_UNSUPPORTED'
      | 'VERSION_TOO_NEW'
      | 'INVALID_SCHEMA_VERSION'
      | 'MIGRATION_FAILED' = 'MIGRATION_FAILED';
    let blockedOp: Operation | null = null;

    for (const op of remoteOps) {
      let opVersion: number;
      try {
        opVersion = getOperationSchemaVersion(op as { schemaVersion?: unknown });
      } catch {
        blockedOp = op;
        blockReason = 'INVALID_SCHEMA_VERSION';
        break;
      }

      // Op below minimum supported version: no migration path exists.
      if (opVersion < MIN_SUPPORTED_SCHEMA_VERSION) {
        blockedOp = op;
        blockReason = 'VERSION_UNSUPPORTED';
        break;
      }

      // Op from a newer schema version: this client cannot interpret it safely.
      if (opVersion > currentVersion) {
        blockedOp = op;
        blockReason = 'VERSION_TOO_NEW';
        break;
      }

      try {
        const migrated = this.schemaMigrationService.migrateOperation(op);
        if (migrated === null) {
          // Track dropped entity IDs for dependency warning
          if (op.entityId) {
            droppedEntityIds.add(op.entityId);
          }
          if (op.entityIds) {
            op.entityIds.forEach((id) => droppedEntityIds.add(id));
          }
          OpLog.verbose(
            `RemoteOpsProcessingService: Dropped op ${op.id} (migrated to null)`,
          );
        } else if (Array.isArray(migrated)) {
          // Operation was split into multiple operations
          migratedOps.push(...migrated);
        } else {
          migratedOps.push(migrated);
        }
      } catch (e) {
        OpLog.err(`RemoteOpsProcessingService: Migration failed for op ${op.id}`, e);
        blockedOp = op;
        blockReason = 'MIGRATION_FAILED';
        break;
      }
    }

    if (blockedOp) {
      OpLog.err(
        `RemoteOpsProcessingService: Blocked at op ${blockedOp.id} (${blockReason}, ` +
          `schemaVersion=${blockedOp.schemaVersion ?? 1}, current=${currentVersion}). ` +
          'Processing the batch prefix only; cursor must not advance past this op.',
      );
      this._notifyBlockedOp(blockReason);
    }

    if (migratedOps.length === 0) {
      if (remoteOps.length > 0 && !blockedOp) {
        OpLog.normal(
          'RemoteOpsProcessingService: All remote ops were dropped during migration.',
        );
      }
      return {
        localWinOpsCreated: 0,
        allOpsFilteredBySyncImport: false,
        filteredOpCount: 0,
        isLocalUnsyncedImport: false,
        blockedByIncompatibleOp: blockedOp !== null,
      };
    }
    const blockedByIncompatibleOp = blockedOp !== null;

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 2: Filter ops invalidated by SYNC_IMPORT
    // When a full-state import happens, ops from OTHER clients created BEFORE the
    // import reference entities that were wiped. These must be discarded.
    // This also checks the LOCAL STORE for imports downloaded in previous sync cycles.
    // ─────────────────────────────────────────────────────────────────────────
    const { validOps, invalidatedOps, filteringImport, isLocalUnsyncedImport } =
      await this.syncImportFilterService.filterOpsInvalidatedBySyncImport(migratedOps);

    if (invalidatedOps.length > 0) {
      OpLog.warn(
        `RemoteOpsProcessingService: Discarded ${invalidatedOps.length} ops invalidated by SYNC_IMPORT. ` +
          `These ops were created before the import and reference the old state.`,
        {
          discardedOpIds: invalidatedOps.map((op) => op.id),
          discardedActionTypes: invalidatedOps.map((op) => op.actionType),
        },
      );
    }

    if (validOps.length === 0) {
      OpLog.normal(
        'RemoteOpsProcessingService: No valid ops to process after SYNC_IMPORT filtering.',
      );
      return {
        localWinOpsCreated: 0,
        allOpsFilteredBySyncImport: invalidatedOps.length > 0,
        filteredOpCount: invalidatedOps.length,
        filteringImport,
        isLocalUnsyncedImport,
        blockedByIncompatibleOp,
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 3: Check for full-state operations
    // These replace the entire state, so conflict detection doesn't apply.
    // ─────────────────────────────────────────────────────────────────────────
    const hasFullStateOp = validOps.some((op) => FULL_STATE_OP_TYPES.has(op.opType));

    if (hasFullStateOp) {
      OpLog.normal(
        'RemoteOpsProcessingService: Full-state operation detected, skipping conflict detection.',
      );
      const callerHoldsOperationLogLock = options?.callerHoldsOperationLogLock ?? false;
      const applyAndValidateWithOperationLogLockHeld = async (): Promise<string[]> => {
        const committedFullStateOpIds = await this.applyNonConflictingOps(validOps, true);

        // Clean Slate Semantics: SYNC_IMPORT/BACKUP_IMPORT replaces entire state.
        // Local synced ops are NOT replayed - the import is an explicit user action
        // to restore all clients to a specific point in time.
        await this.validateAfterSync(true);
        return committedFullStateOpIds;
      };

      // Keep the pending-write cutoff, remote-clock premerge, full-state reducer,
      // deferred capture drain, and validation in one operation-log critical
      // section. Callers already inside that section must not re-enter its
      // non-reentrant lock or flush while holding it.
      const committedFullStateOpIds = callerHoldsOperationLogLock
        ? await applyAndValidateWithOperationLogLockHeld()
        : await this.writeFlushService.flushThenRunExclusive(
            applyAndValidateWithOperationLogLockHeld,
          );

      return {
        localWinOpsCreated: 0,
        allOpsFilteredBySyncImport: false,
        filteredOpCount: 0,
        isLocalUnsyncedImport: false,
        blockedByIncompatibleOp,
        committedFullStateOpIds,
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 4: Conflict Detection
    // Compare remote ops against local pending ops using vector clocks.
    // NOTE: A client with 0 pending ops can still have an entity frontier from
    // already-synced ops. The frontier tracks ALL applied ops, not just pending.
    //
    // SKIP when skipConflictDetection is true (e.g., forceDownloadRemoteState).
    // The user has explicitly chosen to accept server state — conflict detection
    // is semantically wrong because the NgRx store was just reset to empty state,
    // causing all entities to appear missing and CONCURRENT ops to be discarded.
    // Flush is also skipped: any pending writes that slip through after
    // forceDownloadRemoteState() clears the op-log will be uploaded on the next
    // sync cycle with stale vector clocks, and the server will reject them as
    // concurrent with or older than the SYNC_IMPORT that seeded the remote state.
    // ─────────────────────────────────────────────────────────────────────────

    if (options?.skipConflictDetection) {
      OpLog.normal(
        'RemoteOpsProcessingService: Skipping conflict detection (skipConflictDetection=true). ' +
          `Applying ${validOps.length} ops directly.`,
      );
      await this.applyNonConflictingOps(
        validOps,
        options.callerHoldsOperationLogLock ?? false,
      );
      await this.validateAfterSync(options.callerHoldsOperationLogLock ?? false);
      return {
        localWinOpsCreated: 0,
        allOpsFilteredBySyncImport: false,
        filteredOpCount: 0,
        isLocalUnsyncedImport: false,
        blockedByIncompatibleOp,
      };
    }

    // CRITICAL: Flush pending operation writes before conflict detection.
    // The NgRx effect that writes operations uses concatMap for sequential processing.
    // If a user action (e.g., rename) was dispatched but the effect hasn't written it
    // to IndexedDB yet, the operation won't appear in getUnsyncedByEntity() and the
    // conflict won't be detected. This causes the remote op (e.g., moveToArchive) to
    // be applied as non-conflicting, and the local op gets uploaded later — potentially
    // resurrecting archived entities via LWW Update (Bug B).
    await this.writeFlushService.flushPendingWrites();

    // Acquire the same lock used by writeOperation effects.
    // This ensures no NEW writes can start while we read the frontier,
    // detect conflicts, AND apply resolutions.
    let localWinOpsCreated = 0;
    await this.lockService.request(LOCK_NAMES.OPERATION_LOG, async () => {
      const appliedFrontierByEntity = await this.vectorClockService.getEntityFrontier();
      const conflictResult = await this.detectConflicts(
        validOps,
        appliedFrontierByEntity,
      );
      const { nonConflicting, conflicts } = conflictResult;

      // ─────────────────────────────────────────────────────────────────────────
      // STEP 5: Handle Results - Auto-Resolve Conflicts with LWW
      // IMPORTANT: If conflicts exist, we must NOT apply non-conflicting ops first.
      // They may depend on entities in the conflict (e.g., Task depends on Project).
      // Instead, piggyback them to ConflictResolutionService for batched application.
      // ─────────────────────────────────────────────────────────────────────────
      if (conflicts.length > 0) {
        OpLog.warn(
          `RemoteOpsProcessingService: Detected ${conflicts.length} conflicts. Auto-resolving with LWW.`,
          {
            conflicts: conflicts.map((conflict) => ({
              entityType: conflict.entityType,
              entityId: conflict.entityId,
              localOpIds: conflict.localOps.map((op) => op.id),
              remoteOpIds: conflict.remoteOps.map((op) => op.id),
              suggestedResolution: conflict.suggestedResolution,
            })),
          },
        );
        // Auto-resolve conflicts using Last-Write-Wins strategy.
        // Piggyback non-conflicting ops so they're applied with resolved conflicts.
        // Validation failure is surfaced via the session-validation latch.
        const lwwResult = await this.conflictResolutionService.autoResolveConflictsLWW(
          conflicts,
          nonConflicting,
          { callerHoldsOperationLogLock: true },
        );
        localWinOpsCreated = lwwResult.localWinOpsCreated;
        return;
      }

      // ─────────────────────────────────────────────────────────────────────────
      // STEP 6: No Conflicts - Apply directly and validate
      // ─────────────────────────────────────────────────────────────────────────
      if (nonConflicting.length > 0) {
        await this.applyNonConflictingOps(nonConflicting, true);
        await this.validateAfterSync(true); // Inside sp_op_log lock
      }
    });
    return {
      localWinOpsCreated,
      allOpsFilteredBySyncImport: false,
      filteredOpCount: 0,
      isLocalUnsyncedImport: false,
      blockedByIncompatibleOp,
    };
  }

  /**
   * User notification for a version/migration block, once per session per
   * category to avoid snack spam from periodic sync retries (the block persists
   * until an app update or migration fix, and every retry re-hits it).
   */
  private _notifyBlockedOp(
    reason:
      | 'VERSION_UNSUPPORTED'
      | 'VERSION_TOO_NEW'
      | 'INVALID_SCHEMA_VERSION'
      | 'MIGRATION_FAILED',
  ): void {
    if (this.snackService.hasPendingPersistentAction()) {
      // Never replace a visible persistent recovery action (e.g. the USE_REMOTE
      // Undo — the only entry point to the pre-replace backup). The block
      // persists, so the latch stays unset and a later retry re-warns.
      return;
    }
    if (reason === 'MIGRATION_FAILED' || reason === 'INVALID_SCHEMA_VERSION') {
      if (!this._hasWarnedMigrationFailureThisSession) {
        this._hasWarnedMigrationFailureThisSession = true;
        this.snackService.open({
          type: 'ERROR',
          msg: T.F.SYNC.S.MIGRATION_FAILED,
        });
      }
      return;
    }
    if (!this._hasWarnedVersionBlockThisSession) {
      this._hasWarnedVersionBlockThisSession = true;
      if (reason === 'VERSION_UNSUPPORTED') {
        // Below-minimum data: updating THIS device cannot help, so no
        // download action — the fix lives on the device that produced it.
        this.snackService.open({
          type: 'ERROR',
          msg: T.F.SYNC.S.VERSION_UNSUPPORTED,
        });
      } else {
        this.snackService.open({
          type: 'ERROR',
          msg: T.F.SYNC.S.VERSION_TOO_OLD,
          actionStr: T.PS.UPDATE_APP,
          actionFn: () =>
            window.open('https://super-productivity.com/download', '_blank'),
        });
      }
    }
  }

  /**
   * Applies non-conflicting operations with crash-safe tracking.
   *
   * ## Crash Safety Protocol
   * 1. Store ops with `pendingApply: true` flag
   * 2. Apply ops to NgRx store
   * 3. Mark ops as applied (removes pendingApply flag)
   *
   * If crash occurs between steps 1-2, ops will be retried on startup.
   * If crash occurs between steps 2-3, ops may be re-applied (idempotent).
   *
   * @param ops - Non-conflicting operations to apply
   * @param callerHoldsLock - If true, deferred local actions reuse the caller's
   *        sp_op_log lock after remote clocks are merged.
   * @throws Re-throws if application fails (ops marked as failed first)
   */
  async applyNonConflictingOps(
    ops: Operation[],
    callerHoldsLock: boolean = false,
  ): Promise<string[]> {
    const locallyReplayableOps =
      await this._withLocalOnlySyncSettingsForFullStateOps(ops);

    await this._logFullStateApplyDiagnostics(locallyReplayableOps);

    // Mirror autoResolveConflictsLWW: once the incoming remote clocks are
    // durable, flush deferred local actions even if reducer dispatch or later
    // apply bookkeeping throws. A failed pre-apply clock merge never starts
    // the reducer/deferred-action window. (#7700)
    let canDrainDeferredActions = false;
    let hasPrimaryError = false;
    let committedFullStateOpIds: string[] = [];
    try {
      // Core owns the generic crash-safety ordering. Angular diagnostics,
      // validation, and user notifications stay in this service.
      const result = await applyRemoteOperations({
        ops: locallyReplayableOps,
        store: this.opLogStore,
        applier: {
          applyOperations: (opsToApply, applyOptions) =>
            this.operationApplier.applyOperations(opsToApply, {
              skipDeferredLocalActions: true,
              onReducersCommitted: applyOptions?.onReducersCommitted,
            }),
        },
        isFullStateOperation: this._isFullStateOperation,
        // The core invokes this before reducer application starts, after the
        // incoming clock frontier is durable. Any subsequent failure can safely
        // drain actions buffered by the reducer window.
        onRemoteClocksDurable: () => {
          canDrainDeferredActions = true;
        },
      });

      committedFullStateOpIds = result.appliedOps
        .filter((op) => FULL_STATE_OP_TYPES.has(op.opType))
        .map((op) => op.id);

      if (result.skippedCount > 0) {
        OpLog.verbose(
          `RemoteOpsProcessingService: Skipping ${result.skippedCount} duplicate op(s)`,
        );
      }

      if (result.clearedFullStateOpCount > 0) {
        OpLog.normal(
          `RemoteOpsProcessingService: Cleared ${result.clearedFullStateOpCount} old full-state op(s) after applying new one.`,
        );
      }

      if (result.appliedSeqs.length > 0) {
        OpLog.normal(
          `RemoteOpsProcessingService: Applied and marked ${result.appliedSeqs.length} remote ops`,
        );
      }

      // Handle partial failure
      if (result.failedOp) {
        OpLog.err(
          `RemoteOpsProcessingService: ${result.appliedOps.length} ops applied before failure. ` +
            `Marking ${result.failedOpIds.length} ops as failed.`,
          result.failedOp.error,
        );

        await this._validateAndFlagSession(
          'partial-apply-failure',
          callerHoldsLock,
          'RemoteOpsProcessingService: State validation failed after partial apply failure',
        );

        this.snackService.open({
          type: 'ERROR',
          msg: T.F.SYNC.S.PARTIAL_APPLY_FAILURE,
        });

        // The deferred-actions flush in the finally below runs before the
        // throw propagates.
        throw new IncompleteRemoteOperationsError(result.failedOp.error);
      }
    } catch (error) {
      hasPrimaryError = true;
      throw error;
    } finally {
      if (canDrainDeferredActions) {
        try {
          await processDeferredActionsAfterRemoteApply(this.injector, callerHoldsLock);
        } catch (deferredError) {
          if (!hasPrimaryError) {
            throw deferredError;
          }
          OpLog.err(
            'RemoteOpsProcessingService: Deferred-action drain also failed after the primary remote-apply error',
            { name: (deferredError as Error | undefined)?.name },
          );
        }
      }
    }
    return committedFullStateOpIds;
  }

  private async _withLocalOnlySyncSettingsForFullStateOps(
    ops: Operation[],
  ): Promise<Operation[]> {
    const hasFullStateOp = ops.some((op) => this._isFullStateOperation(op));
    if (!hasFullStateOp) {
      return ops;
    }

    const currentSyncConfig = await firstValueFrom(this.store.select(selectSyncConfig));
    const localOnlySettings: LocalOnlySyncSettings = {
      isEnabled: currentSyncConfig.isEnabled,
      isEncryptionEnabled: currentSyncConfig.isEncryptionEnabled,
      syncProvider: currentSyncConfig.syncProvider,
      syncInterval: currentSyncConfig.syncInterval,
      isManualSyncOnly: currentSyncConfig.isManualSyncOnly,
    };

    return ops.map((op) => {
      if (!this._isFullStateOperation(op)) {
        return op;
      }

      const fullState = extractFullStateFromPayload(op.payload);
      const localReplayPayload = applyLocalOnlySyncSettingsToAppData(
        fullState,
        localOnlySettings,
      );
      if (localReplayPayload === fullState) {
        return op;
      }

      return {
        ...op,
        payload: isWrappedFullStatePayload(op.payload)
          ? { ...op.payload, appDataComplete: localReplayPayload }
          : localReplayPayload,
      };
    });
  }

  private _isFullStateOperation(op: Operation): boolean {
    return FULL_STATE_OP_TYPES.has(op.opType);
  }

  /**
   * Logs receiver state before full-state remote ops land. This diagnostic is
   * app-side because it reads SP's operation store and uses exportable app logs.
   */
  private async _logFullStateApplyDiagnostics(ops: Operation[]): Promise<void> {
    const fullStateOps = ops.filter(this._isFullStateOperation);
    if (fullStateOps.length === 0) {
      return;
    }

    // Snapshot the receiver's prior clock and unsynced-op tally before the
    // batch lands. After append, the receiver's state advances and we can no
    // longer reconstruct what was about to be wiped. Captures both the prior
    // vector clock (whose entries the SYNC_IMPORT will collapse) and the
    // count of local unsynced user work that the SyncImportFilter will then
    // discard — that count answers the "post-import edits failed to upload
    // vs. dropped by the filter" question on the next incident.
    const priorClock = await this.opLogStore.getVectorClock();
    const priorUnsynced = await this.opLogStore.getUnsynced();
    const priorUnsyncedByOpType = priorUnsynced.reduce<Record<string, number>>(
      (acc, entry) => {
        const key = entry.op.opType;
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      },
      {},
    );
    OpLog.log(
      `RemoteOpsProcessingService: APPLYING FULL-STATE OP(s): ${fullStateOps.map((op) => `${op.opType} from ${op.clientId}`).join(', ')}`,
      {
        incoming: fullStateOps.map((op) => ({
          opType: op.opType,
          clientId: op.clientId,
          syncImportReason: op.syncImportReason ?? null,
          vectorClock: op.vectorClock,
        })),
        priorClock: priorClock ?? null,
        priorClockSize: priorClock ? Object.keys(priorClock).length : 0,
        priorUnsyncedCount: priorUnsynced.length,
        priorUnsyncedByOpType,
      },
    );
  }

  /**
   * Detects conflicts between remote operations and local pending operations.
   *
   * ## How It Works
   * For each remote op, we compare its vector clock against the local "frontier"
   * (merged clock of all applied + pending ops for that entity).
   *
   * ## Vector Clock Comparison Results
   * | Result       | Meaning                        | Action                    |
   * |--------------|--------------------------------|---------------------------|
   * | LESS_THAN    | Remote is newer                | Apply (non-conflicting)   |
   * | GREATER_THAN | Local is newer (remote superseded) | Skip remote op       |
   * | EQUAL        | Same op (duplicate)            | Skip remote op            |
   * | CONCURRENT   | True conflict                  | Add to conflicts list     |
   *
   * ## Fast Path Optimization
   * If an entity has no local PENDING ops, there's no conflict possible.
   * Conflicts require concurrent modifications from both sides.
   *
   * @param remoteOps - Remote operations to check for conflicts
   * @param appliedFrontierByEntity - Per-entity vector clocks of applied ops
   * @returns Object with `nonConflicting` ops to apply and `conflicts` to resolve
   */
  async detectConflicts(
    remoteOps: Operation[],
    appliedFrontierByEntity: Map<string, VectorClock>,
  ): Promise<ConflictResult> {
    const localPendingOpsByEntity = await this.opLogStore.getUnsyncedByEntity();
    const conflicts: EntityConflict[] = [];
    const nonConflicting: Operation[] = [];

    // Get the snapshot vector clock as a fallback for entities not in the frontier map
    const snapshotVectorClock = await this.vectorClockService.getSnapshotVectorClock();
    const hasNoSnapshotClock =
      !snapshotVectorClock || Object.keys(snapshotVectorClock).length === 0;

    // Get snapshot entity keys to distinguish entities that existed at compaction time
    const snapshotEntityKeys = await this.vectorClockService.getSnapshotEntityKeys();

    // Handle old snapshot format migration
    this._handleOldSnapshotFormat(snapshotEntityKeys);

    // PERF: Process in batches and yield to event loop to prevent UI hangs
    const CONFLICT_CHECK_BATCH_SIZE = 100;
    for (let i = 0; i < remoteOps.length; i++) {
      const remoteOp = remoteOps[i];
      const result = await this.conflictResolutionService.checkOpForConflicts(remoteOp, {
        localPendingOpsByEntity,
        appliedFrontierByEntity,
        snapshotVectorClock,
        snapshotEntityKeys,
        hasNoSnapshotClock,
      });

      if (result.conflict) {
        conflicts.push(result.conflict);
      } else if (!result.isSupersededOrDuplicate) {
        nonConflicting.push(remoteOp);
      }

      // Yield to event loop after each batch to keep UI responsive
      if ((i + 1) % CONFLICT_CHECK_BATCH_SIZE === 0 && i + 1 < remoteOps.length) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    return { nonConflicting, conflicts };
  }

  /**
   * Handles old snapshot format by triggering compaction asynchronously.
   */
  private _handleOldSnapshotFormat(snapshotEntityKeys: Set<string> | undefined): void {
    if (snapshotEntityKeys === undefined) {
      OpLog.warn(
        'RemoteOpsProcessingService: Old snapshot format detected - missing snapshotEntityKeys. Triggering compaction.',
      );
      this.compactionService.compact().catch((err) => {
        OpLog.err('RemoteOpsProcessingService: Failed to compact old snapshot', err);
      });
    }
  }

  /**
   * CHECKPOINT D: Validates state after applying remote operations.
   * If validation fails, attempts repair and creates a REPAIR operation.
   *
   * @param callerHoldsLock - If true, skip lock acquisition in repair operation.
   *        Pass true when calling from within the sp_op_log lock.
   * @returns `true` if state is valid (or was successfully repaired), `false`
   *          otherwise. On failure the SyncSessionValidationService latch is
   *          flipped so the wrapper can refuse to claim IN_SYNC (#7330).
   */
  async validateAfterSync(callerHoldsLock: boolean = false): Promise<boolean> {
    return await this._validateAndFlagSession(
      'sync',
      callerHoldsLock,
      'RemoteOpsProcessingService: State validation failed after sync',
      T.F.SYNC.S.SYNC_VALIDATION_FAILED,
    );
  }

  private async _validateAndFlagSession(
    context: 'sync' | 'partial-apply-failure',
    callerHoldsLock: boolean,
    errorMessage: string,
    snackMessage?: string,
  ): Promise<boolean> {
    const isValid = await this.validateStateService.validateAndRepairCurrentState(
      context,
      { callerHoldsLock },
    );
    if (!isValid) {
      OpLog.err(errorMessage);
      this.sessionValidation.setFailed();
      if (snackMessage) {
        this.snackService.open({
          type: 'ERROR',
          msg: snackMessage,
        });
      }
    }
    return isValid;
  }
}

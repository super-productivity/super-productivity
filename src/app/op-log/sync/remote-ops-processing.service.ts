import { inject, Injectable } from '@angular/core';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import {
  ConflictResult,
  EntityConflict,
  Operation,
  OpType,
  VectorClock,
} from '../core/operation.types';
import { OpLog } from '../../core/log';
import { OperationApplierService } from '../apply/operation-applier.service';
import { ConflictResolutionService } from './conflict-resolution.service';
import { ValidateStateService } from '../validation/validate-state.service';
import { VectorClockService } from './vector-clock.service';
import {
  MAX_VERSION_SKIP,
  MIN_SUPPORTED_SCHEMA_VERSION,
  SchemaMigrationService,
} from '../persistence/schema-migration.service';
import { SnackService } from '../../core/snack/snack.service';
import { T } from '../../t.const';
import { LOCK_NAMES } from '../core/operation-log.const';
import { LockService } from './lock.service';
import { OperationLogCompactionService } from '../persistence/operation-log-compaction.service';
import { SyncImportFilterService } from './sync-import-filter.service';

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
  private opLogStore = inject(OperationLogStoreService);
  private operationApplier = inject(OperationApplierService);
  private conflictResolutionService = inject(ConflictResolutionService);
  private validateStateService = inject(ValidateStateService);
  private vectorClockService = inject(VectorClockService);
  private schemaMigrationService = inject(SchemaMigrationService);
  private snackService = inject(SnackService);
  private lockService = inject(LockService);
  private compactionService = inject(OperationLogCompactionService);
  private syncImportFilterService = inject(SyncImportFilterService);

  /** Flag to show newer version warning only once per session */
  private _hasWarnedNewerVersionThisSession = false;

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
    options?: { skipConflictDetection?: boolean },
  ): Promise<{
    localWinOpsCreated: number;
    allOpsFilteredBySyncImport: boolean;
    filteredOpCount: number;
    filteringImport?: Operation;
    isLocalUnsyncedImport: boolean;
  }> {
    // ─────────────────────────────────────────────────────────────────────────
    // STEP 1: Schema Migration (Receiver-Side)
    // Migrate ops from older schema versions to current version.
    // - Ops below MIN_SUPPORTED_SCHEMA_VERSION: error, stop sync
    // - Ops beyond MAX_VERSION_SKIP: error, stop sync
    // - Ops from newer version (within skip): warning once per session, continue
    // ─────────────────────────────────────────────────────────────────────────
    const currentVersion = this.schemaMigrationService.getCurrentVersion();
    const migratedOps: Operation[] = [];
    const droppedEntityIds = new Set<string>();
    let updateRequired = false;

    for (const op of remoteOps) {
      const opVersion = op.schemaVersion ?? 1;

      // Check if remote op is too old (below minimum supported)
      if (opVersion < MIN_SUPPORTED_SCHEMA_VERSION) {
        this.snackService.open({
          type: 'ERROR',
          msg: T.F.SYNC.S.VERSION_UNSUPPORTED,
          actionStr: T.PS.UPDATE_APP,
          actionFn: () =>
            window.open('https://super-productivity.com/download', '_blank'),
        });
        return {
          localWinOpsCreated: 0,
          allOpsFilteredBySyncImport: false,
          filteredOpCount: 0,
          isLocalUnsyncedImport: false,
        };
      }

      // Check if remote op is too new (exceeds supported skip)
      if (opVersion > currentVersion + MAX_VERSION_SKIP) {
        updateRequired = true;
        break;
      }

      // Warn once per session if receiving ops from a newer version
      if (opVersion > currentVersion && !this._hasWarnedNewerVersionThisSession) {
        this._hasWarnedNewerVersionThisSession = true;
        this.snackService.open({
          type: 'WARNING',
          msg: T.F.SYNC.S.NEWER_VERSION_AVAILABLE,
          actionStr: T.PS.UPDATE_APP,
          actionFn: () =>
            window.open('https://super-productivity.com/download', '_blank'),
        });
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
        // We skip ops that fail migration, but if they are from a compatible version,
        // this indicates a bug or data corruption.
      }
    }

    if (updateRequired) {
      this.snackService.open({
        type: 'ERROR',
        msg: T.F.SYNC.S.VERSION_TOO_OLD,
        actionStr: T.PS.UPDATE_APP,
        actionFn: () => window.open('https://super-productivity.com/download', '_blank'),
      });
      return {
        localWinOpsCreated: 0,
        allOpsFilteredBySyncImport: false,
        filteredOpCount: 0,
        isLocalUnsyncedImport: false,
      };
    }

    if (migratedOps.length === 0) {
      if (remoteOps.length > 0) {
        OpLog.normal(
          'RemoteOpsProcessingService: All remote ops were dropped during migration.',
        );
      }
      return {
        localWinOpsCreated: 0,
        allOpsFilteredBySyncImport: false,
        filteredOpCount: 0,
        isLocalUnsyncedImport: false,
      };
    }

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
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 3: Check for full-state operations (SYNC_IMPORT / BACKUP_IMPORT)
    // These replace the entire state, so conflict detection doesn't apply.
    // ─────────────────────────────────────────────────────────────────────────
    const hasFullStateOp = validOps.some(
      (op) => op.opType === OpType.SyncImport || op.opType === OpType.BackupImport,
    );

    if (hasFullStateOp) {
      OpLog.normal(
        'RemoteOpsProcessingService: Full-state operation detected, skipping conflict detection.',
      );
      await this.applyNonConflictingOps(validOps);

      // Clean Slate Semantics: SYNC_IMPORT/BACKUP_IMPORT replaces entire state.
      // Local synced ops are NOT replayed - the import is an explicit user action
      // to restore all clients to a specific point in time.

      await this.validateAfterSync();
      return {
        localWinOpsCreated: 0,
        allOpsFilteredBySyncImport: false,
        filteredOpCount: 0,
        isLocalUnsyncedImport: false,
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
    // ─────────────────────────────────────────────────────────────────────────

    if (options?.skipConflictDetection) {
      OpLog.normal(
        'RemoteOpsProcessingService: Skipping conflict detection (skipConflictDetection=true). ' +
          `Applying ${validOps.length} ops directly.`,
      );
      await this.applyNonConflictingOps(validOps);
      await this.validateAfterSync();
      return {
        localWinOpsCreated: 0,
        allOpsFilteredBySyncImport: false,
        filteredOpCount: 0,
        isLocalUnsyncedImport: false,
      };
    }

    // CRITICAL: Acquire the same lock used by writeOperation effects.
    // This ensures:
    // 1. All pending writes complete before we read (FIFO lock ordering)
    // 2. No NEW writes can start while we read the frontier, detect conflicts, AND apply resolutions
    // Without this, a race condition exists where a write could start after
    // reading the frontier but before conflict resolution/application completes,
    // causing the new write to be based on stale state.
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
          conflicts,
        );
        // Auto-resolve conflicts using Last-Write-Wins strategy
        // Piggyback non-conflicting ops so they're applied with resolved conflicts
        const lwwResult = await this.conflictResolutionService.autoResolveConflictsLWW(
          conflicts,
          nonConflicting,
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
    };
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
   * @param callerHoldsLock - If true, skip lock acquisition in repair operation.
   *        Pass true when calling from within the sp_op_log lock.
   * @throws Re-throws if application fails (ops marked as failed first)
   */
  async applyNonConflictingOps(
    ops: Operation[],
    callerHoldsLock: boolean = false,
  ): Promise<void> {
    // Map op ID to seq for marking partial success
    const opIdToSeq = new Map<string, number>();

    // Atomically filter and append ops in a single transaction (issue #6343).
    // This eliminates the TOCTOU race between filterNewOps() and appendBatch()
    // that caused persistent "Duplicate operation detected" errors.
    const opsToApply = await this._filterAndAppendOps(ops, opIdToSeq);

    // Apply only NON-duplicate ops to NgRx store
    if (opsToApply.length > 0) {
      const result = await this.operationApplier.applyOperations(opsToApply);

      // Mark successfully applied ops
      const appliedSeqs = result.appliedOps
        .map((op) => opIdToSeq.get(op.id))
        .filter((seq): seq is number => seq !== undefined);

      if (appliedSeqs.length > 0) {
        await this.opLogStore.markApplied(appliedSeqs);

        // CRITICAL: Merge remote ops' vector clocks into local clock.
        // This ensures subsequent local operations have clocks that "dominate"
        // the remote ops (GREATER_THAN instead of CONCURRENT).
        // Without this, ops created after a SYNC_IMPORT would be incorrectly
        // filtered by SyncImportFilterService as "invalidated by import".
        await this.opLogStore.mergeRemoteOpClocks(result.appliedOps);

        // CRITICAL: Update protected client IDs for vector clock pruning.
        // When a full-state op is applied, its client ID must be preserved in future
        // vector clocks. Otherwise, pruning could remove it (if it has a low counter),
        // causing new ops to appear CONCURRENT instead of GREATER_THAN with the import.
        const appliedFullStateOp = result.appliedOps.find(
          (op) =>
            op.opType === OpType.SyncImport ||
            op.opType === OpType.BackupImport ||
            op.opType === OpType.Repair,
        );
        if (appliedFullStateOp) {
          // CRITICAL FIX: Protect ALL client IDs in the import's vector clock, not just
          // the import's own clientId. The import's vectorClock contains merged clocks
          // from all clients at import time. If any of these are pruned from the local
          // clock, new ops will appear CONCURRENT with the import instead of GREATER_THAN.
          //
          // Example: Import has {A_EemJ:1, B_HSxu:10342}. If we only protect B_HSxu,
          // then A_EemJ gets pruned. New ops have {A_ypDK:6, B_HSxu:10714} (missing A_EemJ).
          // Comparison: Import wins on A_EemJ (1>0), op wins on A_ypDK (6>0) → CONCURRENT!
          const protectedIds = Object.keys(appliedFullStateOp.vectorClock);
          await this.opLogStore.setProtectedClientIds(protectedIds);
          OpLog.normal(
            `RemoteOpsProcessingService: Updated protected client IDs from ${appliedFullStateOp.opType}: [${protectedIds.join(', ')}]`,
          );

          // CRITICAL FIX: Clear older full-state ops AFTER successfully storing the new one.
          // This prevents the scenario where:
          // 1. Client A has old SYNC_IMPORT from client X with minimal clock {X:1}
          // 2. Client B uploads new SYNC_IMPORT with its own minimal clock
          // 3. Client A downloads and stores B's SYNC_IMPORT
          // 4. Without clearing, getLatestFullStateOpEntry might return X's old import
          //    (if it has a higher UUIDv7 timestamp)
          // 5. New operations appear CONCURRENT with X's import and get filtered
          //
          // We clear AFTER storing (not before) to ensure crash safety.
          // We exclude the newly stored full-state op IDs so we don't delete what we just added.
          const newFullStateOpIds = result.appliedOps
            .filter(
              (op) =>
                op.opType === OpType.SyncImport ||
                op.opType === OpType.BackupImport ||
                op.opType === OpType.Repair,
            )
            .map((op) => op.id);
          const clearedCount =
            await this.opLogStore.clearFullStateOpsExcept(newFullStateOpIds);
          if (clearedCount > 0) {
            OpLog.normal(
              `RemoteOpsProcessingService: Cleared ${clearedCount} old full-state op(s) after applying new one.`,
            );
          }
        }

        OpLog.normal(
          `RemoteOpsProcessingService: Applied and marked ${appliedSeqs.length} remote ops`,
        );
      }

      // Handle partial failure
      if (result.failedOp) {
        // Find all ops that weren't applied (failed op + remaining ops)
        const failedOpIndex = opsToApply.findIndex(
          (op) => op.id === result.failedOp!.op.id,
        );
        const failedOps = opsToApply.slice(failedOpIndex);
        const failedOpIds = failedOps.map((op) => op.id);

        OpLog.err(
          `RemoteOpsProcessingService: ${result.appliedOps.length} ops applied before failure. ` +
            `Marking ${failedOpIds.length} ops as failed.`,
          result.failedOp.error,
        );
        await this.opLogStore.markFailed(failedOpIds);

        // Run validation after partial failure to detect/repair any state inconsistencies
        await this.validateStateService.validateAndRepairCurrentState(
          'partial-apply-failure',
          { callerHoldsLock },
        );

        this.snackService.open({
          type: 'ERROR',
          msg: T.F.SYNC.S.PARTIAL_APPLY_FAILURE,
        });

        // Re-throw if it's a SyncStateCorruptedError, otherwise wrap it
        throw result.failedOp.error;
      }
    }
  }

  /**
   * Atomically filters out already-applied ops and appends new ones to the store.
   * Uses appendBatchSkipDuplicates() to check and insert within a single IndexedDB
   * transaction, eliminating the TOCTOU race condition (issue #6343).
   *
   * @param ops - Operations to filter and potentially append
   * @param opIdToSeq - Map to populate with op ID -> sequence number mappings
   * @returns The operations that were actually appended (after filtering)
   */
  private async _filterAndAppendOps(
    ops: Operation[],
    opIdToSeq: Map<string, number>,
  ): Promise<Operation[]> {
    // DIAGNOSTIC: Check if any full-state ops will be applied
    const fullStateOps = ops.filter(
      (op) =>
        op.opType === OpType.SyncImport ||
        op.opType === OpType.BackupImport ||
        op.opType === OpType.Repair,
    );
    if (fullStateOps.length > 0) {
      OpLog.log(
        `RemoteOpsProcessingService: APPLYING FULL-STATE OP(s): ${fullStateOps.map((op) => `${op.opType} from ${op.clientId}`).join(', ')}`,
      );
    }

    // Atomically check-and-insert within a single transaction (issue #6343).
    // Duplicates are silently skipped rather than causing ConstraintError.
    const result = await this.opLogStore.appendBatchSkipDuplicates(ops, 'remote', {
      pendingApply: true,
    });

    if (result.skippedCount > 0) {
      OpLog.verbose(
        `RemoteOpsProcessingService: Skipping ${result.skippedCount} duplicate op(s)`,
      );
    }

    result.writtenOps.forEach((op, i) => opIdToSeq.set(op.id, result.seqs[i]));
    return result.writtenOps;
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
   */
  async validateAfterSync(callerHoldsLock: boolean = false): Promise<void> {
    await this.validateStateService.validateAndRepairCurrentState('sync', {
      callerHoldsLock,
    });
  }
}

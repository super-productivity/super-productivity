import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { OperationLogStoreService } from './operation-log-store.service';
import { loadAllData } from '../../root-store/meta/load-all-data.action';
import { OperationLogMigrationService } from './operation-log-migration.service';
import {
  CURRENT_SCHEMA_VERSION,
  SchemaMigrationService,
} from './schema-migration.service';
import { OperationLogSnapshotService } from './operation-log-snapshot.service';
import { OperationLogRecoveryService } from './operation-log-recovery.service';
import { SyncHydrationService } from './sync-hydration.service';
import { ArchiveMigrationService } from './archive-migration.service';
import { OpLog } from '../../core/log';
import { StateSnapshotService, AppStateSnapshot } from '../backup/state-snapshot.service';
import { Operation, OpType, RepairPayload } from '../core/operation.types';
import { SnackService } from '../../core/snack/snack.service';
import { T } from '../../t.const';
import { IndexedDBOpenError } from '../core/errors/indexed-db-open.error';
import { alertDialog } from '../../util/native-dialogs';
import { ValidateStateService } from '../validation/validate-state.service';
import { OperationApplierService } from '../apply/operation-applier.service';
import { HydrationStateService } from '../apply/hydration-state.service';
import { bulkApplyOperations } from '../apply/bulk-hydration.action';
import { VectorClockService } from '../sync/vector-clock.service';
import { MAX_CONFLICT_RETRY_ATTEMPTS } from '../core/operation-log.const';

/**
 * Handles the hydration (loading) of the application state from the operation log
 * during application startup. It first attempts to load a saved state snapshot,
 * and then replays any subsequent operations from the log to bring the application
 * state up to date. This approach optimizes startup performance by avoiding a full
 * replay of all historical operations.
 */
@Injectable({ providedIn: 'root' })
export class OperationLogHydratorService {
  private store = inject(Store);
  private opLogStore = inject(OperationLogStoreService);
  private migrationService = inject(OperationLogMigrationService);
  private schemaMigrationService = inject(SchemaMigrationService);
  private stateSnapshotService = inject(StateSnapshotService);
  private snackService = inject(SnackService);
  private validateStateService = inject(ValidateStateService);
  private vectorClockService = inject(VectorClockService);
  private operationApplierService = inject(OperationApplierService);
  private hydrationStateService = inject(HydrationStateService);

  // Extracted services
  private snapshotService = inject(OperationLogSnapshotService);
  private recoveryService = inject(OperationLogRecoveryService);
  private syncHydrationService = inject(SyncHydrationService);
  private archiveMigrationService = inject(ArchiveMigrationService);

  // Mutex to prevent concurrent repair operations and re-validation during repair
  private _repairMutex: Promise<void> | null = null;

  // Track if schema migration ran during this hydration (requires validation)
  private _migrationRanDuringHydration = false;

  /**
   * Finds the LAST full-state operation in an array and sets its client ID as protected.
   * Uses reverse search because if multiple full-state ops exist, only the latest matters.
   *
   * This is critical for vector clock pruning: the SYNC_IMPORT client ID must be preserved
   * in future vector clocks, otherwise pruning could remove it (if it has a low counter),
   * causing new ops to appear CONCURRENT instead of GREATER_THAN with the import.
   */
  private async _setProtectedClientIdFromOps(ops: Operation[]): Promise<void> {
    // Find LAST full-state op (not first) - if multiple imports exist, latest wins
    for (let i = ops.length - 1; i >= 0; i--) {
      const op = ops[i];
      if (
        op.opType === OpType.SyncImport ||
        op.opType === OpType.BackupImport ||
        op.opType === OpType.Repair
      ) {
        // Protect ALL client IDs in the import's vector clock, not just the import's clientId.
        // See RemoteOpsProcessingService.applyNonConflictingOps for detailed explanation.
        const protectedIds = Object.keys(op.vectorClock);
        await this.opLogStore.setProtectedClientIds(protectedIds);
        OpLog.normal(
          `OperationLogHydratorService: Set protected client IDs from ${op.opType}: [${protectedIds.join(', ')}]`,
        );
        return;
      }
    }
  }

  /**
   * MIGRATION: Ensures protectedClientIds contains ALL vector clock keys from the stored SYNC_IMPORT.
   *
   * This handles two cases:
   * 1. SYNC_IMPORT was processed with old code that didn't set protectedClientIds at all
   * 2. SYNC_IMPORT was processed with buggy code that only set the import's clientId,
   *    not ALL keys in its vectorClock (the bug we fixed)
   *
   * Without this migration:
   * 1. Vector clock pruning would remove import's vectorClock entries (like A_EemJ)
   * 2. New ops would have clocks missing those entries
   * 3. Those ops would appear CONCURRENT with the import instead of GREATER_THAN
   * 4. SyncImportFilterService would incorrectly filter them as "invalidated"
   *
   * This runs early in hydration, BEFORE any new operations are created.
   */
  private async _migrateProtectedClientIdsIfNeeded(): Promise<void> {
    // Look for the latest full-state op in the entire ops log
    const latestFullStateOp = await this.opLogStore.getLatestFullStateOp();
    if (!latestFullStateOp) {
      OpLog.normal(
        'OperationLogHydratorService: No full-state op found in ops log, no migration needed',
      );
      return;
    }

    // Get all client IDs that SHOULD be protected (all keys in the import's vectorClock)
    const requiredProtectedIds = Object.keys(latestFullStateOp.vectorClock);

    // Check if protectedClientIds is already correctly set
    const existingProtectedIds = await this.opLogStore.getProtectedClientIds();
    const existingSet = new Set(existingProtectedIds);

    // Check if all required IDs are already protected
    const allProtected = requiredProtectedIds.every((id) => existingSet.has(id));

    if (allProtected && existingProtectedIds.length > 0) {
      OpLog.normal(
        `OperationLogHydratorService: Protected client IDs already set: [${existingProtectedIds.join(', ')}]`,
      );
      return;
    }

    // MIGRATION: Some required IDs are missing - update to include ALL vectorClock keys
    // This handles the bug where only the import's clientId was protected, not all vectorClock keys
    const missingIds = requiredProtectedIds.filter((id) => !existingSet.has(id));
    if (missingIds.length > 0) {
      OpLog.warn(
        `OperationLogHydratorService: MIGRATION - Missing protected IDs detected: [${missingIds.join(', ')}]`,
      );
    }

    // CRITICAL: Also merge the SYNC_IMPORT's vectorClock into the local clock.
    // The missing entries (like A_EemJ) may have been pruned from the local clock already.
    // Without this, new ops would still be missing these entries even after setting protectedClientIds.
    await this.opLogStore.mergeRemoteOpClocks([latestFullStateOp]);
    OpLog.normal(
      `OperationLogHydratorService: MIGRATION - Merged SYNC_IMPORT vectorClock into local clock`,
    );

    await this.opLogStore.setProtectedClientIds(requiredProtectedIds);
    OpLog.normal(
      `OperationLogHydratorService: MIGRATION - Set protected client IDs from ${latestFullStateOp.opType}: [${requiredProtectedIds.join(', ')}]`,
    );
  }

  async hydrateStore(): Promise<void> {
    OpLog.normal('OperationLogHydratorService: Starting hydration...');

    try {
      // PERF: Parallel startup operations - all access different IndexedDB stores
      // and don't depend on each other's results, so they can run concurrently.
      const [, , hasBackup] = await Promise.all([
        // Check for pending remote ops from crashed sync (touches 'ops' store)
        this.recoveryService.recoverPendingRemoteOps(),
        // Legacy migration placeholder - kept for future DB migrations if needed
        this._runLegacyMigrationIfNeeded(),
        // A.7.12: Check for interrupted migration (touches 'state_cache' store)
        this.opLogStore.hasStateCacheBackup(),
      ]);

      // Clean up corrupt operations (e.g., with undefined entityId) that cause
      // infinite rejection loops during sync. Must run after recoverPendingRemoteOps.
      await this.recoveryService.cleanupCorruptOps();

      // Migrate archives from legacy 'pf' database to SUP_OPS if needed.
      // This is idempotent - skips if archives already exist in SUP_OPS.
      await this.archiveMigrationService.migrateArchivesIfNeeded();

      if (hasBackup) {
        OpLog.warn(
          'OperationLogHydratorService: Found migration backup - previous migration may have crashed. Restoring...',
        );
        await this.opLogStore.restoreStateCacheFromBackup();
        OpLog.normal('OperationLogHydratorService: Restored from backup.');
      }

      // 1. Load snapshot
      let snapshot = await this.opLogStore.loadStateCache();

      if (!snapshot) {
        OpLog.normal(
          'OperationLogHydratorService: No snapshot found. Checking for migration...',
        );
        // Fresh install or migration - no snapshot exists
        await this.migrationService.checkAndMigrate();
        // Try loading again after potential migration
        snapshot = await this.opLogStore.loadStateCache();
      }

      // 2. Run schema migration if needed (A.7.12: with backup safety)
      if (snapshot && this.schemaMigrationService.needsMigration(snapshot)) {
        snapshot = await this.snapshotService.migrateSnapshotWithBackup(snapshot);
        this._migrationRanDuringHydration = true;
      }

      // 3. Validate snapshot if it exists
      if (snapshot && !this.snapshotService.isValidSnapshot(snapshot)) {
        OpLog.warn(
          'OperationLogHydratorService: Snapshot is invalid/corrupted. Attempting recovery...',
        );
        await this.recoveryService.attemptRecovery();
        return;
      }

      if (snapshot) {
        OpLog.normal('OperationLogHydratorService: Snapshot found. Hydrating state...', {
          lastAppliedOpSeq: snapshot.lastAppliedOpSeq,
        });

        // CHECKPOINT B: Schema-version trust optimization
        // Skip synchronous validation if schema version matches current - the snapshot
        // was validated before being saved in the previous session. Only validate
        // synchronously if a migration ran (schema changed).
        // TODO: Consider removing this validation after ops-log testing phase.
        // Checkpoint C validates the final state anyway, making this redundant.
        let stateToLoad = snapshot.state as AppStateSnapshot;
        const snapshotSchemaVersion = (snapshot as { schemaVersion?: number })
          .schemaVersion;
        const needsSyncValidation =
          this._migrationRanDuringHydration ||
          snapshotSchemaVersion !== CURRENT_SCHEMA_VERSION;

        if (needsSyncValidation && !this._repairMutex) {
          OpLog.normal(
            'OperationLogHydratorService: Running synchronous validation (migration ran or schema mismatch)',
          );
          const validationResult = await this._validateAndRepairState(
            stateToLoad as unknown as Record<string, unknown>,
            'snapshot',
          );
          if (validationResult.wasRepaired && validationResult.repairedState) {
            stateToLoad = validationResult.repairedState as unknown as AppStateSnapshot;
            // Update snapshot with repaired state
            snapshot = { ...snapshot, state: stateToLoad };
          }
        } else {
          OpLog.normal(
            'OperationLogHydratorService: Trusting snapshot (schema version matches, no migration)',
          );
        }

        // CRITICAL: Restore snapshot's vector clock to the vector_clock store.
        // This is necessary because:
        // 1. hydrateFromRemoteSync saves the clock in the snapshot but NOT in the store
        // 2. When user creates new ops, incrementAndStoreVectorClock reads from the store
        // 3. Without this, new ops would have clocks missing entries from the SYNC_IMPORT
        // 4. Those ops would be CONCURRENT with the SYNC_IMPORT and get filtered on sync
        if (snapshot.vectorClock && Object.keys(snapshot.vectorClock).length > 0) {
          await this.opLogStore.setVectorClock(snapshot.vectorClock);
          OpLog.normal(
            'OperationLogHydratorService: Restored vector clock from snapshot',
            { clockSize: Object.keys(snapshot.vectorClock).length },
          );
        }

        // MIGRATION: Ensure protectedClientIds is set if a full-state op exists.
        // This handles the case where a SYNC_IMPORT was processed with old code that
        // didn't set protectedClientIds. Must run BEFORE any new ops are created.
        await this._migrateProtectedClientIdsIfNeeded();

        // 3. Hydrate NgRx with (possibly repaired) snapshot
        // Cast to any - stateToLoad is AppStateSnapshot which is runtime-compatible but TypeScript can't verify
        this.store.dispatch(loadAllData({ appDataComplete: stateToLoad as any }));

        // 4. Replay tail operations (A.7.13: with operation migration)
        const tailOps = await this.opLogStore.getOpsAfterSeq(snapshot.lastAppliedOpSeq);

        if (tailOps.length > 0) {
          // Optimization: If last op is SyncImport or Repair, skip replay and load directly
          const lastOp = tailOps[tailOps.length - 1].op;
          const appData = this._extractFullStateFromOp(lastOp);
          if (appData) {
            OpLog.normal(
              `OperationLogHydratorService: Last of ${tailOps.length} tail ops is ${lastOp.opType}, loading directly`,
            );

            // Validate and repair the full-state data BEFORE loading to NgRx
            // This prevents corrupted SyncImport/Repair operations from breaking the app
            if (!this._repairMutex) {
              const validationResult = await this._validateAndRepairState(
                appData as Record<string, unknown>,
                'tail-full-state-op-load',
              );
              const tailStateToLoad =
                validationResult.wasRepaired && validationResult.repairedState
                  ? validationResult.repairedState
                  : (appData as Record<string, unknown>);
              // FIX: Merge vector clock BEFORE dispatching loadAllData
              // This ensures any operations created synchronously during loadAllData
              // (e.g., TODAY_TAG repair) will have the correct merged clock.
              // Without this, those operations get superseded clocks and are rejected by the server.
              await this.opLogStore.mergeRemoteOpClocks([lastOp]);
              // FIX: Protect ALL client IDs in the import's vector clock
              // See RemoteOpsProcessingService.applyNonConflictingOps for detailed explanation.
              const protectedIds = Object.keys(lastOp.vectorClock);
              await this.opLogStore.setProtectedClientIds(protectedIds);
              OpLog.normal(
                `OperationLogHydratorService: Set protected client IDs from ${lastOp.opType}: [${protectedIds.join(', ')}]`,
              );
              this.store.dispatch(
                loadAllData({ appDataComplete: tailStateToLoad as any }),
              );
            } else {
              // FIX: Same fix for the else branch
              await this.opLogStore.mergeRemoteOpClocks([lastOp]);
              // FIX: Protect ALL client IDs in the import's vector clock
              const protectedIdsElse = Object.keys(lastOp.vectorClock);
              await this.opLogStore.setProtectedClientIds(protectedIdsElse);
              OpLog.normal(
                `OperationLogHydratorService: Set protected client IDs from ${lastOp.opType}: [${protectedIdsElse.join(', ')}]`,
              );
              this.store.dispatch(loadAllData({ appDataComplete: appData as any }));
            }
            // No snapshot save needed - full state ops already contain complete state
            // Snapshot will be saved after next batch of regular operations
          } else {
            // A.7.13: Migrate tail operations before replay
            const opsToReplay = this._migrateTailOps(tailOps.map((e) => e.op));

            const droppedCount = tailOps.length - opsToReplay.length;
            OpLog.normal(
              `OperationLogHydratorService: Replaying ${opsToReplay.length} tail ops ` +
                `(${droppedCount} dropped during migration).`,
            );
            // PERF: Use bulk dispatch to apply all operations in a single NgRx update.
            // This reduces 500 dispatches to 1, dramatically improving startup performance.
            // The bulkHydrationMetaReducer iterates through ops and applies each action.
            this.hydrationStateService.startApplyingRemoteOps();
            this.store.dispatch(bulkApplyOperations({ operations: opsToReplay }));
            this.hydrationStateService.endApplyingRemoteOps();

            // Merge replayed ops' clocks into local clock
            // This ensures subsequent ops have clocks that dominate these tail ops
            await this.opLogStore.mergeRemoteOpClocks(opsToReplay);
            // FIX: Set protected client ID if any replayed op is a full-state op
            await this._setProtectedClientIdFromOps(opsToReplay);

            // CHECKPOINT C: Validate state after replaying tail operations
            // Must validate BEFORE saving snapshot to avoid persisting corrupted state
            if (!this._repairMutex) {
              await this._validateAndRepairCurrentState('tail-replay');
            }

            // 5. If we replayed many ops, save a new snapshot for faster future loads
            // Snapshot is saved AFTER validation to ensure we persist valid/repaired state
            if (opsToReplay.length > 10) {
              OpLog.normal(
                `OperationLogHydratorService: Saving new snapshot after replaying ${opsToReplay.length} ops`,
              );
              await this.snapshotService.saveCurrentStateAsSnapshot();
            }
          }
        }

        OpLog.normal('OperationLogHydratorService: Hydration complete.');
      } else {
        OpLog.warn(
          'OperationLogHydratorService: No snapshot found. Replaying all operations from start.',
        );
        // No snapshot means we might be in a fresh install state or post-migration-check with no legacy data.
        // We must replay ALL operations from the beginning of the log.
        const allOps = await this.opLogStore.getOpsAfterSeq(0);

        if (allOps.length === 0) {
          // Fresh install - no data at all
          OpLog.normal(
            'OperationLogHydratorService: Fresh install detected. No data to load.',
          );
          return;
        }

        // MIGRATION: Ensure protectedClientIds is set if a full-state op exists.
        // This handles the case where a SYNC_IMPORT was processed with old code that
        // didn't set protectedClientIds. Must run BEFORE any new ops are created.
        await this._migrateProtectedClientIdsIfNeeded();

        // Optimization: If last op is SyncImport or Repair, skip replay and load directly
        const lastOp = allOps[allOps.length - 1].op;
        const appData = this._extractFullStateFromOp(lastOp);
        if (appData) {
          OpLog.normal(
            `OperationLogHydratorService: Last of ${allOps.length} ops is ${lastOp.opType}, loading directly`,
          );

          // Validate and repair the full-state data BEFORE loading to NgRx
          // This prevents corrupted SyncImport/Repair operations from breaking the app
          if (!this._repairMutex) {
            const validationResult = await this._validateAndRepairState(
              appData as Record<string, unknown>,
              'full-state-op-load',
            );
            const stateToLoad =
              validationResult.wasRepaired && validationResult.repairedState
                ? validationResult.repairedState
                : (appData as Record<string, unknown>);
            // FIX: Merge vector clock BEFORE dispatching loadAllData
            // Same fix as the tail ops branch - prevents superseded clock bug
            await this.opLogStore.mergeRemoteOpClocks([lastOp]);
            // FIX: Protect ALL client IDs in the import's vector clock
            // See RemoteOpsProcessingService.applyNonConflictingOps for detailed explanation.
            const protectedIds2 = Object.keys(lastOp.vectorClock);
            await this.opLogStore.setProtectedClientIds(protectedIds2);
            OpLog.normal(
              `OperationLogHydratorService: Set protected client IDs from ${lastOp.opType}: [${protectedIds2.join(', ')}]`,
            );
            this.store.dispatch(loadAllData({ appDataComplete: stateToLoad as any }));
          } else {
            // FIX: Same fix for the else branch
            await this.opLogStore.mergeRemoteOpClocks([lastOp]);
            // FIX: Protect ALL client IDs in the import's vector clock
            const protectedIds2Else = Object.keys(lastOp.vectorClock);
            await this.opLogStore.setProtectedClientIds(protectedIds2Else);
            OpLog.normal(
              `OperationLogHydratorService: Set protected client IDs from ${lastOp.opType}: [${protectedIds2Else.join(', ')}]`,
            );
            this.store.dispatch(loadAllData({ appDataComplete: appData as any }));
          }
          // No snapshot save needed - full state ops already contain complete state
        } else {
          // A.7.13: Migrate all operations before replay
          const opsToReplay = this._migrateTailOps(allOps.map((e) => e.op));

          const droppedCount = allOps.length - opsToReplay.length;
          OpLog.normal(
            `OperationLogHydratorService: Replaying all ${opsToReplay.length} ops ` +
              `(${droppedCount} dropped during migration).`,
          );
          // PERF: Use bulk dispatch to apply all operations in a single NgRx update.
          // This reduces 500 dispatches to 1, dramatically improving startup performance.
          // The bulkHydrationMetaReducer iterates through ops and applies each action.
          this.hydrationStateService.startApplyingRemoteOps();
          this.store.dispatch(bulkApplyOperations({ operations: opsToReplay }));
          this.hydrationStateService.endApplyingRemoteOps();

          // Merge replayed ops' clocks into local clock
          await this.opLogStore.mergeRemoteOpClocks(opsToReplay);
          // FIX: Set protected client ID if any replayed op is a full-state op
          await this._setProtectedClientIdFromOps(opsToReplay);

          // CHECKPOINT C: Validate state after replaying all operations
          // Must validate BEFORE saving snapshot to avoid persisting corrupted state
          if (!this._repairMutex) {
            await this._validateAndRepairCurrentState('full-replay');
          }

          // Save snapshot after replay for faster future loads
          // Snapshot is saved AFTER validation to ensure we persist valid/repaired state
          OpLog.normal(
            `OperationLogHydratorService: Saving snapshot after replaying ${opsToReplay.length} ops`,
          );
          await this.snapshotService.saveCurrentStateAsSnapshot();
        }

        OpLog.normal('OperationLogHydratorService: Full replay complete.');
      }

      // Legacy cleanup placeholder - kept for future maintenance operations if needed
      await this._runLegacyCleanupIfNeeded();

      // Retry any failed remote ops from previous conflict resolution attempts
      // Now that state is fully hydrated, dependencies might be resolved
      await this.retryFailedRemoteOps();
    } catch (e) {
      OpLog.err('OperationLogHydratorService: Error during hydration', e);

      // Handle IndexedDB open failure with specific guidance
      if (e instanceof IndexedDBOpenError) {
        this._showIndexedDBOpenError(e);
        throw e;
      }

      try {
        await this.recoveryService.attemptRecovery();
      } catch (recoveryErr) {
        OpLog.err('OperationLogHydratorService: Recovery also failed', recoveryErr);

        // Check if recovery failed due to IndexedDB issue
        if (recoveryErr instanceof IndexedDBOpenError) {
          this._showIndexedDBOpenError(recoveryErr);
          throw recoveryErr;
        }

        this.snackService.open({
          type: 'ERROR',
          msg: T.F.SYNC.S.HYDRATION_FAILED,
          actionStr: T.PS.RELOAD,
          actionFn: (): void => {
            window.location.reload();
          },
        });
        throw recoveryErr;
      }
    }
  }

  /**
   * Extracts full application state from operations that contain complete state.
   * Returns undefined for operations that don't contain full state (normal CRUD ops).
   *
   * Operations that contain full state:
   * - OpType.SyncImport: Full state from remote sync
   * - OpType.Repair: Full repaired state from auto-repair
   * - OpType.BackupImport: Full state from backup file restore
   */
  private _extractFullStateFromOp(op: Operation): unknown | undefined {
    if (!op.payload) {
      return undefined;
    }

    // Handle full state operations
    if (
      op.opType === OpType.SyncImport ||
      op.opType === OpType.BackupImport ||
      op.opType === OpType.Repair
    ) {
      const payload = op.payload as
        | { appDataComplete?: unknown }
        | RepairPayload
        | unknown;

      // Check if payload has appDataComplete wrapper
      if (
        typeof payload === 'object' &&
        payload !== null &&
        'appDataComplete' in payload
      ) {
        return (payload as { appDataComplete: unknown }).appDataComplete;
      }

      // Legacy format: payload IS the appDataComplete
      return payload;
    }

    return undefined;
  }

  // ============================================================
  // A.7.13 Tail Ops Migration
  // ============================================================

  /**
   * Migrates tail operations to current schema version (A.7.13).
   * Operations that should be dropped (e.g., for removed features) are filtered out.
   *
   * @param ops - The operations to migrate
   * @returns Array of migrated operations
   */
  private _migrateTailOps(ops: Operation[]): Operation[] {
    // Check if any ops need migration
    const needsMigration = ops.some((op) =>
      this.schemaMigrationService.operationNeedsMigration(op),
    );

    if (!needsMigration) {
      return ops;
    }

    OpLog.normal(
      `OperationLogHydratorService: Migrating ${ops.length} tail ops to current schema version...`,
    );

    return this.schemaMigrationService.migrateOperations(ops);
  }

  /**
   * Handles hydration after a remote sync download.
   * Delegates to SyncHydrationService.
   *
   * @param downloadedMainModelData - Entity models from remote meta file.
   *   These are NOT stored in IndexedDB (only archives are) so must be passed explicitly.
   * @param remoteVectorClock - Vector clock from the downloaded snapshot.
   *   Merged into the SYNC_IMPORT's clock to prevent mutual discarding during provider switch.
   */
  async hydrateFromRemoteSync(
    downloadedMainModelData?: Record<string, unknown>,
    remoteVectorClock?: Record<string, number>,
  ): Promise<void> {
    return this.syncHydrationService.hydrateFromRemoteSync(
      downloadedMainModelData,
      remoteVectorClock,
    );
  }

  /**
   * Validates a state object and repairs it if necessary.
   * Used for validating snapshot state before dispatching.
   * Uses a mutex to prevent concurrent repair operations.
   *
   * @param state - The state to validate
   * @param context - Context string for logging (e.g., 'snapshot', 'tail-replay')
   * @returns Validation result with optional repaired state
   */
  private async _validateAndRepairState(
    state: Record<string, unknown>,
    context: string,
  ): Promise<{ wasRepaired: boolean; repairedState?: Record<string, unknown> }> {
    // Wait for any ongoing repair to complete before validating
    if (this._repairMutex) {
      await this._repairMutex;
    }

    const result = this.validateStateService.validateAndRepair(state as never);

    if (!result.wasRepaired) {
      return { wasRepaired: false };
    }

    if (!result.repairedState || !result.repairSummary) {
      OpLog.err(
        `[OperationLogHydratorService] Repair failed for ${context}:`,
        result.error,
      );
      return { wasRepaired: false };
    }

    // DISABLED: Repair system is non-functional - this code path is unreachable
    // because validateAndRepair() always returns wasRepaired: false
    //
    // const repairPromise = (async () => {
    //   try {
    //     const clientId = await this.pfapiService.pf.metaModel.loadClientId();
    //     await this.repairOperationService.createRepairOperation(
    //       result.repairedState!,
    //       result.repairSummary!,
    //       clientId,
    //     );
    //     OpLog.log(`[OperationLogHydratorService] Created REPAIR operation for ${context}`);
    //   } catch (e) {
    //     OpLog.err(`[OperationLogHydratorService] Failed to create REPAIR operation for ${context}:`, e);
    //     throw e;
    //   } finally {
    //     this._repairMutex = null;
    //   }
    // })();
    // this._repairMutex = repairPromise;
    // await repairPromise;

    // Should never reach here while repair is disabled
    return { wasRepaired: false };
  }

  /**
   * Validates the current NgRx state and repairs it if necessary.
   * Used after replaying operations.
   *
   * @param context - Context string for logging
   */
  private async _validateAndRepairCurrentState(context: string): Promise<void> {
    // Get current state from NgRx
    const currentState = this.stateSnapshotService.getStateSnapshot();

    const result = await this._validateAndRepairState(
      currentState as unknown as Record<string, unknown>,
      context,
    );

    if (result.wasRepaired && result.repairedState) {
      // Dispatch the repaired state to NgRx
      this.store.dispatch(loadAllData({ appDataComplete: result.repairedState as any }));
    }
  }

  /**
   * Legacy cleanup placeholder.
   * Kept for future maintenance operations if needed.
   */
  private async _runLegacyCleanupIfNeeded(): Promise<void> {
    // No-op: placeholder for future cleanup operations
  }

  /**
   * Retries failed remote operations from previous conflict resolution attempts.
   * Called after hydration to give failed ops another chance to apply now that
   * more state might be available (e.g., dependencies resolved by sync).
   *
   * Failed ops are ops that previously failed during conflict resolution
   * but may succeed now that more state has been loaded.
   */
  async retryFailedRemoteOps(): Promise<void> {
    const failedOps = await this.opLogStore.getFailedRemoteOps();

    if (failedOps.length === 0) {
      return;
    }

    OpLog.normal(
      `OperationLogHydratorService: Retrying ${failedOps.length} previously failed remote ops...`,
    );

    const appliedOpIds: string[] = [];
    const stillFailedOpIds: string[] = [];

    for (const entry of failedOps) {
      const result = await this.operationApplierService.applyOperations([entry.op]);
      if (result.failedOp) {
        // SyncStateCorruptedError or any other error means the op still can't be applied
        OpLog.warn(
          `OperationLogHydratorService: Failed to retry op ${entry.op.id}`,
          result.failedOp.error,
        );
        stillFailedOpIds.push(entry.op.id);
      } else {
        // Operation succeeded
        appliedOpIds.push(entry.op.id);
      }
    }

    // Mark successfully applied ops
    if (appliedOpIds.length > 0) {
      const appliedSeqs = failedOps
        .filter((e) => appliedOpIds.includes(e.op.id))
        .map((e) => e.seq);
      await this.opLogStore.markApplied(appliedSeqs);
      OpLog.normal(
        `OperationLogHydratorService: Successfully retried ${appliedOpIds.length} failed ops`,
      );
    }

    // Update retry count for still-failed ops (may reject them if max retries reached)
    if (stillFailedOpIds.length > 0) {
      await this.opLogStore.markFailed(stillFailedOpIds, MAX_CONFLICT_RETRY_ATTEMPTS);
      OpLog.warn(
        `OperationLogHydratorService: ${stillFailedOpIds.length} ops still failing after retry`,
      );
    }
  }

  /**
   * Legacy migration placeholder.
   * Kept for future DB migrations if needed.
   */
  private async _runLegacyMigrationIfNeeded(): Promise<void> {
    // No-op: placeholder for future migrations
  }

  /**
   * Shows a helpful error dialog when IndexedDB fails to open.
   * Provides platform-specific guidance for "backing store" errors.
   * Also logs full error details to console for debugging.
   *
   * @see https://github.com/johannesjo/super-productivity/issues/6255
   */
  private _showIndexedDBOpenError(error: IndexedDBOpenError): void {
    // Log full error details to console for debugging (can be copied by users)
    OpLog.err(
      'IndexedDB open failed after all retries. Original error:',
      error.originalError,
    );

    const originalMsg =
      error.originalError instanceof Error
        ? error.originalError.message
        : String(error.originalError);

    let message =
      'Database Error - Cannot Load Data\n\n' +
      'Super Productivity cannot open its database. ' +
      'This may be caused by:\n\n' +
      '- Low disk space\n' +
      '- Temporary file lock (try closing other tabs)\n' +
      '- Storage corruption\n\n';

    if (error.isBackingStoreError) {
      message +=
        'Recovery steps:\n' +
        '1. Close ALL browser tabs and windows\n' +
        '2. Restart the app\n' +
        '3. If using Linux Snap, try: snap set core experimental.refresh-app-awareness=true\n' +
        '4. If issue persists, check available disk space\n\n';
    }

    message +=
      'If the problem continues after restart, your browser storage may need to be cleared.\n\n' +
      `Technical details: ${originalMsg}\n\n` +
      '(Check browser console for full error details)';

    alertDialog(message);
  }
}

import { inject, Injectable } from '@angular/core';
import { OperationLogStoreService } from './operation-log-store.service';
import {
  CURRENT_SCHEMA_VERSION,
  MigratableStateCache,
  SchemaMigrationService,
} from './schema-migration.service';
import { VectorClockService } from '../sync/vector-clock.service';
import { StateSnapshotService } from '../backup/state-snapshot.service';
import { OpLog } from '../../core/log';
import { extractEntityKeysFromState } from './extract-entity-keys';
import { CLIENT_ID_PROVIDER, ClientIdProvider } from '../util/client-id.provider';
import { limitVectorClockSize } from '../../core/util/vector-clock';
import { ValidateStateService } from '../validation/validate-state.service';
import { hasMeaningfulStateData } from '../validation/has-meaningful-state-data.util';
import { LockService } from '../sync/lock.service';
import { LOCK_NAMES } from '../core/operation-log.const';

type StateCache = MigratableStateCache;

/**
 * Handles snapshot lifecycle operations for the operation log system.
 *
 * Responsibilities:
 * - Validating snapshot structure and integrity
 * - Saving current NgRx state as snapshots
 * - Migrating snapshots with backup safety (A.7.12)
 *
 * This service is used by OperationLogHydratorService for startup hydration
 * and by other services that need to save/validate snapshots.
 */
@Injectable({ providedIn: 'root' })
export class OperationLogSnapshotService {
  private opLogStore = inject(OperationLogStoreService);
  private vectorClockService = inject(VectorClockService);
  private stateSnapshotService = inject(StateSnapshotService);
  private schemaMigrationService = inject(SchemaMigrationService);
  private validateStateService = inject(ValidateStateService);
  private clientIdProvider: ClientIdProvider = inject(CLIENT_ID_PROVIDER);
  private lockService = inject(LockService);

  /**
   * Validates that a snapshot has the expected structure and data.
   */
  isValidSnapshot(snapshot: StateCache): boolean {
    // Check required properties exist and have sane types.
    if (
      !snapshot.state ||
      typeof snapshot.lastAppliedOpSeq !== 'number' ||
      !Number.isFinite(snapshot.lastAppliedOpSeq) ||
      typeof snapshot.compactedAt !== 'number' ||
      !Number.isFinite(snapshot.compactedAt) ||
      typeof snapshot.vectorClock !== 'object' ||
      snapshot.vectorClock === null ||
      Array.isArray(snapshot.vectorClock)
    ) {
      return false;
    }

    // Check state is an object with expected structure
    const state = snapshot.state as Record<string, unknown>;
    if (typeof state !== 'object' || state === null) {
      return false;
    }

    // Check for at least some core models (task, project, globalConfig)
    // These should always exist even if empty
    const coreModels = ['task', 'project', 'globalConfig'];
    for (const model of coreModels) {
      if (!(model in state)) {
        OpLog.warn(
          `OperationLogSnapshotService: Missing core model in snapshot: ${model}`,
        );
        return false;
      }
    }

    return true;
  }

  /**
   * Saves the current NgRx state as a snapshot for faster future loads.
   * Called after replaying many operations to optimize next startup.
   *
   * Wrapped in OPERATION_LOG lock to prevent a lost-update window: without
   * the lock, an op appended between reading NgRx state and reading lastSeq
   * would get a seq <= lastAppliedOpSeq but its effect would be absent from
   * the snapshot. On next hydration the tail replay would start after that
   * seq, silently skipping the op forever.
   *
   * Additionally, lastSeq is read BEFORE the state snapshot so the worst
   * interleaving degrades to re-replay rather than a missed op. Most op types
   * are idempotent on re-replay (entity-adapter CRUD/move/reorder), but some
   * persistent ops accumulate onto current state and double-apply on re-replay
   * (e.g. time-tracking/counter deltas and the plain-append branches of project
   * task moves). This edge is unlikely (the save runs only during hydration) and
   * strictly better than op-loss. The audited op list and a truly-lossless
   * capture (quiesce the op-write queue before reading) are tracked in #8469.
   */
  async saveCurrentStateAsSnapshot(): Promise<void> {
    try {
      await this.lockService.request(LOCK_NAMES.OPERATION_LOG, async () => {
        // Read lastSeq BEFORE state snapshot — see JSDoc above.
        // NOTE: compaction reads in the opposite order (state, then lastSeq);
        // its failure mode if the lock is bypassed is missed-op data loss.
        const lastSeq = await this.opLogStore.getLastSeq();
        const currentState = this.stateSnapshotService.getStateSnapshot();

        // GUARD (#7892): never cache an empty/degraded state over a good one.
        // The snapshot is only a load-time cache — the op-log is the source of
        // truth. If the live NgRx state has no user data (e.g. a transient
        // hydration glitch left the store in its initial empty state), caching it
        // would make the next boot trust empty data. Skipping the save is always
        // safe for correctness: replaying the op-log reconstructs the true state
        // (including legitimate full-wipe deletes), at most costing a slower boot.
        if (!hasMeaningfulStateData(currentState)) {
          OpLog.warn(
            'OperationLogSnapshotService: Skipping snapshot save — current state has no ' +
              'meaningful data (refusing to overwrite cache with empty state)',
          );
          return;
        }

        // Get current vector clock
        const vectorClock = await this.vectorClockService.getCurrentVectorClock();

        // Prune vector clock before persisting to prevent bloat (max 20 entries).
        // Without this, clocks can grow unbounded across sync cycles and cause
        // repeated conflict dialogs on every sync.
        const clientId = await this.clientIdProvider.loadClientId();
        const prunedClock = clientId
          ? limitVectorClockSize(vectorClock, clientId)
          : vectorClock;

        // Extract entity keys for conflict detection after compaction
        const snapshotEntityKeys = extractEntityKeysFromState(currentState);

        // Save snapshot
        await this.opLogStore.saveStateCache({
          state: currentState,
          lastAppliedOpSeq: lastSeq,
          vectorClock: prunedClock,
          compactedAt: Date.now(),
          schemaVersion: CURRENT_SCHEMA_VERSION,
          snapshotEntityKeys,
        });

        OpLog.normal('OperationLogSnapshotService: Saved new snapshot');
      });
    } catch (e) {
      // Don't fail hydration if snapshot save fails
      OpLog.warn('OperationLogSnapshotService: Failed to save snapshot', e);
    }
  }

  /**
   * Migrates a snapshot with backup safety (A.7.12).
   * Creates a backup before migration and restores it if migration fails.
   *
   * @param snapshot - The snapshot to migrate
   * @returns The migrated snapshot
   * @throws If migration fails and rollback also fails
   */
  async migrateSnapshotWithBackup(snapshot: StateCache): Promise<StateCache> {
    OpLog.normal(
      'OperationLogSnapshotService: Running schema migration with backup safety...',
    );

    // 1. Create backup before migration
    await this.opLogStore.saveStateCacheBackup();
    OpLog.normal('OperationLogSnapshotService: Created pre-migration backup.');

    try {
      // 2. Run migration
      const migratedSnapshot = this.schemaMigrationService.migrateStateIfNeeded(snapshot);

      // 3. Validate migrated cache metadata before persisting or clearing the backup.
      if (!this.isValidSnapshot(migratedSnapshot)) {
        throw new Error('Migrated snapshot metadata validation failed');
      }

      // 4. Validate migrated snapshot state before persisting or clearing the backup.
      // Otherwise an invalid current-schema cache could be trusted on next startup.
      const validationResult = await this.validateStateService.validateState(
        migratedSnapshot.state as Record<string, unknown>,
      );
      if (!validationResult.isValid) {
        throw new Error(
          `Migrated snapshot validation failed (${validationResult.typiaErrors.length} typia errors` +
            `${validationResult.crossModelError ? `, cross-model: ${validationResult.crossModelError}` : ''})`,
        );
      }

      // 5. Save migrated snapshot
      await this.opLogStore.saveStateCache(migratedSnapshot);

      // 6. Clear backup on success
      await this.opLogStore.clearStateCacheBackup();
      OpLog.normal(
        'OperationLogSnapshotService: Schema migration complete. Backup cleared.',
      );

      return migratedSnapshot;
    } catch (e) {
      OpLog.err(
        'OperationLogSnapshotService: Schema migration failed. Restoring backup...',
        e,
      );

      try {
        // Restore backup
        await this.opLogStore.restoreStateCacheFromBackup();
        OpLog.normal(
          'OperationLogSnapshotService: Backup restored after migration failure.',
        );
      } catch (restoreErr) {
        OpLog.err(
          'OperationLogSnapshotService: CRITICAL - Failed to restore backup after migration failure!',
          restoreErr,
        );
        // Both migration and restore failed - this is a critical error
        throw new Error(
          `Schema migration failed and backup restore also failed. ` +
            `Original error: ${e instanceof Error ? e.message : String(e)}. ` +
            `Restore error: ${restoreErr instanceof Error ? restoreErr.message : String(restoreErr)}`,
        );
      }

      // Re-throw original error after successful restore
      throw e;
    }
  }
}

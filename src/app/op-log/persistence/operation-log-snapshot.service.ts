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

  /**
   * Validates that a snapshot has the expected structure and data.
   */
  isValidSnapshot(snapshot: StateCache): boolean {
    // Check required properties exist
    if (!snapshot.state || typeof snapshot.lastAppliedOpSeq !== 'number') {
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
   */
  async saveCurrentStateAsSnapshot(): Promise<void> {
    try {
      // Get current state from NgRx
      const currentState = this.stateSnapshotService.getStateSnapshot();

      // Get current vector clock and last seq
      const vectorClock = await this.vectorClockService.getCurrentVectorClock();
      const lastSeq = await this.opLogStore.getLastSeq();

      // Extract entity keys for conflict detection after compaction
      const snapshotEntityKeys = extractEntityKeysFromState(currentState);

      // Save snapshot
      await this.opLogStore.saveStateCache({
        state: currentState,
        lastAppliedOpSeq: lastSeq,
        vectorClock,
        compactedAt: Date.now(),
        schemaVersion: CURRENT_SCHEMA_VERSION,
        snapshotEntityKeys,
      });

      OpLog.normal('OperationLogSnapshotService: Saved new snapshot');
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

      // 3. Save migrated snapshot
      await this.opLogStore.saveStateCache(migratedSnapshot);

      // 4. Clear backup on success
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

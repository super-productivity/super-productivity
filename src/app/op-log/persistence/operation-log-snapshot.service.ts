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
import { ValidateStateService } from '../validation/validate-state.service';
import { hasMeaningfulStateData } from '../validation/has-meaningful-state-data.util';
import { OperationCaptureService } from '../capture/operation-capture.service';
import { getPhantomChangeRisk } from '../capture/phantom-change-guard.util';
import { OperationWriteFlushService } from '../sync/operation-write-flush.service';

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
  private operationCapture = inject(OperationCaptureService);
  private writeFlushService = inject(OperationWriteFlushService);

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
   * Runs via flushThenRunExclusive (#8469): the capture pipeline is drained
   * BEFORE the OPERATION_LOG lock is taken and the pending counter re-checked
   * once inside it, so no counted action can be dispatched-but-unsequenced at
   * the capture point. NgRx state mutates synchronously at dispatch while the
   * op's seq is only assigned later in the persist effect — without the
   * quiesce, an op whose reducer had already run but whose seq-write was
   * still queued behind the lock would be baked into the snapshot state AND
   * tail-replayed on the next boot, double-applying non-idempotent reducers
   * (accumulating time/metric deltas, plain-append list branches).
   *
   * Deferred actions (buffered during a sync window, kept across windows
   * after a failed drain) are NOT covered by the pending counter; they are
   * handled by an explicit skip inside the body.
   *
   * Inside the lock, state is read first — synchronously, before any await
   * can let a dispatch interleave — and lastSeq after. While the lock is held
   * no new seq can be assigned, so every op with seq <= lastAppliedOpSeq has
   * its effect in the captured state, and any later dispatch is absent from
   * it and replays cleanly. This order relies on EVERY seq-assigning writer
   * holding the OPERATION_LOG lock (persist effect, remote apply, repair,
   * server migration — all do): a writer bypassing the lock would degrade
   * this window to silent op-LOSS, strictly worse than the pre-quiesce
   * re-replay bias.
   *
   * Failure (flush timeout, persistent dispatch activity) only skips the
   * save: the snapshot is a boot-time cache and the op-log stays the source
   * of truth.
   */
  async saveCurrentStateAsSnapshot(): Promise<void> {
    try {
      await this.writeFlushService.flushThenRunExclusive(async () => {
        // GUARD (#8751): never snapshot live state while it may contain
        // changes with no durable op behind them (failed or still-pending
        // writes, undrained deferred actions from the hydration sync window) —
        // the cache write below would bake the phantom change in. Checked
        // synchronously immediately before the snapshot read; skipping only
        // costs a slower next boot.
        const phantomRisk = getPhantomChangeRisk(this.operationCapture);
        if (phantomRisk) {
          OpLog.warn(
            `OperationLogSnapshotService: Skipping snapshot save — ${phantomRisk} (#8751)`,
          );
          return;
        }

        // Read state synchronously at the quiesce cutoff (no await before it)
        // and lastSeq after — see JSDoc above.
        const currentState = this.stateSnapshotService.getStateSnapshotForOperationLog();
        const lastSeq = await this.opLogStore.getLastSeq();

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

        // Get current vector clock; pruning happens inside saveStateCache
        // (store-owned, #9096).
        const vectorClock = await this.vectorClockService.getCurrentVectorClock();

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
   * State-validation failures are non-fatal: the migrated snapshot is returned
   * for hydration (unpersisted) rather than throwing. See the step-4 note.
   *
   * @param snapshot - The snapshot to migrate
   * @returns The migrated snapshot
   * @throws On migration failure or metadata-validation failure. The backup is
   *         rolled back first; if that rollback ALSO fails, a combined error is
   *         thrown instead. State-validation failure does NOT throw (step 4).
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

      // 4. Validate migrated snapshot state before PERSISTING it — an invalid
      // current-schema cache must not be trusted on next startup (Checkpoint B
      // skips validation for a matching schema version). But a validation
      // failure here is NOT fatal to hydration: many "invalid" shapes are
      // reducer-healable — e.g. a snapshot from an older release missing a
      // newly-required config field the loadAllData reducer backfills by
      // default. Bailing to disaster recovery in that case bricks the app to an
      // empty store on upgrade, even though the data is fine. So on failure we
      // roll the on-disk cache back to the pre-migration backup (never persist
      // the unvalidated migrated snapshot) yet still RETURN it, letting the
      // hydrator load it through the reducer (which heals defaults) and boot
      // with correct data.
      //
      // Caveat: this non-fatal path does NOT itself persist a clean snapshot.
      // Re-persist only happens if the hydrator's post-replay Checkpoint C runs
      // and its save gate is met (tail ops present, not a full-state-op load,
      // >10 replayed ops) — otherwise the on-disk cache stays at the old version
      // and the migration re-runs every boot (correct, but a startup tax). For
      // fields with a migration backfill (below) validation passes and step 5
      // persists a clean snapshot immediately, so that path is the real fix;
      // this branch is the safety net for the not-yet-backfilled case.
      // TODO(followup): persist a fresh snapshot after a migration ran whenever
      // Checkpoint C validates, regardless of tail-op count, to converge in one
      // boot instead of every boot.
      const validationResult = await this.validateStateService.validateState(
        migratedSnapshot.state as Record<string, unknown>,
      );
      if (!validationResult.isValid) {
        OpLog.warn(
          'OperationLogSnapshotService: Migrated snapshot failed validation — ' +
            'restoring backup and hydrating unpersisted so the reducer can heal it.',
          {
            typiaErrorCount: validationResult.typiaErrors.length,
            crossModelError: validationResult.crossModelError,
          },
        );
        await this.opLogStore.restoreStateCacheFromBackup();
        OpLog.normal(
          'OperationLogSnapshotService: Backup restored; returning migrated snapshot for reducer-healed hydration.',
        );
        return migratedSnapshot;
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

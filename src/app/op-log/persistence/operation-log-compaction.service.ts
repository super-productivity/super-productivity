import { inject, Injectable } from '@angular/core';
import { LockService } from '../sync/lock.service';
import {
  COMPACTION_RETENTION_MS,
  COMPACTION_TIMEOUT_MS,
  EMERGENCY_COMPACTION_RETENTION_MS,
  LOCK_NAMES,
  SLOW_COMPACTION_THRESHOLD_MS,
} from '../core/operation-log.const';
import { OperationLogStoreService } from './operation-log-store.service';
import { StateSnapshotService } from '../backup/state-snapshot.service';
import { CURRENT_SCHEMA_VERSION } from './schema-migration.service';
import { VectorClockService } from '../sync/vector-clock.service';
import { OpLog } from '../../core/log';
import { extractEntityKeysFromState } from './extract-entity-keys';
import { CLIENT_ID_PROVIDER, ClientIdProvider } from '../util/client-id.provider';
import { limitVectorClockSize } from '../../core/util/vector-clock';
import { hasMeaningfulStateData } from '../validation/has-meaningful-state-data.util';
import { OperationCaptureService } from '../capture/operation-capture.service';
import { OperationWriteFlushService } from '../sync/operation-write-flush.service';
import { getDeferredActions } from '../capture/operation-capture.meta-reducer';

/**
 * Manages the compaction (garbage collection) of the operation log.
 * To prevent the log from growing indefinitely, this service periodically
 * creates a complete snapshot of the current application state and stores it
 * in IndexedDB. It then deletes old operations from the log that are already
 * reflected in the snapshot and have been successfully synced (if applicable)
 * and are older than a defined retention window.
 */
@Injectable({ providedIn: 'root' })
export class OperationLogCompactionService {
  private opLogStore = inject(OperationLogStoreService);
  private lockService = inject(LockService);
  private stateSnapshot = inject(StateSnapshotService);
  private vectorClockService = inject(VectorClockService);
  private clientIdProvider: ClientIdProvider = inject(CLIENT_ID_PROVIDER);
  private operationCapture = inject(OperationCaptureService);
  private writeFlushService = inject(OperationWriteFlushService);

  async compact(): Promise<boolean> {
    return this._doCompact(COMPACTION_RETENTION_MS, false);
  }

  /**
   * Emergency compaction triggered when storage quota is exceeded.
   * Uses a shorter retention window (1 day instead of 7) to free more space.
   * Returns true if compaction succeeded, false otherwise.
   */
  async emergencyCompact(): Promise<boolean> {
    try {
      return await this._doCompact(EMERGENCY_COMPACTION_RETENTION_MS, true);
    } catch (e) {
      OpLog.err('OperationLogCompactionService: Emergency compaction failed', e);
      return false;
    }
  }

  /**
   * Core compaction logic shared between regular and emergency compaction.
   * @param retentionMs - How long to keep synced operations (in ms)
   * @param isEmergency - Whether this is an emergency compaction (for logging)
   */
  private async _doCompact(retentionMs: number, isEmergency: boolean): Promise<boolean> {
    const compactExclusively = async (): Promise<boolean> => {
      const startTime = Date.now();
      const label = isEmergency ? 'emergency ' : '';

      // A snapshot must never advance past remote operations whose reducers have
      // not committed yet. Otherwise restart hydration would treat those ops as
      // covered by the snapshot even though their state is missing from it.
      const pendingRemoteOps = await this.opLogStore.getPendingRemoteOps();
      this.checkCompactionTimeout(startTime, `${label}pending operation check`);
      if (pendingRemoteOps.length > 0) {
        OpLog.warn(
          'OperationLogCompactionService: Skipping compaction — remote reducer work is pending',
        );
        return false;
      }

      // #8469: the await above may have let a local dispatch land. Its reducer
      // effect would be captured in the state below while its op is still
      // unsequenced, so the cache would be tagged behind an op it already
      // contains and the next boot would re-apply it (double-applying
      // non-idempotent reducers). Deferred actions (buffered during a sync
      // window, kept across windows after a failed drain) are in the same
      // position but invisible to the pending counter, so check both. The
      // check and the state read run in one synchronous block — no dispatch
      // can interleave, and new deferrals cannot start while we hold the lock
      // (the sync window that buffers them requires it). Bail; compaction
      // re-triggers on the next threshold. The emergency path skips this: the
      // failing write itself keeps the counter elevated (see below).
      if (
        !isEmergency &&
        (this.operationCapture.getPendingCount() > 0 || getDeferredActions().length > 0)
      ) {
        OpLog.warn(
          'OperationLogCompactionService: Skipping compaction — local writes are pending (in-flight or deferred)',
        );
        return false;
      }

      // 1. Get current state from NgRx store
      const currentState = this.stateSnapshot.getStateSnapshotForOperationLog();
      this.checkCompactionTimeout(startTime, `${label}state snapshot`);

      // GUARD (#7892): never compact against an empty/degraded state. Compaction
      // both writes the state cache AND deletes old synced ops — if the live
      // state were a transient empty/initial state, we would cache emptiness and
      // then prune the very ops needed to recover. Skipping is always safe for
      // correctness: the op-log stays the source of truth and replaying the
      // un-pruned log reconstructs the correct state, including legitimate full
      // wipes. Trade-off: a store that is *genuinely* empty-but-active (e.g. the
      // user deleted everything yet keeps generating synced ops) will never get
      // its old synced ops pruned while it stays empty, so the log can grow. That
      // is an accepted cost — preventing empty-over-good is worth more than GC for
      // this rare case, and pruning resumes as soon as real data exists again.
      if (!hasMeaningfulStateData(currentState)) {
        OpLog.warn(
          'OperationLogCompactionService: Skipping compaction — current state has no ' +
            'meaningful data (refusing to overwrite cache and prune ops against empty state)',
        );
        return false;
      }

      // 2. Get current vector clock (max of all ops)
      const currentVectorClock = await this.vectorClockService.getCurrentVectorClock();
      this.checkCompactionTimeout(startTime, `${label}vector clock`);

      // Prune vector clock before persisting to prevent bloat (max 20 entries).
      // Without this, clocks can grow unbounded across sync cycles.
      const clientId = await this.clientIdProvider.loadClientId();
      const prunedClock = clientId
        ? limitVectorClockSize(currentVectorClock, clientId)
        : currentVectorClock;

      // 3. Get lastSeq IMMEDIATELY before writing cache to minimize race window
      // This ensures new ops written after this point have seq > lastSeq
      const lastSeq = await this.opLogStore.getLastSeq();

      // 4. Extract entity keys for conflict detection after compaction
      // This allows us to distinguish between entities that existed at snapshot time
      // vs new entities created later - critical for correct vector clock comparison
      const snapshotEntityKeys = extractEntityKeysFromState(currentState);

      // 5. Write to state cache with schema version and entity keys
      await this.opLogStore.saveStateCache({
        state: currentState,
        lastAppliedOpSeq: lastSeq,
        vectorClock: prunedClock,
        compactedAt: Date.now(),
        schemaVersion: CURRENT_SCHEMA_VERSION,
        snapshotEntityKeys,
      });

      // After snapshot is saved, new operations with seq > lastSeq won't be deleted

      // 6. Reset compaction counter (persistent across tabs/restarts)
      await this.opLogStore.resetCompactionCounter();

      // 7. Delete old terminal operations (keep recent for conflict resolution)
      const cutoff = Date.now() - retentionMs;

      await this.opLogStore.deleteOpsWhere((entry) => {
        const isRejected = entry.rejectedAt !== undefined;
        const isApplicationComplete =
          isRejected ||
          entry.applicationStatus === undefined ||
          entry.applicationStatus === 'applied';
        const terminalAt = entry.rejectedAt ?? entry.appliedAt;

        return (
          (entry.syncedAt !== undefined || isRejected) &&
          isApplicationComplete &&
          terminalAt < cutoff &&
          entry.seq <= lastSeq // keep tail for conflict frontier
        );
      });

      // Log metrics for slow compaction or emergency compaction
      const totalDuration = Date.now() - startTime;
      if (totalDuration > SLOW_COMPACTION_THRESHOLD_MS || isEmergency) {
        OpLog.normal('OperationLogCompactionService: Compaction completed', {
          durationMs: totalDuration,
          entityCount: snapshotEntityKeys.length,
          isEmergency,
        });
      }

      return true;
    };

    // #8469: drain the capture pipeline before capturing so no action can be
    // dispatched-but-unsequenced at the state read — otherwise its effect is
    // baked into the cache while its seq lands after lastAppliedOpSeq, and the
    // next boot's tail replay double-applies it. Emergency compaction is
    // invoked from the failing write's own call stack (quota handling), where
    // that write's pending-counter entry is still elevated — flushing there
    // would wait on ourselves until the flush timeout and break quota
    // recovery, so it keeps the bare lock and accepts the residual re-replay
    // window.
    return isEmergency
      ? this.lockService.request(LOCK_NAMES.OPERATION_LOG, compactExclusively)
      : this.writeFlushService.flushThenRunExclusive(compactExclusively);
  }

  /**
   * Checks if compaction has exceeded the timeout threshold.
   * If exceeded, throws an error to abort compaction before the lock expires.
   * This prevents data corruption from concurrent access.
   */
  private checkCompactionTimeout(startTime: number, phase: string): void {
    const elapsed = Date.now() - startTime;
    if (elapsed > COMPACTION_TIMEOUT_MS) {
      throw new Error(
        `Compaction timeout after ${elapsed}ms during ${phase}. ` +
          `Aborting to prevent lock expiration. ` +
          `Consider reducing state size or increasing timeout.`,
      );
    }
  }
}

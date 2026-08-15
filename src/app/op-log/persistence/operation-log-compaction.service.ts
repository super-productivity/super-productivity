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
import { hasMeaningfulStateData } from '../validation/has-meaningful-state-data.util';
import { OperationCaptureService } from '../capture/operation-capture.service';
import { getPhantomChangeRisk } from '../capture/phantom-change-guard.util';
import { OperationWriteFlushService } from '../sync/operation-write-flush.service';
import { HydrationStateService } from '../apply/hydration-state.service';
import { TabSeqFrontierService } from './tab-seq-frontier.service';

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
  private operationCapture = inject(OperationCaptureService);
  private writeFlushService = inject(OperationWriteFlushService);
  private hydrationState = inject(HydrationStateService);
  private tabSeqFrontier = inject(TabSeqFrontierService);

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
    // Fast-path (re-checked inside the lock via getPhantomChangeRisk): the
    // divergence flag is sticky for the session, so once set every attempt
    // would skip anyway — avoid the cross-tab lock churn, since a compact()
    // fires after every write while the counter sits at the threshold.
    if (this.operationCapture.hasUnrecoveredPersistFailure()) {
      OpLog.warn(
        'OperationLogCompactionService: Skipping compaction — an unrecovered persist failure left live state ahead of the op log (#8751)',
      );
      return false;
    }
    // Same fast-path rationale for the sticky #9438 divergence flag: it only
    // clears on re-hydration/baseline install, compact() re-fires after every
    // write once the counter sits at the threshold, and each attempt would
    // otherwise pay the flush + cross-tab lock + state capture below before
    // the in-lock guard skips anyway. The scalar frontier check stays in-lock
    // (it needs getLastSeq()); only the sticky half can be hoisted. Emergency
    // compaction is exempt from the #9438 guard, so it must not bail here.
    if (!isEmergency && this.tabSeqFrontier.hasKnownForeignWrites()) {
      OpLog.warn(
        'OperationLogCompactionService: Skipping compaction — sticky concurrent-tab divergence (#9438)',
      );
      return false;
    }
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

      // GUARD (#8751): live state must not be snapshotted while it contains
      // changes that no durable op represents (failed or still-pending writes,
      // undrained deferred actions) — the state-cache write below would bake
      // such a phantom change in as permanent, silent cross-device divergence.
      // Checked synchronously IMMEDIATELY before the snapshot read (no awaits
      // in between) so nothing can slip in behind the guard.
      //
      // DO NOT HOIST THIS ABOVE THE getPendingRemoteOps() AWAIT. The position
      // is load-bearing in both directions, and this is the upper bound:
      // triggerCompaction() fires from inside the write path, so the action
      // that triggered us is still counted pending here and is decremented on
      // a microtask chain once that write releases the lock we just took. The
      // await above is a real IndexedDB round-trip, which lets those
      // microtasks drain first — that is the ONLY reason the guard observes a
      // settled counter rather than skipping on every single attempt.
      // Checking earlier ("the cheap guard first") starves compaction
      // permanently. Covered by the guard-position spec.
      //
      // Skipping is always safe: the op-log stays the source of truth, and
      // compaction re-runs once writes settle / the deferred drain succeeds /
      // the user reloads after an unrecovered failure (the sticky snackbar
      // asks for exactly that). Note the quota corollary: emergency compaction is
      // invoked while the failing write is still pending, so it skips here
      // deterministically — freeing space at that moment is impossible
      // without baking that write's phantom change.
      const phantomRisk = getPhantomChangeRisk(this.operationCapture);
      if (phantomRisk) {
        OpLog.warn(
          `OperationLogCompactionService: Skipping ${label}compaction — ${phantomRisk} (#8751)`,
        );
        return false;
      }

      // GUARD (#9140): while this session booted via the hydration fallback,
      // the live state may be PARTIAL (rebuilt from the surviving op tail
      // only) while the intact-but-unhydratable snapshot still sits on disk.
      // Compacting would overwrite that last complete local copy AND prune
      // the ops the next boot's recovery replays. Skipping is always safe —
      // see the #7892 note below; pruning resumes after the next clean boot.
      if (this.hydrationState.isHydrationFallbackActive()) {
        OpLog.warn(
          `OperationLogCompactionService: Skipping ${label}compaction — hydration fallback recovery active (#9140)`,
        );
        return false;
      }

      // GUARD (#9084): hydration dispatches the snapshot's loadAllData and
      // only later replays the tail ops on top of it (await boundaries, no
      // lock in between). Compacting inside that gap would cache state
      // missing the tail ops' effects under a lastAppliedOpSeq that covers
      // them — and prune the very ops the next boot needs to recover them.
      // The guards above don't see this: the tail ops are already terminal
      // ('applied' in their original session), nothing pending or deferred.
      // Reachable via re-entrant hydration (PluginAPI.reInitData()) in a
      // session past the compaction threshold, or the legacy-snapshot
      // compact() in RemoteOpsProcessingService; on a cold boot repair
      // effects are held off by skipDuringSyncWindow() until after
      // hydrateStore() resolves. Skipping is always safe: the op-log stays
      // the source of truth and the next over-threshold write retriggers
      // compaction once hydration completes.
      if (this.hydrationState.isHydrationInProgress()) {
        OpLog.warn(
          `OperationLogCompactionService: Skipping ${label}compaction — hydration replay in progress (#9084)`,
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

      // 2. Get current vector clock (max of all ops); pruning happens inside
      // saveStateCache (store-owned, #9096)
      const currentVectorClock = await this.vectorClockService.getCurrentVectorClock();
      this.checkCompactionTimeout(startTime, `${label}vector clock`);

      // 3. Get lastSeq IMMEDIATELY before writing cache to minimize race window
      // This ensures new ops written after this point have seq > lastSeq
      const lastSeq = await this.opLogStore.getLastSeq();

      // GUARD (#9438): lastSeq is the global max across the SHARED store — a
      // concurrent tab's op is counted there while its effect is absent from
      // this tab's state. Anchoring the cache past it would make the next
      // boot's tail replay silently skip that op (and step 7 would prune ops
      // behind the false anchor). Emergency compaction is exempt so quota
      // recovery cannot wedge on a diverged tab — a real trade-off: a
      // diverged emergency compact could still write the stale anchor this
      // guard prevents (permanent op skip, NOT the bounded re-replay window
      // the bare-lock note below accepts). Today that is unreachable in the
      // quota path (the #8751 phantom guard skips deterministically there —
      // see the reachability note in operation-log.effects.ts); re-evaluate
      // this exemption if emergency compaction ever becomes completable.
      if (!isEmergency && !this.tabSeqFrontier.isSaveSafeAt(lastSeq)) {
        OpLog.warn(
          'OperationLogCompactionService: Skipping compaction — the op log ' +
            "contains writes from a concurrent tab that are not in this tab's " +
            'state (#9438)',
          { lastSeq, frontier: this.tabSeqFrontier.frontierSeq },
        );
        return false;
      }

      // 4. Extract entity keys for conflict detection after compaction
      // This allows us to distinguish between entities that existed at snapshot time
      // vs new entities created later - critical for correct vector clock comparison
      const snapshotEntityKeys = extractEntityKeysFromState(currentState);

      // 5. Write to state cache with schema version and entity keys
      await this.opLogStore.saveStateCache({
        state: currentState,
        lastAppliedOpSeq: lastSeq,
        vectorClock: currentVectorClock,
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

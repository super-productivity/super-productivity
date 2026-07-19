import { inject, Injectable, Injector } from '@angular/core';
import { Store } from '@ngrx/store';
import { OperationLogStoreService } from './operation-log-store.service';
import { processDeferredActions } from '../sync/process-deferred-actions-flush.util';
import { loadAllData } from '../../root-store/meta/load-all-data.action';
import { OperationLogMigrationService } from './operation-log-migration.service';
import {
  CURRENT_SCHEMA_VERSION,
  getOperationSchemaVersion,
  SchemaMigrationService,
} from './schema-migration.service';
import { OperationLogSnapshotService } from './operation-log-snapshot.service';
import { OperationLogRecoveryService } from './operation-log-recovery.service';
import { SyncHydrationService } from './sync-hydration.service';
import { ArchiveMigrationService } from './archive-migration.service';
import { OpLog } from '../../core/log';
import { StateSnapshotService, AppStateSnapshot } from '../backup/state-snapshot.service';
import {
  Operation,
  OperationLogEntry,
  OpType,
  RepairPayload,
  isFullStateOpType,
} from '../core/operation.types';
import { SnackService } from '../../core/snack/snack.service';
import { T } from '../../t.const';
import { IndexedDBOpenError } from '../core/errors/indexed-db-open.error';
import { alertDialog } from '../../util/native-dialogs';
import { ValidateStateService } from '../validation/validate-state.service';
import { OperationApplierService } from '../apply/operation-applier.service';
import { HydrationStateService } from '../apply/hydration-state.service';
import { bulkApplyOperations } from '../apply/bulk-hydration.action';
import { AppDataComplete } from '../model/model-config';
import { CLIENT_ID_PROVIDER, ClientIdProvider } from '../util/client-id.provider';
import { IS_ELECTRON } from '../../app.constants';
import {
  BulkReplayReducerFailure,
  runWithBulkReplayFailureCollector,
} from '../apply/bulk-replay-failure-collector';
import { runWithLoadAllDataFailureCollector } from '../apply/load-all-data-failure-guard.meta-reducer';
import { hasMeaningfulStateData } from '../validation/has-meaningful-state-data.util';

/**
 * sessionStorage key used to track auto-reload attempts after IndexedDB backing store errors.
 * Exported for use in tests.
 */
export const IDB_OPEN_ERROR_RELOAD_KEY = 'sp_idb_open_reload_attempt';

interface HydrationReplayBatch {
  operations: Operation[];
  atomicReplayGroups: string[][];
  sourceOpIdByReplayedOpId: Map<string, string>;
  sourceOpIdsWithReplay: Set<string>;
  sourceEntryByOpId: Map<string, OperationLogEntry>;
}

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
  private operationApplierService = inject(OperationApplierService);
  private hydrationStateService = inject(HydrationStateService);
  private injector = inject(Injector);
  private clientIdProvider: ClientIdProvider = inject(CLIENT_ID_PROVIDER);

  // Extracted services
  private snapshotService = inject(OperationLogSnapshotService);
  private recoveryService = inject(OperationLogRecoveryService);
  private syncHydrationService = inject(SyncHydrationService);
  private archiveMigrationService = inject(ArchiveMigrationService);

  // Track if schema migration ran during this hydration (requires validation)
  private _migrationRanDuringHydration = false;

  async hydrateStore(): Promise<void> {
    OpLog.normal('OperationLogHydratorService: Starting hydration...');

    // Reset the per-run migration flag: hydrateStore() genuinely re-enters on
    // this root singleton whenever a plugin calls PluginAPI.reInitData()
    // (plugin-bridge.service.ts -> DataInitService.reInit()). A stale `true`
    // would fire the post-migration convergence save — and Checkpoint B's
    // synchronous full-state validation — on a run where no migration ran.
    this._migrationRanDuringHydration = false;
    // Whether the on-disk cache already holds a fresh CURRENT_SCHEMA_VERSION
    // snapshot, so the post-migration convergence save at the end of the try
    // block can skip its redundant write. Assigned from the save's RETURN VALUE,
    // never set unconditionally: saveCurrentStateAsSnapshot() resolves normally
    // when a guard (#8751 phantom / #7892 empty) or a caught write failure
    // skipped the write, and treating that as "persisted" would suppress the
    // convergence save that is this method's whole point.
    // NB: this does not track migrateSnapshotWithBackup's step-5 persist — on the
    // healthy backfill path (migrated snapshot validates and is persisted) with
    // few/no tail ops, convergence still writes once more. That extra write is
    // harmless and its post-replay state is strictly more advanced, so it is not
    // worth extra plumbing to suppress; only the every-boot re-migration it
    // prevents matters.
    //
    // Nor is this strictly "once per schema bump per device": sync-hydration
    // persists its state cache WITHOUT a schemaVersion, which reads back as v1
    // and migrates on the next boot. That omission is deliberate and
    // load-bearing — downloaded snapshot data is never schema-migrated anywhere
    // else on the client (migrateStateIfNeeded has exactly one call site, on the
    // local state_cache) and the SYNC_IMPORT op carrying it is stamped
    // CURRENT_SCHEMA_VERSION, so op migration skips it too. Do NOT "fix" that
    // writer by stamping a version: it would freeze old-schema remote data into
    // a cache Checkpoint B then trusts unvalidated. Convergence only stamps a
    // version AFTER the migration chain has actually run, which is safe.
    let snapshotPersistedDuringHydration = false;

    try {
      // PERF: Parallel startup operations - all access different IndexedDB stores
      // and don't depend on each other's results, so they can run concurrently.
      const [pendingRemoteOps, , hasBackup] = await Promise.all([
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
      let hydrationFallbackRan = false;
      if (snapshot && this.schemaMigrationService.needsMigration(snapshot)) {
        try {
          snapshot = await this.snapshotService.migrateSnapshotWithBackup(snapshot);
          this._migrationRanDuringHydration = true;
        } catch (migrationErr) {
          // #9140: escalating a migration throw would hit attemptRecovery(),
          // which refuses while a snapshot exists on disk — the every-boot
          // empty-store brick. The backup was already restored (nothing
          // destroyed), so skip the unmigratable-but-intact snapshot for this
          // boot and rebuild from the op-log instead. The fallback never
          // persists its result; recovery re-runs each boot until a fixed
          // build hydrates the intact snapshot again.
          await this._fallBackToOpLogReplay(
            migrationErr,
            'Schema migration failed',
            pendingRemoteOps,
          );
          hydrationFallbackRan = true;
          snapshot = null;
        }
      }

      // 3. Validate snapshot if it exists
      if (snapshot && !this.snapshotService.isValidSnapshot(snapshot)) {
        OpLog.warn('OperationLogHydratorService: Snapshot is invalid/corrupted.');
        // The snapshot is only a load-time cache — the op-log is the source of
        // truth. Before surrendering to recovery (which, with no legacy data and
        // no sync, drops to an EMPTY store), check whether the op-log itself is
        // intact and rebuild from it (#7892).
        //
        // Correctness: compaction only ever prunes *synced* ops, so for a
        // no-sync client the entire log survives and replay-from-0 fully
        // reconstructs state; for a synced client any pruned ops still live on
        // the remote and a subsequent sync restores them. Either way, replaying
        // the surviving log is strictly better than discarding it for empty.
        const lastSeq = await this.opLogStore.getLastSeq();
        if (lastSeq > 0) {
          OpLog.warn(
            `OperationLogHydratorService: Discarding corrupt snapshot and replaying ` +
              `the op-log from the start (lastSeq=${lastSeq}).`,
          );
          // Fall through to the "no snapshot → replay all operations" branch.
          snapshot = null;
        } else {
          OpLog.warn(
            'OperationLogHydratorService: No op-log to replay. Attempting recovery...',
          );
          await this.recoveryService.attemptRecovery();
          sessionStorage.removeItem(IDB_OPEN_ERROR_RELOAD_KEY);
          return;
        }
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
        const stateToLoad = snapshot.state as AppStateSnapshot;
        const snapshotSchemaVersion = (snapshot as { schemaVersion?: number })
          .schemaVersion;
        const needsSyncValidation =
          this._migrationRanDuringHydration ||
          snapshotSchemaVersion !== CURRENT_SCHEMA_VERSION;

        if (needsSyncValidation) {
          OpLog.normal(
            'OperationLogHydratorService: Running synchronous validation (migration ran or schema mismatch)',
          );
          await this._validateStateForHydration(
            stateToLoad as unknown as Record<string, unknown>,
            'snapshot',
          );
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
          // setVectorClock prunes internally (store-owned, #9096) — this also
          // bounds legacy snapshot clocks saved before pruning existed.
          await this.opLogStore.setVectorClock(snapshot.vectorClock);
          OpLog.normal(
            'OperationLogHydratorService: Restored vector clock from snapshot',
            { clockSize: Object.keys(snapshot.vectorClock).length },
          );
        }

        // 3. Hydrate NgRx with (possibly repaired) snapshot
        // stateToLoad is AppStateSnapshot which is runtime-compatible but TypeScript can't verify
        //
        // #9140 (guarded dispatch): a feature reducer throw does NOT surface
        // here — rxjs diverts it to an async unhandled-error report and
        // silently tears down the store's state subscription, so hydration
        // would "succeed" against a dead store that drops every later
        // dispatch. The loadAllData failure guard catches inside the reducer
        // chain instead, keeps the store alive, and reports here so we can
        // fall back to op-log replay (a throwing reducer commits no state).
        // See loadAllDataFailureGuardMetaReducer.
        let snapshotLoadFailure: Error | undefined;
        runWithLoadAllDataFailureCollector(
          (error) => (snapshotLoadFailure = error),
          () =>
            this.store.dispatch(
              loadAllData({
                appDataComplete: stateToLoad as unknown as AppDataComplete,
              }),
            ),
        );

        if (snapshotLoadFailure !== undefined) {
          await this._fallBackToOpLogReplay(
            snapshotLoadFailure,
            'loadAllData reducer rejected the snapshot state',
            pendingRemoteOps,
          );
          hydrationFallbackRan = true;
        } else {
          // 4. Replay tail operations (A.7.13: with operation migration)
          snapshotPersistedDuringHydration = await this._replayTailOps(
            snapshot.lastAppliedOpSeq,
            pendingRemoteOps,
          );
          OpLog.normal('OperationLogHydratorService: Hydration complete.');
        }
      } else if (!hydrationFallbackRan) {
        snapshotPersistedDuringHydration =
          await this._replayAllOpsFromScratch(pendingRemoteOps);
      }

      // Legacy cleanup placeholder - kept for future maintenance operations if needed
      await this._runLegacyCleanupIfNeeded();

      // Retry any failed remote ops from previous conflict resolution attempts
      // Now that state is fully hydrated, dependencies might be resolved
      await this.retryFailedRemoteOps();

      // CONVERGENCE: when a schema migration ran during this hydration but no
      // fresh snapshot was persisted yet, persist one now from the current,
      // reducer-healed state so the on-disk cache reaches CURRENT_SCHEMA_VERSION.
      // Without this the migrated snapshot's safety-net path
      // (migrateSnapshotWithBackup rolls the on-disk cache back to the old-schema
      // backup and hydrates unpersisted) never advances the cache, so migration +
      // validation re-run on EVERY launch for a not-yet-backfilled required
      // field. This resolves the TODO(followup) in
      // operation-log-snapshot.service.ts.
      //
      // Gated on re-validating the LIVE current state: an unhealed or corrupt
      // state must never be cached, because this is the write that flips the next
      // boot into Checkpoint B's trust-without-validating path. The save routes
      // through saveCurrentStateAsSnapshot(), so the #8469 quiesce, #8751 phantom
      // guard and #7892 empty-overwrite guard all still apply and may safely SKIP
      // (never corrupt) the write — in which case we simply re-migrate next boot,
      // exactly as before this change.
      //
      // The whole block is best-effort and must never escalate an otherwise
      // successful hydration into the catch below: recovery would refuse (a
      // snapshot exists) and surface the very "Failed to load data" this fix
      // removes. Only the on-disk cache is at stake; the store is already
      // hydrated.
      // The #9140 fallback persists nothing — the convergence save must not
      // undo that by caching the partial replay over the intact snapshot.
      if (
        this._migrationRanDuringHydration &&
        !snapshotPersistedDuringHydration &&
        !hydrationFallbackRan
      ) {
        try {
          // Drain explicitly rather than relying on retryFailedRemoteOps(): it
          // early-returns before its finally when there are no failed ops (the
          // common boot), so actions buffered during the replay's sync window
          // would still be pending and the phantom-change guard (#8751) would
          // skip the save. No-ops when the buffer is empty.
          await processDeferredActions(this.injector, false);

          const isConvergedStateValid = await this._validateCurrentStateForHydration(
            'post-migration-convergence',
          );
          if (isConvergedStateValid) {
            OpLog.normal(
              'OperationLogHydratorService: Persisting current-schema snapshot after migration to converge in one boot.',
            );
            await this.snapshotService.saveCurrentStateAsSnapshot();
          } else {
            OpLog.warn(
              'OperationLogHydratorService: Skipping post-migration convergence save — ' +
                'current state did not validate; will re-migrate next boot.',
            );
          }
        } catch (convergenceErr) {
          OpLog.err(
            'OperationLogHydratorService: Post-migration convergence failed; will re-migrate next boot.',
            { name: (convergenceErr as Error | undefined)?.name },
          );
        }
      }

      // #9140: gate compaction while the fallback's possibly-partial state is
      // live; a later clean run (plugin reInit) re-enables it.
      this.hydrationStateService.setHydrationFallbackActive(hydrationFallbackRan);

      // Clear the auto-reload guard so that a fresh backing-store error in the same
      // tab session gets the auto-reload treatment again rather than going straight
      // to the manual recovery dialog.
      sessionStorage.removeItem(IDB_OPEN_ERROR_RELOAD_KEY);
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
   * #9140: gate for the op-log replay fallback. Rethrows `cause` (preserving
   * the original error for the terminal catch) when: IndexedDB itself is
   * broken (terminal catch shows the IDB-specific guidance); the store
   * already holds meaningful data — hydrateStore() re-enters on a LIVE store
   * via PluginAPI.reInitData(), and replay-from-0 on top would double-apply
   * non-idempotent reducers; or the op-log has no rows (cheap pre-filter —
   * _replayAllOpsFromScratch re-checks the reducer-rejected-filtered set).
   */
  private async _assertOpLogReplayFallbackViable(cause: unknown): Promise<void> {
    if (cause instanceof IndexedDBOpenError) {
      throw cause;
    }
    if (hasMeaningfulStateData(this.stateSnapshotService.getStateSnapshot())) {
      throw cause;
    }
    if ((await this.opLogStore.getLastSeq()) === 0) {
      throw cause;
    }
  }

  /**
   * #9140: hydrates from an op-log replay-from-scratch after the snapshot
   * could not be hydrated, and makes the degraded recovery visible. Throws
   * (via the gate or the replay) when the fallback cannot safely produce
   * state — the terminal catch then keeps the pre-#9140 behavior.
   */
  private async _fallBackToOpLogReplay(
    cause: unknown,
    reason: string,
    pendingRemoteOps: OperationLogEntry[],
  ): Promise<void> {
    await this._assertOpLogReplayFallbackViable(cause);
    OpLog.err(
      `OperationLogHydratorService: ${reason}. Skipping the snapshot for this boot and replaying the op-log from the start.`,
      cause,
    );
    await this._replayAllOpsFromScratch(pendingRemoteOps, cause);
    // Visible degradation; fires only after the replay produced state (a
    // replay throw takes the terminal HYDRATION_FAILED path instead).
    this.snackService.open({
      type: 'ERROR',
      msg: T.F.SYNC.S.HYDRATION_FALLBACK_RECOVERY,
    });
  }

  /**
   * Replays the tail operations after a hydrated snapshot (A.7.13: with
   * operation migration).
   *
   * Replay is status-blind except for durable reducer rejections
   * (getOpsAfterSeq has no status filter) — every other entry's reducer
   * effect belongs in state exactly once:
   * - applied ops: their effect is state history by definition.
   * - failed ops (remote, archive side effect threw): their reducers DID
   *   commit before the failure (bulk dispatch precedes archive handling),
   *   so replay restores that effect; retryFailedRemoteOps() then re-runs
   *   ONLY the outstanding archive side effects.
   * - rejected ops: every rejection path appends its compensation AFTER
   *   them in seq order, so replay converges to post-resolution runtime
   *   state — server-rejected local ops are followed by merged ops
   *   (SupersededOperationResolver) or keep their effect (permanent
   *   rejections never revert state), and LWW-losing remote ops are
   *   followed by the local-win op that overwrites them
   *   (ConflictResolutionService).
   * - reducerRejectedAt ops: conversion, schema migration, or reducer
   *   application could not produce state, so replay must not try them
   *   again on every startup.
   *
   * @returns Whether a fresh snapshot was persisted during the replay.
   */
  private async _replayTailOps(
    lastAppliedOpSeq: number,
    pendingRemoteOps: OperationLogEntry[],
  ): Promise<boolean> {
    const tailOps = (await this.opLogStore.getOpsAfterSeq(lastAppliedOpSeq)).filter(
      (entry) => entry.reducerRejectedAt === undefined,
    );

    if (tailOps.length === 0) {
      return false;
    }

    // Optimization: If last op is SyncImport or Repair, skip replay and load directly
    const lastEntry = tailOps[tailOps.length - 1];
    const lastOp = lastEntry.op;
    // The shortcut is safe only when the entire replay range has a
    // durable reducer outcome. An earlier pending row still needs bulk
    // replay/checkpointing even if a later full-state op replaces its
    // visible state; otherwise that row would quarantine sync forever.
    const hasPendingReducerWork = tailOps.some(
      (entry) => entry.applicationStatus === 'pending',
    );
    const appData = hasPendingReducerWork
      ? undefined
      : this._extractFullStateFromOp(lastOp);
    if (appData) {
      OpLog.normal(
        `OperationLogHydratorService: Last of ${tailOps.length} tail ops is ${lastOp.opType}, loading directly`,
      );

      // Validate the full-state data before loading to NgRx.
      // The check is non-fatal: we log issues but still dispatch so the user
      // sees their data rather than a half-loaded UI. Repair is intentionally
      // not attempted here (it requires a confirm dialog that breaks Electron
      // focus on Windows — see issue #7631).
      await this._validateStateForHydration(
        appData as Record<string, unknown>,
        'tail-full-state-op-load',
      );
      // FIX: Merge vector clock BEFORE dispatching loadAllData
      // This ensures any operations created synchronously during loadAllData
      // (e.g., TODAY_TAG repair) will have the correct merged clock.
      // Without this, those operations get superseded clocks and are rejected by the server.
      await this.opLogStore.mergeRemoteOpClocks([lastOp]);
      this.store.dispatch(
        loadAllData({
          appDataComplete: appData as unknown as AppDataComplete,
        }),
      );
      // No snapshot save needed - full state ops already contain complete state
      // Snapshot will be saved after next batch of regular operations
      return false;
    }

    // A.7.13: Migrate tail operations before replay
    const replayBatch = this._migrateTailOps(tailOps);
    const opsToReplay = replayBatch.operations;

    const droppedCount = tailOps.length - replayBatch.sourceOpIdsWithReplay.size;
    OpLog.normal(
      `OperationLogHydratorService: Replaying ${opsToReplay.length} tail ops ` +
        `(${droppedCount} dropped during migration).`,
    );
    // PERF: Use bulk dispatch to apply all operations in a single NgRx update.
    // This reduces 500 dispatches to 1, dramatically improving startup performance.
    // The bulkHydrationMetaReducer iterates through ops and applies each action.
    // Lenient (no throw) so a cold-boot IndexedDB hiccup can't block
    // startup. A null clientId leaves the bulk-apply flag unset, which
    // defaults to own-op semantics (apply faithfully) — the safe
    // direction for the common case (replaying THIS device's own ops).
    // See bulkOperationsMetaReducer.
    const localClientId = (await this.clientIdProvider.loadClientId()) ?? undefined;
    const tailOpIds = new Set(tailOps.map((entry) => entry.op.id));
    await this._dispatchHydrationReplay(
      replayBatch,
      localClientId,
      pendingRemoteOps.filter((entry) => tailOpIds.has(entry.op.id)),
    );

    // CHECKPOINT C: Validate state after replaying tail operations.
    // If invalid, we keep the data on screen but skip the snapshot save so
    // we don't cache corrupted state for next boot.
    const isStateValid = await this._validateCurrentStateForHydration('tail-replay');

    // 5. If we replayed many ops AND state is valid, save a new snapshot
    // for faster future loads.
    if (isStateValid && opsToReplay.length > 10) {
      OpLog.normal(
        `OperationLogHydratorService: Saving new snapshot after replaying ${opsToReplay.length} ops`,
      );
      return this.snapshotService.saveCurrentStateAsSnapshot();
    }
    return false;
  }

  /**
   * Replays the entire op-log from seq 0 against the store's current (initial)
   * state. Runs when no snapshot exists, and as the #9140 fallback when the
   * snapshot cannot be hydrated (migration throw / loadAllData reducer
   * rejection) but the op-log still has replayable rows.
   *
   * MUST only run while the store holds no snapshot-derived state: bulk replay
   * applies ops ON TOP of current state, so replay-from-0 after a committed
   * loadAllData would double-apply non-idempotent reducers. The no-snapshot
   * call site satisfies this trivially; the #9140 fallback call sites are
   * guarded by _assertOpLogReplayFallbackViable (throws happen pre-commit, and
   * the live-store check rejects re-entrant hydration).
   *
   * @param fallbackCause - Set when running as the #9140 fallback while an
   *   INTACT (merely unhydratable-this-build) snapshot is still on disk: the
   *   replay then rethrows the cause when nothing is replayable (instead of
   *   booting silently empty) and NEVER persists its result — for a synced
   *   client the surviving log is only a compaction-window tail and a
   *   cursor-based sync never re-sends pruned ops, so persisting would
   *   overwrite the last complete local copy.
   * @returns Whether a fresh snapshot was persisted during the replay.
   */
  private async _replayAllOpsFromScratch(
    pendingRemoteOps: OperationLogEntry[],
    fallbackCause?: unknown,
  ): Promise<boolean> {
    OpLog.warn(
      'OperationLogHydratorService: Replaying all operations from the start of the op-log.',
    );
    // We might be in a fresh install state or post-migration-check with no
    // legacy data. Replay ALL operations from the beginning of the log.
    // Status-blind except for durable reducer rejections — see the replay
    // policy note on _replayTailOps.
    const allOps = (await this.opLogStore.getOpsAfterSeq(0)).filter(
      (entry) => entry.reducerRejectedAt === undefined,
    );

    if (allOps.length === 0) {
      if (fallbackCause !== undefined) {
        // Rows exist (the gate pre-checked) but every one is reducer-rejected:
        // booting silently empty would be worse than the terminal path.
        throw fallbackCause;
      }
      // Fresh install - no data at all. The caller's common tail clears the
      // IDB reload guard.
      OpLog.normal(
        'OperationLogHydratorService: Fresh install detected. No data to load.',
      );
      return false;
    }

    // Optimization: If last op is SyncImport or Repair, skip replay and load directly
    const lastEntry = allOps[allOps.length - 1];
    const lastOp = lastEntry.op;
    const hasPendingReducerWork = allOps.some(
      (entry) => entry.applicationStatus === 'pending',
    );
    const appData = hasPendingReducerWork
      ? undefined
      : this._extractFullStateFromOp(lastOp);
    if (appData) {
      OpLog.normal(
        `OperationLogHydratorService: Last of ${allOps.length} ops is ${lastOp.opType}, loading directly`,
      );

      // Validate the full-state data before loading to NgRx (non-fatal).
      await this._validateStateForHydration(
        appData as Record<string, unknown>,
        'full-state-op-load',
      );
      // FIX: Merge vector clock BEFORE dispatching loadAllData
      // Same fix as the tail ops branch - prevents superseded clock bug
      await this.opLogStore.mergeRemoteOpClocks([lastOp]);
      this.store.dispatch(
        loadAllData({
          appDataComplete: appData as unknown as AppDataComplete,
        }),
      );
      // No snapshot save needed - full state ops already contain complete state
      OpLog.normal('OperationLogHydratorService: Full replay complete.');
      return false;
    }

    // A.7.13: Migrate all operations before replay
    const replayBatch = this._migrateTailOps(allOps);
    const opsToReplay = replayBatch.operations;

    const droppedCount = allOps.length - replayBatch.sourceOpIdsWithReplay.size;
    OpLog.normal(
      `OperationLogHydratorService: Replaying all ${opsToReplay.length} ops ` +
        `(${droppedCount} dropped during migration).`,
    );
    // PERF: Use bulk dispatch to apply all operations in a single NgRx update.
    // This reduces 500 dispatches to 1, dramatically improving startup performance.
    // The bulkHydrationMetaReducer iterates through ops and applies each action.
    // Lenient (no throw) so a cold-boot IndexedDB hiccup can't block
    // startup. A null clientId leaves the bulk-apply flag unset, which
    // defaults to own-op semantics (apply faithfully) — the safe direction
    // for the common case (replaying THIS device's own ops). See
    // bulkOperationsMetaReducer.
    const localClientId = (await this.clientIdProvider.loadClientId()) ?? undefined;
    const allOpIds = new Set(allOps.map((entry) => entry.op.id));
    await this._dispatchHydrationReplay(
      replayBatch,
      localClientId,
      pendingRemoteOps.filter((entry) => allOpIds.has(entry.op.id)),
    );

    if (fallbackCause !== undefined) {
      // #9140 fallback mode: never overwrite the intact on-disk snapshot with
      // the (possibly partial) replay — see the @param doc.
      OpLog.warn(
        'OperationLogHydratorService: Fallback replay complete — keeping the existing on-disk snapshot (no persist).',
      );
      return false;
    }

    // CHECKPOINT C: Validate state after replaying all operations.
    // If invalid, we still proceed but skip the snapshot save so we don't
    // cache corrupted state for next boot.
    const isStateValid = await this._validateCurrentStateForHydration('full-replay');

    // Save snapshot after replay for faster future loads (only when valid).
    let snapshotPersisted = false;
    if (isStateValid) {
      OpLog.normal(
        `OperationLogHydratorService: Saving snapshot after replaying ${opsToReplay.length} ops`,
      );
      snapshotPersisted = await this.snapshotService.saveCurrentStateAsSnapshot();
    }

    OpLog.normal('OperationLogHydratorService: Full replay complete.');
    return snapshotPersisted;
  }

  /**
   * Replays a hydration batch and durably records its reducer outcome before
   * startup can retry archive side effects or save a snapshot past the batch.
   */
  private async _dispatchHydrationReplay(
    replayBatch: HydrationReplayBatch,
    localClientId: string | undefined,
    pendingRemoteOps: OperationLogEntry[],
  ): Promise<void> {
    const {
      operations,
      atomicReplayGroups,
      sourceOpIdByReplayedOpId,
      sourceOpIdsWithReplay,
      sourceEntryByOpId,
    } = replayBatch;
    const reducerFailures: BulkReplayReducerFailure[] = [];
    this.hydrationStateService.startApplyingRemoteOps();
    try {
      runWithBulkReplayFailureCollector(
        (failure) => reducerFailures.push(failure),
        () =>
          this.store.dispatch(
            bulkApplyOperations({
              operations,
              localClientId,
              ...(atomicReplayGroups.length > 0 ? { atomicReplayGroups } : {}),
            }),
          ),
      );
    } finally {
      this.hydrationStateService.endApplyingRemoteOps();
    }

    const failedFullStateOp = reducerFailures.find((failure) =>
      isFullStateOpType(failure.op.opType),
    );
    if (failedFullStateOp) {
      throw failedFullStateOp.error;
    }

    const failedLocalOp = reducerFailures.find((failure) => {
      const sourceOpId = sourceOpIdByReplayedOpId.get(failure.op.id) ?? failure.op.id;
      return sourceEntryByOpId.get(sourceOpId)?.source === 'local';
    });
    if (failedLocalOp) {
      throw failedLocalOp.error;
    }

    const reducerFailedSourceOpIds = new Set(
      reducerFailures.map(
        (failure) => sourceOpIdByReplayedOpId.get(failure.op.id) ?? failure.op.id,
      ),
    );
    const committedPendingEntries = pendingRemoteOps.filter(
      (entry) =>
        sourceOpIdsWithReplay.has(entry.op.id) &&
        !reducerFailedSourceOpIds.has(entry.op.id),
    );
    const committedPendingOps = committedPendingEntries.map((entry) => entry.op);
    const committedPendingSeqs = committedPendingEntries.map((entry) => entry.seq);
    const migratedOutPendingEntries = pendingRemoteOps.filter(
      (entry) => !sourceOpIdsWithReplay.has(entry.op.id),
    );
    const migratedOutPendingOpIds = migratedOutPendingEntries.map((entry) => entry.op.id);
    const rejectedOpIds = [
      ...new Set([...reducerFailedSourceOpIds, ...migratedOutPendingOpIds]),
    ];

    // Make the entire replay frontier durable before terminally marking any
    // reducer failure. If startup crashes after the clock write, the rows stay
    // pending and replay safely; the inverse order could filter a rejected row
    // on the next boot before its clock was ever merged.
    await this.opLogStore.mergeRemoteOpClocks([
      ...operations,
      ...migratedOutPendingEntries.map((entry) => entry.op),
    ]);

    if (committedPendingOps.length > 0 || rejectedOpIds.length > 0) {
      await this.opLogStore.markReducersCommittedAndMergeClocks(
        committedPendingSeqs,
        committedPendingOps,
        rejectedOpIds,
      );
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
   * @param entries - The durable operation-log rows to migrate
   * @returns Migrated operations plus their durable source-row lineage
   */
  private _migrateTailOps(entries: OperationLogEntry[]): HydrationReplayBatch {
    // Lenient boundary: a malformed stored schemaVersion (legacy or corrupt
    // entry) must not abort the WHOLE hydration into attemptRecovery() — that
    // trades one questionable op for possible tail-data loss on every boot.
    // Strict parsing stays on the receive/upload paths; locally we replay the
    // op verbatim as a best effort (stamping the current version so
    // migrateOperations passes it through unchanged, preserving order).
    const sanitizedOps = entries.map(({ op }) => {
      try {
        getOperationSchemaVersion(op);
        return op;
      } catch {
        OpLog.warn(
          'OperationLogHydratorService: Stored op has a malformed schemaVersion; replaying verbatim without migration.',
          { id: op.id },
        );
        return { ...op, schemaVersion: CURRENT_SCHEMA_VERSION };
      }
    });

    // Check if any ops need migration
    const needsMigration = sanitizedOps.some((op) =>
      this.schemaMigrationService.operationNeedsMigration(op),
    );

    const sourceOpIdByReplayedOpId = new Map<string, string>();
    const sourceOpIdsWithReplay = new Set<string>();
    const sourceEntryByOpId = new Map(entries.map((entry) => [entry.op.id, entry]));

    if (!needsMigration) {
      for (const op of sanitizedOps) {
        sourceOpIdByReplayedOpId.set(op.id, op.id);
        sourceOpIdsWithReplay.add(op.id);
      }
      return {
        operations: sanitizedOps,
        atomicReplayGroups: [],
        sourceOpIdByReplayedOpId,
        sourceOpIdsWithReplay,
        sourceEntryByOpId,
      };
    }

    OpLog.normal(
      `OperationLogHydratorService: Migrating ${sanitizedOps.length} tail ops to current schema version...`,
    );

    const atomicReplayGroups: string[][] = [];
    const operations = sanitizedOps.flatMap((op) => {
      const migrationResult = this.schemaMigrationService.operationNeedsMigration(op)
        ? this.schemaMigrationService.migrateOperation(op)
        : op;
      const migratedOps = migrationResult
        ? Array.isArray(migrationResult)
          ? migrationResult
          : [migrationResult]
        : [];
      if (migratedOps.length > 0) {
        sourceOpIdsWithReplay.add(op.id);
      }
      if (migratedOps.length > 1) {
        atomicReplayGroups.push(migratedOps.map((migratedOp) => migratedOp.id));
      }
      for (const migratedOp of migratedOps) {
        sourceOpIdByReplayedOpId.set(migratedOp.id, op.id);
      }
      return migratedOps;
    });

    return {
      operations,
      atomicReplayGroups,
      sourceOpIdByReplayedOpId,
      sourceOpIdsWithReplay,
      sourceEntryByOpId,
    };
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
   * Validates a state object during hydration without attempting repair.
   *
   * Repair is intentionally not run here: it requires a native `confirm()` dialog
   * which steals focus from the renderer on Windows and leaves the UI unresponsive
   * to keyboard/mouse input until the window is refocused (issue #7631). Validation
   * failures are logged but non-fatal — the caller continues with the original state
   * so the user sees their data rather than a half-loaded UI.
   *
   * @returns Whether the state is valid.
   */
  private async _validateStateForHydration(
    state: Record<string, unknown>,
    context: string,
  ): Promise<boolean> {
    const result = await this.validateStateService.validateState(state);
    if (!result.isValid) {
      OpLog.err(`[OperationLogHydratorService] Validation failed for ${context}`, {
        typiaErrorCount: result.typiaErrors.length,
        crossModelError: result.crossModelError,
      });
      return false;
    }
    return true;
  }

  /**
   * Validates the current NgRx state after replay.
   * Used to gate the snapshot save — we must not persist a corrupted snapshot.
   *
   * @param context - Context string for logging
   * @returns Whether the current state is valid.
   */
  private async _validateCurrentStateForHydration(context: string): Promise<boolean> {
    const currentState = this.stateSnapshotService.getStateSnapshot();
    return this._validateStateForHydration(
      currentState as unknown as Record<string, unknown>,
      context,
    );
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
   * Failed ops are ops whose archive side effect threw after their reducers
   * committed, so the retry runs archive side effects ONLY
   * (`skipReducerDispatch`) — hydration replay / the snapshot already carry
   * their reducer effects.
   */
  async retryFailedRemoteOps(): Promise<void> {
    const failedOps = await this.opLogStore.getFailedRemoteOps();

    if (failedOps.length === 0) {
      return;
    }

    OpLog.normal(
      `OperationLogHydratorService: Retrying ${failedOps.length} previously failed remote ops...`,
    );

    // Retry as ONE seq-ordered batch, not one op at a time. A per-op retry turns
    // every applyOperations() call into a single-op batch, and the same-batch
    // archive pre-scan (collectTaskRemovalEntityIdsFromBatch) returns an
    // empty set for single-op batches — silently weakening the #7330
    // orphan-resurrection guard. Batching restores that protection and matches
    // how the primary remote-apply path (applyRemoteOperations) applies ops.
    // getFailedRemoteOps() reads from an index whose result order isn't part of
    // its contract, so sort by seq explicitly to keep causal order. See #8305.
    const orderedFailedOps = [...failedOps].sort((a, b) => a.seq - b.seq);
    const opsToApply = orderedFailedOps.map((e) => e.op);
    const opIdToSeq = new Map(orderedFailedOps.map((e) => [e.op.id, e.seq]));

    // `failed` can only be set AFTER a bulk dispatch committed (archive side
    // effects run after the dispatch and are the only per-op failure point),
    // so every failed op's reducer effect is already in state — via the
    // snapshot when its seq <= lastAppliedOpSeq, via the status-blind tail
    // replay above otherwise. Skip the reducer dispatch and re-run only the
    // outstanding archive side effects: re-dispatching would double-apply
    // additive reducers (syncTimeSpent, increaseSimpleCounterCounterToday)
    // on every retry attempt.
    try {
      const result = await this.operationApplierService.applyOperations(opsToApply, {
        skipReducerDispatch: true,
        // The drain runs in the finally below with its own error boundary. Left
        // to the applier's finally, a drain throw would mask the archive result
        // (markFailed below never runs) and escalate out of hydrateStore() into
        // attemptRecovery(), which can import stale legacy data over a
        // correctly hydrated store.
        skipDeferredLocalActions: true,
      });

      // Mark successfully applied ops.
      const appliedSeqs = result.appliedOps
        .map((op) => opIdToSeq.get(op.id))
        .filter((seq): seq is number => seq !== undefined);
      if (appliedSeqs.length > 0) {
        // The primary remote-apply path (applyRemoteOperations) merges clocks at
        // reducer commit for the WHOLE batch, including ops whose archive
        // handling later fails — so these clocks were usually merged already.
        // Re-merging here is a harmless component-wise max and also covers ops
        // that reached `failed`/`archive_pending` via crash recovery, where the
        // reducer-commit callback (and its clock merge) may never have run.
        await this.opLogStore.mergeRemoteOpClocks(result.appliedOps);
        await this.opLogStore.markApplied(appliedSeqs);
        OpLog.normal(
          `OperationLogHydratorService: Successfully retried ${appliedSeqs.length} failed ops`,
        );
      }

      // On a partial failure the batch applier stops at the first archive error.
      // Charge only that attempted operation: successors remain archive-pending
      // without consuming retry budget and will run after the blocker succeeds.
      // A persistent blocker stays failed so ordinary sync remains safely paused.
      if (result.failedOp) {
        const failedOpIds = [result.failedOp.op.id];

        OpLog.warn(
          `OperationLogHydratorService: Failed to retry op ${result.failedOp.op.id}`,
          result.failedOp.error,
        );
        // Keep archive failure visible to the sync safety gate. A retry cap that
        // rejects it would hide incomplete downloaded work and allow false IN_SYNC.
        await this.opLogStore.markFailed(failedOpIds);
        OpLog.warn(
          'OperationLogHydratorService: Archive operation still failing after retry',
        );
      }
    } finally {
      // Local actions captured while the retry held the remote-apply window
      // open. Runs after mergeRemoteOpClocks so their clocks dominate the
      // retried remote ops (#7700). A failed drain keeps the actions buffered
      // for the next drain point (e.g. the pre-sync flush) — never escalate
      // it into hydration recovery.
      try {
        await processDeferredActions(this.injector, false);
      } catch (drainError) {
        OpLog.err(
          'OperationLogHydratorService: Deferred-action drain failed after archive retry; actions stay buffered.',
          { name: (drainError as Error | undefined)?.name },
        );
      }
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

    // Hoist platform detection — used in both branches below to avoid computing twice
    const isFlatpak = IS_ELECTRON && window.ea?.isFlatpak?.();
    const isSnap = !isFlatpak && IS_ELECTRON && window.ea?.isSnap?.();

    // For backing-store errors (common during Linux session startup with autostart),
    // auto-reload once after the user dismisses the dialog. By the time the dialog
    // is dismissed the OS / Flatpak sandbox will usually have finished initializing.
    // A sessionStorage counter prevents an infinite reload loop on genuine errors.
    if (error.isBackingStoreError) {
      const reloadCount = +(sessionStorage.getItem(IDB_OPEN_ERROR_RELOAD_KEY) || '0');
      if (reloadCount === 0) {
        // Silent auto-reload on first occurrence — most likely a transient startup
        // timing issue (Flatpak sandbox not ready, stale LOCK file). The user is
        // typically not watching (autostart scenario), so a blocking dialog requiring
        // a click before the reload is unnecessary friction. If the reload fixes it,
        // the user never needs to know. If it fails again, the dialog below runs.
        OpLog.warn(
          'IndexedDB backing-store error on first attempt — triggering silent auto-reload',
        );
        sessionStorage.setItem(IDB_OPEN_ERROR_RELOAD_KEY, '1');
        this._triggerReload();
        return;
      }
    }

    // Second failure, or non-backing-store error: show full manual recovery instructions.
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
        (isFlatpak
          ? '3. If using Linux Flatpak with autostart, try disabling autostart and launching manually\n'
          : isSnap
            ? '3. If using Linux Snap, try: snap set core experimental.refresh-app-awareness=true\n'
            : '3. If using Linux with autostart, try disabling autostart and launching manually\n') +
        '4. If issue persists, check available disk space\n\n';
    }

    message +=
      'If the problem continues after restart, your browser storage may need to be cleared.\n\n' +
      `Technical details: ${originalMsg}\n\n` +
      '(Check browser console for full error details)';

    alertDialog(message);
  }

  /**
   * Triggers an app reload. Uses Electron IPC in Electron context, browser reload otherwise.
   * Extracted as a method to allow spying in unit tests.
   */
  private _triggerReload(): void {
    if (IS_ELECTRON) {
      window.ea.reloadMainWin();
    } else {
      window.location.reload();
    }
  }
}

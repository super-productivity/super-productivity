import { inject, Injectable, Injector } from '@angular/core';
import { Store } from '@ngrx/store';
import { VectorClock, mergeVectorClocks } from '../../core/util/vector-clock';
import {
  ImportBackupRef,
  OperationLogStoreService,
} from '../persistence/operation-log-store.service';
import { TabSeqFrontierService } from '../persistence/tab-seq-frontier.service';
import { BackupService } from '../backup/backup.service';
import { OpLog } from '../../core/log';
import { OperationSyncCapable } from '../sync-providers/provider.interface';
import { getUnknownOpVocabulary } from './remote-op-block.util';
import { OperationLogDownloadService } from './operation-log-download.service';
import { SnackService } from '../../core/snack/snack.service';
import { T } from '../../t.const';
import { CaptureRacedRebuildError } from '../core/errors/sync-errors';
import { OperationWriteFlushService } from './operation-write-flush.service';
import { RepairSyncContextService } from '../validation/repair-sync-context.service';
import { RemoteOpsProcessingService } from './remote-ops-processing.service';
import { LocalDraftService } from '../../core/draft/local-draft.service';
import { VectorClockService } from './vector-clock.service';
import { SyncHydrationService } from '../persistence/sync-hydration.service';
import {
  CURRENT_SCHEMA_VERSION,
  MIN_SUPPORTED_SCHEMA_VERSION,
  SchemaMigrationService,
  getOperationSchemaVersion,
} from '../persistence/schema-migration.service';
import { getDefaultMainModelData, MODEL_CONFIGS } from '../model/model-config';
import { loadAllData } from '../../root-store/meta/load-all-data.action';
import { Operation } from '../core/operation.types';
import { ValidateStateService } from '../validation/validate-state.service';
import { extractEntityKeysFromState } from '../persistence/extract-entity-keys';
import { firstValueFrom } from 'rxjs';
import {
  selectNewInstallSections,
  selectSyncConfig,
} from '../../features/config/store/global-config.reducer';
import { buildRemoteRebuildBaselineState } from './remote-rebuild-baseline.util';
import {
  applyLocalOnlySyncSettingsToAppData,
  LocalOnlySyncSettings,
  stripLocalOnlySyncSettingsFromAppData,
} from '../../features/config/local-only-sync-settings.util';
import { OperationApplierService } from '../apply/operation-applier.service';
import { processDeferredActions } from './process-deferred-actions-flush.util';
import { partitionSnapshotOps } from './partition-snapshot-ops.util';

/**
 * The USE_REMOTE rebuild: replaces local data with the complete remote
 * history, resumes an interrupted rebuild's bookkeeping, and offers the
 * pre-replace backup back to the user. OperationLogSyncService stays the
 * entry point and decides when a rebuild runs or resumes.
 */
@Injectable({
  providedIn: 'root',
})
export class RemoteStateRebuildService {
  private store = inject(Store);
  private opLogStore = inject(OperationLogStoreService);
  private backupService = inject(BackupService);
  private downloadService = inject(OperationLogDownloadService);
  private snackService = inject(SnackService);
  private writeFlushService = inject(OperationWriteFlushService);
  private schemaMigrationService = inject(SchemaMigrationService);
  private validateStateService = inject(ValidateStateService);
  private repairSyncContext = inject(RepairSyncContextService);
  private tabSeqFrontier = inject(TabSeqFrontierService);
  private remoteOpsProcessingService = inject(RemoteOpsProcessingService);
  private localDraftService = inject(LocalDraftService);
  private vectorClockService = inject(VectorClockService);
  private syncHydrationService = inject(SyncHydrationService);
  private operationApplier = inject(OperationApplierService);
  private injector = inject(Injector);

  /**
   * Once-per-session latch for the USE_REMOTE newer-schema snack: the block
   * persists until an app update, and every auto/WS-triggered resume attempt
   * re-hits the preflight — without the latch the snack re-fires each time.
   */
  private _hasWarnedRebuildVersionBlockThisSession = false;

  /**
   * Force download all remote state, replacing local data.
   * This is used when user explicitly chooses "USE_REMOTE" in conflict resolution.
   *
   * Download-first rebuild: the COMPLETE server history (including this
   * client's own ops and ops already known locally) is downloaded and
   * validated BEFORE any local mutation. Only then is the local op-log
   * replaced wholesale with the server history and replayed from a defaults
   * baseline. Aborts without touching local state on download failure, an
   * empty remote, or a remote containing newer-schema ops.
   *
   * IMPORTANT: This also resets the vector clock to the remote's rebuilt clock
   * to ensure rejected local ops don't pollute the causal history.
   *
   * @param syncProvider - The sync provider to download from
   */
  async forceDownloadRemoteState(
    syncProvider: OperationSyncCapable,
    options?: {
      /**
       * Resuming an interrupted rebuild (crash between the baseline replacement
       * and the replay commit). Keeps the FIRST attempt's pre-replace safety
       * backup: the single backup slot still holds the user's original data,
       * and re-capturing here would overwrite it with the partial baseline.
       */
      isCrashResume?: boolean;
    },
  ): Promise<void> {
    OpLog.warn(
      'OperationLogSyncService: Force downloading remote state for a full rebuild.',
    );

    // ─────────────────────────────────────────────────────────────────────────
    // PHASE 1 — download and validate. Nothing local is mutated until the
    // complete server history is in memory: a network failure here must leave
    // local state untouched (previously the op-log was cleared and the cursor
    // reset BEFORE the download, so a failed download stranded the client with
    // destroyed local bookkeeping).
    //
    // Raw-rebuild mode: includes ops authored by this client and ops already
    // known locally. The normal download filters drop both, which made the old
    // USE_REMOTE unable to rebuild a server history this client had (fully or
    // partially) produced itself.
    // ─────────────────────────────────────────────────────────────────────────
    const result = await this.downloadService.downloadRemoteOps(syncProvider, {
      forceFromSeq0: true,
      includeOwnAndAppliedOps: true,
    });

    if (!result.success) {
      throw new Error(
        'Download failed - partial or no data received. ' +
          `failedFileCount=${result.failedFileCount}`,
      );
    }

    const hasSnapshotState =
      result.providerMode === 'fileSnapshotOps' && !!result.snapshotState;
    if (!hasSnapshotState && result.newOps.length === 0) {
      // An empty remote is not a state to adopt. Silently succeeding here used
      // to leave live NgRx state untouched while the op-log bookkeeping was
      // already wiped — state and log permanently disagreeing.
      throw new Error('USE_REMOTE aborted: remote returned no data to rebuild from.');
    }

    let migratedRemoteOps: Operation[];
    let migratedSnapshotIncludedOps: Operation[] = [];
    let migratedPostSnapshotOps: Operation[] = [];
    if (hasSnapshotState && result.providerMode === 'fileSnapshotOps') {
      const snapshotOps = partitionSnapshotOps(
        result.newOps,
        result.snapshotAppliedOpIds,
      );
      migratedSnapshotIncludedOps = this._preflightRemoteOperations(
        snapshotOps.snapshotIncludedOps,
      );
      migratedPostSnapshotOps = this._preflightRemoteOperations(
        snapshotOps.postSnapshotOps,
      );
      migratedRemoteOps = [...migratedSnapshotIncludedOps, ...migratedPostSnapshotOps];
    } else {
      migratedRemoteOps = this._preflightRemoteOperations(result.newOps);
    }

    const currentSyncConfig = await firstValueFrom(this.store.select(selectSyncConfig));
    const localOnlySyncSettings: LocalOnlySyncSettings = {
      isEnabled: currentSyncConfig.isEnabled,
      isEncryptionEnabled: currentSyncConfig.isEncryptionEnabled,
      syncProvider: currentSyncConfig.syncProvider,
      syncInterval: currentSyncConfig.syncInterval,
      isManualSyncOnly: currentSyncConfig.isManualSyncOnly,
    };

    let snapshotState = result.snapshotState as Record<string, unknown> | undefined;
    if (hasSnapshotState && snapshotState) {
      // File providers intentionally omit device-local schedule fields and null
      // the provider on the wire. Restore this device's values before schema
      // validation so a valid transport snapshot is locally replayable.
      snapshotState = applyLocalOnlySyncSettingsToAppData(
        stripLocalOnlySyncSettingsFromAppData(snapshotState),
        localOnlySyncSettings,
      ) as Record<string, unknown>;
      // User-initiated USE_REMOTE recovery: this validates in PHASE 1, before
      // the destructive replace acquires sp_op_log, and the user is in the
      // foreground — so keep the interactive confirm/acknowledge dialogs. Every
      // automatic/in-lock repair path uses the non-interactive default (#9026).
      const validation = await this.validateStateService.validateAndRepair(
        snapshotState,
        { interactive: true },
      );
      if (!validation.isValid) {
        throw new Error(
          'USE_REMOTE aborted: remote snapshot is invalid and could not be repaired.',
        );
      }
      if (validation.wasRepaired && validation.repairedState) {
        snapshotState = validation.repairedState;
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PHASE 2 — destructive replace (local mutations only, no network left).
    // The local op-log becomes exactly the server history: clearing ALL ops
    // (not just unsynced/full-state ones) lets the raw replay below re-append
    // and re-apply ops this client already knew. The old keep-synced-ops
    // variant made the duplicate filter skip them, so a "rebuild" replayed only
    // an unseen suffix onto a defaults reset.
    // ─────────────────────────────────────────────────────────────────────────
    // Reset the vector clock to the remote's causal knowledge (snapshot clock
    // merged with every downloaded op clock); only this device's own counter is
    // kept (in the lock below) so its next op never reuses a seen one (#11564).
    let rebuiltClock: VectorClock = { ...(result.snapshotVectorClock ?? {}) };
    for (const opClock of result.allOpClocks ?? []) {
      rebuiltClock = mergeVectorClocks(rebuiltClock, opClock);
    }
    const defaultData = getDefaultMainModelData();
    const baselineSource = snapshotState ?? defaultData;
    const baselineState = buildRemoteRebuildBaselineState(
      baselineSource,
      localOnlySyncSettings,
      await firstValueFrom(this.store.select(selectNewInstallSections)),
    );
    const archiveYoung =
      (snapshotState?.[
        'archiveYoung'
      ] as typeof MODEL_CONFIGS.archiveYoung.defaultData) ??
      MODEL_CONFIGS.archiveYoung.defaultData!;
    const archiveOld =
      (snapshotState?.['archiveOld'] as typeof MODEL_CONFIGS.archiveOld.defaultData) ??
      MODEL_CONFIGS.archiveOld.defaultData!;

    let capturedBackupRef: ImportBackupRef | undefined;
    let replacementCommitted = false;
    let backupRef: ImportBackupRef | undefined;
    let preservedLocalOps: Operation[] = [];
    // A capture racing the rebuild aborts the attempt (CaptureRacedRebuildError
    // from the asserts below). Retry in-call from the already-downloaded
    // history: the raced ops become durable in the next flush barrier and fold
    // into preservedLocalOps via the resume branch, so each retry converges —
    // important while e.g. active time tracking dispatches continuously, where
    // waiting for the next sync trigger would re-download everything per
    // attempt. In-memory reuse is safe: WS downloads and immediate uploads are
    // gated while the rebuild marker is set. On exhaustion, the persisted
    // marker hands over to the next-sync resume path as before.
    const MAX_CAPTURE_RACE_ATTEMPTS = 3;
    let isCrashResume = options?.isCrashResume ?? false;
    for (let attempt = 1; ; attempt++) {
      try {
        // flushThenRunExclusive drains the capture pipeline BEFORE acquiring the
        // op-log lock (flushPendingWrites re-acquires the same non-reentrant lock,
        // so flushing while holding it deadlocks) and re-checks inside the lock —
        // actions dispatched while the network request and preflight were in
        // flight are durably written and included in the reversible safety backup.
        backupRef = await this.writeFlushService.flushThenRunExclusive(async () => {
          let currentBackupRef: ImportBackupRef | undefined;
          if (isCrashResume) {
            // Keep the first attempt's pre-replace backup (see option JSDoc).
            const marker = await this.opLogStore.loadRawRebuildIncomplete();
            const storedBackup = await this.opLogStore.loadImportBackup();
            const expectedBackupRef = marker?.backupRef ?? capturedBackupRef;
            currentBackupRef = expectedBackupRef
              ? storedBackup?.backupId === expectedBackupRef.backupId
                ? expectedBackupRef
                : undefined
              : storedBackup
                ? {
                    backupId: storedBackup.backupId,
                    savedAt: storedBackup.savedAt,
                  }
                : undefined;
            capturedBackupRef ??= currentBackupRef;
            const liveLocalOps = (await this.opLogStore.getUnsynced()).map(
              (entry) => entry.op,
            );
            preservedLocalOps = this._mergeOperationsById(
              marker?.preservedLocalOps ?? [],
              liveLocalOps,
            );
          } else {
            try {
              currentBackupRef =
                await this.backupService.captureImportBackup('FORCE_DOWNLOAD');
              capturedBackupRef = currentBackupRef;
            } catch (e) {
              OpLog.warn(
                'OperationLogSyncService: Pre-replace safety backup failed; aborting force download.',
                { name: (e as Error | undefined)?.name },
              );
              throw new Error(
                'Pre-replace safety backup failed; aborting to preserve local state.',
              );
            }
          }

          // The provider cursor lives outside SUP_OPS, so it cannot join the IDB
          // transaction. Do not reset it eagerly: for file adapters that call is
          // also the durable-apply acknowledgement for the staged download. The
          // transaction stores a raw-rebuild-incomplete marker atomically with
          // the replacement, and crash recovery always re-downloads from seq 0;
          // the cursor is therefore advanced only after replay/hydration succeeds.
          await this.opLogStore.runRemoteStateReplacement({
            baselineState,
            vectorClock: await this.vectorClockService.keepOwnCounter(rebuiltClock),
            schemaVersion: CURRENT_SCHEMA_VERSION,
            snapshotEntityKeys: extractEntityKeysFromState(
              baselineState as unknown as Parameters<
                typeof extractEntityKeysFromState
              >[0],
            ),
            archiveYoung,
            archiveOld,
            preservedLocalOps,
            backupRef: currentBackupRef,
          });
          replacementCommitted = true;

          OpLog.normal(
            'OperationLogSyncService: Replaced local persistence with remote baseline.',
          );

          // FILE-BASED SYNC: Handle snapshot state from force download.
          // When downloading from seq 0 on file-based providers, we may receive a
          // snapshotState instead of incremental ops. This happens when the remote
          // has a SYNC_IMPORT (full state snapshot) with empty recentOps.
          // hydrateFromRemoteSync persists its own state cache + vector clock.
          if (result.providerMode === 'fileSnapshotOps' && snapshotState) {
            OpLog.normal(
              'OperationLogSyncService: Force download received snapshotState. Hydrating...',
            );

            // Hydrate from snapshot. We're accepting remote state, not
            // uploading local state, so no SYNC_IMPORT is created.
            await this.syncHydrationService.hydrateFromRemoteSync(
              snapshotState,
              result.snapshotVectorClock,
            );

            // Record only operations already represented by the snapshot. A
            // split-file suffix must still be dispatched on top of that state.
            if (migratedSnapshotIncludedOps.length > 0) {
              const appendResult = await this.opLogStore.appendSnapshotIncludedOps(
                migratedSnapshotIncludedOps,
              );
              OpLog.normal(
                `OperationLogSyncService: Wrote ${appendResult.writtenOps.length} snapshot ops to IndexedDB ` +
                  'after force-download hydration.' +
                  (appendResult.skippedCount > 0
                    ? ` Skipped ${appendResult.skippedCount} duplicate(s).`
                    : ''),
              );
            }

            if (migratedPostSnapshotOps.length > 0) {
              const processResult =
                await this.remoteOpsProcessingService.processRemoteOps(
                  migratedPostSnapshotOps,
                  {
                    skipConflictDetection: true,
                    callerHoldsOperationLogLock: true,
                    skipRecoveryPoint: true,
                  },
                );
              if (processResult.blockedByIncompatibleOp) {
                throw new Error(
                  'USE_REMOTE incomplete: a post-snapshot op failed schema migration during replay.',
                );
              }
            }

            await this._restorePreservedLocalOps(preservedLocalOps);

            await this._assertNoCaptureRacedWithRebuild();

            // Update lastServerSeq after hydration
            if (result.latestServerSeq !== undefined) {
              await syncProvider.setLastServerSeq(result.latestServerSeq);
            }

            const hasDurableRecovery = await this._completeRawRebuild(currentBackupRef);

            OpLog.normal(
              'OperationLogSyncService: Force download snapshot hydration complete.',
            );
            return hasDurableRecovery ? currentBackupRef : undefined;
          }

          // Reset live state to defaults, then replay the COMPLETE server history on
          // top. A full-state op in the history replaces state again by its own
          // semantics; a purely incremental history rebuilds from this baseline.
          this.store.dispatch(
            loadAllData({
              appDataComplete: defaultData as Parameters<
                typeof loadAllData
              >[0]['appDataComplete'],
            }),
          );
          // Brief yield to let NgRx process the state reset
          await new Promise((resolve) => setTimeout(resolve, 0));

          // Process all remote ops (no confirmation needed - user already chose USE_REMOTE).
          // Skip conflict detection because the NgRx store was just reset to empty state,
          // which causes all entities to appear missing and CONCURRENT ops to be discarded.
          // Validation failure is surfaced via the session-validation latch. (#7330)
          const processResult = await this.repairSyncContext.runWithBaseServerSeq(
            result.latestServerSeq,
            () =>
              this.remoteOpsProcessingService.processRemoteOps(migratedRemoteOps, {
                skipConflictDetection: true,
                callerHoldsOperationLogLock: true,
                skipRecoveryPoint: true,
                // Whole history onto the default baseline dispatched above; the
                // file-provider branch hydrates a snapshot first and must NOT
                // set this (#9863 genesis gate).
                isReplayFromEmptyBaseline: true,
              }),
          );

          if (processResult.blockedByIncompatibleOp) {
            // Version blocks were pre-checked above; only a migration exception lands
            // here. The rebuild is partial: keep the cursor at 0 so the next sync
            // retries the remainder, and surface the failure — the Undo snack still
            // offers the pre-replace backup.
            throw new Error(
              'USE_REMOTE incomplete: an op failed schema migration during replay.',
            );
          }

          await this._restorePreservedLocalOps(preservedLocalOps);

          await this._assertNoCaptureRacedWithRebuild();

          // Update lastServerSeq
          if (result.latestServerSeq !== undefined) {
            await syncProvider.setLastServerSeq(result.latestServerSeq);
          }

          const hasDurableRecovery = await this._completeRawRebuild(currentBackupRef);

          OpLog.normal(
            `OperationLogSyncService: Force download complete. Rebuilt from ${migratedRemoteOps.length} ops.`,
          );
          return hasDurableRecovery ? currentBackupRef : undefined;
        });
        break;
      } catch (e) {
        if (
          e instanceof CaptureRacedRebuildError &&
          attempt < MAX_CAPTURE_RACE_ATTEMPTS
        ) {
          OpLog.warn(
            `OperationLogSyncService: Local capture raced the rebuild; retrying phase 2 in-call ` +
              `(attempt ${attempt}/${MAX_CAPTURE_RACE_ATTEMPTS}).`,
          );
          // The replacement committed before the assert threw, so the marker is
          // set: re-enter through the crash-resume branch, which keeps the first
          // attempt's backup and merges the newly-durable raced ops.
          isCrashResume = true;
          continue;
        }
        // Final failure only — showing this per aborted attempt would churn the
        // single snack slot.
        if (replacementCommitted && capturedBackupRef) {
          await this.offerStrandedRebuildBackup();
        }
        throw e;
      }
    }

    // On a crash resume without a surviving backup there is nothing to offer.
    if (backupRef) {
      this._showRestorePreviousDataSnack(backupRef, true);
    }
  }

  private _mergeOperationsById(...operationGroups: Operation[][]): Operation[] {
    const merged: Operation[] = [];
    const seenIds = new Set<string>();
    for (const operations of operationGroups) {
      for (const op of operations) {
        if (!seenIds.has(op.id)) {
          seenIds.add(op.id);
          merged.push(op);
        }
      }
    }
    return merged;
  }

  private _assertNoCaptureRacedWithRebuild(): void {
    if (this.writeFlushService.hasPendingWrites()) {
      throw new CaptureRacedRebuildError();
    }
  }

  private async _completeRawRebuild(backupRef?: ImportBackupRef): Promise<boolean> {
    this._assertNoCaptureRacedWithRebuild();
    // #9438: every op the rebuild wrote inside this exclusive section is
    // applied to live state by now (processRemoteOps, the snapshot
    // materialization, and _restorePreservedLocalOps all throw on partial
    // apply), so the tab frontier equals the store tail again. Re-arm the
    // snapshot/compaction guard that the pre-rebuild ops wipe correctly left
    // default-open.
    this.tabSeqFrontier.establishFrontier(await this.opLogStore.getLastSeq());
    const hasDurableRecovery = await this.opLogStore.completeRawRebuild(backupRef);
    // This "Use Server Data" path replays the
    // complete server history over live state, replacing every note, and it
    // does NOT funnel through importCompleteBackup.
    this.localDraftService.deleteAllDrafts();
    return hasDurableRecovery;
  }

  /**
   * Replays edits captured after an interrupted rebuild on top of the complete
   * authoritative history. They stay local/unsynced so the next upload carries
   * the user's post-crash intent to the server.
   */
  private async _restorePreservedLocalOps(operations: Operation[]): Promise<void> {
    if (operations.length === 0) {
      return;
    }

    const { writtenOps } = await this.opLogStore.appendBatchSkipDuplicates(
      operations,
      'local',
    );
    if (writtenOps.length === 0) {
      return;
    }

    let restoredClock = (await this.opLogStore.getVectorClock()) ?? {};
    for (const op of writtenOps) {
      restoredClock = mergeVectorClocks(restoredClock, op.vectorClock);
    }
    await this.opLogStore.setVectorClock(restoredClock);

    const applyResult = await this.operationApplier.applyOperations(writtenOps, {
      // The authoritative replacement also overwrote archive IndexedDB stores,
      // so archive-affecting post-crash edits must replay their side effects.
      // The entries themselves remain source=local and unsynced in the op-log.
      isLocalHydration: false,
      skipDeferredLocalActions: true,
    });
    if (applyResult.failedOp || applyResult.appliedOps.length !== writtenOps.length) {
      throw new Error(
        'USE_REMOTE incomplete: post-crash local operations could not be restored.',
      );
    }

    await processDeferredActions(this.injector, true);
  }

  private _preflightRemoteOperations(remoteOps: Operation[]): Operation[] {
    for (const op of remoteOps) {
      let version: number;
      try {
        version = getOperationSchemaVersion(op as { schemaVersion?: unknown });
      } catch (e) {
        // Keep the root cause diagnosable (id-only, no payloads) — this is a
        // rare, support-heavy failure path.
        OpLog.err('OperationLogSyncService: USE_REMOTE preflight version parse failed', {
          id: op.id,
          name: (e as Error | undefined)?.name,
        });
        throw new Error(
          'USE_REMOTE aborted: remote history has an invalid schema version.',
          { cause: e },
        );
      }

      if (version < MIN_SUPPORTED_SCHEMA_VERSION) {
        throw new Error(
          'USE_REMOTE aborted: remote history contains an unsupported schema version.',
        );
      }
      if (version > CURRENT_SCHEMA_VERSION || getUnknownOpVocabulary(op) !== null) {
        if (
          !this._hasWarnedRebuildVersionBlockThisSession &&
          !this.snackService.hasPendingPersistentAction()
        ) {
          this._hasWarnedRebuildVersionBlockThisSession = true;
          this.snackService.open({
            type: 'ERROR',
            msg: T.F.SYNC.S.VERSION_TOO_OLD,
            actionStr: T.PS.UPDATE_APP,
            actionFn: () =>
              window.open('https://super-productivity.com/download', '_blank'),
          });
        }
        throw new Error(
          'USE_REMOTE aborted: remote history contains ops from a newer schema version or with an unknown op type — update the app first.',
        );
      }
    }

    try {
      return this.schemaMigrationService.migrateOperations(remoteOps);
    } catch (e) {
      OpLog.err('OperationLogSyncService: USE_REMOTE preflight migration failed', {
        name: (e as Error | undefined)?.name,
      });
      throw new Error('USE_REMOTE aborted: remote operation migration failed.', {
        cause: e,
      });
    }
  }

  /**
   * Shows a non-blocking snack after a destructive "Use Server Data" replace,
   * offering to restore the local snapshot captured before the wipe — making the
   * otherwise-irreversible replace reversible.
   *
   * WARNING type (honest framing of a data-replacement + provides a dismiss
   * control) and no auto-dismiss timer (duration: 0) so the undo isn't lost to a
   * timeout. (#8107)
   */
  private _showRestorePreviousDataSnack(
    backupRef: ImportBackupRef,
    isCompletedRecovery: boolean,
  ): void {
    this.snackService.open({
      type: 'WARNING',
      msg: T.F.SYNC.S.LOCAL_DATA_REPLACE_UNDO,
      actionStr: T.G.UNDO,
      actionFn: async (): Promise<void> => {
        try {
          const didRestore = await this.backupService.restoreImportBackup(backupRef);
          if (didRestore) {
            await this.opLogStore.clearRawRebuildRecovery(backupRef.backupId);
          }
          this.snackService.open({
            type: didRestore ? 'SUCCESS' : 'ERROR',
            msg: didRestore ? T.F.SYNC.S.RESTORE_SUCCESS : T.F.SYNC.S.RESTORE_ERROR,
          });
        } catch (e) {
          OpLog.err('OperationLogSyncService: Failed to restore pre-replace backup', {
            name: (e as Error | undefined)?.name,
          });
          this.snackService.open({ type: 'ERROR', msg: T.F.SYNC.S.RESTORE_ERROR });
        }
      },
      ...(isCompletedRecovery
        ? {
            dismissFn: async (): Promise<void> => {
              try {
                await this.opLogStore.retireCompletedRawRebuildRecovery(
                  backupRef.backupId,
                );
              } catch (error) {
                OpLog.err(
                  'OperationLogSyncService: Failed to retire dismissed rebuild recovery',
                  { name: (error as Error | undefined)?.name },
                );
              }
            },
          }
        : {}),
      config: { duration: 0 },
    });
  }

  /**
   * Boot-time entry point for raw-rebuild recovery (see StartupService).
   * Handles both an interrupted rebuild and a completed rebuild whose durable
   * Undo token survived a reload.
   */
  async offerInterruptedRebuildRecovery(): Promise<void> {
    await this.offerStrandedRebuildBackup();
  }

  /**
   * Offer the pre-replace Undo after an interrupted USE_REMOTE rebuild whose
   * resume could not finish. The first attempt already committed the destructive
   * baseline, so the user's original data survives only in the IMPORT_BACKUP
   * slot; without an explicit affordance here it has no restore entry point and
   * reads as total data loss. Skipped while a persistent recovery snack is
   * already showing, so repeated resume attempts (auto/WS syncs) don't respawn it.
   */
  async offerStrandedRebuildBackup(): Promise<void> {
    if (this.snackService.hasPendingPersistentAction()) {
      return;
    }
    const [incomplete, recovery, backup] = await Promise.all([
      this.opLogStore.loadRawRebuildIncomplete(),
      this.opLogStore.loadRawRebuildRecovery(),
      this.opLogStore.loadImportBackup(),
    ]);
    if (!incomplete && !recovery) {
      return;
    }
    if (!backup) {
      if (recovery && !incomplete) {
        await this.opLogStore.clearRawRebuildRecovery(recovery.backupId);
      }
      return;
    }

    // While incomplete, the surviving backup slot is still the authoritative
    // pre-rebuild snapshot. Completed recovery is stricter: its durable token
    // must match so an unrelated later import can never be offered as Undo.
    if (incomplete) {
      const expectedBackup = incomplete.backupRef;
      if (expectedBackup && expectedBackup.backupId !== backup.backupId) {
        return;
      }
      this._showRestorePreviousDataSnack(
        expectedBackup ?? {
          backupId: backup.backupId,
          savedAt: backup.savedAt,
        },
        false,
      );
    } else if (recovery && recovery.backupId === backup.backupId) {
      this._showRestorePreviousDataSnack(
        {
          backupId: recovery.backupId,
          savedAt: recovery.backupSavedAt,
        },
        true,
      );
    } else if (recovery) {
      await this.opLogStore.clearRawRebuildRecovery(recovery.backupId);
    }
  }
}

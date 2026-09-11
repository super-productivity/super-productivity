import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import { OperationLogStoreService } from './operation-log-store.service';
import { StateSnapshotService } from '../backup/state-snapshot.service';
import { ClientIdService } from '../../core/util/client-id.service';
import { VectorClockService } from '../sync/vector-clock.service';
import { ValidateStateService } from '../validation/validate-state.service';
import { SyncSessionValidationService } from '../sync/sync-session-validation.service';
import { loadAllData } from '../../root-store/meta/load-all-data.action';
import { Operation } from '../core/operation.types';
import { incrementVectorClock, mergeVectorClocks } from '../../core/util/vector-clock';
import { OpLog } from '../../core/log';
import { AppDataComplete } from '../model/model-config';
import { selectSyncConfig } from '../../features/config/store/global-config.reducer';
import { SnackService } from '../../core/snack/snack.service';
import { T } from '../../t.const';
import { ArchiveDbAdapter } from '../../core/persistence/archive-db-adapter.service';
import { ArchiveModel } from '../../features/time-tracking/time-tracking.model';
import { normalizeGlobalConfigStartOfNextDay } from '../../features/config/normalize-start-of-next-day-config';
import {
  applyLocalOnlySyncSettingsToAppData,
  stripLocalOnlySyncSettingsFromAppData,
} from '../../features/config/local-only-sync-settings.util';
import { LockService } from '../sync/lock.service';
import { LOCK_NAMES } from '../core/operation-log.const';
import { TaskTimeSyncService } from '../../features/tasks/task-time-sync.service';

interface SnapshotHydrationHooks {
  /** Remote operations already represented by a file-based snapshot. */
  snapshotIncludedOps?: readonly Operation[];
  /** Runs synchronously after downloaded archive replacement commits. */
  afterArchiveReplacement?: () => void;
  /** Runs synchronously after the snapshot baseline transaction commits. */
  afterSnapshotCachePersisted?: () => void;
  /** Runs synchronously after the complete snapshot baseline commits. */
  afterSnapshotPersisted?: () => void;
  /** Runs synchronously immediately before loadAllData replaces live NgRx state. */
  beforeStateLoad?: () => void;
  /** Runs synchronously after loadAllData has replaced live NgRx state. */
  afterStateLoad?: () => void;
}

/**
 * Handles hydration after remote sync downloads.
 *
 * Responsibilities:
 * - Merging entity models from sync with archive data from IndexedDB
 * - Creating SYNC_IMPORT operations with proper vector clocks
 * - Saving state cache (snapshot) for crash safety
 * - Updating NgRx with synced data
 *
 * This service is called by sync providers after downloading remote data,
 * instead of the normal startup hydration flow.
 */
@Injectable({ providedIn: 'root' })
export class SyncHydrationService {
  private store = inject(Store);
  private opLogStore = inject(OperationLogStoreService);
  private stateSnapshotService = inject(StateSnapshotService);
  private clientIdService = inject(ClientIdService);
  private vectorClockService = inject(VectorClockService);
  private validateStateService = inject(ValidateStateService);
  private sessionValidation = inject(SyncSessionValidationService);
  private snackService = inject(SnackService);
  private archiveDbAdapter = inject(ArchiveDbAdapter);
  private lockService = inject(LockService);
  private taskTimeSyncService = inject(TaskTimeSyncService);

  /**
   * Handles hydration after a remote sync download.
   * This method:
   * 1. Merges passed mainModelData (entity models) with IndexedDB data (archive models)
   * 2. Creates a SYNC_IMPORT operation to persist it to SUP_OPS (optional)
   * 3. Saves a new state cache (snapshot) for crash safety
   * 4. Dispatches loadAllData to update NgRx
   *
   * This is called instead of hydrateStore() after sync downloads to ensure
   * the synced data is persisted to SUP_OPS and loaded into NgRx.
   *
   * @param downloadedMainModelData - Entity models from remote meta file.
   *   These are NOT stored in IndexedDB (only archives are) so must be passed explicitly.
   * @param remoteVectorClock - Vector clock from the remote snapshot (for clock merging).
   * @param hooks - Internal orchestration hooks around archive and state replacement.
   */
  async hydrateFromRemoteSync(
    downloadedMainModelData?: Record<string, unknown>,
    remoteVectorClock?: Record<string, number>,
    hooks?: SnapshotHydrationHooks,
  ): Promise<void> {
    OpLog.normal('SyncHydrationService: Hydrating from remote sync...');

    try {
      // Capture the exact pending set before any snapshot work can yield. The
      // normal file-snapshot caller opens a remote-apply window around this
      // method, so user actions arriving after this read are deferred and must
      // be preserved on top of the downloaded snapshot rather than rejected as
      // if they belonged to the superseded local baseline.
      const unsyncedOpsToReject = await this.opLogStore.getUnsynced();

      // 0. Capture current local-only sync settings BEFORE overwriting
      // These settings should remain local to each client and not be overwritten by remote data.
      // FIX: isEnabled was not being preserved, causing sync to appear disabled after reload
      // when another client had sync disabled.
      const currentSyncConfig = await firstValueFrom(this.store.select(selectSyncConfig));
      const localOnlySettings = {
        isEnabled: currentSyncConfig.isEnabled,
        isEncryptionEnabled: currentSyncConfig.isEncryptionEnabled,
        syncProvider: currentSyncConfig.syncProvider,
        syncInterval: currentSyncConfig.syncInterval,
        isManualSyncOnly: currentSyncConfig.isManualSyncOnly,
      };

      const typedDownloadedData = downloadedMainModelData as
        | Record<string, unknown>
        | undefined;
      const downloadedArchiveYoung = typedDownloadedData?.['archiveYoung'] as
        | ArchiveModel
        | undefined;
      const downloadedArchiveOld = typedDownloadedData?.['archiveOld'] as
        | ArchiveModel
        | undefined;

      // 1. Replace downloaded archives and read the resulting snapshot under one
      // archive lock. Otherwise a local archive read-modify-write can start from
      // the old archive, then save it after this replacement and silently erase
      // downloaded entries. TASK_ARCHIVE is independent from OPERATION_LOG.
      const dbData = await this.lockService.request(LOCK_NAMES.TASK_ARCHIVE, async () => {
        // Archive writes are deferred to commitFileSnapshotBaseline(), where
        // archives, state, clock, and included operations commit atomically.
        // Read them under the same lock so the state cache and loadAllData
        // share one view.
        return this.stateSnapshotService.getAllSyncModelDataFromStoreAsync();
      });

      // 2. Merge the serialized archive data with passed entity data.

      const mergedData = downloadedMainModelData
        ? { ...dbData, ...downloadedMainModelData }
        : dbData;

      const syncedData = stripLocalOnlySyncSettingsFromAppData(mergedData);
      const locallyReplayableSyncedData = applyLocalOnlySyncSettingsToAppData(
        syncedData,
        localOnlySettings,
      );
      OpLog.normal(
        'SyncHydrationService: Loaded synced data',
        downloadedMainModelData
          ? '(merged passed entity models with archive data from DB)'
          : '(from state snapshot)',
      );

      // 3. Get client ID for vector clock (regenerate if missing or invalid)
      const clientId = await this.clientIdService.getOrGenerateClientId();

      // 4. Create SYNC_IMPORT operation with merged clock
      // CRITICAL: The SYNC_IMPORT's clock must include ALL known clients, not just local ones.
      // If we only use the local clock, ops from other clients will be CONCURRENT with
      // this import and get filtered out by SyncImportFilterService.
      // We merge: local clock + state cache clock + remote snapshot clock (if available).
      // The remote snapshot clock ensures we include knowledge from the uploading client,
      // preventing the "mutual SYNC_IMPORT discarding" bug during provider switch scenarios.
      const localClock = await this.vectorClockService.getCurrentVectorClock();
      const stateCache = await this.opLogStore.loadStateCache();
      const stateCacheClock = stateCache?.vectorClock || {};
      let mergedClock = mergeVectorClocks(localClock, stateCacheClock);

      // Merge remote snapshot clock to ensure SYNC_IMPORT dominates remote client's ops
      if (remoteVectorClock) {
        mergedClock = mergeVectorClocks(mergedClock, remoteVectorClock);
        OpLog.normal('SyncHydrationService: Merged remote snapshot vector clock', {
          remoteClockSize: Object.keys(remoteVectorClock).length,
        });
      }

      // Store-owned pruning (#9096): preserves the current client and — for
      // the file-snapshot bootstrap branch, where no SYNC_IMPORT is created
      // and a previously stored full-state op stays the filter baseline — the
      // latest full-state author. Must run after getOrGenerateClientId() so
      // the id is persisted for the store's lookup.
      const newClock = await this.opLogStore.pruneClockForStorage(
        incrementVectorClock(mergedClock, clientId),
      );

      // 4b. No SYNC_IMPORT is created on this path. That avoids "clean slate"
      // semantics, so concurrent ops from other clients are not filtered by
      // SyncImportFilterService.
      //
      // Any local pending ops are now based on superseded state and must be
      // rejected: without a SYNC_IMPORT, SyncImportFilterService won't filter
      // them automatically. The rejection is deferred into
      // commitFileSnapshotBaseline() below so it commits atomically with the
      // state replacement. Rejecting here (a separate transaction) would
      // strand these ops as permanently non-uploadable if the baseline commit
      // then failed (e.g. the op-log tail changed) and the old state survived.
      const lastSeq = await this.opLogStore.getLastSeq();

      // 7. Validate and repair synced data before dispatching.
      // This fixes stale task references (e.g., tags/projects referencing deleted tasks).
      // If the validator reports the data is *not* valid (and repair didn't
      // succeed), flip the SyncSessionValidationService latch so the wrapper
      // can refuse IN_SYNC. Without this, snapshot hydration would silently
      // accept corrupt remote data — a gap not covered by validateAfterSync
      // since this path bypasses processRemoteOps entirely. (#7330)
      const downloadedAppData = locallyReplayableSyncedData as AppDataComplete;
      const normalizedGlobalConfig = normalizeGlobalConfigStartOfNextDay(
        downloadedAppData.globalConfig,
      );
      let dataToLoad = normalizedGlobalConfig
        ? {
            ...downloadedAppData,
            globalConfig: normalizedGlobalConfig,
          }
        : downloadedAppData;
      // Runs inside the sp_op_log lock (flushThenRunExclusive) during automatic
      // snapshot hydration, so rely on the non-interactive default — a blocking
      // dialog on an invalid remote snapshot would starve lock contenders (#9026).
      const validationResult =
        await this.validateStateService.validateAndRepair(dataToLoad);
      if (validationResult.wasRepaired && validationResult.repairedState) {
        // Cast to any since Record<string, unknown> doesn't directly map to AppDataComplete
        dataToLoad = validationResult.repairedState as any;
        OpLog.normal('SyncHydrationService: Repaired synced data before loading');
      }
      if (!validationResult.isValid) {
        OpLog.err(
          'SyncHydrationService: Validation failed for hydrated remote snapshot — flagging session',
          { error: validationResult.error },
        );
        this.sessionValidation.setFailed();
      }

      // 8. Keep the full merged clock. Without a SYNC_IMPORT there is no
      // clean-slate baseline, so every known client entry must survive.
      const clockForStorage = newClock;

      // 9. Commit the durable snapshot baseline before replacing live state.
      // File snapshots include the downloaded archives and represented remote
      // operations in this same transaction. If any write fails, the old
      // baseline remains intact and mid-hydration local actions can safely drain
      // against it; there is no cache-only or ops-only restart state.
      {
        // Reject superseded local ops atomically with the state replacement.
        const rejectOpIds = unsyncedOpsToReject.map((entry) => entry.op.id);
        const appendResult = await this.opLogStore.commitFileSnapshotBaseline({
          state: dataToLoad,
          lastAppliedOpSeq: lastSeq,
          vectorClock: clockForStorage,
          compactedAt: Date.now(),
          snapshotIncludedOps: hooks?.snapshotIncludedOps ?? [],
          ...(rejectOpIds.length ? { rejectOpIds } : {}),
          ...(downloadedArchiveYoung ? { archiveYoung: downloadedArchiveYoung } : {}),
          ...(downloadedArchiveOld ? { archiveOld: downloadedArchiveOld } : {}),
        });
        if (downloadedArchiveYoung || downloadedArchiveOld) {
          hooks?.afterArchiveReplacement?.();
        }
        hooks?.afterSnapshotCachePersisted?.();
        OpLog.normal(
          `SyncHydrationService: Atomically committed file snapshot and ` +
            `${appendResult.writtenOps.length} included operation(s)` +
            (appendResult.skippedCount > 0
              ? `; skipped ${appendResult.skippedCount} duplicate(s)`
              : ''),
        );

        // Notify the user only after the rejection durably committed with the
        // new baseline — never before, so a failed commit leaves both the old
        // state and the still-uploadable local ops intact.
        if (rejectOpIds.length > 0) {
          OpLog.normal(
            `SyncHydrationService: Rejected ${rejectOpIds.length} local pending op(s) ` +
              `(superseded after file-based sync snapshot)`,
          );
          this.snackService.open({
            msg: T.F.SYNC.S.LOCAL_CHANGES_DISCARDED_SNAPSHOT,
            translateParams: { count: rejectOpIds.length },
          });
        }
      }
      hooks?.afterSnapshotPersisted?.();
      OpLog.normal('SyncHydrationService: Committed snapshot persistence baseline');

      // Flush the in-memory tracked-time accumulator into a durable syncTimeSpent
      // op BEFORE replacing NgRx. The accumulator holds time already applied to
      // the live state we are about to discard; left in place, that stale delta
      // later flushes as a LOCAL (non-remote) syncTimeSpent that the reducer
      // intentionally ignores (task.reducer only applies remote syncTimeSpent),
      // so the accepted time silently vanishes from live state until the next
      // op-log replay. Flushing captures it as a pending op (re-applied
      // additively on replay, and uploaded) and empties the accumulator so
      // nothing stale survives the replacement. Placed AFTER the baseline commit
      // so the appended op cannot move the op-log tail past the seq that
      // commitFileSnapshotBaseline() asserts. Unlike backup import — which
      // clear()s because it deliberately discards local concurrent state — sync
      // hydration preserves local edits (cf. snapshot-hydration handling).
      this.taskTimeSyncService.flush();

      // 10. Dispatch loadAllData to update NgRx
      hooks?.beforeStateLoad?.();
      this.store.dispatch(loadAllData({ appDataComplete: dataToLoad }));
      hooks?.afterStateLoad?.();
      OpLog.normal('SyncHydrationService: Dispatched loadAllData with synced data');
    } catch (e) {
      OpLog.err('SyncHydrationService: Error during hydrateFromRemoteSync', e);
      throw e;
    }
  }
}

import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import { OperationLogStoreService } from './operation-log-store.service';
import { CURRENT_SCHEMA_VERSION } from './schema-migration.service';
import { StateSnapshotService } from '../backup/state-snapshot.service';
import { ClientIdService } from '../../core/util/client-id.service';
import { VectorClockService } from '../sync/vector-clock.service';
import { ValidateStateService } from '../validation/validate-state.service';
import { loadAllData } from '../../root-store/meta/load-all-data.action';
import { Operation, OpType, ActionType, SyncImportReason } from '../core/operation.types';
import { uuidv7 } from '../../util/uuid-v7';
import {
  incrementVectorClock,
  limitVectorClockSize,
  mergeVectorClocks,
} from '../../core/util/vector-clock';
import { OpLog } from '../../core/log';
import { AppDataComplete } from '../model/model-config';
import { selectSyncConfig } from '../../features/config/store/global-config.reducer';
import { DEFAULT_GLOBAL_CONFIG } from '../../features/config/default-global-config.const';
import { SnackService } from '../../core/snack/snack.service';
import { T } from '../../t.const';
import { ArchiveDbAdapter } from '../../core/persistence/archive-db-adapter.service';
import { ArchiveModel } from '../../features/time-tracking/time-tracking.model';

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
  private snackService = inject(SnackService);
  private archiveDbAdapter = inject(ArchiveDbAdapter);

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
   * @param createSyncImportOp - Whether to create a SYNC_IMPORT operation. Set to false
   *   for file-based sync bootstrap to avoid "clean slate" semantics that would filter
   *   concurrent ops from other clients. Default is true for backwards compatibility
   *   and for explicit "use local/remote" conflict resolution flows.
   */
  async hydrateFromRemoteSync(
    downloadedMainModelData?: Record<string, unknown>,
    remoteVectorClock?: Record<string, number>,
    createSyncImportOp: boolean = true,
    syncImportReason?: SyncImportReason,
  ): Promise<void> {
    OpLog.normal('SyncHydrationService: Hydrating from remote sync...');

    try {
      // 0. Capture ALL local sync settings BEFORE overwriting with remote data.
      // Sync settings are entirely local-only — each client independently controls
      // its provider, interval, encryption, etc.
      const localSyncConfig = await firstValueFrom(this.store.select(selectSyncConfig));

      // 1. Write archives to IndexedDB if they were included in the downloaded data.
      // This is critical for file-based sync where archives are bundled with the snapshot.
      // Archives must be written BEFORE we read them back via getAllSyncModelDataFromStoreAsync().
      // NOTE: This only happens when actually applying remote state (not during conflict
      // detection - the downloadOps method no longer writes archives prematurely).
      if (downloadedMainModelData) {
        const typedData = downloadedMainModelData as Record<string, unknown>;
        if (typedData['archiveYoung']) {
          await this.archiveDbAdapter.saveArchiveYoung(
            typedData['archiveYoung'] as ArchiveModel,
          );
          OpLog.normal('SyncHydrationService: Wrote archiveYoung to IndexedDB from sync');
        }
        if (typedData['archiveOld']) {
          await this.archiveDbAdapter.saveArchiveOld(
            typedData['archiveOld'] as ArchiveModel,
          );
          OpLog.normal('SyncHydrationService: Wrote archiveOld to IndexedDB from sync');
        }
      }

      // 2. Read archive data from IndexedDB and merge with passed entity data
      // Entity models (task, tag, project, etc.) come from downloadedMainModelData
      // Archive models (archiveYoung, archiveOld) come from IndexedDB (now with synced data)
      const dbData = await this.stateSnapshotService.getAllSyncModelDataFromStoreAsync();

      const mergedData = downloadedMainModelData
        ? { ...dbData, ...downloadedMainModelData }
        : dbData;

      const syncedData = this._stripLocalOnlySettings(mergedData);
      OpLog.normal(
        'SyncHydrationService: Loaded synced data',
        downloadedMainModelData
          ? '(merged passed entity models with archive data from DB)'
          : '(from state snapshot)',
      );

      // 3. Get client ID for vector clock
      const clientId = await this.clientIdService.loadClientId();
      if (!clientId) {
        throw new Error('Failed to load clientId - cannot create SYNC_IMPORT operation');
      }

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

      const newClock = limitVectorClockSize(
        incrementVectorClock(mergedClock, clientId),
        clientId,
      );

      let lastSeq: number;

      if (createSyncImportOp) {
        // 4b. Create and append SYNC_IMPORT operation
        // This is used for explicit "use local/remote" conflict resolution where we want
        // "clean slate" semantics that discard concurrent ops from other clients.
        OpLog.normal('SyncHydrationService: Creating SYNC_IMPORT with merged clock', {
          localClockSize: Object.keys(localClock).length,
          stateCacheClockSize: Object.keys(stateCacheClock).length,
          remoteClockSize: remoteVectorClock ? Object.keys(remoteVectorClock).length : 0,
          mergedClockSize: Object.keys(mergedClock).length,
        });

        const op: Operation = {
          id: uuidv7(),
          actionType: ActionType.LOAD_ALL_DATA,
          opType: OpType.SyncImport,
          entityType: 'ALL',
          payload: syncedData,
          clientId: clientId,
          vectorClock: newClock,
          timestamp: Date.now(),
          schemaVersion: CURRENT_SCHEMA_VERSION,
          syncImportReason: syncImportReason ?? 'FILE_IMPORT',
        };

        // 5. Append operation to SUP_OPS
        await this.opLogStore.append(op, 'remote');
        OpLog.normal('SyncHydrationService: Persisted SYNC_IMPORT operation');

        // 6. Get the sequence number of the operation we just wrote
        lastSeq = await this.opLogStore.getLastSeq();
      } else {
        // 4b-alt. Skip SYNC_IMPORT creation for file-based sync bootstrap.
        // This avoids "clean slate" semantics so concurrent ops from other clients
        // won't be filtered by SyncImportFilterService.
        OpLog.normal(
          'SyncHydrationService: Skipping SYNC_IMPORT creation (file-based bootstrap)',
        );

        // CRITICAL: Reject any local pending ops since they're now based on superseded state.
        // Without SYNC_IMPORT, SyncImportFilterService won't automatically filter them.
        // These ops have superseded clocks and payloads that don't match the new snapshot.
        const unsyncedOps = await this.opLogStore.getUnsynced();
        if (unsyncedOps.length > 0) {
          const opIds = unsyncedOps.map((entry) => entry.op.id);
          await this.opLogStore.markRejected(opIds);
          OpLog.normal(
            `SyncHydrationService: Rejected ${unsyncedOps.length} local pending op(s) ` +
              `(superseded after file-based sync snapshot)`,
          );

          // Notify user that local changes were discarded
          this.snackService.open({
            msg: T.F.SYNC.S.LOCAL_CHANGES_DISCARDED_SNAPSHOT,
            translateParams: {
              count: unsyncedOps.length,
            },
          });
        }

        lastSeq = await this.opLogStore.getLastSeq();
      }

      // 7. Validate and repair synced data before dispatching
      // This fixes stale task references (e.g., tags/projects referencing deleted tasks)
      let dataToLoad = syncedData as AppDataComplete;
      const validationResult =
        await this.validateStateService.validateAndRepair(dataToLoad);
      if (validationResult.wasRepaired && validationResult.repairedState) {
        // Cast to any since Record<string, unknown> doesn't directly map to AppDataComplete
        dataToLoad = validationResult.repairedState as any;
        OpLog.normal('SyncHydrationService: Repaired synced data before loading');
      }

      // 7b. Restore ALL local sync settings into dataToLoad.
      // Sync settings are entirely local-only — each client independently controls
      // its provider, interval, encryption, compression, etc.
      if (dataToLoad.globalConfig) {
        dataToLoad = {
          ...dataToLoad,
          globalConfig: {
            ...dataToLoad.globalConfig,
            sync: localSyncConfig,
          },
        };
      }

      // 8. Determine the working clock to use.
      // When a SYNC_IMPORT was created, reset to minimal (only importing client's entry)
      // to prevent dead client IDs from accumulating. The SYNC_IMPORT operation stores
      // the full merged clock for SyncImportFilterService to use when filtering.
      // When no SYNC_IMPORT (file-based bootstrap), keep the full merged clock.
      let clockForStorage: Record<string, number>;
      if (createSyncImportOp) {
        clockForStorage = {};
        // Guard against undefined — consistent with mergeRemoteOpClocks() in OperationLogStoreService
        if (newClock[clientId] !== undefined) {
          clockForStorage[clientId] = newClock[clientId];
        }
        OpLog.normal('SyncHydrationService: Reset working clock to minimal after sync', {
          fullClockSize: Object.keys(newClock).length,
          minimalClockSize: Object.keys(clockForStorage).length,
        });
      } else {
        clockForStorage = newClock;
      }

      // 9. Save new state cache (snapshot) for crash safety
      await this.opLogStore.saveStateCache({
        state: dataToLoad,
        lastAppliedOpSeq: lastSeq,
        vectorClock: clockForStorage,
        compactedAt: Date.now(),
      });
      OpLog.normal('SyncHydrationService: Saved state cache after sync');

      // 10. Update vector clock store
      // This is critical because:
      // - The SYNC_IMPORT was appended with source='remote', so store wasn't updated
      // - If user creates new ops in this session, incrementAndStoreVectorClock reads from store
      // - Without this, new ops would have clocks missing entries from the SYNC_IMPORT
      await this.opLogStore.setVectorClock(clockForStorage);
      OpLog.normal('SyncHydrationService: Updated vector clock store after sync');

      // 11. Dispatch loadAllData to update NgRx
      this.store.dispatch(loadAllData({ appDataComplete: dataToLoad }));
      OpLog.normal('SyncHydrationService: Dispatched loadAllData with synced data');
    } catch (e) {
      OpLog.err('SyncHydrationService: Error during hydrateFromRemoteSync', e);
      throw e;
    }
  }

  /**
   * Strips local-only settings from synced data to prevent them from being
   * overwritten by remote data. Sync settings are entirely local to each client.
   */
  private _stripLocalOnlySettings(data: unknown): unknown {
    if (!data || typeof data !== 'object') {
      return data;
    }

    const typedData = data as Record<string, unknown>;
    if (!typedData['globalConfig']) {
      return data;
    }

    const globalConfig = typedData['globalConfig'] as Record<string, unknown>;
    if (!globalConfig['sync']) {
      return data;
    }

    // Replace sync with defaults — the real local sync config will be
    // restored at step 7b. Using defaults (not undefined) ensures the
    // SYNC_IMPORT payload has a valid GlobalConfigState shape, which is
    // needed for validation and for replay on fresh installs.
    return {
      ...typedData,
      globalConfig: {
        ...globalConfig,
        sync: DEFAULT_GLOBAL_CONFIG.sync,
      },
    };
  }
}

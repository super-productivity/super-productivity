import { inject, Injectable } from '@angular/core';
import { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';
import {
  AppStateSnapshot,
  StateSnapshotService,
} from '../../op-log/backup/state-snapshot.service';
import { VectorClockService } from '../../op-log/sync/vector-clock.service';
import {
  CLIENT_ID_PROVIDER,
  ClientIdProvider,
} from '../../op-log/util/client-id.provider';
import { isOperationSyncCapable } from '../../op-log/sync/operation-sync.util';
import { SyncProviderId } from '../../op-log/sync-providers/provider.const';
import { SuperSyncPrivateCfg } from '../../op-log/sync-providers/super-sync/super-sync.model';
import { CURRENT_SCHEMA_VERSION } from '../../op-log/persistence/schema-migration.service';
import { SyncLog } from '../../core/log';
import { uuidv7 } from '../../util/uuid-v7';
import {
  OperationSyncCapable,
  SyncProviderServiceInterface,
} from '../../op-log/sync-providers/provider.interface';
import { VectorClock } from '../../core/util/vector-clock';

/**
 * Data gathered for a snapshot upload operation.
 */
export interface SnapshotUploadData {
  syncProvider: SyncProviderServiceInterface<SyncProviderId> & OperationSyncCapable;
  existingCfg: SuperSyncPrivateCfg | null;
  state: AppStateSnapshot;
  vectorClock: VectorClock;
  clientId: string;
}

/**
 * Result of a snapshot upload operation.
 */
export interface SnapshotUploadResult {
  accepted: boolean;
  serverSeq?: number;
  error?: string;
}

/**
 * Low-level service for snapshot upload mechanics.
 *
 * This service handles the mechanical aspects of uploading snapshots:
 * - Validating the SuperSync provider
 * - Gathering state, vector clock, and client ID
 * - Uploading the snapshot payload
 * - Updating the lastServerSeq
 *
 * Config orchestration (timing, error recovery, encryption settings)
 * remains the responsibility of calling services.
 *
 * @see EncryptionDisableService
 * @see EncryptionEnableService
 * @see ImportEncryptionHandlerService
 */
@Injectable({
  providedIn: 'root',
})
export class SnapshotUploadService {
  private _providerManager = inject(SyncProviderManager);
  private _stateSnapshotService = inject(StateSnapshotService);
  private _vectorClockService = inject(VectorClockService);
  private _clientIdProvider: ClientIdProvider = inject(CLIENT_ID_PROVIDER);

  /**
   * Validates that the active provider is SuperSync and operation-sync capable.
   *
   * @throws Error if no active provider, not SuperSync, or not operation-sync capable
   */
  getValidatedSuperSyncProvider(): SyncProviderServiceInterface<SyncProviderId> &
    OperationSyncCapable {
    const syncProvider = this._providerManager.getActiveProvider();

    if (!syncProvider) {
      throw new Error('No active sync provider. Please enable sync first.');
    }

    if (syncProvider.id !== SyncProviderId.SuperSync) {
      throw new Error(
        `This operation is only supported for SuperSync (current: ${syncProvider.id})`,
      );
    }

    if (!isOperationSyncCapable(syncProvider)) {
      throw new Error('Sync provider does not support operation sync');
    }

    return syncProvider as SyncProviderServiceInterface<SyncProviderId> &
      OperationSyncCapable;
  }

  /**
   * Gathers all data needed for a snapshot upload.
   *
   * This includes:
   * - Validated sync provider
   * - Existing private config
   * - Current state snapshot (loaded from IndexedDB)
   * - Vector clock
   * - Client ID
   *
   * @param logPrefix - Optional prefix for log messages
   * @throws Error if validation fails or client ID is not available
   */
  async gatherSnapshotData(logPrefix?: string): Promise<SnapshotUploadData> {
    const prefix = logPrefix ? `${logPrefix}: ` : '';
    const syncProvider = this.getValidatedSuperSyncProvider();

    const existingCfg =
      (await syncProvider.privateCfg.load()) as SuperSyncPrivateCfg | null;

    // IMPORTANT: Must use async version to load real archives from IndexedDB
    // The sync getStateSnapshot() returns DEFAULT_ARCHIVE (empty) which causes data loss
    SyncLog.normal(`${prefix}Getting current state...`);
    const state = await this._stateSnapshotService.getStateSnapshotAsync();
    const vectorClock = await this._vectorClockService.getCurrentVectorClock();
    const clientId = await this._clientIdProvider.loadClientId();

    if (!clientId) {
      throw new Error('Client ID not available');
    }

    return {
      syncProvider,
      existingCfg,
      state,
      vectorClock,
      clientId,
    };
  }

  /**
   * Uploads a snapshot payload to the server.
   *
   * This is a low-level method that just handles the upload mechanics.
   * Config management (before/after upload) is the caller's responsibility.
   *
   * @param syncProvider - The validated SuperSync provider
   * @param payload - The snapshot payload (plain or encrypted)
   * @param clientId - The client ID
   * @param vectorClock - The current vector clock
   * @param isPayloadEncrypted - Whether the payload is encrypted
   */
  async uploadSnapshot(
    syncProvider: SyncProviderServiceInterface<SyncProviderId> & OperationSyncCapable,
    payload: unknown,
    clientId: string,
    vectorClock: VectorClock,
    isPayloadEncrypted: boolean,
  ): Promise<SnapshotUploadResult> {
    const response = await syncProvider.uploadSnapshot(
      payload,
      clientId,
      'recovery',
      vectorClock,
      CURRENT_SCHEMA_VERSION,
      isPayloadEncrypted,
      uuidv7(),
    );

    return {
      accepted: response.accepted,
      serverSeq: response.serverSeq,
      error: response.error,
    };
  }

  /**
   * Updates the lastServerSeq after a successful upload.
   *
   * @param syncProvider - The SuperSync provider
   * @param serverSeq - The server sequence number
   * @param logPrefix - Optional prefix for log messages
   */
  async updateLastServerSeq(
    syncProvider: SyncProviderServiceInterface<SyncProviderId> & OperationSyncCapable,
    serverSeq: number | undefined,
    logPrefix?: string,
  ): Promise<void> {
    const prefix = logPrefix ? `${logPrefix}: ` : '';

    if (serverSeq !== undefined) {
      await syncProvider.setLastServerSeq(serverSeq);
    } else {
      SyncLog.err(
        `${prefix}Snapshot accepted but serverSeq is missing. ` +
          'Sync state may be inconsistent - consider using "Sync Now" to verify.',
      );
    }
  }
}

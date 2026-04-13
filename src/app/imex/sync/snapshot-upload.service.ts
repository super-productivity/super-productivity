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
  SyncProviderBase,
} from '../../op-log/sync-providers/provider.interface';
import { VectorClock } from '../../core/util/vector-clock';
import { OperationEncryptionService } from '../../op-log/sync/operation-encryption.service';
import { isCryptoSubtleAvailable } from '../../op-log/encryption/encryption';
import { WebCryptoNotAvailableError } from '../../op-log/core/errors/sync-errors';

/**
 * Data gathered for a snapshot upload operation.
 */
export interface SnapshotUploadData {
  syncProvider: SyncProviderBase<SyncProviderId> & OperationSyncCapable;
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
 * @see SuperSyncEncryptionToggleService
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
  private _encryptionService = inject(OperationEncryptionService);

  /**
   * Validates that the active provider is SuperSync and operation-sync capable.
   *
   * @throws Error if no active provider, not SuperSync, or not operation-sync capable
   */
  getValidatedSuperSyncProvider(): SyncProviderBase<SyncProviderId> &
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

    return syncProvider as SyncProviderBase<SyncProviderId> & OperationSyncCapable;
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
    syncProvider: SyncProviderBase<SyncProviderId> & OperationSyncCapable,
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
    syncProvider: SyncProviderBase<SyncProviderId> & OperationSyncCapable,
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

  /**
   * Deletes all server data and uploads a fresh snapshot with new encryption settings.
   *
   * Common pattern used by both encryption toggle and import encryption handler.
   * Validates crypto availability, gathers state, encrypts if needed, deletes
   * server data, updates provider config, uploads snapshot, and updates lastServerSeq.
   *
   * Error handling (throw vs return result) remains the caller's responsibility.
   *
   * @throws WebCryptoNotAvailableError if encryption is enabled but WebCrypto is unavailable
   */
  async deleteAndReuploadWithNewEncryption(options: {
    encryptKey: string | undefined;
    isEncryptionEnabled: boolean;
    logPrefix: string;
  }): Promise<SnapshotUploadResult & { existingCfg: SuperSyncPrivateCfg | null }> {
    const { encryptKey, isEncryptionEnabled, logPrefix } = options;

    // Validate crypto availability before any destructive action
    if (isEncryptionEnabled && !isCryptoSubtleAvailable()) {
      throw new WebCryptoNotAvailableError(
        'Cannot enable encryption: WebCrypto API is not available. ' +
          'Encryption requires a secure context (HTTPS). ' +
          'On Android, encryption is not supported.',
      );
    }

    const { syncProvider, existingCfg, state, vectorClock, clientId } =
      await this.gatherSnapshotData(logPrefix);

    // Encrypt before delete (fail-early)
    let payload: unknown = state;
    if (isEncryptionEnabled && encryptKey) {
      SyncLog.normal(`${logPrefix}: Encrypting snapshot...`);
      payload = await this._encryptionService.encryptPayload(state, encryptKey);
    }

    // Delete all server data
    SyncLog.normal(`${logPrefix}: Deleting server data...`);
    await syncProvider.deleteAllData();

    // Update config before upload
    SyncLog.normal(`${logPrefix}: Updating provider config...`);
    await this._providerManager.setProviderConfig(SyncProviderId.SuperSync, {
      ...existingCfg,
      encryptKey: isEncryptionEnabled ? encryptKey : undefined,
      isEncryptionEnabled,
    } as SuperSyncPrivateCfg);

    // Upload snapshot with retry for rate limiting
    // Critical: server data is already deleted, so we must try hard to get the upload through
    const result = await this._uploadWithRateLimitRetry({
      syncProvider,
      payload,
      clientId,
      vectorClock,
      isPayloadEncrypted: isEncryptionEnabled && !!encryptKey,
      logPrefix,
    });

    if (!result.accepted) {
      throw new Error(`Snapshot upload failed: ${result.error}`);
    }

    await this.updateLastServerSeq(syncProvider, result.serverSeq, logPrefix);

    return { ...result, existingCfg };
  }

  /**
   * Uploads a snapshot with automatic retry on 429 rate limit errors.
   * Used after destructive delete where upload failure leaves server in bad state.
   */
  private async _uploadWithRateLimitRetry(options: {
    syncProvider: SyncProviderBase<SyncProviderId> & OperationSyncCapable;
    payload: unknown;
    clientId: string;
    vectorClock: VectorClock;
    isPayloadEncrypted: boolean;
    logPrefix: string;
  }): Promise<SnapshotUploadResult> {
    const {
      syncProvider,
      payload,
      clientId,
      vectorClock,
      isPayloadEncrypted,
      logPrefix,
    } = options;
    const MAX_RETRIES = 2;
    // Server rate limits are typically 5-10 minutes; honor the full delay since
    // the dialog shows a spinner and server data is already deleted
    const MAX_DELAY_MS = 10 * 60_000;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        SyncLog.normal(`${logPrefix}: Uploading snapshot (attempt ${attempt + 1})...`);
        return await this.uploadSnapshot(
          syncProvider,
          payload,
          clientId,
          vectorClock,
          isPayloadEncrypted,
        );
      } catch (error) {
        const delayMs = this._parseRateLimitDelayMs(error);
        if (delayMs !== null && attempt < MAX_RETRIES) {
          const cappedDelay = Math.min(delayMs, MAX_DELAY_MS);
          SyncLog.warn(
            `${logPrefix}: Rate limited (429) on attempt ${attempt + 1}, ` +
              `retrying in ${(cappedDelay / 1000).toFixed(0)}s...`,
          );
          await new Promise((resolve) => setTimeout(resolve, cappedDelay));
          continue;
        }
        throw error;
      }
    }
    throw new Error('Snapshot upload failed after retries');
  }

  /**
   * Parses a rate limit (429) error and returns the suggested retry delay in ms.
   * Returns null if the error is not a rate limit error.
   */
  private _parseRateLimitDelayMs(error: unknown): number | null {
    const message = error instanceof Error ? error.message : String(error);
    if (!/\b429\b/.test(message)) {
      return null;
    }

    const minutesMatch = message.match(/retry in (\d+)\s*minute/i);
    if (minutesMatch) {
      return parseInt(minutesMatch[1], 10) * 60_000;
    }

    const secondsMatch = message.match(/retry in (\d+)\s*second/i);
    if (secondsMatch) {
      return parseInt(secondsMatch[1], 10) * 1000;
    }

    // Default retry delay for unspecified 429
    return 60_000;
  }
}

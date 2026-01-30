import { inject, Injectable } from '@angular/core';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { LockService } from './lock.service';
import {
  Operation,
  OperationLogEntry,
  OpType,
  FULL_STATE_OP_TYPES,
  extractFullStateFromPayload,
  assertValidFullStatePayload,
} from '../core/operation.types';
import { OpLog } from '../../core/log';
import { LOCK_NAMES, MAX_OPS_PER_UPLOAD_REQUEST } from '../core/operation-log.const';
import { chunkArray } from '../../util/chunk-array';
import {
  OperationSyncCapable,
  SyncOperation,
} from '../sync-providers/provider.interface';
import { syncOpToOperation } from './operation-sync.util';
import { OperationEncryptionService } from './operation-encryption.service';
import {
  RejectedOpInfo,
  UploadResult,
  UploadOptions,
} from '../core/types/sync-results.types';
import { handleStorageQuotaError } from './sync-error-utils';
import { DecryptNoPasswordError } from '../core/errors/sync-errors';

// Re-export for consumers that import from this service
export type {
  RejectedOpInfo,
  UploadResult,
  UploadOptions,
} from '../core/types/sync-results.types';

/**
 * Handles uploading local pending operations to remote storage.
 *
 * CURRENT ARCHITECTURE (as of Dec 2025):
 * - Only SuperSync uses operation log sync (it implements OperationSyncCapable)
 * - SuperSync uses API-based sync via `_uploadPendingOpsViaApi()`
 * - Legacy providers (WebDAV, Dropbox, LocalFile) do NOT use operation log sync at all
 *   They use pfapi's model-level LWW sync instead (see sync.service.ts:104)
 */
@Injectable({
  providedIn: 'root',
})
export class OperationLogUploadService {
  private opLogStore = inject(OperationLogStoreService);
  private lockService = inject(LockService);
  private encryptionService = inject(OperationEncryptionService);

  async uploadPendingOps(
    syncProvider: OperationSyncCapable,
    options?: UploadOptions,
  ): Promise<UploadResult> {
    if (!syncProvider) {
      OpLog.warn('OperationLogUploadService: No active sync provider passed for upload.');
      return { uploadedCount: 0, piggybackedOps: [], rejectedCount: 0, rejectedOps: [] };
    }

    return this._uploadPendingOpsViaApi(syncProvider, options);
  }

  private async _uploadPendingOpsViaApi(
    syncProvider: OperationSyncCapable,
    options?: UploadOptions,
  ): Promise<UploadResult> {
    OpLog.normal('OperationLogUploadService: Uploading pending operations via API...');

    const piggybackedOps: Operation[] = [];
    const rejectedOps: RejectedOpInfo[] = [];
    let uploadedCount = 0;
    let rejectedCount = 0;
    let hasMorePiggyback = false;
    // Track encryption state of piggybacked operations for detecting encryption config mismatch.
    // When another client disables encryption, all piggybacked ops will be unencrypted.
    // We track this BEFORE decryption to detect the server's actual encryption state.
    let sawAnyPiggybackOps = false;
    let sawEncryptedPiggybackOp = false;

    await this.lockService.request(LOCK_NAMES.UPLOAD, async () => {
      // Execute pre-upload callback INSIDE the lock, BEFORE checking for pending ops.
      // This ensures operations like server migration checks are atomic with the upload.
      if (options?.preUploadCallback) {
        await options.preUploadCallback();
      }

      const pendingOps = await this.opLogStore.getUnsynced();

      if (pendingOps.length === 0) {
        OpLog.normal('OperationLogUploadService: No pending operations to upload.');
        return;
      }

      // Get the clientId from the first operation
      const clientId = pendingOps[0].op.clientId;
      // Use let so we can update between chunks to avoid duplicate piggybacked ops
      let lastKnownServerSeq = await syncProvider.getLastServerSeq();
      // Track highest received sequence across ALL chunks to prevent regression
      let highestReceivedSeq = lastKnownServerSeq;

      // Get encryption key (optional - file-based adapters handle encryption internally)
      const encryptKey = syncProvider.getEncryptKey
        ? await syncProvider.getEncryptKey()
        : undefined;
      const isEncryptionEnabled = !!encryptKey;

      // Separate full-state operations (backup imports, repairs) from regular ops
      // Full-state ops are uploaded via snapshot endpoint for better efficiency
      const fullStateOps = pendingOps.filter((entry) =>
        FULL_STATE_OP_TYPES.has(entry.op.opType as OpType),
      );
      const regularOps = pendingOps.filter(
        (entry) => !FULL_STATE_OP_TYPES.has(entry.op.opType as OpType),
      );

      // Upload full-state operations via snapshot endpoint
      let syncImportUploaded = false;
      for (const entry of fullStateOps) {
        const result = await this._uploadFullStateOpAsSnapshot(
          syncProvider,
          entry,
          encryptKey,
          options?.isCleanSlate,
        );
        if (result.accepted) {
          await this.opLogStore.markSynced([entry.seq]);
          uploadedCount++;
          if (result.serverSeq !== undefined) {
            await syncProvider.setLastServerSeq(result.serverSeq);
          }
          // Track if a SYNC_IMPORT was uploaded - regular ops should be skipped
          if (entry.op.opType === OpType.SyncImport) {
            syncImportUploaded = true;
          }
        } else {
          // Special handling for SYNC_IMPORT_EXISTS: another client already uploaded
          // a SYNC_IMPORT. We should delete our local SYNC_IMPORT and let the normal
          // download flow bring in the remote data. Our local ops will then be
          // uploaded as regular operations.
          if (result.errorCode === 'SYNC_IMPORT_EXISTS') {
            OpLog.warn(
              `OperationLogUploadService: Server already has SYNC_IMPORT from another client. ` +
                `Deleting local SYNC_IMPORT and proceeding with normal sync flow.`,
            );
            await this.opLogStore.deleteOpsWhere(
              (logEntry) => logEntry.op.id === entry.op.id,
            );
            // Don't count as rejected - this is expected behavior when joining existing group
            continue;
          }

          // Only permanently reject if the server explicitly rejected the operation
          // (e.g., validation error, conflict). Network errors should be retried.
          const isNetworkError = this._isNetworkError(result.error);
          if (isNetworkError) {
            OpLog.warn(
              `OperationLogUploadService: Full-state op ${entry.op.id} failed due to network error, will retry: ${result.error}`,
            );
            // Don't mark as rejected - leave as unsynced for retry
          } else {
            await this.opLogStore.markRejected([entry.op.id]);
            rejectedOps.push({ opId: entry.op.id, error: result.error });
            rejectedCount++;
            OpLog.warn(
              `OperationLogUploadService: Full-state op ${entry.op.id} rejected: ${result.error}`,
            );
          }
        }
      }

      // Skip regular ops processing if none exist or if SYNC_IMPORT was uploaded.
      // After SYNC_IMPORT, all regular ops are already reflected in the snapshot state,
      // so they should be marked as synced rather than uploaded separately.
      if (regularOps.length === 0) {
        return;
      }

      if (syncImportUploaded) {
        // Mark all regular ops as synced - they're already included in the SYNC_IMPORT snapshot
        const regularSeqs = regularOps.map((entry) => entry.seq);
        await this.opLogStore.markSynced(regularSeqs);
        uploadedCount += regularSeqs.length;
        OpLog.normal(
          `OperationLogUploadService: Marked ${regularSeqs.length} regular ops as synced ` +
            `(already included in SYNC_IMPORT snapshot)`,
        );
        return;
      }

      // Convert to SyncOperation format
      let syncOps: SyncOperation[] = regularOps.map((entry) =>
        this._entryToSyncOp(entry),
      );

      // Encrypt payloads if E2E encryption is enabled
      if (isEncryptionEnabled && encryptKey) {
        OpLog.normal('OperationLogUploadService: Encrypting operation payloads...');
        syncOps = await this.encryptionService.encryptOperations(syncOps, encryptKey);
      }

      // Upload in batches to avoid 413 Payload Too Large errors
      const chunks = chunkArray(syncOps, MAX_OPS_PER_UPLOAD_REQUEST);
      const correspondingEntries = chunkArray(regularOps, MAX_OPS_PER_UPLOAD_REQUEST);

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const entries = correspondingEntries[i];

        OpLog.normal(
          `OperationLogUploadService: Uploading batch of ${chunk.length} ops via API`,
        );

        let response;
        try {
          response = await syncProvider.uploadOps(
            chunk,
            clientId,
            lastKnownServerSeq,
            options?.isCleanSlate,
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          OpLog.error(`OperationLogUploadService: Upload failed: ${message}`);
          handleStorageQuotaError(message);
          throw err; // Re-throw to propagate the error
        }

        // Mark successfully accepted ops as synced
        const acceptedSeqs = response.results
          .filter((r) => r.accepted)
          .map((r) => {
            const entry = entries.find((e) => e.op.id === r.opId);
            return entry?.seq;
          })
          .filter((seq): seq is number => seq !== undefined);

        if (acceptedSeqs.length > 0) {
          await this.opLogStore.markSynced(acceptedSeqs);
          uploadedCount += acceptedSeqs.length;
        }

        // Collect piggybacked new ops from other clients
        // SKIP if skipPiggybackProcessing is set - used for force upload scenarios
        // where piggybacked ops may be encrypted with a different key (e.g., after password change)
        if (options?.skipPiggybackProcessing) {
          if (response.newOps && response.newOps.length > 0) {
            OpLog.normal(
              `OperationLogUploadService: Skipping ${response.newOps.length} piggybacked ops (skipPiggybackProcessing=true)`,
            );
          }
        } else if (response.newOps && response.newOps.length > 0) {
          OpLog.normal(
            `OperationLogUploadService: Received ${response.newOps.length} piggybacked ops` +
              (response.hasMorePiggyback ? ' (more available on server)' : ''),
          );
          let piggybackSyncOps = response.newOps.map((serverOp) => serverOp.op);

          // Track encryption state BEFORE decryption to detect server's actual state.
          // This is critical for detecting when another client disables encryption.
          sawAnyPiggybackOps = true;
          const hasEncryptedOps = piggybackSyncOps.some((op) => op.isPayloadEncrypted);
          if (hasEncryptedOps) {
            sawEncryptedPiggybackOp = true;
          }

          // Decrypt piggybacked ops if any are encrypted
          if (hasEncryptedOps) {
            if (!encryptKey) {
              // Match download service behavior: throw error to trigger password dialog
              OpLog.error(
                'OperationLogUploadService: Received encrypted piggybacked operations but no encryption key is configured.',
              );
              throw new DecryptNoPasswordError(
                'Encrypted data received but no encryption password is configured',
              );
            }

            piggybackSyncOps = await this.encryptionService.decryptOperations(
              piggybackSyncOps,
              encryptKey,
            );
          }

          const ops = piggybackSyncOps.map((op) => syncOpToOperation(op));
          piggybackedOps.push(...ops);
        }

        // Update last known server seq
        // When hasMorePiggyback is true, use the max piggybacked op's serverSeq
        // so subsequent download will fetch remaining ops
        let seqToStore = response.latestSeq;
        if (response.hasMorePiggyback) {
          hasMorePiggyback = true;
          if (response.newOps && response.newOps.length > 0) {
            const maxPiggybackSeq = Math.max(
              ...response.newOps.map((op) => op.serverSeq),
            );
            // Use Math.max to ensure we never regress across chunks
            highestReceivedSeq = Math.max(highestReceivedSeq, maxPiggybackSeq);
            seqToStore = highestReceivedSeq;
            OpLog.normal(
              `OperationLogUploadService: hasMorePiggyback=true, setting lastServerSeq to ${seqToStore} instead of ${response.latestSeq}`,
            );
          } else {
            // Server indicates more ops but didn't send any - don't advance sequence
            // Use highestReceivedSeq to ensure we don't regress from previous chunks
            seqToStore = highestReceivedSeq;
            OpLog.warn(
              `OperationLogUploadService: hasMorePiggyback=true but no ops received, keeping lastServerSeq at ${highestReceivedSeq}`,
            );
          }
        } else {
          // No more piggyback, but still ensure we don't regress
          highestReceivedSeq = Math.max(highestReceivedSeq, response.latestSeq);
          seqToStore = highestReceivedSeq;
        }
        await syncProvider.setLastServerSeq(seqToStore);
        lastKnownServerSeq = seqToStore;

        // Collect rejected operations - DO NOT mark as rejected here!
        // The sync service must process piggybacked ops FIRST to allow proper conflict detection.
        // If we mark rejected before processing piggybacked ops, the local ops won't be in the
        // pending list, conflict detection won't find them, and user's changes are silently lost.
        const rejected = response.results.filter((r) => !r.accepted);
        if (rejected.length > 0) {
          for (const r of rejected) {
            rejectedOps.push({
              opId: r.opId,
              error: r.error,
              errorCode: r.errorCode,
              existingClock: r.existingClock,
            });
          }
          rejectedCount += rejected.length;

          OpLog.warn(
            `OperationLogUploadService: ${rejected.length} ops were rejected by server (will be handled after piggybacked ops)`,
            rejected.map((r) => ({ opId: r.opId, error: r.error })),
          );
        }
      }

      OpLog.normal(
        `OperationLogUploadService: Uploaded ${uploadedCount} ops via API` +
          (rejectedCount > 0 ? `, ${rejectedCount} rejected` : '.'),
      );
    });

    // Note: We no longer show the rejection warning here since rejections
    // may be resolved via conflict dialog. The sync service handles this.

    // Determine if piggybacked ops have only unencrypted data.
    // This is true when we received piggybacked ops AND none of them were encrypted.
    // This indicates another client disabled encryption.
    const piggybackHasOnlyUnencryptedData =
      sawAnyPiggybackOps && !sawEncryptedPiggybackOp;

    return {
      uploadedCount,
      piggybackedOps,
      rejectedCount,
      rejectedOps,
      ...(hasMorePiggyback ? { hasMorePiggyback: true } : {}),
      ...(piggybackHasOnlyUnencryptedData ? { piggybackHasOnlyUnencryptedData } : {}),
    };
  }

  private _entryToSyncOp(entry: OperationLogEntry): SyncOperation {
    return {
      id: entry.op.id,
      clientId: entry.op.clientId,
      actionType: entry.op.actionType,
      opType: entry.op.opType,
      entityType: entry.op.entityType,
      entityId: entry.op.entityId,
      entityIds: entry.op.entityIds,
      payload: entry.op.payload,
      vectorClock: entry.op.vectorClock,
      timestamp: entry.op.timestamp,
      schemaVersion: entry.op.schemaVersion,
    };
  }

  /**
   * Uploads a full-state operation (backup import, repair, sync import) via
   * the snapshot endpoint instead of the ops endpoint. This is more efficient
   * for large payloads as the snapshot endpoint is designed for full state uploads.
   *
   * @param syncProvider - The sync provider to upload to
   * @param entry - The operation log entry containing the full state
   * @param encryptKey - Optional encryption key for E2E encryption
   * @param isCleanSlate - If true, server deletes all data before accepting the snapshot
   */
  private async _uploadFullStateOpAsSnapshot(
    syncProvider: OperationSyncCapable,
    entry: OperationLogEntry,
    encryptKey: string | undefined,
    isCleanSlate?: boolean,
  ): Promise<{
    accepted: boolean;
    serverSeq?: number;
    error?: string;
    errorCode?: string;
  }> {
    const op = entry.op;
    OpLog.normal(
      `OperationLogUploadService: Uploading ${op.opType} operation via snapshot endpoint`,
    );

    // Extract state from payload, handling both wrapped and unwrapped formats.
    // Uses shared utility to ensure consistent handling across the codebase.
    let state: unknown = extractFullStateFromPayload(op.payload);

    // Validate the payload structure before uploading to catch bugs early.
    // This throws if the payload is malformed (e.g., missing expected keys).
    assertValidFullStatePayload(
      state,
      'OperationLogUploadService._uploadFullStateOpAsSnapshot',
    );

    const isPayloadEncrypted = !!encryptKey;

    // If encryption is enabled, encrypt the state
    if (encryptKey) {
      OpLog.normal('OperationLogUploadService: Encrypting snapshot payload...');
      state = await this.encryptionService.encryptPayload(state, encryptKey);
    }

    // Map operation type to snapshot reason
    const reason = this._opTypeToSnapshotReason(op.opType as OpType);

    try {
      const response = await syncProvider.uploadSnapshot(
        state,
        op.clientId,
        reason,
        op.vectorClock,
        op.schemaVersion,
        isPayloadEncrypted,
        op.id, // CRITICAL: Pass op.id to prevent ID mismatch bugs
        isCleanSlate,
      );
      return response;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      OpLog.error(`OperationLogUploadService: Snapshot upload failed: ${message}`);
      handleStorageQuotaError(message);

      // Extract errorCode from error message if present (server returns JSON with errorCode)
      let errorCode: string | undefined;
      if (message.includes('SYNC_IMPORT_EXISTS')) {
        errorCode = 'SYNC_IMPORT_EXISTS';
      }

      return { accepted: false, error: message, errorCode };
    }
  }

  /**
   * Maps an OpType to the snapshot reason expected by the server.
   */
  private _opTypeToSnapshotReason(opType: OpType): 'initial' | 'recovery' | 'migration' {
    switch (opType) {
      case OpType.SyncImport:
        return 'initial';
      case OpType.BackupImport:
        return 'recovery';
      case OpType.Repair:
        return 'recovery';
      default:
        return 'recovery';
    }
  }

  /**
   * Determines if an error message indicates a transient error
   * that should be retried, vs a permanent server rejection.
   *
   * Transient errors include:
   * - Network errors (failed to fetch, timeout, etc.)
   * - Server internal errors (transaction timeout, server busy)
   *
   * Permanent rejections are typically validation errors (invalid payload,
   * duplicate operation, conflict, etc.) that won't succeed on retry.
   *
   * Uses regex patterns with word boundaries for more precise matching,
   * avoiding false positives like "not a network error".
   */
  private _isNetworkError(error: string | undefined): boolean {
    if (!error) return false;

    const lowerError = error.toLowerCase();

    // Use regex patterns for more precise matching
    const transientErrorPatterns: RegExp[] = [
      // Network/fetch errors - use word boundaries to avoid false positives
      /\bfailed to fetch\b/,
      /\bnetwork\s*(error|request|failure)?\b/, // "network error", "network request", "network"
      /\btimeout\b/,
      /\beconnrefused\b/,
      /\benotfound\b/,
      /\bcors\b/,
      /\bnet::/,
      /\boffline\b/,
      /\baborted\b/,
      /\bconnection\s*(refused|reset|closed)\b/,
      /\bsocket\s*(hang up|closed)\b/,
      // Server transient errors
      /\bserver\s*busy\b/,
      /\bplease\s*retry\b/,
      /\btransaction\s*rolled\s*back\b/,
      /\binternal\s*server\s*error\b/,
      // HTTP status codes - match as words to avoid matching in other contexts
      /\b500\b/,
      /\b502\b/,
      /\b503\b/,
      /\b504\b/,
      /\bservice\s*unavailable\b/,
      /\bgateway\s*timeout\b/,
    ];

    return transientErrorPatterns.some((pattern) => pattern.test(lowerError));
  }
}

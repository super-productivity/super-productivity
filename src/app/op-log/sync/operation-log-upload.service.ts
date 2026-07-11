import { inject, Injectable } from '@angular/core';
import {
  planRegularOpsAfterFullStateUpload,
  planUploadLastServerSeqUpdate,
} from '@sp/sync-core';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { LockService } from './lock.service';
import {
  Operation,
  OperationLogEntry,
  OpType,
  FULL_STATE_OP_TYPES,
  extractFullStateFromPayload,
  assertValidFullStatePayload,
  ActionType,
} from '../core/operation.types';
import { OpLog } from '../../core/log';
import { LOCK_NAMES, MAX_OPS_PER_UPLOAD_REQUEST } from '../core/operation-log.const';
import { chunkArray } from '../../util/chunk-array';
import {
  OperationSyncCapable,
  RestorePointType,
  SyncOperation,
} from '../sync-providers/provider.interface';
import { syncOpToOperation } from './operation-sync.util';
import { OperationEncryptionService } from './operation-encryption.service';
import {
  RejectedOpInfo,
  UploadResult,
  UploadOptions,
} from '../core/types/sync-results.types';
import { isRetryableUploadError } from '@sp/sync-providers/http';
import { handleStorageQuotaError } from './sync-error-utils';
import {
  DecryptNoPasswordError,
  EncryptNoPasswordError,
} from '../core/errors/sync-errors';
import { assertOpsEncryptedWhenExpected } from './assert-ops-encryption-expected';
import {
  stripLocalOnlySyncScheduleSettings,
  stripLocalOnlySyncSettingsFromAppData,
} from '../../features/config/local-only-sync-settings.util';

// Re-export for consumers that import from this service
export type {
  RejectedOpInfo,
  UploadResult,
  UploadOptions,
} from '../core/types/sync-results.types';

/**
 * Handles uploading local pending operations to remote storage.
 *
 * CURRENT ARCHITECTURE:
 * - SuperSync uses API-based sync via `_uploadPendingOpsViaApi()`
 * - File-based providers (WebDAV, Dropbox, LocalFile) also use operation log sync
 *   via `FileBasedSyncAdapterService` which creates `OperationSyncCapable` adapters
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
    // #8304: When this upload collects piggybacked ops for the caller to apply, the
    // last-server-seq covering them must be persisted by the caller AFTER those ops are
    // applied — not here. We surface the planned value instead of persisting it.
    let lastServerSeqToPersist: number | undefined;
    // Set when the mandatory-encryption guard skips the upload with pending ops still
    // unsynced, so the caller can report an honest not-in-sync status (not IN_SYNC).
    let encryptionRequiredKeyMissing = false;

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
      // #8304: Becomes true once any chunk collects piggybacked ops the caller must
      // apply. From that point on we stop persisting lastServerSeq in-loop (and never
      // regress) — the caller persists the final value after processing those ops.
      let deferSeqPersistToCaller = false;

      // Get encryption key (optional - file-based adapters handle encryption internally)
      const encryptKey = syncProvider.getEncryptKey
        ? await syncProvider.getEncryptKey()
        : undefined;
      const isEncryptionEnabled = !!encryptKey;

      // GHSA-9v8x-68pf-p5x7: providers that mandate E2E encryption (SuperSync)
      // must NEVER transmit plaintext ops. While no usable key is configured yet
      // — e.g. first-time setup, before the user has chosen a password — abort the
      // upload entirely and leave every pending op unsynced. Downloads still run
      // (merge-first), and the encryption-enable flow performs the first, encrypted
      // upload. Without this guard the initial setup sync pushes all local ops to
      // the server in cleartext, breaking the E2EE promise even if later deleted.
      if (syncProvider.isEncryptionMandatory && !encryptKey) {
        // We got past the empty-ops check above, so there ARE pending ops we are
        // refusing to upload. Flag it so the caller reports an honest not-in-sync
        // status instead of IN_SYNC (which a plain uploadedCount:0 would look like).
        encryptionRequiredKeyMissing = true;
        // Expected during the pre-encryption setup window (fires on every
        // auto-sync until a key is set), so log at normal level, not warn.
        OpLog.normal(
          'OperationLogUploadService: Encryption is mandatory for this provider but ' +
            'no key is configured yet — skipping upload until encryption setup completes.',
        );
        return;
      }

      // GHSA-9544-hjjr-fg8h: file-based providers encrypt inside the adapter and
      // hide the key from this service (no getEncryptKey), so the SuperSync guard
      // above cannot see their missing key. Ask the adapter directly whether
      // encryption is enabled for this provider but the key is gone (silently
      // dropped credentials) and fail CLOSED before either upload loop. Throwing
      // (rather than returning) both leaves the pending ops unsynced for retry —
      // never permanently rejected via the snapshot path's markRejected — and
      // routes to the enter-password recovery dialog in SyncWrapperService. Unlike
      // the mandatory-encryption case above this is never an expected steady
      // state, so it warrants an error, not a silent skip.
      if (
        syncProvider.isEncryptionKeyMissing &&
        (await syncProvider.isEncryptionKeyMissing())
      ) {
        throw new EncryptNoPasswordError(
          'File-based sync: encryption is enabled for this provider but the ' +
            'encryption key is missing — refusing to upload until it is restored.',
        );
      }

      // Separate full-state operations (backup imports, repairs) from regular ops
      // Full-state ops are uploaded via snapshot endpoint for better efficiency
      const fullStateOps = pendingOps.filter((entry) =>
        FULL_STATE_OP_TYPES.has(entry.op.opType as OpType),
      );
      let regularOps = pendingOps.filter(
        (entry) => !FULL_STATE_OP_TYPES.has(entry.op.opType as OpType),
      );

      // Upload full-state operations via snapshot endpoint
      let fullStateOpUploaded = false;
      let lastUploadedFullStateOpId: string | undefined;
      for (const entry of fullStateOps) {
        // BackupImport/Repair: always wipe server (recovery operations replace all state)
        // SyncImport: only wipe when explicitly requested (preserves SYNC_IMPORT_EXISTS check)
        const isCleanSlateForOp =
          entry.op.opType === OpType.SyncImport ? options?.isCleanSlate : true;
        const result = await this._uploadFullStateOpAsSnapshot(
          syncProvider,
          entry,
          encryptKey,
          isCleanSlateForOp,
        );
        if (result.accepted) {
          await this.opLogStore.markSynced([entry.seq]);
          uploadedCount++;
          if (result.serverSeq !== undefined) {
            await syncProvider.setLastServerSeq(result.serverSeq);
            lastKnownServerSeq = result.serverSeq;
            highestReceivedSeq = Math.max(highestReceivedSeq, result.serverSeq);
          }
          // Track that a full-state op was uploaded - regular ops before it are already included
          fullStateOpUploaded = true;
          lastUploadedFullStateOpId = entry.op.id;
        } else {
          // Special handling for SYNC_IMPORT_EXISTS: another client already uploaded
          // a SYNC_IMPORT. We should delete our local SYNC_IMPORT and let the normal
          // download flow bring in the remote data. Our local ops will then be
          // uploaded as regular operations.
          if (result.errorCode === 'SYNC_IMPORT_EXISTS') {
            OpLog.normal(
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
          if (isRetryableUploadError(result.error)) {
            OpLog.normal(
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

      // Skip regular ops processing if none exist
      if (regularOps.length === 0) {
        return;
      }

      if (fullStateOpUploaded && lastUploadedFullStateOpId) {
        const { opsIncludedInSnapshot, opsAfterSnapshot } =
          planRegularOpsAfterFullStateUpload({
            regularOps,
            lastUploadedFullStateOpId,
          });

        if (opsIncludedInSnapshot.length > 0) {
          const seqs = opsIncludedInSnapshot.map((entry) => entry.seq);
          await this.opLogStore.markSynced(seqs);
          uploadedCount += seqs.length;
          OpLog.normal(
            `OperationLogUploadService: Marked ${seqs.length} regular ops as synced ` +
              `(already included in full-state snapshot)`,
          );
        }

        if (opsAfterSnapshot.length === 0) {
          return;
        }

        // Continue with uploading ops created after the snapshot
        OpLog.normal(
          `OperationLogUploadService: ${opsAfterSnapshot.length} regular ops were created ` +
            `after the snapshot and still need uploading.`,
        );
        regularOps = opsAfterSnapshot;
      }

      // Convert to SyncOperation format. Local-only operations remain in the
      // local op-log for replay, but are acknowledged locally instead of uploaded.
      let syncOps: SyncOperation[] = [];
      const uploadEntries: OperationLogEntry[] = [];
      const localOnlySeqs: number[] = [];
      for (const entry of regularOps) {
        const syncOp = this._entryToSyncOp(entry);
        if (syncOp === null) {
          localOnlySeqs.push(entry.seq);
        } else {
          syncOps.push(syncOp);
          uploadEntries.push(entry);
        }
      }
      if (localOnlySeqs.length > 0) {
        await this.opLogStore.markSynced(localOnlySeqs);
        uploadedCount += localOnlySeqs.length;
        OpLog.normal(
          `OperationLogUploadService: Marked ${localOnlySeqs.length} local-only op(s) as synced without upload`,
        );
      }
      if (syncOps.length === 0) {
        return;
      }

      // Encrypt payloads if E2E encryption is enabled
      if (isEncryptionEnabled && encryptKey) {
        OpLog.normal('OperationLogUploadService: Encrypting operation payloads...');
        syncOps = await this.encryptionService.encryptOperations(syncOps, encryptKey);
      }

      // Upload in batches to avoid 413 Payload Too Large errors
      const chunks = chunkArray(syncOps, MAX_OPS_PER_UPLOAD_REQUEST);
      const correspondingEntries = chunkArray(uploadEntries, MAX_OPS_PER_UPLOAD_REQUEST);

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const entries = correspondingEntries[i];

        OpLog.normal(
          `OperationLogUploadService: Uploading batch of ${chunk.length} ops via API`,
        );

        let response;
        try {
          response = await syncProvider.uploadOps(chunk, clientId, lastKnownServerSeq);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          OpLog.error(`OperationLogUploadService: Upload failed: ${message}`);
          handleStorageQuotaError(message);
          throw err; // Re-throw to propagate the error
        }

        // Mark successfully accepted ops as synced
        const entrySeqByOpId = new Map(entries.map((entry) => [entry.op.id, entry.seq]));
        const acceptedSeqs = response.results
          .filter((r) => r.accepted)
          .map((r) => entrySeqByOpId.get(r.opId))
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

          // Fail closed on a plaintext piggybacked op when encryption is mandatory
          // (same reasoning as the download path, GHSA-8pxh-mgc7-gp3g). A keyless
          // mandatory-encryption upload already returned early above, so reaching
          // here implies a usable key — `isEncryptionEnabled` (=!!encryptKey) holds.
          assertOpsEncryptedWhenExpected(
            piggybackSyncOps,
            !!syncProvider.isEncryptionMandatory && isEncryptionEnabled,
          );

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
          // These ops are returned to the caller for processRemoteOps; defer the seq
          // persist so it cannot advance past ops that are not yet applied. (#8304)
          deferSeqPersistToCaller = true;
        }

        // Update last known server seq
        // When hasMorePiggyback is true, use the max piggybacked op's serverSeq
        // so subsequent download will fetch remaining ops
        const serverSeqPlan = planUploadLastServerSeqUpdate({
          currentHighestReceivedSeq: highestReceivedSeq,
          responseLatestSeq: response.latestSeq,
          hasMorePiggyback: response.hasMorePiggyback,
          piggybackServerSeqs: response.newOps?.map((op) => op.serverSeq) ?? [],
        });
        highestReceivedSeq = serverSeqPlan.highestReceivedSeq;
        hasMorePiggyback = hasMorePiggyback || serverSeqPlan.hasMorePiggyback;
        if (serverSeqPlan.reason === 'has-more-with-piggyback') {
          OpLog.normal(
            `OperationLogUploadService: hasMorePiggyback=true, setting lastServerSeq to ${serverSeqPlan.seqToStore} instead of ${response.latestSeq}`,
          );
        } else if (serverSeqPlan.reason === 'has-more-empty') {
          OpLog.warn(
            `OperationLogUploadService: hasMorePiggyback=true but no ops received, keeping lastServerSeq at ${serverSeqPlan.seqToStore}`,
          );
        }
        lastKnownServerSeq = serverSeqPlan.seqToStore;
        if (deferSeqPersistToCaller) {
          // #8304: Hand the value to the caller; it persists after applying the
          // piggybacked ops (mirrors the download path's "persist AFTER ops stored").
          lastServerSeqToPersist = serverSeqPlan.seqToStore;
        } else {
          await syncProvider.setLastServerSeq(serverSeqPlan.seqToStore);
        }

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

          OpLog.normal(
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
      ...(lastServerSeqToPersist !== undefined ? { lastServerSeqToPersist } : {}),
      ...(encryptionRequiredKeyMissing ? { encryptionRequiredKeyMissing: true } : {}),
    };
  }

  private _entryToSyncOp(entry: OperationLogEntry): SyncOperation | null {
    const payload = this._sanitizeRegularOpPayloadForUpload(entry.op);
    if (payload === null) {
      return null;
    }

    return {
      id: entry.op.id,
      clientId: entry.op.clientId,
      actionType: entry.op.actionType,
      opType: entry.op.opType,
      entityType: entry.op.entityType,
      entityId: entry.op.entityId,
      entityIds: entry.op.entityIds,
      payload,
      vectorClock: entry.op.vectorClock,
      timestamp: entry.op.timestamp,
      schemaVersion: entry.op.schemaVersion,
      ...(entry.op.syncImportReason
        ? { syncImportReason: entry.op.syncImportReason }
        : {}),
    };
  }

  private _sanitizeRegularOpPayloadForUpload(op: Operation): unknown | null {
    if (
      op.actionType !== ActionType.GLOBAL_CONFIG_UPDATE_SECTION ||
      typeof op.payload !== 'object' ||
      op.payload === null ||
      !('actionPayload' in op.payload)
    ) {
      return op.payload;
    }

    const multiEntityPayload = op.payload as {
      actionPayload?: Record<string, unknown>;
      entityChanges?: unknown;
    };
    const actionPayload = multiEntityPayload.actionPayload;
    if (
      !actionPayload ||
      actionPayload['sectionKey'] !== 'sync' ||
      typeof actionPayload['sectionCfg'] !== 'object' ||
      actionPayload['sectionCfg'] === null
    ) {
      return op.payload;
    }

    const sectionCfg = stripLocalOnlySyncScheduleSettings(
      actionPayload['sectionCfg'] as Record<string, unknown>,
    );
    if (Object.keys(sectionCfg).length === 0) {
      // GLOBAL_CONFIG_UPDATE_SECTION replays from actionPayload; entityChanges are empty.
      return null;
    }

    return {
      ...multiEntityPayload,
      actionPayload: {
        ...actionPayload,
        sectionCfg,
      },
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
    let state: unknown = stripLocalOnlySyncSettingsFromAppData(
      extractFullStateFromPayload(op.payload),
    );

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
        op.opType as RestorePointType,
        op.syncImportReason,
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
}

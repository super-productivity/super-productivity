import { inject, Injectable, OnDestroy } from '@angular/core';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { LockService } from './lock.service';
import { Operation } from '../core/operation.types';
import { OpLog } from '../../core/log';
import {
  OperationSyncCapable,
  SyncOperation,
} from '../sync-providers/provider.interface';
import { syncOpToOperation } from './operation-sync.util';
import { SnackService } from '../../core/snack/snack.service';
import { T } from '../../t.const';
import {
  LOCK_NAMES,
  MAX_DOWNLOAD_OPS_IN_MEMORY,
  MAX_DOWNLOAD_ITERATIONS,
  CLOCK_DRIFT_THRESHOLD_MS,
  DOWNLOAD_PAGE_SIZE,
} from '../core/operation-log.const';
import { OperationEncryptionService } from './operation-encryption.service';
import { DecryptNoPasswordError } from '../core/errors/sync-errors';
import { SuperSyncStatusService } from './super-sync-status.service';
import { DownloadResult } from '../core/types/sync-results.types';
import { CLIENT_ID_PROVIDER } from '../util/client-id.provider';

// Re-export for consumers that import from this service
export type { DownloadResult } from '../core/types/sync-results.types';

/**
 * Handles downloading remote operations from storage.
 *
 * CURRENT ARCHITECTURE (as of Dec 2025):
 * - Only SuperSync uses operation log sync (it implements OperationSyncCapable)
 * - SuperSync uses API-based sync via `_downloadRemoteOpsViaApi()`
 * - Legacy providers (WebDAV, Dropbox, LocalFile) do NOT use operation log sync at all
 *   They use pfapi's model-level LWW sync instead (see sync.service.ts:104)
 *
 * This service only handles downloading and filtering - conflict detection
 * and application are handled by OperationLogSyncService.
 */
@Injectable({
  providedIn: 'root',
})
export class OperationLogDownloadService implements OnDestroy {
  private opLogStore = inject(OperationLogStoreService);
  private lockService = inject(LockService);
  private snackService = inject(SnackService);
  private encryptionService = inject(OperationEncryptionService);
  private superSyncStatusService = inject(SuperSyncStatusService);
  private clientIdProvider = inject(CLIENT_ID_PROVIDER);

  /** Track if we've already warned about clock drift this session */
  private hasWarnedClockDrift = false;

  /** Timeout handle for clock drift retry check (cleaned up on destroy) */
  private clockDriftTimeoutId: ReturnType<typeof setTimeout> | null = null;

  ngOnDestroy(): void {
    if (this.clockDriftTimeoutId) {
      clearTimeout(this.clockDriftTimeoutId);
      this.clockDriftTimeoutId = null;
    }
  }

  async downloadRemoteOps(
    syncProvider: OperationSyncCapable,
    options?: { forceFromSeq0?: boolean },
  ): Promise<DownloadResult> {
    if (!syncProvider) {
      OpLog.warn(
        'OperationLogDownloadService: No active sync provider passed for download.',
      );
      return { newOps: [], success: false, failedFileCount: 0 };
    }

    return this._downloadRemoteOpsViaApi(syncProvider, options);
  }

  private async _downloadRemoteOpsViaApi(
    syncProvider: OperationSyncCapable,
    options?: { forceFromSeq0?: boolean },
  ): Promise<DownloadResult> {
    const forceFromSeq0 = options?.forceFromSeq0 ?? false;
    OpLog.normal(
      `OperationLogDownloadService: Downloading remote operations via API...${forceFromSeq0 ? ' (forced from seq 0)' : ''}`,
    );

    const allNewOps: Operation[] = [];
    const allOpClocks: import('../core/operation.types').VectorClock[] = [];
    let downloadFailed = false;
    let needsFullStateUpload = false;
    let finalLatestSeq = 0;
    let snapshotVectorClock: import('../core/operation.types').VectorClock | undefined;
    let snapshotState: unknown | undefined;
    // Track encryption state of downloaded operations for detecting encryption config mismatch.
    // When another client disables encryption, all downloaded ops will be unencrypted.
    // We track this BEFORE decryption to detect the server's actual encryption state.
    let sawAnyOps = false;
    let sawEncryptedOp = false;

    // Get encryption key upfront (optional - file-based adapters handle encryption internally)
    // Note: Use 'let' instead of 'const' because we may need to re-fetch the key
    // if gap detection occurs (e.g., after password change clean slate)
    let encryptKey = syncProvider.getEncryptKey
      ? await syncProvider.getEncryptKey()
      : undefined;

    await this.lockService.request(LOCK_NAMES.DOWNLOAD, async () => {
      const lastServerSeq = forceFromSeq0 ? 0 : await syncProvider.getLastServerSeq();
      const appliedOpIds = await this.opLogStore.getAppliedOpIds();
      const clientId = await this.clientIdProvider.loadClientId();
      OpLog.verbose(
        `OperationLogDownloadService: [DEBUG] Starting download. ` +
          `lastServerSeq=${lastServerSeq}, appliedOpIds.size=${appliedOpIds.size}, clientId=${clientId}`,
      );

      if (forceFromSeq0) {
        OpLog.warn(
          'OperationLogDownloadService: Forced download from seq 0 to rebuild clock state',
        );
      }

      // Download ops in pages
      let hasMore = true;
      let sinceSeq = lastServerSeq;
      let hasResetForGap = false;
      let iterationCount = 0;

      while (hasMore) {
        iterationCount++;
        if (iterationCount > MAX_DOWNLOAD_ITERATIONS) {
          OpLog.error(
            `OperationLogDownloadService: Exceeded max iterations (${MAX_DOWNLOAD_ITERATIONS}). ` +
              `Server may have a bug returning hasMore=true indefinitely.`,
          );
          downloadFailed = true;
          break;
        }

        const response = await syncProvider.downloadOps(
          sinceSeq,
          clientId ?? undefined,
          DOWNLOAD_PAGE_SIZE,
        );
        finalLatestSeq = response.latestSeq;
        OpLog.verbose(
          `OperationLogDownloadService: [DEBUG] Download response: ops=${response.ops.length}, ` +
            `latestSeq=${response.latestSeq}, hasMore=${response.hasMore}, ` +
            `gapDetected=${response.gapDetected}, snapshotState=${!!response.snapshotState}`,
        );

        // Capture snapshot vector clock from first response (only present when snapshot optimization used)
        if (!snapshotVectorClock && response.snapshotVectorClock) {
          snapshotVectorClock = response.snapshotVectorClock;
          OpLog.normal(
            `OperationLogDownloadService: Received snapshotVectorClock with ${Object.keys(snapshotVectorClock).length} entries`,
          );
        }

        // Capture snapshot state from first response (file-based sync providers only)
        // This is only present when downloading from seq 0 (fresh download)
        if (!snapshotState && response.snapshotState) {
          snapshotState = response.snapshotState;
          OpLog.normal(
            'OperationLogDownloadService: Received snapshotState for fresh download bootstrap',
          );
        }

        // Handle gap detection: server was reset or client has stale lastServerSeq
        if (response.gapDetected && !hasResetForGap) {
          OpLog.warn(
            `OperationLogDownloadService: Gap detected (sinceSeq=${sinceSeq}, latestSeq=${response.latestSeq}). ` +
              `Resetting to 0 and re-downloading.`,
          );
          // Reset and re-download from the beginning
          sinceSeq = 0;
          hasResetForGap = true;
          allNewOps.length = 0; // Clear any ops we may have accumulated
          allOpClocks.length = 0; // Clear clocks too
          snapshotVectorClock = undefined; // Clear snapshot clock to capture fresh one after reset
          snapshotState = undefined; // Clear snapshot state to capture fresh one after reset
          sawAnyOps = false; // Reset encryption tracking
          sawEncryptedOp = false;

          // CRITICAL: Re-fetch encryption key after gap detection.
          // Gap usually means server was wiped (e.g., password change clean slate),
          // so the encryption key may have changed. We must fetch the current key
          // before attempting to decrypt the re-downloaded operations.
          encryptKey = syncProvider.getEncryptKey
            ? await syncProvider.getEncryptKey()
            : undefined;

          // NOTE: Don't persist lastServerSeq=0 here - caller will persist the final value
          // after ops are stored in IndexedDB. This ensures localStorage and IndexedDB stay in sync.
          continue;
        }

        if (response.ops.length === 0) {
          // No ops to download - caller will persist latestServerSeq after this method returns
          break;
        }

        // Check for clock drift using server's current time (if provided)
        // NOTE: We use serverTime (current server time) instead of receivedAt (when ops were uploaded)
        // because receivedAt can be hours old and would falsely trigger clock drift warnings.
        if (response.serverTime !== undefined) {
          this._checkClockDrift(response.serverTime);
        }

        // When force downloading from seq 0, capture ALL op clocks (including duplicates)
        // This allows rebuilding vector clock state from all known ops on the server
        if (forceFromSeq0) {
          for (const serverOp of response.ops) {
            if (serverOp.op.vectorClock) {
              allOpClocks.push(serverOp.op.vectorClock);
            }
          }
        }

        // Track encryption state from ALL server ops BEFORE filtering.
        // This detects server encryption state even when ops were already applied.
        // Critical for detecting when another client disables encryption.
        if (response.ops.length > 0) {
          sawAnyOps = true;
          if (response.ops.some((serverOp) => serverOp.op.isPayloadEncrypted)) {
            sawEncryptedOp = true;
          }
        }

        // Filter already applied ops
        let syncOps: SyncOperation[] = response.ops
          .filter((serverOp) => !appliedOpIds.has(serverOp.op.id))
          .map((serverOp) => serverOp.op);

        // Decrypt encrypted operations if we have an encryption key
        const hasEncryptedOps = syncOps.some((op) => op.isPayloadEncrypted);
        if (hasEncryptedOps) {
          if (!encryptKey) {
            // No encryption key available - throw error to let sync wrapper show password dialog
            OpLog.error(
              'OperationLogDownloadService: Received encrypted operations but no encryption key is configured.',
            );
            throw new DecryptNoPasswordError(
              'Encrypted data received but no encryption password is configured',
            );
          }

          // Decrypt encrypted operations - let DecryptError propagate to sync-wrapper handler
          syncOps = await this.encryptionService.decryptOperations(syncOps, encryptKey);
        }

        // Convert to Operation format
        const newOps = syncOps.map((op) => syncOpToOperation(op));
        allNewOps.push(...newOps);

        // Bounds check: prevent memory exhaustion
        if (allNewOps.length > MAX_DOWNLOAD_OPS_IN_MEMORY) {
          OpLog.error(
            `OperationLogDownloadService: Too many operations to download (${allNewOps.length}). ` +
              `Stopping at ${MAX_DOWNLOAD_OPS_IN_MEMORY} to prevent memory exhaustion.`,
          );
          this.snackService.open({
            type: 'ERROR',
            msg: T.F.SYNC.S.TOO_MANY_OPS_TO_DOWNLOAD,
          });
          // Process what we have so far rather than failing completely
          downloadFailed = true;
          break;
        }

        // Update cursors
        sinceSeq = response.ops[response.ops.length - 1].serverSeq;
        hasMore = response.hasMore;

        // Monotonicity check: warn if server seq decreased (indicates potential server bug)
        if (response.latestSeq < lastServerSeq) {
          OpLog.warn(
            `OperationLogDownloadService: Server sequence decreased from ${lastServerSeq} to ${response.latestSeq}. ` +
              `This may indicate a server bug or data loss.`,
          );
        }

        // NOTE: Don't persist lastServerSeq here - caller will persist it after ops are
        // stored in IndexedDB. This ensures localStorage and IndexedDB stay in sync.
      }

      // NOTE: We don't call acknowledgeOps here anymore.
      // ACK was used for server-side garbage collection, but the server already
      // cleans up stale devices after 50 days (STALE_DEVICE_THRESHOLD_MS).
      // Removing ACK simplifies the flow and avoids issues with fresh clients
      // (device not registered until first upload would cause 403 errors).

      // Server migration detection:
      // If we detected a gap AND the server is empty (no ops to download),
      // this indicates a server migration scenario. The client should upload
      // a full state snapshot to seed the new server with its data.
      // IMPORTANT: If we received a snapshotState, the server is NOT empty - it has data
      // in snapshot form. This happens when another client uploaded a SYNC_IMPORT.
      if (
        hasResetForGap &&
        allNewOps.length === 0 &&
        finalLatestSeq === 0 &&
        !snapshotState
      ) {
        needsFullStateUpload = true;
        OpLog.warn(
          'OperationLogDownloadService: Server migration detected - gap on empty server. ' +
            'Full state upload will be required.',
        );
      }

      // Alternative migration detection for file-based providers:
      // When connecting to an empty server, check if the client has previously synced ops
      // (from another provider like SuperSync OR from a previous sync with this provider).
      // This handles:
      // 1. Provider switch scenario (e.g., SuperSync → Dropbox)
      // 2. Server reset scenario (e.g., user deleted sync-data.json in Dropbox)
      // File-based providers don't return gapDetected, so we need this alternative check.
      // NOTE: We check regardless of lastServerSeq because:
      // - lastServerSeq might be non-zero from a previous sync with this provider
      // - If server is empty but client has ops, we need to migrate regardless
      OpLog.verbose(
        `OperationLogDownloadService: [DEBUG] Migration check - needsFullStateUpload=${needsFullStateUpload}, ` +
          `allNewOps=${allNewOps.length}, finalLatestSeq=${finalLatestSeq}, lastServerSeq=${lastServerSeq}`,
      );
      // IMPORTANT: If we have a snapshotState, the server is NOT empty - skip migration check
      if (
        !needsFullStateUpload &&
        allNewOps.length === 0 &&
        finalLatestSeq === 0 &&
        !snapshotState
      ) {
        const hasSyncedOps = await this.opLogStore.hasSyncedOps();
        OpLog.verbose(
          `OperationLogDownloadService: [DEBUG] Empty server detected, hasSyncedOps=${hasSyncedOps}`,
        );
        if (hasSyncedOps) {
          needsFullStateUpload = true;
          OpLog.normal(
            'OperationLogDownloadService: Server migration detected - empty server with synced ops. ' +
              'Full state upload will be required.',
          );
        }
      }

      OpLog.normal(
        `OperationLogDownloadService: Downloaded ${allNewOps.length} new operations via API.`,
      );

      // Log type breakdown for high-volume sync debugging
      if (allNewOps.length > 10) {
        const opTypeCounts = new Map<string, number>();
        for (const op of allNewOps) {
          const key = op.opType;
          opTypeCounts.set(key, (opTypeCounts.get(key) || 0) + 1);
        }
        OpLog.verbose(
          `OperationLogDownloadService: Downloaded ops breakdown:`,
          Object.fromEntries(opTypeCounts),
        );
      }
    });

    if (downloadFailed) {
      return { newOps: [], success: false, failedFileCount: 0 };
    }

    // Mark that we successfully checked the remote server
    this.superSyncStatusService.markRemoteChecked();

    OpLog.verbose(
      `OperationLogDownloadService: [DEBUG] Return values - newOps=${allNewOps.length}, ` +
        `needsFullStateUpload=${needsFullStateUpload}, latestServerSeq=${finalLatestSeq}, ` +
        `hasSnapshotState=${!!snapshotState}`,
    );

    // Determine if server has only unencrypted data.
    // This is true when we downloaded ops AND none of them were encrypted.
    // This indicates another client disabled encryption.
    const serverHasOnlyUnencryptedData = sawAnyOps && !sawEncryptedOp;

    // Return latestServerSeq so caller can persist it AFTER storing ops in IndexedDB.
    // This ensures localStorage (lastServerSeq) and IndexedDB (ops) stay in sync.
    return {
      newOps: allNewOps,
      success: true,
      failedFileCount: 0,
      needsFullStateUpload,
      latestServerSeq: finalLatestSeq,
      // Include all op clocks when force downloading from seq 0
      ...(forceFromSeq0 && allOpClocks.length > 0 ? { allOpClocks } : {}),
      // Include snapshot vector clock when snapshot optimization was used
      ...(snapshotVectorClock ? { snapshotVectorClock } : {}),
      // Include snapshot state for file-based sync fresh downloads
      ...(snapshotState ? { snapshotState } : {}),
      // Include encryption state detection for mismatch handling
      ...(serverHasOnlyUnencryptedData ? { serverHasOnlyUnencryptedData } : {}),
    };
  }

  /**
   * Checks for significant clock drift between client and server.
   * Warns user once per session if drift exceeds threshold.
   * Retries once after 1 second to handle transient drift after device wake-up.
   */
  private _checkClockDrift(serverTimestamp: number): void {
    if (this.hasWarnedClockDrift) {
      return;
    }

    const getDriftMinutes = (): number => Math.abs(Date.now() - serverTimestamp) / 60000;
    const thresholdMinutes = CLOCK_DRIFT_THRESHOLD_MS / 60000;

    const driftMinutes = getDriftMinutes();

    if (driftMinutes > thresholdMinutes) {
      // Retry after 1 second - clock may sync after device wake-up
      this.clockDriftTimeoutId = setTimeout(() => {
        this.clockDriftTimeoutId = null;
        if (this.hasWarnedClockDrift) {
          return;
        }
        const retryDriftMinutes = getDriftMinutes();
        if (retryDriftMinutes > thresholdMinutes) {
          this.hasWarnedClockDrift = true;
          const retryDrift = Date.now() - serverTimestamp;
          OpLog.warn('OperationLogDownloadService: Clock drift detected', {
            driftMinutes: retryDriftMinutes.toFixed(1),
            direction: retryDrift > 0 ? 'client ahead' : 'client behind',
          });
          this.snackService.open({
            type: 'ERROR',
            msg: T.F.SYNC.S.CLOCK_DRIFT_WARNING,
            translateParams: { minutes: Math.round(retryDriftMinutes) },
          });
        }
      }, 1000);
    }
  }
}

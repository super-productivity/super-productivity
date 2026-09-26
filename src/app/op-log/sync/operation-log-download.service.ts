import { inject, Injectable, OnDestroy } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import {
  planDownloadFullStateUpload,
  planDownloadGapReset,
  planDownloadedDataEncryptionState,
} from '@sp/sync-core';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { LockService } from './lock.service';
import { Operation, VectorClock } from '../core/operation.types';
import { mergeVectorClocks } from '../../core/util/vector-clock';
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
import {
  OperationDecryptionError,
  OperationEncryptionService,
} from './operation-encryption.service';
import { buildDecryptFailureLogArgs } from './operation-decrypt-failure-log.util';
import { DecryptNoPasswordError } from '../core/errors/sync-errors';
import { assertOpsEncryptedWhenExpected } from './assert-ops-encryption-expected';
import { SuperSyncStatusService } from './super-sync-status.service';
import { DownloadResult } from '../core/types/sync-results.types';
import { CLIENT_ID_PROVIDER } from '../util/client-id.provider';
import { SyncProviderManager } from '../sync-providers/provider-manager.service';

/**
 * True when this client's vector clock already accounts for `op`: an author's
 * counter is monotonic, so a counter at or below our entry for that author was
 * processed here before. Missing entries (pruned or import-reset clock) yield
 * false so the op falls through to the regular filters.
 */
const isOpCoveredByLocalClock = (
  op: Pick<SyncOperation, 'clientId' | 'vectorClock'>,
  localClock: VectorClock | null,
): boolean => {
  if (!localClock || !op.clientId) {
    return false;
  }
  const authorCounter = op.vectorClock?.[op.clientId];
  const knownCounter = localClock[op.clientId];
  return (
    authorCounter !== undefined &&
    knownCounter !== undefined &&
    authorCounter <= knownCounter
  );
};

/**
 * Resume point of the rejected-ops forced seq-0 download, which only collects
 * op clocks and on a long history spans dozens of pages. On mobile the network
 * drops when the app is backgrounded; restarting from seq 0 every sync meant it
 * never finished.
 *
 * Only pages that yielded NO new op are covered (all their ops are applied
 * here), so resuming skips nothing but their clocks, kept merged in
 * `mergedClock`. In memory, keyed on client id + `configEpoch` (moves on any
 * sync-target or credential change) — not on the cursor, which an active user
 * or another device moves between attempts without making a scanned page
 * unsafe.
 */
interface ForcedDownloadCheckpoint {
  key: string;
  sinceSeq: number;
  mergedClock: VectorClock;
  snapshotVectorClock?: VectorClock;
}

// Re-export for consumers that import from this service
export type { DownloadResult } from '../core/types/sync-results.types';

export interface RemoteOpsDownloadOptions {
  forceFromSeq0?: boolean;
  isReDeliveryRetry?: boolean;
  includeOwnAndAppliedOps?: boolean;
  /**
   * Keep the ops decrypted on earlier pages when a later page fails to decrypt
   * (#9256), instead of discarding the whole run. Opt-in: only the top-level
   * download of a sync cycle may pass it — see `isDecryptedPrefixKeepable`.
   */
  keepDecryptedPrefix?: boolean;
}

/**
 * #9256: whether a run that hit an undecryptable page may keep the pages it
 * already decrypted instead of discarding them all.
 *
 * Applying the prefix is equivalent to having synced when the server head was
 * the prefix's last op, a state every client passes through, so the top-level
 * incremental download of a sync cycle may keep it. Excluded:
 * - forced seq-0 downloads and the raw rebuild, whose result replaces local
 *   state or clocks wholesale as if it were the whole server history;
 * - the re-delivery retry and every other rejected-ops download (they never
 *   opt in), which resolve a conflict the server detected against its FULL
 *   head, so a view that stops short of it would resolve against stale data;
 * - a gap reset, whose re-download belongs to a new server epoch;
 * - file-based providers, which decrypt inside their adapter and never reach
 *   this per-page path with a meaningful per-op cursor.
 */
const isDecryptedPrefixKeepable = ({
  options,
  providerMode,
  hasResetForGap,
  keptOpCount,
}: {
  options: RemoteOpsDownloadOptions | undefined;
  providerMode: OperationSyncCapable['providerMode'];
  hasResetForGap: boolean;
  keptOpCount: number;
}): boolean =>
  !!options?.keepDecryptedPrefix &&
  !options.forceFromSeq0 &&
  !options.isReDeliveryRetry &&
  !options.includeOwnAndAppliedOps &&
  providerMode === 'superSyncOps' &&
  !hasResetForGap &&
  keptOpCount > 0;

/**
 * Handles downloading remote operations from storage.
 *
 * CURRENT ARCHITECTURE:
 * - SuperSync uses API-based sync via `_downloadRemoteOpsViaApi()`
 * - File-based providers (WebDAV, Dropbox, LocalFile) also use operation log sync
 *   via `FileBasedSyncAdapterService` which creates `OperationSyncCapable` adapters
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
  private providerManager = inject(SyncProviderManager);

  /** Track if we've already warned about clock drift this session */
  private hasWarnedClockDrift = false;
  /** The last API pass stopped at a checkpoint with ops left on the server. */
  private _hasUnseenRemoteOps = false;
  /** Last checkpoint announced on {@link remoteBacklogRemains$}; 0 at head. */
  private _lastAnnouncedCheckpointSeq = 0;
  private _remoteBacklogRemains$ = new Subject<void>();

  /**
   * Emits when a pass stops at a new checkpoint (#8763). SuperSync has no
   * interval timer, so without a follow-up sync the rest of the backlog would
   * wait for an unrelated trigger.
   */
  readonly remoteBacklogRemains$: Observable<void> =
    this._remoteBacklogRemains$.asObservable();

  /** Timeout handle for clock drift retry check (cleaned up on destroy) */
  private clockDriftTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private clockDriftRetryServerTimestamp: number | null = null;

  private forcedDownloadCheckpoint: ForcedDownloadCheckpoint | null = null;

  /**
   * True while a SuperSync backlog is only partly downloaded (#8763). The
   * rejection handler must not resolve conflicts locally meanwhile: judged
   * without the unseen ops, a local edit could silently win over a newer one.
   */
  hasUnseenRemoteOps(): boolean {
    return this._hasUnseenRemoteOps;
  }

  ngOnDestroy(): void {
    this._clearClockDriftTimeout();
  }

  private _clearClockDriftTimeout(): void {
    if (this.clockDriftTimeoutId) {
      clearTimeout(this.clockDriftTimeoutId);
      this.clockDriftTimeoutId = null;
    }
    this.clockDriftRetryServerTimestamp = null;
  }

  /**
   * @param options.includeOwnAndAppliedOps - Raw-rebuild mode for USE_REMOTE:
   *        skips the appliedOpIds filter AND downloads ops authored by this
   *        client (no excludeClient param). Required to reconstruct the full
   *        server history — the normal filters would drop everything the local
   *        store already knows, leaving a destructive replace with nothing to
   *        replay. Callers are expected to clear the local op store before
   *        appending the result.
   */
  async downloadRemoteOps(
    syncProvider: OperationSyncCapable,
    options?: RemoteOpsDownloadOptions,
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
    options?: RemoteOpsDownloadOptions,
  ): Promise<DownloadResult> {
    const forceFromSeq0 = options?.forceFromSeq0 ?? false;
    OpLog.normal(
      `OperationLogDownloadService: Downloading remote operations via API...${forceFromSeq0 ? ' (forced from seq 0)' : ''}`,
    );

    const allNewOps: Operation[] = [];
    const allOpClocks: import('../core/operation.types').VectorClock[] = [];
    let downloadFailed = false;
    // Set when a bounds check stops the download early with more left on the
    // server; returned instead of the server's head seq (#8763).
    let checkpointSeq: number | undefined;
    let needsFullStateUpload = false;
    let finalLatestSeq = 0;
    let snapshotVectorClock: import('../core/operation.types').VectorClock | undefined;
    let snapshotState: unknown | undefined;
    let snapshotAppliedOpIds: string[] | undefined;
    let remoteLastModified: number | undefined;
    // Track encryption state of downloaded operations for detecting encryption config mismatch.
    // When another client disables encryption, all downloaded ops will be unencrypted.
    // We track this BEFORE decryption to detect the server's actual encryption state.
    let sawAnyOps = false;
    let sawEncryptedOp = false;
    let decryptErrorAfterKeptPrefix: OperationDecryptionError | undefined;

    // Get encryption key upfront (optional - file-based adapters handle encryption internally)
    // Note: Use 'let' instead of 'const' because we may need to re-fetch the key
    // if gap detection occurs (e.g., after password change clean slate)
    let encryptKey = syncProvider.getEncryptKey
      ? await syncProvider.getEncryptKey()
      : undefined;

    // Whether inbound plaintext ops must be rejected (GHSA-8pxh-mgc7-gp3g). Gate
    // on config INTENT (isEncryptionEnabled), not key presence: in the
    // dropped-credential state the key is transiently gone but encryption is
    // still enabled, and a `!!encryptKey` gate would fail OPEN there and accept a
    // forged plaintext batch. `isEncryptionMandatory` scopes this to SuperSync,
    // where enabling encryption deletes + re-uploads all data encrypted, so no
    // legitimate plaintext op remains. Config intent is stable across a
    // gap-reset re-fetch, so compute once here.
    const isEncryptionExpected =
      !!syncProvider.isEncryptionMandatory &&
      !!(await syncProvider.isEncryptionEnabled?.());

    await this.lockService.request(LOCK_NAMES.DOWNLOAD, async () => {
      const lastServerSeq = forceFromSeq0 ? 0 : await syncProvider.getLastServerSeq();
      // Raw-rebuild mode: an empty applied set disables the duplicate filter
      // below; a missing clientId makes the server include this client's own ops.
      const appliedOpIds = options?.includeOwnAndAppliedOps
        ? new Set<string>()
        : await this.opLogStore.getAppliedOpIds();
      const clientId = options?.includeOwnAndAppliedOps
        ? null
        : await this.clientIdProvider.loadClientId();
      // A forced seq-0 download re-fetches everything after the server's latest
      // full-state op, including ops compaction already pruned from the local
      // log. Those are invisible to the applied-id filter. Without a second
      // filter an already-applied SYNC_IMPORT resurfaces as a new incoming
      // import on every concurrent-rejection retry and raises the conflict
      // dialog (or, with nothing pending, replaces state wholesale).
      // An op is treated as re-delivered only when BOTH hold: the persisted
      // cursor is past it (it was processed here — a schema-version block keeps
      // the cursor behind the blocked op) AND the local vector clock covers it
      // (it is reflected in local state — a rebuilt log can sit behind a stale
      // cursor; and the rejection resolver merges server clocks into the local
      // clock, so the clock alone could cover a blocked op).
      // Raw rebuild wants every op, so it keeps this filter off. The provider
      // gate is an allowlist: a future provider mode must opt in explicitly
      // rather than inherit a filter nobody reasoned about for it.
      // Keyed on the CALLER'S intent, never on `forceFromSeq0` alone: that flag
      // is also set for a provider switch (`SyncWrapperService`), whose whole
      // point is a fresh state comparison that reaches the conflict gate. A
      // switch back to a previously-used SuperSync account carries a non-zero
      // cursor for that provider and a local clock inherited from the other
      // one, so filtering there would silently drop the server's history, skip
      // the dialog, and let this device upload its divergent state.
      //
      // File-based providers (#10119) return their WHOLE op buffer (up to
      // MAX_RECENT_OPS) on every download, so after compaction an old remote op
      // looks new and can resurrect an entity deleted/archived here since. Their
      // adapter exposes each op's `serverSeq` as the file `syncVersion` it was
      // written at, the same space as their cursor, so the filter runs on every
      // incremental download. It stays off for seq-0 downloads (lastServerSeq
      // is 0): a provider switch or USE_REMOTE rebuild must see everything. The
      // clock half is what keeps it safe when the cursor ran ahead of applied
      // ops (an upload merging a freshly downloaded file sets it to the new
      // version): an op this client never applied is not covered by its clock.
      const isReDeliveryFilterActive =
        !options?.includeOwnAndAppliedOps &&
        ((!!options?.isReDeliveryRetry && syncProvider.providerMode === 'superSyncOps') ||
          (syncProvider.providerMode === 'fileSnapshotOps' && lastServerSeq > 0));
      // Not const: a gap reset below switches to a new server epoch whose seq
      // space is unrelated to this cursor, so the filter must be disabled.
      let deliveredUpToSeq = isReDeliveryFilterActive
        ? await syncProvider.getLastServerSeq()
        : 0;
      const localClock = isReDeliveryFilterActive
        ? await this.opLogStore.getVectorClock()
        : null;
      let reDeliveredCount = 0;
      // Only the rejected-ops retry (forced + re-delivery filter = SuperSync
      // re-delivery retry) resumes: it only collects clocks, never replaces
      // local state.
      const checkpointKey =
        forceFromSeq0 && isReDeliveryFilterActive
          ? `${clientId ?? ''}|${this.providerManager.configEpoch}`
          : undefined;
      const resumeFrom =
        checkpointKey !== undefined &&
        this.forcedDownloadCheckpoint?.key === checkpointKey
          ? this.forcedDownloadCheckpoint
          : undefined;
      let checkpointClock: VectorClock = resumeFrom ? { ...resumeFrom.mergedClock } : {};
      // A newer full-state op since the checkpoint makes the server skip ahead
      // on the first resumed page; its snapshot clock then replaces ours.
      let isSnapshotClockFromResume = !!resumeFrom;
      if (resumeFrom) {
        allOpClocks.push({ ...resumeFrom.mergedClock });
        snapshotVectorClock = resumeFrom.snapshotVectorClock;
      }
      OpLog.verbose(
        `OperationLogDownloadService: [DEBUG] Starting download. ` +
          `lastServerSeq=${lastServerSeq}, appliedOpIds.size=${appliedOpIds.size}, clientId=${clientId}`,
      );

      if (forceFromSeq0) {
        OpLog.normal(
          'OperationLogDownloadService: Forced download from seq 0 to rebuild clock state',
        );
      }

      if (resumeFrom) {
        OpLog.normal(
          `OperationLogDownloadService: Resuming interrupted forced download at seq ${resumeFrom.sinceSeq}`,
        );
      }

      // Download ops in pages
      let hasMore = true;
      let sinceSeq = resumeFrom ? resumeFrom.sinceSeq : lastServerSeq;
      let hasResetForGap = false;
      let iterationCount = 0;
      // Run-level password evidence for the failure log: ops decrypted on
      // earlier pages of THIS run prove the key even when nothing in a later
      // failing batch decrypts (e.g. a single corrupt op on the final page).
      let decryptedOpsInEarlierBatches = 0;

      while (hasMore) {
        iterationCount++;

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
        if (
          response.snapshotVectorClock &&
          (!snapshotVectorClock || isSnapshotClockFromResume)
        ) {
          snapshotVectorClock = response.snapshotVectorClock;
          OpLog.normal(
            `OperationLogDownloadService: Received snapshotVectorClock with ${Object.keys(snapshotVectorClock).length} entries`,
          );
        }
        isSnapshotClockFromResume = false;

        // Capture snapshot state from first response (file-based sync providers only)
        // This is only present when downloading from seq 0 (fresh download)
        if (
          syncProvider.providerMode === 'fileSnapshotOps' &&
          !snapshotState &&
          response.snapshotState
        ) {
          snapshotState = response.snapshotState;
          snapshotAppliedOpIds =
            'snapshotAppliedOpIds' in response
              ? response.snapshotAppliedOpIds
              : undefined;
          const receivedLastModified =
            'remoteLastModified' in response ? response.remoteLastModified : undefined;
          remoteLastModified =
            typeof receivedLastModified === 'number' &&
            Number.isFinite(receivedLastModified) &&
            receivedLastModified >= 0
              ? receivedLastModified
              : undefined;
          OpLog.normal(
            'OperationLogDownloadService: Received snapshotState for fresh download bootstrap',
          );
        }

        const gapResetPlan = planDownloadGapReset({
          gapDetected: response.gapDetected,
          hasResetForGap,
        });
        // Handle gap detection: server was reset or client has stale lastServerSeq
        if (gapResetPlan.shouldReset) {
          OpLog.normal(
            `OperationLogDownloadService: Gap detected (sinceSeq=${sinceSeq}, latestSeq=${response.latestSeq}). ` +
              `Resetting to 0 and re-downloading.`,
          );
          // Reset and re-download from the beginning
          sinceSeq = 0;
          hasResetForGap = true;
          allNewOps.length = 0; // Clear any ops we may have accumulated
          allOpClocks.length = 0; // Clear clocks too
          // The re-delivery filter compares against the OLD server's cursor. A
          // gap means a reset/replaced server, so the re-fetched ops carry seqs
          // from a fresh epoch that the old cursor would wrongly cover — and
          // dropping them here would lose them silently. 0 disables the filter
          // for the rest of this download (every real serverSeq is >= 1).
          deliveredUpToSeq = 0;
          reDeliveredCount = 0; // pre-reset skips belong to the discarded epoch
          // The checkpoint belongs to the old epoch too (and the re-download
          // may itself be cut off before the end-of-run clear).
          this.forcedDownloadCheckpoint = null;
          snapshotVectorClock = undefined; // Clear snapshot clock to capture fresh one after reset
          snapshotState = undefined; // Clear snapshot state to capture fresh one after reset
          snapshotAppliedOpIds = undefined; // Clear snapshot boundary with the stale state
          remoteLastModified = undefined; // Clear timestamp belonging to the stale state
          sawAnyOps = false; // Reset encryption tracking
          sawEncryptedOp = false;
          // The re-fetched key may differ (password change clean slate), so
          // pre-reset decrypts are no evidence for the key used after it.
          decryptedOpsInEarlierBatches = 0;

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
          if (response.hasMore) {
            OpLog.error(
              'OperationLogDownloadService: Server returned an empty page with hasMore=true. Aborting to avoid accepting a partial download.',
            );
            downloadFailed = true;
          }
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
        const pageClocks: VectorClock[] = [];
        if (forceFromSeq0) {
          for (const serverOp of response.ops) {
            if (serverOp.op.vectorClock) {
              allOpClocks.push(serverOp.op.vectorClock);
              pageClocks.push(serverOp.op.vectorClock);
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
        const newServerOps = response.ops.filter((serverOp) => {
          if (appliedOpIds.has(serverOp.op.id)) {
            return false;
          }
          if (
            serverOp.serverSeq <= deliveredUpToSeq &&
            isOpCoveredByLocalClock(serverOp.op, localClock)
          ) {
            reDeliveredCount++;
            return false;
          }
          return true;
        });
        let syncOps: SyncOperation[] = newServerOps.map((serverOp) => serverOp.op);

        // Fail closed on a plaintext op when SuperSync encryption is enabled: the
        // server is all-encrypted once encryption is on (delete + reupload), so an
        // inbound plaintext op is stale or attacker-injected and would otherwise
        // skip decryption + the integrity check (GHSA-8pxh-mgc7-gp3g).
        assertOpsEncryptedWhenExpected(syncOps, isEncryptionExpected);

        // Decrypt encrypted operations if we have an encryption key
        const encryptedOpsInPage = syncOps.filter((op) => op.isPayloadEncrypted).length;
        if (encryptedOpsInPage > 0) {
          if (!encryptKey) {
            // No encryption key available - throw to let the sync wrapper show the
            // password dialog. Severity depends on history: a client that has never
            // synced AND has no local encryption config is EXPECTED to hit this on
            // first connect to an encrypted dataset (it just needs the password
            // prompt), so log it quietly. Anything else — an already-synced client, or
            // one whose local config still flags encryption on but has no key (the
            // dropped-credential signature, e.g. after a wiped op store) — is dangerous,
            // so keep it loud. See SyncCredentialStore.load.
            const everSynced = await this.opLogStore.hasSyncedOps();
            const localEncryptionEnabled = syncProvider.isEncryptionEnabled
              ? await syncProvider.isEncryptionEnabled()
              : false;
            const msg =
              'OperationLogDownloadService: Received encrypted operations but no encryption key is configured.';
            if (everSynced || localEncryptionEnabled) {
              OpLog.error(msg);
            } else {
              OpLog.normal(msg);
            }
            throw new DecryptNoPasswordError(
              'Encrypted data received but no encryption password is configured',
            );
          }

          // Decrypt encrypted operations - let DecryptError propagate to sync-wrapper handler
          try {
            syncOps = await this.encryptionService.decryptOperations(syncOps, encryptKey);
            decryptedOpsInEarlierBatches += encryptedOpsInPage;
          } catch (error) {
            if (error instanceof OperationDecryptionError) {
              OpLog.error(
                'OperationLogDownloadService: Encrypted operation batch could not be processed.',
                ...buildDecryptFailureLogArgs(
                  error.diagnosis,
                  newServerOps.filter((serverOp) => serverOp.op.isPayloadEncrypted),
                  decryptedOpsInEarlierBatches,
                ),
              );
              if (
                isDecryptedPrefixKeepable({
                  options,
                  providerMode: syncProvider.providerMode,
                  hasResetForGap,
                  keptOpCount: allNewOps.length,
                })
              ) {
                // The caller applies the prefix, persists the cursor (which stops
                // before this page) and then throws the error, so this cycle still
                // reports it and the next download starts at the failing page
                // (unless the cycle's outcome supersedes it — see
                // `isKeptPrefixDecryptErrorSuperseded`).
                OpLog.warn(
                  `OperationLogDownloadService: Keeping ${allNewOps.length} op(s) decrypted ` +
                    `before the failing page; cursor stops at ${sinceSeq}.`,
                );
                finalLatestSeq = sinceSeq;
                decryptErrorAfterKeptPrefix = error;
                break;
              }
            }
            throw error;
          }
        }

        // Convert to Operation format
        const newOps = syncOps.map((op) => syncOpToOperation(op));
        allNewOps.push(...newOps);

        // Update cursors. A page that claims more data must advance the cursor;
        // otherwise accepting the accumulated prefix would silently skip the
        // unseen suffix (or spin until the iteration cap).
        const nextSinceSeq = response.ops[response.ops.length - 1].serverSeq;
        if (response.hasMore && nextSinceSeq <= sinceSeq) {
          OpLog.error(
            `OperationLogDownloadService: Non-progressing page cursor (${nextSinceSeq} <= ${sinceSeq}) with hasMore=true. Aborting partial download.`,
          );
          downloadFailed = true;
          break;
        }
        sinceSeq = nextSinceSeq;
        hasMore = response.hasMore;

        if (checkpointKey !== undefined && !hasResetForGap && allNewOps.length === 0) {
          for (const clock of pageClocks) {
            checkpointClock = mergeVectorClocks(checkpointClock, clock);
          }
          this.forcedDownloadCheckpoint = {
            key: checkpointKey,
            sinceSeq,
            mergedClock: checkpointClock,
            ...(snapshotVectorClock ? { snapshotVectorClock } : {}),
          };
        }

        // Monotonicity check: warn if server seq decreased (indicates potential server bug)
        // Skip after gap reset: server was reset/replaced, so lower seq is expected
        if (response.latestSeq < lastServerSeq && !hasResetForGap) {
          OpLog.warn(
            `OperationLogDownloadService: Server sequence decreased from ${lastServerSeq} to ${response.latestSeq}. ` +
              `This may indicate a server bug or data loss.`,
          );
        }

        // NOTE: Don't persist lastServerSeq here - caller will persist it after ops are
        // stored in IndexedDB. This ensures localStorage and IndexedDB stay in sync.

        // Bounds check (memory / runaway paging). Ops are served in serverSeq
        // order, so the pages so far are a complete prefix: hand them over with
        // the cursor at the last page so the caller applies and checkpoints them
        // and the next sync resumes there. Discarding them instead made a large
        // backlog re-download the same prefix forever (#8763).
        if (
          hasMore &&
          (allNewOps.length >= MAX_DOWNLOAD_OPS_IN_MEMORY ||
            iterationCount >= MAX_DOWNLOAD_ITERATIONS)
        ) {
          // A seq-0 download (clock rebuild, provider switch, raw rebuild) needs
          // the WHOLE history; a prefix would be treated as all of it.
          if (forceFromSeq0 || options?.includeOwnAndAppliedOps) {
            OpLog.error(
              `OperationLogDownloadService: Download limit reached (${allNewOps.length} ops, ` +
                `${iterationCount} pages) during a full-history download. Aborting.`,
            );
            downloadFailed = true;
          } else {
            OpLog.warn(
              `OperationLogDownloadService: Download limit reached (${allNewOps.length} ops, ` +
                `${iterationCount} pages). Processing up to seq ${sinceSeq}; the rest follows on the next sync.`,
            );
            checkpointSeq = sinceSeq;
          }
          break;
        }
      }

      // Loop ended without throwing: done, or failed in a way a resume won't fix.
      if (checkpointKey !== undefined) {
        this.forcedDownloadCheckpoint = null;
      }

      // NOTE: We don't call acknowledgeOps here anymore.
      // ACK was used for server-side garbage collection, but the server already
      // cleans up stale devices after 50 days (STALE_DEVICE_THRESHOLD_MS).
      // Removing ACK simplifies the flow and avoids issues with fresh clients
      // (device not registered until first upload would cause 403 errors).

      if (reDeliveredCount > 0) {
        OpLog.normal(
          `OperationLogDownloadService: Skipped ${reDeliveredCount} re-delivered op(s) ` +
            `behind cursor ${deliveredUpToSeq} and covered by the local vector clock ` +
            '(compacted out of the local log).',
        );
      }

      // Server migration detection:
      // If we detected a gap AND the server is empty (no ops to download),
      // this indicates a server migration scenario. The client should upload
      // a full state snapshot to seed the new server with its data.
      // IMPORTANT: If we received a snapshotState, the server is NOT empty - it has data
      // in snapshot form. This happens when another client uploaded a SYNC_IMPORT.
      const gapMigrationPlan = planDownloadFullStateUpload({
        currentNeedsFullStateUpload: needsFullStateUpload,
        hasResetForGap,
        downloadedOpCount: allNewOps.length,
        finalLatestSeq,
        hasSnapshotState: !!snapshotState,
      });
      if (gapMigrationPlan.needsFullStateUpload) {
        needsFullStateUpload = true;
        OpLog.normal(
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
      const shouldCheckSyncedOpsPlan = planDownloadFullStateUpload({
        currentNeedsFullStateUpload: needsFullStateUpload,
        hasResetForGap,
        downloadedOpCount: allNewOps.length,
        finalLatestSeq,
        hasSnapshotState: !!snapshotState,
      });
      if (shouldCheckSyncedOpsPlan.shouldCheckHasSyncedOps) {
        const hasSyncedOps = await this.opLogStore.hasSyncedOps();
        OpLog.verbose(
          `OperationLogDownloadService: [DEBUG] Empty server detected, hasSyncedOps=${hasSyncedOps}`,
        );
        const emptyServerMigrationPlan = planDownloadFullStateUpload({
          currentNeedsFullStateUpload: needsFullStateUpload,
          hasResetForGap,
          downloadedOpCount: allNewOps.length,
          finalLatestSeq,
          hasSnapshotState: !!snapshotState,
          hasSyncedOps,
        });
        if (emptyServerMigrationPlan.needsFullStateUpload) {
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

    this._hasUnseenRemoteOps = checkpointSeq !== undefined;
    if (checkpointSeq === undefined) {
      // Mark that we successfully checked the remote server. A kept prefix stopped
      // short of the server head, so it must not count as a completed check.
      if (!decryptErrorAfterKeptPrefix) {
        this.superSyncStatusService.markRemoteChecked();
      }
      this._lastAnnouncedCheckpointSeq = 0;
    } else if (checkpointSeq !== this._lastAnnouncedCheckpointSeq) {
      // A server restore can lower the checkpoint. Repeating the SAME checkpoint
      // means apply made no progress; announcing that again would loop.
      this._lastAnnouncedCheckpointSeq = checkpointSeq;
      this._remoteBacklogRemains$.next();
    }

    OpLog.verbose(
      `OperationLogDownloadService: [DEBUG] Return values - newOps=${allNewOps.length}, ` +
        `needsFullStateUpload=${needsFullStateUpload}, latestServerSeq=${finalLatestSeq}, ` +
        `hasSnapshotState=${!!snapshotState}`,
    );

    // Determine if server has only unencrypted data.
    // This is true when we downloaded ops AND none of them were encrypted.
    // This indicates another client disabled encryption.
    const { serverHasOnlyUnencryptedData } = planDownloadedDataEncryptionState({
      sawAnyOps,
      sawEncryptedOp,
    });

    // Return latestServerSeq so caller can persist it AFTER storing ops in IndexedDB.
    // This ensures localStorage (lastServerSeq) and IndexedDB (ops) stay in sync.
    const baseResult = {
      newOps: allNewOps,
      success: true as const,
      failedFileCount: 0,
      needsFullStateUpload,
      latestServerSeq: checkpointSeq ?? finalLatestSeq,
      // Include all op clocks when force downloading from seq 0
      ...(forceFromSeq0 && allOpClocks.length > 0 ? { allOpClocks } : {}),
      // Include snapshot vector clock when snapshot optimization was used
      ...(snapshotVectorClock ? { snapshotVectorClock } : {}),
      // Include encryption state detection for mismatch handling
      ...(serverHasOnlyUnencryptedData ? { serverHasOnlyUnencryptedData } : {}),
      ...(decryptErrorAfterKeptPrefix ? { decryptErrorAfterKeptPrefix } : {}),
    };

    if (syncProvider.providerMode === 'fileSnapshotOps') {
      return {
        ...baseResult,
        providerMode: 'fileSnapshotOps',
        // Include snapshot state for file-based sync fresh downloads
        ...(snapshotState ? { snapshotState } : {}),
        ...(snapshotAppliedOpIds ? { snapshotAppliedOpIds } : {}),
        ...(remoteLastModified !== undefined ? { remoteLastModified } : {}),
      };
    }

    return {
      ...baseResult,
      providerMode: 'superSyncOps',
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

    const getDriftMinutes = (timestamp: number): number =>
      Math.abs(Date.now() - timestamp) / 60000;
    const thresholdMinutes = CLOCK_DRIFT_THRESHOLD_MS / 60000;

    const driftMinutes = getDriftMinutes(serverTimestamp);

    if (driftMinutes <= thresholdMinutes) {
      this._clearClockDriftTimeout();
      return;
    }

    this.clockDriftRetryServerTimestamp = serverTimestamp;

    if (this.clockDriftTimeoutId) {
      return;
    }

    // Retry after 1 second - clock may sync after device wake-up
    this.clockDriftTimeoutId = setTimeout(() => {
      this.clockDriftTimeoutId = null;
      const retryServerTimestamp = this.clockDriftRetryServerTimestamp;
      this.clockDriftRetryServerTimestamp = null;
      if (this.hasWarnedClockDrift || retryServerTimestamp === null) {
        return;
      }
      const retryDriftMinutes = getDriftMinutes(retryServerTimestamp);
      if (retryDriftMinutes > thresholdMinutes) {
        this.hasWarnedClockDrift = true;
        const retryDrift = Date.now() - retryServerTimestamp;
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

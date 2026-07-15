import { inject, Injectable, Injector } from '@angular/core';
import { SyncProviderId } from '../provider.const';
import {
  FileSyncProvider,
  OperationSyncCapable,
  SyncOperation,
  OpUploadResponse,
  FileSnapshotOpDownloadResponse,
  ServerSyncOperation,
  SnapshotUploadResponse,
  RestorePointType,
} from '../provider.interface';
import { EncryptAndCompressHandlerService } from '../../encryption/encrypt-and-compress-handler.service';
import { extractSyncFileStateFromPrefix } from '../../util/sync-file-prefix';
import { EncryptAndCompressCfg } from '../../core/types/sync.types';
import { REPAIR_STALE_ERROR_CODE } from '../../core/operation-log.const';
import {
  Operation,
  VectorClock,
  ActionType,
  OpType,
  EntityType,
  SyncImportReason,
} from '../../core/operation.types';
import {
  FileBasedSyncData,
  FileBasedOpsFile,
  FileBasedStateFile,
  FileBasedSplitTombstone,
  FILE_BASED_SYNC_CONSTANTS,
  SyncFileCompactOp,
} from './file-based-sync.types';
import { OpLog } from '../../../core/log';
import {
  DecompressError,
  DecryptError,
  InvalidDataSPError,
  JsonParseError,
  LegacySyncFormatDetectedError,
  RemoteFileNotFoundAPIError,
  SplitSyncFormatDetectedError,
  SyncDataCorruptedError,
  UploadRevToMatchMismatchAPIError,
} from '../../core/errors/sync-errors';
import { GlobalConfigService } from '../../../features/config/global-config.service';
import { SnackService } from '../../../core/snack/snack.service';
import { T } from '../../../t.const';
import { mergeVectorClocks, compareVectorClocks } from '../../../core/util/vector-clock';
import { ArchiveDbAdapter } from '../../../core/persistence/archive-db-adapter.service';
import { StateSnapshotService } from '../../backup/state-snapshot.service';
import { stripLocalOnlySyncSettingsFromAppData } from '../../../features/config/local-only-sync-settings.util';
import { CompactOperation } from '../../persistence/compact/compact-operation.types';
import {
  encodeOperation,
  decodeOperation,
} from '../../persistence/compact/operation-codec.service';

/**
 * Adapter that enables file-based sync providers (WebDAV, Dropbox, LocalFile)
 * to support operation-log sync.
 *
 * ## Architecture
 * This adapter wraps a file-based provider and implements `OperationSyncCapable`,
 * allowing the unified sync system to work with file storage instead of APIs.
 *
 * ## Single File Approach
 * All sync data is stored in `sync-data.json`:
 * - Full state snapshot (for bootstrapping and recovery)
 * - Recent operations (for conflict detection and merging)
 * - Vector clock (for causality tracking)
 * - syncVersion counter (for optimistic locking)
 *
 * ## Conflict Resolution
 * Unlike PFAPI's model-level conflicts, this approach enables entity-level
 * conflict resolution using the operations in `recentOps`. When two clients
 * modify different entities, both changes are preserved.
 *
 * ## Content-Based Optimistic Locking
 * Instead of relying on server ETags (which vary by WebDAV implementation),
 * we use a `syncVersion` counter inside the file itself. On upload:
 * 1. Download current file to get syncVersion
 * 2. If syncVersion !== expected, conflict detected → merge and retry
 * 3. If match, increment syncVersion and upload
 *
 * @see FileBasedSyncData for the file schema
 */
@Injectable({ providedIn: 'root' })
export class FileBasedSyncAdapterService {
  private _encryptAndCompressHandler = new EncryptAndCompressHandlerService();
  private _archiveDbAdapter = inject(ArchiveDbAdapter);
  private _stateSnapshotService = inject(StateSnapshotService);
  // Resolved lazily (not eagerly injected) to avoid a construction-time DI cycle:
  // SnackService's dependency graph transitively reaches the sync providers. We only
  // need it for the non-fatal backup-recovery notice, well after construction.
  private _injector = inject(Injector);

  /**
   * Max CONDITIONAL upload retries after a rev mismatch before surfacing a
   * retryable error. The retry path never force-overwrites the primary sync file.
   */
  private readonly _MAX_UPLOAD_RETRIES = 2;

  /** Expected sync version for optimistic locking, keyed by provider+user */
  private _expectedSyncVersions = new Map<string, number>();

  /** Downloaded version awaiting confirmation that its snapshot/ops were applied. */
  private _pendingExpectedSyncVersions = new Map<string, number>();

  /**
   * SPAP-9: last-seen remote vector clock per provider+user. Used to tell a
   * benign (cosmetic) syncVersion reset apart from a genuine one: if the file's
   * causal clock did not regress, a lower syncVersion counter lost no data and
   * must not trigger the full-gap resync path.
   */
  private _lastSeenVectorClocks = new Map<string, VectorClock>();

  /** Downloaded causal clock awaiting the same durable-apply confirmation. */
  private _pendingVectorClocks = new Map<string, VectorClock>();

  /** Local sequence counters (simulates server seq for file-based) */
  private _localSeqCounters = new Map<string, number>();

  /**
   * Last corrupt primary rev we surfaced a backup-recovery notice for, keyed by
   * provider+user. Prevents re-toasting the same corruption every sync cycle for a
   * download-only client that cannot heal the primary file itself.
   */
  private _lastRecoveredCorruptRev = new Map<string, string>();

  /**
   * SPAP-10: last-seen remote file rev per provider+user. Lets a poll skip the
   * full `sync-data.json` download when the provider's cheap `getFileRev` reports
   * the same rev we already processed (the file is byte-identical → nothing new).
   */
  private _lastSeenRevs = new Map<string, string>();

  /**
   * SPAP-10: rev of the file downloaded in the current cycle, not yet confirmed
   * durably applied by the caller. Promoted to `_lastSeenRevs` (and persisted) only
   * in setLastServerSeq — the same after-apply ordering as the seq cursor — so a
   * throw/crash between download and apply can't strand a rev ahead of un-applied
   * ops and skip them on the next poll's pre-check.
   */
  private _pendingRevs = new Map<string, string>();

  /**
   * SPAP-10: providers whose `getFileRev` is BOTH cheap (a metadata-only call, so
   * the pre-check actually saves the full-file download) AND returns a rev that
   * changes IFF the file content changes (so an unchanged rev is a sound "nothing
   * new" signal):
   * - Dropbox: content rev from files/get_metadata (metadata-only).
   * - OneDrive: eTag from item metadata (metadata-only).
   *
   * WebDAV and LocalFile are deliberately excluded: their `getFileRev` performs a
   * FULL-body read (no bandwidth saved on an unchanged rev, and a changed rev would
   * download the file twice), and the rev can be a weak/coarse validator that may
   * not change on a same-second write, so short-circuiting there risks missing a
   * remote update. Re-adding WebDAV behind a strong-ETag / PROPFIND `getetag` check
   * is tracked in SPAP-29. A provider-id allowlist is used rather than a capability
   * flag on `FileSyncProvider` because the flag would have to be threaded through
   * every provider implementation and the shared package interface for a purely
   * adapter-local optimization.
   */
  private readonly _REV_PRECHECK_PROVIDERS: ReadonlySet<SyncProviderId> = new Set([
    SyncProviderId.Dropbox,
    SyncProviderId.OneDrive,
  ]);

  /** Cache for downloaded sync data within a sync cycle (avoids redundant downloads) */
  private _syncCycleCache = new Map<
    string,
    {
      data: FileBasedSyncData;
      rev: string;
      timestamp: number;
    }
  >();

  /** Cache TTL - 30 seconds (sync cycle should complete within this) */
  private readonly _CACHE_TTL_MS = 30_000;

  /**
   * SPAP-11: within-cycle cache for the split-format ops file (`sync-ops.json`),
   * so an upload can reuse the rev fetched by the preceding download in the same
   * cycle (mirrors `_syncCycleCache` for the single-file path).
   */
  private _splitOpsCache = new Map<
    string,
    { data: FileBasedOpsFile; rev: string; timestamp: number }
  >();

  /** Tracks whether we've loaded persisted state from localStorage */
  private _persistedStateLoaded = false;

  /** Storage key for atomic state persistence */
  private readonly _STORAGE_KEY =
    FILE_BASED_SYNC_CONSTANTS.SYNC_VERSION_STORAGE_KEY_PREFIX + 'state';

  /**
   * Loads persisted sync state from localStorage if not already loaded.
   * This is called automatically before any sync operation.
   */
  private _loadPersistedState(): void {
    if (this._persistedStateLoaded) {
      return;
    }

    try {
      // Try loading from new atomic storage key first
      const stateJson = localStorage.getItem(this._STORAGE_KEY);
      if (stateJson) {
        const state = JSON.parse(stateJson);
        if (state.syncVersions) {
          this._expectedSyncVersions = new Map(Object.entries(state.syncVersions));
        }
        if (state.seqCounters) {
          this._localSeqCounters = new Map(Object.entries(state.seqCounters));
        }
        // SPAP-10: back-compat — older persisted state has no `revs`; the map
        // simply stays empty and the pre-check no-ops until the next download
        // learns a rev.
        if (state.revs) {
          this._lastSeenRevs = new Map(Object.entries(state.revs));
        }
        this._persistedStateLoaded = true;
        return;
      }

      // Migration: Load from old separate keys (one-time migration)
      const syncVersionsJson = localStorage.getItem(
        FILE_BASED_SYNC_CONSTANTS.SYNC_VERSION_STORAGE_KEY_PREFIX + 'versions',
      );
      const seqCountersJson = localStorage.getItem(
        FILE_BASED_SYNC_CONSTANTS.SYNC_VERSION_STORAGE_KEY_PREFIX + 'seqCounters',
      );
      if (syncVersionsJson || seqCountersJson) {
        if (syncVersionsJson) {
          const parsed = JSON.parse(syncVersionsJson);
          this._expectedSyncVersions = new Map(Object.entries(parsed));
        }
        if (seqCountersJson) {
          const parsed = JSON.parse(seqCountersJson);
          this._localSeqCounters = new Map(Object.entries(parsed));
        }
        // Migrate to new atomic format and clean up old keys
        this._persistState();
        localStorage.removeItem(
          FILE_BASED_SYNC_CONSTANTS.SYNC_VERSION_STORAGE_KEY_PREFIX + 'versions',
        );
        localStorage.removeItem(
          FILE_BASED_SYNC_CONSTANTS.SYNC_VERSION_STORAGE_KEY_PREFIX + 'seqCounters',
        );
        localStorage.removeItem(
          FILE_BASED_SYNC_CONSTANTS.SYNC_VERSION_STORAGE_KEY_PREFIX + 'processedOps',
        );
        OpLog.normal('FileBasedSyncAdapter: Migrated sync state to atomic storage');
      }

      this._persistedStateLoaded = true;
    } catch (e) {
      OpLog.warn('FileBasedSyncAdapter: Failed to load persisted sync state', e);
      this._persistedStateLoaded = true; // Prevent infinite retry
    }
  }

  /**
   * Persists sync state to localStorage atomically for recovery after app restart.
   * Uses a single storage key to ensure all state is written together.
   */
  private _persistState(): void {
    try {
      // Persist all state atomically in a single write
      const state = {
        syncVersions: Object.fromEntries(this._expectedSyncVersions),
        seqCounters: Object.fromEntries(this._localSeqCounters),
        // SPAP-10: last-seen remote rev per provider, for the cheap download pre-check.
        revs: Object.fromEntries(this._lastSeenRevs),
      };
      localStorage.setItem(this._STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      OpLog.warn('FileBasedSyncAdapter: Failed to persist sync state', e);
    }
  }

  /**
   * Gets cached sync data if available and not expired.
   */
  private _getCachedSyncData(
    providerKey: string,
  ): { data: FileBasedSyncData; rev: string } | null {
    const cached = this._syncCycleCache.get(providerKey);
    if (!cached) return null;

    // Check TTL
    if (Date.now() - cached.timestamp > this._CACHE_TTL_MS) {
      this._syncCycleCache.delete(providerKey);
      return null;
    }

    return { data: cached.data, rev: cached.rev };
  }

  /**
   * Caches sync data with its revision for reuse within the sync cycle.
   */
  private _setCachedSyncData(
    providerKey: string,
    data: FileBasedSyncData,
    rev: string,
  ): void {
    this._syncCycleCache.set(providerKey, {
      data,
      rev,
      timestamp: Date.now(),
    });
  }

  /**
   * Clears cached sync data (e.g., after successful upload).
   */
  private _clearCachedSyncData(providerKey: string): void {
    this._syncCycleCache.delete(providerKey);
  }

  /**
   * Creates an OperationSyncCapable adapter for a file-based provider.
   *
   * @param provider - The underlying file provider (WebDAV, Dropbox, etc.)
   * @param encryptAndCompressCfg - Encryption/compression settings
   * @param encryptKey - Optional encryption key
   * @returns Object implementing OperationSyncCapable interface
   */
  createAdapter(
    provider: FileSyncProvider<SyncProviderId>,
    encryptAndCompressCfg: EncryptAndCompressCfg,
    encryptKey: string | undefined,
  ): OperationSyncCapable<'fileSnapshotOps'> {
    // Load persisted state before creating adapter
    this._loadPersistedState();

    const providerKey = this._getProviderKey(provider);

    return {
      supportsOperationSync: true,
      providerMode: 'fileSnapshotOps',

      uploadOps: async (
        ops: SyncOperation[],
        clientId: string,
        lastKnownServerSeq?: number,
        localStateSnapshot?: unknown,
      ): Promise<OpUploadResponse> => {
        return this._uploadOps(
          provider,
          encryptAndCompressCfg,
          encryptKey,
          ops,
          clientId,
          lastKnownServerSeq,
          localStateSnapshot,
        );
      },

      downloadOps: async (
        sinceSeq: number,
        excludeClient?: string,
        limit?: number,
      ): Promise<FileSnapshotOpDownloadResponse> => {
        return this._downloadOps(
          provider,
          encryptAndCompressCfg,
          encryptKey,
          sinceSeq,
          excludeClient,
          limit,
        );
      },

      getLastServerSeq: async (): Promise<number> => {
        this._loadPersistedState();
        return this._localSeqCounters.get(providerKey) || 0;
      },

      setLastServerSeq: async (seq: number): Promise<void> => {
        this._localSeqCounters.set(providerKey, seq);
        const pendingExpectedVersion = this._pendingExpectedSyncVersions.get(providerKey);
        if (pendingExpectedVersion !== undefined) {
          this._expectedSyncVersions.set(providerKey, pendingExpectedVersion);
          this._pendingExpectedSyncVersions.delete(providerKey);
        }
        const pendingVectorClock = this._pendingVectorClocks.get(providerKey);
        if (pendingVectorClock !== undefined) {
          this._lastSeenVectorClocks.set(providerKey, pendingVectorClock);
          this._pendingVectorClocks.delete(providerKey);
        }
        // SPAP-10: the caller invokes this only after the downloaded ops are
        // durably applied, so it's the correct point to promote the rev staged in
        // _downloadOps to last-seen and persist it — same ordering as the seq
        // cursor. A crash before this leaves _lastSeenRevs unchanged, so the next
        // poll re-downloads instead of skipping un-applied ops.
        const pendingRev = this._pendingRevs.get(providerKey);
        if (pendingRev !== undefined) {
          this._lastSeenRevs.set(providerKey, pendingRev);
          this._pendingRevs.delete(providerKey);
        }
        this._persistState();
      },

      uploadSnapshot: async (
        state: unknown,
        clientId: string,
        reason: 'initial' | 'recovery' | 'migration',
        vectorClock: Record<string, number>,
        schemaVersion: number,
        isPayloadEncrypted: boolean | undefined,
        _opId: string, // Not used in file-based sync (operation IDs are client-local)
        _isCleanSlate?: boolean, // Not used - file-based sync replaces entire file
        snapshotOpType?: RestorePointType, // REPAIR triggers a rev-based concurrency guard; see _uploadSnapshot
        _syncImportReason?: string, // Not used - file-based sync has no server-side conflict dialog
      ): Promise<SnapshotUploadResponse> => {
        return this._uploadSnapshot(
          provider,
          encryptAndCompressCfg,
          encryptKey,
          state,
          clientId,
          reason,
          vectorClock,
          schemaVersion,
          snapshotOpType,
        );
      },

      deleteAllData: async (): Promise<{ success: boolean }> => {
        return this._deleteAllData(provider);
      },

      // GHSA-9544-hjjr-fg8h: file-based encryption happens inside this adapter
      // (the key is never handed to the upload service via getEncryptKey), so
      // the upload path relies on these hooks to detect the dropped-credential
      // state. `encryptAndCompressCfg.isEncrypt` carries the durable per-provider
      // intent resolved in WrappedProviderService.
      isEncryptionEnabled: async (): Promise<boolean> =>
        !!encryptAndCompressCfg.isEncrypt,
      isEncryptionKeyMissing: async (): Promise<boolean> =>
        !!encryptAndCompressCfg.isEncrypt && !encryptKey,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UPLOAD OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Gets the current sync state from cache or by downloading.
   */
  private async _getCurrentSyncState(
    provider: FileSyncProvider<SyncProviderId>,
    cfg: EncryptAndCompressCfg,
    encryptKey: string | undefined,
    providerKey: string,
  ): Promise<{
    currentData: FileBasedSyncData | null;
    currentSyncVersion: number;
    fileExists: boolean;
    revToMatch: string | null;
  }> {
    // Try to use cached data from _downloadOps() first
    const cached = this._getCachedSyncData(providerKey);
    if (cached) {
      OpLog.normal('FileBasedSyncAdapter: Using cached sync data (saved 1 download)');
      return {
        currentData: cached.data,
        currentSyncVersion: cached.data.syncVersion,
        fileExists: true,
        revToMatch: cached.rev,
      };
    }

    // Fallback: download if no cache
    try {
      const result = await this._downloadSyncFile(provider, cfg, encryptKey);
      return {
        currentData: result.data,
        currentSyncVersion: result.data.syncVersion,
        fileExists: true,
        revToMatch: result.rev,
      };
    } catch (e) {
      if (e instanceof SplitSyncFormatDetectedError) {
        // SPAP-11: OFF client uploading against a migrated folder — surface the
        // notice and abort the upload (no divergence).
        this._notifySplitFormatDetected();
        throw e;
      }
      if (!(e instanceof RemoteFileNotFoundAPIError)) {
        throw e;
      }
      // No file exists yet - this is first sync
      OpLog.normal('FileBasedSyncAdapter: No existing sync file, creating new');
      return {
        currentData: null,
        currentSyncVersion: 0,
        fileExists: false,
        revToMatch: null,
      };
    }
  }

  /**
   * Builds the merged sync data object for upload.
   */
  private async _buildMergedSyncData(
    currentData: FileBasedSyncData | null,
    ops: SyncOperation[],
    clientId: string,
    currentSyncVersion: number,
    localStateSnapshot?: unknown,
  ): Promise<FileBasedSyncData> {
    const newSyncVersion = currentSyncVersion + 1;

    // Tag each new compact op with the syncVersion of this upload batch
    const compactOps: SyncFileCompactOp[] = ops.map((op) => ({
      ...this._syncOpToCompact(op),
      sv: newSyncVersion,
    }));

    // Build merged vector clock
    let mergedClock: VectorClock = currentData?.vectorClock || {};
    for (const op of ops) {
      mergedClock = mergeVectorClocks(mergedClock, op.vectorClock);
    }

    // Merge recentOps - add new ops, trim to limit
    const existingOps: SyncFileCompactOp[] = currentData?.recentOps || [];
    const combinedOps = [...existingOps, ...compactOps];
    const mergedOps = combinedOps.slice(-FILE_BASED_SYNC_CONSTANTS.MAX_RECENT_OPS);
    if (combinedOps.length > mergedOps.length) {
      OpLog.warn(
        `FileBasedSyncAdapter: Trimmed ${combinedOps.length - mergedOps.length} old ops ` +
          `from recentOps (${combinedOps.length} → ${mergedOps.length})`,
      );
    }

    // Load archive data from IndexedDB to include in sync file
    const archiveYoung = await this._archiveDbAdapter.loadArchiveYoung();
    const archiveOld = await this._archiveDbAdapter.loadArchiveOld();

    // Get current state from NgRx store - this keeps the snapshot up-to-date
    const currentState = stripLocalOnlySyncSettingsFromAppData(
      localStateSnapshot ?? this._stateSnapshotService.getStateSnapshotForOperationLog(),
    );

    // Compute oldestOpSyncVersion from the first (oldest) op in mergedOps.
    // Ops without sv (from old sync files) are ignored — gap detection stays
    // disabled until those ops are naturally trimmed out.
    const oldestOpSyncVersion = mergedOps.length > 0 ? mergedOps[0]?.sv : undefined;

    const newData: FileBasedSyncData = {
      version: FILE_BASED_SYNC_CONSTANTS.FILE_VERSION,
      syncVersion: newSyncVersion,
      schemaVersion: ops[0]?.schemaVersion || currentData?.schemaVersion || 1,
      vectorClock: mergedClock,
      lastModified: Date.now(),
      clientId,
      state: currentState,
      archiveYoung,
      archiveOld,
      recentOps: mergedOps,
      oldestOpSyncVersion,
    };

    return newData;
  }

  /**
   * Uploads sync data with a CONDITIONAL write (optimistic lock on `revToMatch`).
   *
   * On a rev mismatch it re-downloads to classify the failure, but it NEVER
   * force-overwrites the primary sync file — that would silently clobber a
   * concurrent client's ops if the rev check is fooled (caching / rev reuse /
   * eventual consistency). Force-overwrite of `sync-data.json` is reachable ONLY
   * from explicit user actions (forceUploadLocalState / conflict "Use Local").
   *
   * - Same rev after re-download → transient server rev/timestamp inconsistency
   *   (no real concurrent upload). Retry the CONDITIONAL upload (bounded by
   *   `_MAX_UPLOAD_RETRIES`); if still failing, surface a retryable error.
   * - Different rev after re-download → a genuine concurrent upload. Throw a
   *   retryable error so the next sync cycle downloads the concurrent ops
   *   (applying them to the store) and rebuilds a consistent snapshot via
   *   `_buildMergedSyncData()`. Re-uploading here would embed a stale in-memory
   *   snapshot whose state never saw those ops.
   */
  private async _uploadWithMismatchFallback(
    provider: FileSyncProvider<SyncProviderId>,
    cfg: EncryptAndCompressCfg,
    encryptKey: string | undefined,
    newData: FileBasedSyncData,
    revToMatch: string | null,
  ): Promise<{ finalSyncVersion: number; finalRev: string }> {
    const uploadData = await this._encryptAndCompressHandler.compressAndEncryptData(
      cfg,
      encryptKey,
      newData,
      FILE_BASED_SYNC_CONSTANTS.FILE_VERSION,
    );
    this._assertUploadDataNotEmpty(
      uploadData,
      'FileBasedSyncAdapter._uploadWithMismatchFallback',
    );

    const maxAttempts = 1 + this._MAX_UPLOAD_RETRIES;
    let currentRevToMatch = revToMatch;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // CONDITIONAL upload only (isForceOverwrite=false). Never forces.
        const uploadRes = await provider.uploadFile(
          FILE_BASED_SYNC_CONSTANTS.SYNC_FILE,
          uploadData,
          currentRevToMatch,
          false,
        );
        // SPAP-10: the upload response carries the new rev — return it so the
        // caller can record it as the last-seen rev for the next poll's pre-check.
        return { finalSyncVersion: newData.syncVersion, finalRev: uploadRes.rev };
      } catch (e) {
        if (!(e instanceof UploadRevToMatchMismatchAPIError)) {
          throw e;
        }
      }

      if (attempt === maxAttempts) {
        break;
      }

      // Rev mismatch — re-download to check whether a real concurrent upload occurred.
      OpLog.normal(
        'FileBasedSyncAdapter: Rev mismatch detected, re-downloading to check...',
      );
      const { rev: freshRev } = await this._downloadSyncFile(provider, cfg, encryptKey);

      if (freshRev !== currentRevToMatch) {
        // Genuine concurrent upload: another client wrote between our download and
        // upload. Do NOT overwrite. Throw retryable so the next sync cycle downloads
        // the concurrent ops (applying them to the store) and rebuilds a consistent
        // snapshot. This guarantees the concurrent client's ops are never clobbered.
        throw new UploadRevToMatchMismatchAPIError(
          'FileBasedSyncAdapter: Concurrent upload detected. Next sync cycle will ' +
            'download the concurrent ops and retry with a consistent snapshot.',
        );
      }

      // Same rev after re-download → transient server rev/timestamp inconsistency
      // (the remote is confirmed identical to what we were trying to overwrite).
      // Retry the CONDITIONAL upload — never force.
      OpLog.warn(
        'FileBasedSyncAdapter: Rev unchanged after re-download (server rev/timestamp ' +
          'inconsistency). Retrying conditional upload without force-overwrite.',
      );
      currentRevToMatch = freshRev;
    }

    // Retries exhausted without a successful conditional upload. Surface a retryable
    // error rather than silently force-overwriting the primary sync file.
    throw new UploadRevToMatchMismatchAPIError(
      'FileBasedSyncAdapter: Upload retries exhausted after repeated rev mismatch. ' +
        'Sync will retry on the next cycle.',
    );
  }

  private async _uploadOps(
    provider: FileSyncProvider<SyncProviderId>,
    cfg: EncryptAndCompressCfg,
    encryptKey: string | undefined,
    ops: SyncOperation[],
    clientId: string,
    lastKnownServerSeq?: number,
    localStateSnapshot?: unknown,
  ): Promise<OpUploadResponse> {
    const providerKey = this._getProviderKey(provider);

    // SPAP-11: split-file ("Surgical sync") path is fully separate and only
    // reached when the opt-in setting is ON. The single-file path below is
    // byte-for-byte unchanged when the setting is OFF (the default).
    if (this._isSplitSyncEnabled()) {
      return this._uploadOpsSplit(
        provider,
        cfg,
        encryptKey,
        ops,
        clientId,
        providerKey,
        localStateSnapshot,
      );
    }

    // Step 1: Get current sync state
    const { currentData, currentSyncVersion, fileExists, revToMatch } =
      await this._getCurrentSyncState(provider, cfg, encryptKey, providerKey);

    // Early return if no ops and file exists
    if (ops.length === 0 && fileExists) {
      OpLog.normal('FileBasedSyncAdapter: No ops to upload, file already exists');
      return {
        results: [],
        latestSeq: this._localSeqCounters.get(providerKey) || 0,
      };
    }

    OpLog.normal(
      `FileBasedSyncAdapter: Uploading ${ops.length} ops for client ${clientId}${!fileExists ? ' (creating initial sync file)' : ''}`,
    );

    // Log version mismatch (not an error, just informational)
    const expectedVersion = this._expectedSyncVersions.get(providerKey) || 0;
    if (currentData && currentSyncVersion !== expectedVersion) {
      OpLog.normal(
        `FileBasedSyncAdapter: Version changed (expected ${expectedVersion}, got ${currentSyncVersion}). Merging.`,
      );
    }

    // Step 2: Build merged sync data
    const newData = await this._buildMergedSyncData(
      currentData,
      ops,
      clientId,
      currentSyncVersion,
      localStateSnapshot,
    );

    // Step 2.5: Backup-before-overwrite (two-phase write). Copy the CURRENT remote
    // content to sync-data.json.bak before overwriting the primary file, so an
    // interrupted/corrupt write can be recovered on the next download. We re-encode
    // the already-in-hand `currentData` rather than issuing another GET.
    if (fileExists && currentData) {
      await this._writeBakFile(
        provider,
        cfg,
        encryptKey,
        FILE_BASED_SYNC_CONSTANTS.BACKUP_FILE,
        currentData,
        FILE_BASED_SYNC_CONSTANTS.FILE_VERSION,
      );
    }

    // Step 3: Upload conditionally; on rev mismatch re-download and retry
    // conditionally or throw retryably (never force-overwrite).
    const { finalSyncVersion, finalRev } = await this._uploadWithMismatchFallback(
      provider,
      cfg,
      encryptKey,
      newData,
      revToMatch,
    );

    // Step 4: Post-upload processing
    this._clearCachedSyncData(providerKey);
    this._expectedSyncVersions.set(providerKey, finalSyncVersion);
    // SPAP-10: the remote is now exactly what we just uploaded, so its rev is the
    // fresh last-seen rev. Recording it lets the next poll short-circuit if no
    // other client writes in between. Persisted via _persistState() below.
    this._commitLastSeenRev(providerKey, finalRev);

    // Use finalSyncVersion (NOT mergedOps.length) to match download behavior.
    // mergedOps.length is the total ops count, which can be much larger than syncVersion
    // after many syncs, causing false "Server sequence decreased" warnings.
    const latestSeq = finalSyncVersion;

    OpLog.normal(
      `FileBasedSyncAdapter: Upload complete (syncVersion=${finalSyncVersion}, latestSeq=${latestSeq})`,
    );

    this._persistState();

    // Build response — clamp to 0 to prevent negative serverSeq on first multi-op upload
    const startingSeq = Math.max(0, latestSeq - ops.length);
    return {
      results: ops.map((op, i) => ({
        opId: op.id,
        accepted: true,
        serverSeq: startingSeq + i + 1,
      })),
      latestSeq,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DOWNLOAD OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  private async _downloadOps(
    provider: FileSyncProvider<SyncProviderId>,
    cfg: EncryptAndCompressCfg,
    encryptKey: string | undefined,
    sinceSeq: number,
    excludeClient?: string,
    limit: number = 500,
  ): Promise<FileSnapshotOpDownloadResponse> {
    const providerKey = this._getProviderKey(provider);

    // SPAP-11: split-file ("Surgical sync") download path (opt-in). When OFF
    // (default) the single-file path below runs unchanged.
    if (this._isSplitSyncEnabled()) {
      return this._downloadOpsSplit(
        provider,
        cfg,
        encryptKey,
        sinceSeq,
        excludeClient,
        limit,
        providerKey,
      );
    }

    // SPAP-10: cheap remote-rev pre-check. If we already know the last-seen rev
    // AND nothing in this cycle has cached a fresh download, ask the provider for
    // the current rev WITHOUT downloading the full file. An unchanged rev proves
    // the remote `sync-data.json` is byte-identical to what we last processed, so
    // there are provably no new ops — and, crucially, NO gap can exist: every gap
    // signal (syncVersion reset, snapshot replacement, partial trimming) requires
    // the file to have CHANGED, which an identical rev rules out. We therefore
    // safely bypass the gap-detection block below.
    //
    // Gating on cache absence is a correctness guard, not just an optimization:
    // during multi-page pagination `_downloadOps` is called repeatedly with the
    // same rev and a fresh cache, and short-circuiting mid-pagination would drop
    // the remaining pages.
    //
    // Strictly best-effort: ANY error (including RemoteFileNotFoundAPIError) falls
    // through to the full-download path below — the sync must never fail because
    // the cheap check failed.
    //
    // Gated on `sinceSeq > 0` (review follow-up): a `forceFromSeq0` download
    // (sinceSeq === 0) is used to REBUILD local state from the remote snapshot
    // (e.g. USE_REMOTE conflict resolution, which first clears local state). There
    // "remote rev unchanged" does NOT mean "nothing to do" — the caller needs the
    // full snapshotState even when the rev matches, so a seq-0 download must never
    // short-circuit.
    const lastSeenRev = this._lastSeenRevs.get(providerKey);
    if (
      sinceSeq > 0 &&
      lastSeenRev &&
      !this._getCachedSyncData(providerKey) &&
      this._REV_PRECHECK_PROVIDERS.has(provider.id)
    ) {
      try {
        const { rev: remoteRev } = await provider.getFileRev(
          FILE_BASED_SYNC_CONSTANTS.SYNC_FILE,
          lastSeenRev,
        );
        if (remoteRev === lastSeenRev) {
          // latestSeq mirrors the last-known expected syncVersion so the caller
          // (operation-log-download.service) sees "nothing new" without a seq
          // regression (rev unchanged ⇒ same file ⇒ same syncVersion).
          const expectedVersion = this._expectedSyncVersions.get(providerKey) ?? 0;
          OpLog.normal(
            'FileBasedSyncAdapter: Remote rev unchanged — skipping full download (nothing new).',
          );
          return { ops: [], hasMore: false, latestSeq: expectedVersion };
        }
      } catch (e) {
        // Best-effort: never fail the sync on the cheap check. Fall through to the
        // full download, which handles missing/corrupt files authoritatively.
        OpLog.normal(
          'FileBasedSyncAdapter: getFileRev pre-check failed; falling back to full download.',
          e,
        );
      }
    }

    let syncData: FileBasedSyncData;
    let rev: string;
    let recoveredFromBackup = false;
    try {
      const result = await this._downloadSyncFile(provider, cfg, encryptKey);
      syncData = result.data;
      rev = result.rev;

      // Cache data + rev for use in _uploadOps() (avoids redundant download)
      this._setCachedSyncData(providerKey, syncData, rev);
    } catch (e) {
      if (e instanceof SplitSyncFormatDetectedError) {
        // SPAP-11: OFF client hit a migrated (split-format) folder. Surface an
        // actionable notice and pause safely (no upload, no divergence).
        this._notifySplitFormatDetected();
        throw e;
      }
      if (e instanceof RemoteFileNotFoundAPIError) {
        // No sync file yet - return empty
        return {
          ops: [],
          hasMore: false,
          latestSeq: 0,
        };
      }
      if (this._isRecoverableCorruption(e)) {
        // Primary sync-data.json is corrupt/empty/unparseable (e.g. interrupted
        // write). Try to recover from the .bak artifact before failing.
        const recovered = await this._readBakFile<FileBasedSyncData>(
          provider,
          cfg,
          encryptKey,
          FILE_BASED_SYNC_CONSTANTS.BACKUP_FILE,
          FILE_BASED_SYNC_CONSTANTS.FILE_VERSION,
        );
        if (recovered) {
          recoveredFromBackup = true;
          OpLog.warn(
            'FileBasedSyncAdapter: Primary sync file unreadable; recovered from backup',
          );
          syncData = recovered.data;
          // Seed the cache with the CORRUPT PRIMARY file's rev (annotated onto the
          // error in _downloadSyncFile), not the .bak rev. The next conditional
          // upload then matches sync-data.json and OVERWRITES (heals) it. Using the
          // .bak rev would mismatch the primary on every upload, leaving sync stuck
          // in a re-recover/re-fail loop. Fall back to the .bak rev if the primary
          // rev is unavailable (a later mismatch just re-recovers — no data loss).
          const primaryRev =
            (e as { primaryRev?: string } | null)?.primaryRev ?? recovered.rev;
          rev = primaryRev;
          this._setCachedSyncData(providerKey, syncData, rev);
          this._notifyRecoveredCorruptPrimaryOnce(providerKey, primaryRev);
        } else {
          throw e;
        }
      } else {
        throw e;
      }
    }

    // Detect syncVersion reset (e.g., another client uploaded a snapshot).
    // When syncVersion resets to a lower value, we need to signal this to trigger
    // a re-download from seq 0 so the caller can get the snapshotState.
    const previousExpectedVersion = this._expectedSyncVersions.get(providerKey) ?? 0;
    const syncVersionRegressed =
      previousExpectedVersion > 0 && syncData.syncVersion < previousExpectedVersion;

    // Guard against stale in-memory state: if the persisted expected syncVersion is
    // AHEAD of what the remote file reports, our counter is stale (e.g. after another
    // client uploaded a lower-version recovery snapshot). Log and reconcile to the
    // remote's authoritative value rather than trusting the stale counter — the
    // `_expectedSyncVersions.set(...)` below always adopts the remote version, and
    // `versionWasReset` drives gap detection so the caller re-downloads from seq 0.
    if (previousExpectedVersion > syncData.syncVersion) {
      OpLog.warn(
        `FileBasedSyncAdapter: Persisted expected syncVersion (${previousExpectedVersion}) is ` +
          `ahead of remote (${syncData.syncVersion}); reconciling to remote (stale in-memory counter).`,
      );
    }

    // SPAP-9: a syncVersion regression only implies data loss if the causal state
    // also regressed. Compare the file's vector clock against the one we last saw
    // for this provider. Only an EQUAL clock proves this client already holds the
    // exact same causal state, so the reset is purely cosmetic (a counter reset
    // that composed with a snapshot rewrite of identical content) and we can keep
    // syncing incrementally at the expected version instead of forcing a full
    // seq-0 resync.
    //
    // GREATER_THAN is deliberately NOT treated as cosmetic (review follow-up): it
    // only proves the writer did strictly more work, not that this client received
    // the intervening ops. A snapshot can compact ops this client never downloaded
    // and the writer then make one more op — dominating our last-seen clock — so
    // suppressing the reset there would silently drop the compacted ops. Anything
    // that is not EQUAL (GREATER_THAN, behind, or concurrent) is treated as a
    // genuine reset and triggers a seq-0 resync so the caller re-hydrates the
    // snapshot. Implemented generally via the last-seen clock — no dependency on
    // any provider-specific recovery mechanism.
    const lastSeenClock = this._lastSeenVectorClocks.get(providerKey);
    let versionWasReset = syncVersionRegressed;
    if (syncVersionRegressed && lastSeenClock) {
      const resetClockComparison = compareVectorClocks(
        syncData.vectorClock,
        lastSeenClock,
      );
      if (resetClockComparison === 'EQUAL') {
        versionWasReset = false;
        OpLog.normal(
          `FileBasedSyncAdapter: syncVersion regressed ` +
            `(${previousExpectedVersion} → ${syncData.syncVersion}) but remote vector clock is ` +
            `EQUAL to last-seen — treating reset as cosmetic (no gap).`,
        );
      }
    }

    // Also detect snapshot replacement: if client expected ops (sinceSeq > 0) but file has
    // no recent ops AND has a snapshot state, another client uploaded a fresh snapshot.
    // This happens when "Use Local" is chosen in conflict resolution - the snapshot replaces
    // all previous ops but syncVersion may not decrease (could stay at 1).
    //
    // Detection strategy depends on whether we know the downloading client's ID:
    // - If excludeClient is provided: use clientId comparison (more accurate)
    // - If excludeClient is undefined: fall back to syncVersion comparison
    //
    // The clientId check prevents false positives when we just uploaded a snapshot ourselves.
    // The syncVersion check works when sinceSeq doesn't match syncVersion (another client changed it).
    const snapshotReplacement =
      sinceSeq > 0 &&
      syncData.recentOps.length === 0 &&
      !!syncData.state &&
      (excludeClient !== undefined
        ? syncData.clientId !== excludeClient
        : sinceSeq !== syncData.syncVersion);

    // Detect a trimming gap. The client already holds every op up to and including
    // sinceSeq, so the first op it still needs is sinceSeq+1. syncVersion is
    // contiguous and every bump carries at least one op, so if the oldest op still
    // retained has syncVersion > sinceSeq+1, the op at sinceSeq+1 provably existed
    // and has since been trimmed away — a genuine gap that requires the snapshot.
    // The boundary oldestOpSyncVersion === sinceSeq + 1 is contiguous (SPAP-9
    // off-by-one fix) and must NOT be treated as a gap.
    //
    // SPAP-33: `oldestOpSyncVersion > sinceSeq + 1` is sufficient on its own and
    // never false-positives, so the previous `recentOps.length >= MAX_RECENT_OPS`
    // clause was redundant AND harmful — it silently SUPPRESSED a real gap whenever
    // the buffer was trimmed at a smaller floor than the current cap: a legacy
    // buffer written by an old client with a lower MAX_RECENT_OPS, or (in the split
    // format) a buffer trimmed to SPLIT_COMPACTION_THRESHOLD. Dropping it lets a
    // behind client correctly fall back to the snapshot instead of silently
    // diverging.
    const partialTrimGap =
      sinceSeq > 0 &&
      syncData.oldestOpSyncVersion !== undefined &&
      syncData.oldestOpSyncVersion > sinceSeq + 1;

    const needsGapDetection = versionWasReset || snapshotReplacement || partialTrimGap;

    if (needsGapDetection) {
      const reason = versionWasReset
        ? `sync version reset (${previousExpectedVersion} → ${syncData.syncVersion})`
        : snapshotReplacement
          ? `snapshot replacement (expected ops from seq ${sinceSeq}, but recentOps is empty)`
          : `partial trimming (oldestOpSyncVersion=${syncData.oldestOpSyncVersion}, ` +
            `sinceSeq=${sinceSeq}, recentOps=${syncData.recentOps.length})`;
      OpLog.warn(
        `FileBasedSyncAdapter: Gap detected - ${reason}. ` +
          'Another client may have uploaded a snapshot. Signaling gap detection.',
      );
    }

    // Stage the remote baseline until the caller confirms that the downloaded
    // snapshot/ops were durably applied. A cancelled conflict dialog must leave
    // the committed baseline intact so a later reset still triggers a gap.
    this._pendingExpectedSyncVersions.set(providerKey, syncData.syncVersion);
    this._pendingVectorClocks.set(providerKey, syncData.vectorClock);
    this._stageOrDropDownloadedRev(providerKey, rev, recoveredFromBackup);

    // Filter ops using operation IDs instead of synthetic seq numbers.
    // Synthetic seq numbers based on array indices shift when the array is trimmed,
    // causing ops to be missed. Operation IDs are stable identifiers.
    //
    // Note: sinceSeq === 0 indicates a fresh download request (e.g., forceFromSeq0),
    // in which case we should return ALL ops regardless of whether we've seen them.
    const isForceFromZero = sinceSeq === 0;
    const filteredOps: ServerSyncOperation[] = [];

    // We return ALL ops from the file and let the download service's appliedOpIds
    // (from IndexedDB) filter decide what's truly new. This ensures correctness.

    OpLog.verbose(
      `FileBasedSyncAdapter: Returning all ${syncData.recentOps.length} ops from file (filtering by appliedOpIds happens in download service)`,
    );

    syncData.recentOps.forEach((compactOp, index) => {
      // Filter by client if specified (excludeClient is for upload deduplication)
      if (excludeClient && compactOp.c === excludeClient) {
        return;
      }

      filteredOps.push({
        serverSeq: index + 1, // Synthetic seq for compatibility (not used for tracking)
        op: this._compactToSyncOp(compactOp),
        receivedAt: compactOp.t,
      });
    });

    // File-based providers re-download the whole file each call and have no
    // server-side cursor, so there is no "next page": this method returns ops by
    // array index and ignores `sinceSeq`, and the buffer is bounded on write by
    // MAX_RECENT_OPS. Return it WHOLE with hasMore=false and let the caller's
    // appliedOpIds dedup decide what is actually new. `limit` (the caller's
    // DOWNLOAD_PAGE_SIZE) is deliberately not applied — truncating below the buffer
    // would strand a behind client on the oldest slice, because the caller loops on
    // hasMore but the ignored `sinceSeq` never advances. Returning everything (not
    // slicing to a cap) also stays safe for an over-cap buffer from a future
    // higher-MAX_RECENT_OPS client: it converges instead of re-spinning.
    const limitedOps = filteredOps;
    const hasMore = false;

    // Calculate latestSeq using syncVersion (NOT recentOps.length).
    // Using recentOps.length causes a bug after snapshot upload:
    // 1. Snapshot uploaded: recentOps=[], syncVersion=1
    // 2. Download returns latestSeq=0 (recentOps.length)
    // 3. setLastServerSeq(0) is called
    // 4. Next sync: sinceSeq=0, isForceFromZero=true, snapshotState returned
    // 5. If client has ops → conflict dialog on EVERY sync
    //
    // Using syncVersion ensures setLastServerSeq(1) is called, so next sync
    // has sinceSeq=1, isForceFromZero=false, and snapshotState is NOT returned.
    const latestSeq = syncData.syncVersion;

    OpLog.normal(
      `FileBasedSyncAdapter: Downloaded ${limitedOps.length} ops (new/total: ${filteredOps.length}/${latestSeq})`,
    );

    // NOTE: Archives are NOT written to IndexedDB here. They are included in the
    // snapshotState response and written to IndexedDB during hydrateFromRemoteSync()
    // AFTER conflict resolution. Writing them here would corrupt local archives if
    // the user chooses "Keep local" in a conflict dialog, because getStateSnapshotAsync()
    // reads archives from IndexedDB which would then contain remote data while NgRx
    // still has local entity data - causing cross-model validation failures.

    // Build snapshotState that includes archives for proper hydration
    // The entity models (task, project, tag, etc.) come from syncData.state
    // Archives need to be merged in so hydrateFromRemoteSync can write them to IndexedDB
    const snapshotStateWithArchives =
      isForceFromZero && syncData.state
        ? {
            ...syncData.state,
            ...(syncData.archiveYoung ? { archiveYoung: syncData.archiveYoung } : {}),
            ...(syncData.archiveOld ? { archiveOld: syncData.archiveOld } : {}),
          }
        : undefined;

    return {
      ops: limitedOps,
      hasMore,
      latestSeq,
      snapshotVectorClock: syncData.vectorClock,
      remoteLastModified: syncData.lastModified,
      // Signal gap detection when sync version was reset or snapshot was replaced.
      // This triggers the download service to re-download from seq 0, which will include
      // the snapshotState for proper state replacement.
      gapDetected: needsGapDetection,
      // Include full state snapshot for fresh downloads (sinceSeq === 0)
      // This allows new clients to bootstrap with complete state, not just recent ops
      ...(snapshotStateWithArchives ? { snapshotState: snapshotStateWithArchives } : {}),
      ...(snapshotStateWithArchives
        ? { snapshotAppliedOpIds: limitedOps.map(({ op }) => op.id) }
        : {}),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SNAPSHOT UPLOAD
  // ═══════════════════════════════════════════════════════════════════════════

  private async _uploadSnapshot(
    provider: FileSyncProvider<SyncProviderId>,
    cfg: EncryptAndCompressCfg,
    encryptKey: string | undefined,
    state: unknown,
    clientId: string,
    reason: 'initial' | 'recovery' | 'migration',
    vectorClock: Record<string, number>,
    schemaVersion: number,
    snapshotOpType?: RestorePointType,
  ): Promise<SnapshotUploadResponse> {
    const providerKey = this._getProviderKey(provider);

    OpLog.normal(`FileBasedSyncAdapter: Uploading snapshot (reason=${reason})`);

    // SPAP-11: split-file force-upload / recovery / initial — write both files
    // (state THEN ops) so the ops file's snapshotRef always points at a snapshot
    // that is already on the remote.
    if (this._isSplitSyncEnabled()) {
      return this._uploadSnapshotSplit(
        provider,
        cfg,
        encryptKey,
        clientId,
        vectorClock,
        schemaVersion,
        providerKey,
        state,
        snapshotOpType,
      );
    }

    // For snapshots, we start fresh with syncVersion = 1
    const newSyncVersion = 1;

    // The caller captures this state at the same boundary as the full-state op.
    // Re-reading the live store here would let later timer deltas leak into a
    // snapshot whose vector clock does not cover them.
    const currentState = stripLocalOnlySyncSettingsFromAppData(state);

    // Load archive data from IndexedDB to include in snapshot
    const archiveYoung = await this._archiveDbAdapter.loadArchiveYoung();
    const archiveOld = await this._archiveDbAdapter.loadArchiveOld();

    const syncData: FileBasedSyncData = {
      version: FILE_BASED_SYNC_CONSTANTS.FILE_VERSION,
      syncVersion: newSyncVersion,
      schemaVersion,
      vectorClock,
      lastModified: Date.now(),
      clientId,
      state: currentState,
      archiveYoung,
      archiveOld,
      recentOps: [], // Fresh start - no recent ops
    };

    const uploadData = await this._encryptAndCompressHandler.compressAndEncryptData(
      cfg,
      encryptKey,
      syncData,
      FILE_BASED_SYNC_CONSTANTS.FILE_VERSION,
    );
    this._assertUploadDataNotEmpty(uploadData, 'FileBasedSyncAdapter._uploadSnapshot');
    let snapshotUploadRes: { rev: string };
    if (snapshotOpType === 'REPAIR') {
      // #9023: an automatic REPAIR recovery snapshot must never overwrite a remote
      // that advanced since this client last synced — otherwise a concurrent edit
      // from another device (uploaded after our last download) is silently dropped.
      // Mirror the SuperSync repairBaseServerSeq guard by writing CONDITIONALLY on
      // the rev we last downloaded+applied (`_lastSeenRevs` — the repair's base).
      // A rev, not a vector clock, is used deliberately: two independently-pruned
      // clocks (MAX_VECTOR_CLOCK_SIZE) can compare CONCURRENT even when one
      // dominates, which would wedge the repair forever. On a rev mismatch we
      // signal REPAIR_STALE so the shared rebase path (RejectedOpsHandlerService)
      // downloads the concurrent ops and rebuilds the repair; that download
      // promotes `_lastSeenRevs`, so the retry converges. BACKUP_IMPORT / initial /
      // migration keep force-overwrite: explicit restores or first-time uploads.
      const baseRev = this._lastSeenRevs.get(providerKey) ?? null;
      try {
        snapshotUploadRes = await this._conditionalUploadRepairSnapshot(
          provider,
          FILE_BASED_SYNC_CONSTANTS.SYNC_FILE,
          FILE_BASED_SYNC_CONSTANTS.BACKUP_FILE,
          uploadData,
          baseRev,
        );
      } catch (e) {
        if (e instanceof UploadRevToMatchMismatchAPIError) {
          OpLog.warn(
            'FileBasedSyncAdapter: REPAIR snapshot is stale (remote advanced since ' +
              'our last sync); requesting rebase instead of overwriting.',
          );
          return {
            accepted: false,
            error: 'REPAIR snapshot does not include current remote state',
            errorCode: REPAIR_STALE_ERROR_CODE,
          };
        }
        throw e;
      }
    } else {
      snapshotUploadRes = await this._forceUploadWithBakFirst(
        provider,
        FILE_BASED_SYNC_CONSTANTS.SYNC_FILE,
        FILE_BASED_SYNC_CONSTANTS.BACKUP_FILE,
        uploadData,
      );
    }

    // Reset local state
    this._expectedSyncVersions.set(providerKey, newSyncVersion);
    this._localSeqCounters.set(providerKey, newSyncVersion);
    // SPAP-10: record the rev of the snapshot we just wrote as the last-seen rev
    // so the next poll can skip a redundant full download.
    this._commitLastSeenRev(providerKey, snapshotUploadRes.rev);
    this._persistState();

    OpLog.warn(
      `FileBasedSyncAdapter: Snapshot upload complete. Set localSeqCounter[${providerKey}]=${newSyncVersion}`,
    );

    return {
      accepted: true,
      serverSeq: newSyncVersion,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DELETE ALL DATA
  // ═══════════════════════════════════════════════════════════════════════════

  private async _deleteAllData(
    provider: FileSyncProvider<SyncProviderId>,
  ): Promise<{ success: boolean }> {
    const providerKey = this._getProviderKey(provider);

    OpLog.normal('FileBasedSyncAdapter: Deleting all sync data');

    try {
      // Source-of-truth files: a failed deletion MUST fail the whole operation
      // (outer catch → success:false) — reporting success while user data
      // remains on the remote would be a lie. The split files go FIRST so a
      // partial failure can't leave a deleted tombstone next to live split data
      // (an OFF client would then fresh-start a v2 file against it). "Not
      // found" is fine — most users are on the single-file format.
      for (const dataFile of [
        FILE_BASED_SYNC_CONSTANTS.OPS_FILE,
        FILE_BASED_SYNC_CONSTANTS.STATE_FILE,
        FILE_BASED_SYNC_CONSTANTS.SYNC_FILE,
      ]) {
        try {
          await provider.removeFile(dataFile);
        } catch (e) {
          if (!(e instanceof RemoteFileNotFoundAPIError)) {
            throw e;
          }
        }
      }

      // Disposable artifacts: best-effort — leaving one behind degrades nothing
      // (recovery only triggers on a corrupt primary, never on a missing one).
      for (const artifact of [
        FILE_BASED_SYNC_CONSTANTS.BACKUP_FILE,
        FILE_BASED_SYNC_CONSTANTS.OPS_BACKUP_FILE,
        FILE_BASED_SYNC_CONSTANTS.STATE_BACKUP_FILE,
        FILE_BASED_SYNC_CONSTANTS.MIGRATION_LOCK_FILE,
      ]) {
        try {
          await provider.removeFile(artifact);
        } catch (e) {
          if (!(e instanceof RemoteFileNotFoundAPIError)) {
            OpLog.warn(`FileBasedSyncAdapter: Unexpected error deleting ${artifact}`, e);
          }
        }
      }

      // Reset local state
      this._expectedSyncVersions.delete(providerKey);
      this._localSeqCounters.delete(providerKey);
      // SPAP-10: drop the last-seen rev so a stale value can't drive a false
      // "nothing new" short-circuit after the remote file has been deleted.
      this._lastSeenRevs.delete(providerKey);
      this._pendingRevs.delete(providerKey);
      this._lastSeenVectorClocks.delete(providerKey);
      this._pendingExpectedSyncVersions.delete(providerKey);
      this._pendingVectorClocks.delete(providerKey);
      this._clearCachedSyncData(providerKey);
      this._clearCachedOpsData(providerKey);
      this._persistState();

      return { success: true };
    } catch (e) {
      OpLog.err('FileBasedSyncAdapter: Failed to delete all data', e);
      return { success: false };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SPAP-11: SPLIT-FILE ("SURGICAL SYNC") FORMAT (opt-in)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Whether the opt-in split-file sync setting is ON. Resolved lazily via the
   * injector (like SnackService) so the single-file unit harness — which does not
   * provide GlobalConfigService — keeps working and defaults to OFF.
   */
  private _isSplitSyncEnabled(): boolean {
    const svc = this._injector.get(GlobalConfigService, null);
    return svc?.sync()?.isUseSplitSyncFiles === true;
  }

  /** True when a decoded sync-data.json body is a v3 split-format tombstone. */
  private _isSplitTombstone(data: unknown): data is FileBasedSplitTombstone {
    const d = data as Partial<FileBasedSplitTombstone> | null;
    return (
      !!d &&
      d.version === FILE_BASED_SYNC_CONSTANTS.SPLIT_FILE_VERSION &&
      d.format === FILE_BASED_SYNC_CONSTANTS.SPLIT_TOMBSTONE_FORMAT
    );
  }

  private _isPendingSplitMigration(data: FileBasedOpsFile): boolean {
    return data.migration?.status === 'pending' && !!data.migration.legacyRev;
  }

  /** Surfaces the actionable "turn on Surgical sync" notice (non-fatal if no snack). */
  private _notifySplitFormatDetected(): void {
    this._injector
      .get(SnackService, null)
      ?.open({ type: 'ERROR', msg: T.F.SYNC.S.SPLIT_FORMAT_ENABLE_SETTING });
  }

  private _getCachedOpsData(
    providerKey: string,
  ): { data: FileBasedOpsFile; rev: string } | null {
    const cached = this._splitOpsCache.get(providerKey);
    if (!cached) return null;
    if (Date.now() - cached.timestamp > this._CACHE_TTL_MS) {
      this._splitOpsCache.delete(providerKey);
      return null;
    }
    return { data: cached.data, rev: cached.rev };
  }

  private _setCachedOpsData(
    providerKey: string,
    data: FileBasedOpsFile,
    rev: string,
  ): void {
    this._splitOpsCache.set(providerKey, { data, rev, timestamp: Date.now() });
  }

  private _clearCachedOpsData(providerKey: string): void {
    this._splitOpsCache.delete(providerKey);
  }

  /** Downloads + decodes `sync-ops.json` and validates its version. */
  private async _downloadOpsFile(
    provider: FileSyncProvider<SyncProviderId>,
    cfg: EncryptAndCompressCfg,
    encryptKey: string | undefined,
  ): Promise<{ data: FileBasedOpsFile; rev: string }> {
    const response = await provider.downloadFile(FILE_BASED_SYNC_CONSTANTS.OPS_FILE);
    try {
      const data =
        await this._encryptAndCompressHandler.decompressAndDecryptData<FileBasedOpsFile>(
          cfg,
          encryptKey,
          response.dataStr,
        );
      if (data.version !== FILE_BASED_SYNC_CONSTANTS.SPLIT_FILE_VERSION) {
        throw new SyncDataCorruptedError(
          `Unsupported ops-file version: ${data.version} (expected ${FILE_BASED_SYNC_CONSTANTS.SPLIT_FILE_VERSION})`,
          FILE_BASED_SYNC_CONSTANTS.OPS_FILE,
        );
      }
      return { data, rev: response.rev };
    } catch (decodeErr) {
      // Annotate the corrupt file's rev so the .bak recovery path can seed the
      // heal cache with IT (mirrors _downloadSyncFile).
      throw this._annotatePrimaryRev(decodeErr, response.rev);
    }
  }

  /**
   * Downloads + decodes a snapshot file and validates its version. Defaults to
   * the fixed `sync-state.json`; pass a generation-specific name (#9040) to read
   * the immutable snapshot referenced by an ops file's `snapshotRef.file`.
   */
  private async _downloadStateFile(
    provider: FileSyncProvider<SyncProviderId>,
    cfg: EncryptAndCompressCfg,
    encryptKey: string | undefined,
    path: string = FILE_BASED_SYNC_CONSTANTS.STATE_FILE,
  ): Promise<{ data: FileBasedStateFile; rev: string }> {
    const response = await provider.downloadFile(path);
    const data =
      await this._encryptAndCompressHandler.decompressAndDecryptData<FileBasedStateFile>(
        cfg,
        encryptKey,
        response.dataStr,
      );
    if (data.version !== FILE_BASED_SYNC_CONSTANTS.SPLIT_FILE_VERSION) {
      throw new SyncDataCorruptedError(
        `Unsupported state-file version: ${data.version} (expected ${FILE_BASED_SYNC_CONSTANTS.SPLIT_FILE_VERSION})`,
        path,
      );
    }
    return { data, rev: response.rev };
  }

  /**
   * Writes a snapshot file (default `sync-state.json`). Force-overwrite: the ops
   * file (commit point) is the concurrency gate, and readers only trust a snapshot
   * the ops file's snapshotRef validates against. Returns the written rev for the
   * snapshotRef pointer.
   *
   * #9040: pass a generation+client-unique `path` to write the immutable snapshot.
   * Force-overwrite is safe there because the name is unique per (syncVersion,
   * clientId) — no concurrent compactor targets the same file, so nothing clobbers
   * it. The fixed `sync-state.json` remains clobberable and is written only for
   * pre-#9040 clients that don't read `snapshotRef.file`.
   */
  private async _writeStateFile(
    provider: FileSyncProvider<SyncProviderId>,
    cfg: EncryptAndCompressCfg,
    encryptKey: string | undefined,
    data: FileBasedStateFile,
    path: string = FILE_BASED_SYNC_CONSTANTS.STATE_FILE,
  ): Promise<string> {
    const uploadData = await this._encryptAndCompressHandler.compressAndEncryptData(
      cfg,
      encryptKey,
      data,
      FILE_BASED_SYNC_CONSTANTS.SPLIT_FILE_VERSION,
    );
    this._assertUploadDataNotEmpty(uploadData, 'FileBasedSyncAdapter._writeStateFile');
    const res = await provider.uploadFile(path, uploadData, null, true);
    return res.rev;
  }

  /**
   * Builds the immutable snapshot filename for a compaction (#9040):
   * `sync-state__<syncVersion>__<random>.json`. The random suffix (not the
   * clientId) makes two concurrent compactors target different files without
   * leaking device identity — filenames are NOT encrypted, so an opaque suffix
   * keeps device count/platform private from the remote for E2EE users. A
   * collision is astronomically unlikely and self-heals anyway: the reader
   * validates loaded content against `snapshotRef` (clock EQUAL), so a wrong
   * file fails validation and falls back to `sync-state.json`/`.bak`. `syncVersion`
   * stays in the name for legible ordering and a future `listFiles`-prune.
   */
  private _genStateFileName(syncVersion: number): string {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    const random = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${FILE_BASED_SYNC_CONSTANTS.STATE_GEN_FILE_PREFIX}${syncVersion}__${random}.json`;
  }

  /**
   * Best-effort deletion of a generation-specific immutable snapshot file (#9040).
   * Non-fatal — an undeleted snapshot only wastes remote space. Two call sites:
   *   - after a successful compaction: reclaim the PREVIOUS generation's snapshot
   *     (keeps the steady state at ~one immutable file), and
   *   - when a compaction fails to commit: reclaim the snapshot THIS compaction
   *     just wrote, which is now an orphan no committed ops file references (the
   *     concurrent-compaction case that would otherwise leak).
   *
   * Residual: a crash between the snapshot write and either commit or this cleanup
   * still leaks (rare crash window). Upgrade path if it ever matters — an
   * opportunistic `listFiles` prune of `STATE_GEN_FILE_PREFIX` files with a stale
   * syncVersion (listFiles is optional on the provider interface, so it must stay
   * capability-gated).
   */
  private async _removeGenStateFile(
    provider: FileSyncProvider<SyncProviderId>,
    file: string,
  ): Promise<void> {
    try {
      await provider.removeFile(file);
    } catch (e) {
      OpLog.normal('FileBasedSyncAdapter: snapshot cleanup skipped (non-fatal)', e);
    }
  }

  /** Copies the current `sync-state.json` to its `.bak` (non-fatal). */
  private async _backupStateFile(
    provider: FileSyncProvider<SyncProviderId>,
    cfg: EncryptAndCompressCfg,
    encryptKey: string | undefined,
  ): Promise<void> {
    let current: { data: FileBasedStateFile };
    try {
      current = await this._downloadStateFile(provider, cfg, encryptKey);
    } catch (e) {
      // Non-fatal — e.g. first compaction has no existing state file to back up.
      OpLog.normal('FileBasedSyncAdapter: state-file backup skipped (non-fatal)', e);
      return;
    }
    await this._writeBakFile(
      provider,
      cfg,
      encryptKey,
      FILE_BASED_SYNC_CONSTANTS.STATE_BACKUP_FILE,
      current.data,
      FILE_BASED_SYNC_CONSTANTS.SPLIT_FILE_VERSION,
    );
  }

  /** Recovers the snapshot from `sync-state.json.bak` (null if unusable). */
  private async _recoverStateFromBackup(
    provider: FileSyncProvider<SyncProviderId>,
    cfg: EncryptAndCompressCfg,
    encryptKey: string | undefined,
  ): Promise<FileBasedStateFile | null> {
    const recovered = await this._readBakFile<FileBasedStateFile>(
      provider,
      cfg,
      encryptKey,
      FILE_BASED_SYNC_CONSTANTS.STATE_BACKUP_FILE,
      FILE_BASED_SYNC_CONSTANTS.SPLIT_FILE_VERSION,
    );
    return recovered?.data ?? null;
  }

  /** True when a downloaded snapshot matches the ops file's snapshotRef. */
  private _validateSnapshotRef(
    opsFile: FileBasedOpsFile,
    state: FileBasedStateFile,
  ): boolean {
    return (
      state.syncVersion === opsFile.snapshotRef.syncVersion &&
      compareVectorClocks(state.vectorClock, opsFile.snapshotRef.vectorClock) === 'EQUAL'
    );
  }

  /**
   * Loads the snapshot referenced by `opsFile.snapshotRef`, validating it against
   * the ref. Resolution order:
   *   1. #9040: `snapshotRef.file` — the immutable, generation+client-unique
   *      snapshot. A committed ops file's referenced immutable file is never
   *      clobbered by a concurrent compactor, so this is the authoritative source
   *      for post-#9040 ops files.
   *   2. `sync-state.json` — the fixed compat snapshot (older ops files with no
   *      `snapshotRef.file`, or defensive fallback).
   *   3. `sync-state.json.bak` — the crash-window backup (e.g. a crash between the
   *      state and ops writes left a newer, unreferenced `sync-state.json`).
   * Returns null when no snapshot validates the ref (caller signals a gap).
   */
  private async _loadValidatedSnapshot(
    provider: FileSyncProvider<SyncProviderId>,
    cfg: EncryptAndCompressCfg,
    encryptKey: string | undefined,
    opsFile: FileBasedOpsFile,
  ): Promise<FileBasedStateFile | null> {
    const genFile = opsFile.snapshotRef.file;
    if (genFile) {
      try {
        const { data } = await this._downloadStateFile(
          provider,
          cfg,
          encryptKey,
          genFile,
        );
        if (this._validateSnapshotRef(opsFile, data)) return data;
        OpLog.warn(
          'FileBasedSyncAdapter: immutable snapshot does not match snapshotRef; trying sync-state.json',
        );
      } catch (e) {
        OpLog.warn(
          'FileBasedSyncAdapter: immutable snapshot unreadable; trying sync-state.json',
          e,
        );
      }
    }
    try {
      const { data } = await this._downloadStateFile(provider, cfg, encryptKey);
      if (this._validateSnapshotRef(opsFile, data)) return data;
      OpLog.warn(
        'FileBasedSyncAdapter: sync-state.json does not match snapshotRef; trying .bak',
      );
    } catch (e) {
      OpLog.warn('FileBasedSyncAdapter: sync-state.json unreadable; trying .bak', e);
    }
    const bak = await this._recoverStateFromBackup(provider, cfg, encryptKey);
    if (bak && this._validateSnapshotRef(opsFile, bak)) return bak;
    OpLog.warn(
      'FileBasedSyncAdapter: no snapshot matching snapshotRef; signaling gap for full re-sync.',
    );
    return null;
  }

  /** Builds a full snapshot (`sync-state.json` payload). */
  private async _buildStateFileData(
    clientId: string,
    syncVersion: number,
    vectorClock: VectorClock,
    schemaVersion: number,
    localStateSnapshot?: unknown,
  ): Promise<FileBasedStateFile> {
    const state = stripLocalOnlySyncSettingsFromAppData(
      localStateSnapshot ?? this._stateSnapshotService.getStateSnapshotForOperationLog(),
    );
    const archiveYoung = await this._archiveDbAdapter.loadArchiveYoung();
    const archiveOld = await this._archiveDbAdapter.loadArchiveOld();
    return {
      version: FILE_BASED_SYNC_CONSTANTS.SPLIT_FILE_VERSION,
      syncVersion,
      schemaVersion,
      vectorClock,
      lastModified: Date.now(),
      clientId,
      state,
      archiveYoung,
      archiveOld,
    };
  }

  /**
   * Neutralizes `sync-data.json.bak` and then overwrites `sync-data.json` with a
   * v3 split tombstone (NEVER deletes it), so an old client's SPAP-8 `.bak`
   * recovery cannot resurrect a v2 file and diverge. Order matters — see the
   * inline comment.
   */
  private async _writeTombstoneAndNeutralizeBak(
    provider: FileSyncProvider<SyncProviderId>,
    cfg: EncryptAndCompressCfg,
    encryptKey: string | undefined,
    expectedLegacyRev?: string,
  ): Promise<void> {
    const tombstone: FileBasedSplitTombstone = {
      version: FILE_BASED_SYNC_CONSTANTS.SPLIT_FILE_VERSION,
      format: FILE_BASED_SYNC_CONSTANTS.SPLIT_TOMBSTONE_FORMAT,
      migratedAt: Date.now(),
      note: 'Upgraded to split-file sync; update the app / enable Surgical sync to continue.',
    };
    const encoded = await this._encryptAndCompressHandler.compressAndEncryptData(
      cfg,
      encryptKey,
      tombstone,
      FILE_BASED_SYNC_CONSTANTS.SPLIT_FILE_VERSION,
    );
    // Neutralize the legacy .bak FIRST, then the tombstone. In the old order
    // (tombstone first, .bak best-effort) a crash/failure between the two left a
    // live v2 .bak next to the tombstone: an OFF client reading the tombstone
    // gets SyncDataCorruptedError → SPAP-8 recovery adopts the v2 .bak → its
    // next upload heals v2 back OVER the tombstone, forking the folder into two
    // sync worlds. Neutralize-first is crash-safe (a crash in between leaves a
    // valid v2 primary + tombstone .bak — nothing recoverable, nothing stale)
    // and the failure is deliberately FATAL: better a missing tombstone (OFF
    // clients are still caught by the ops-file probe in _downloadSyncFile) than
    // a tombstone with a resurrectable v2 .bak beside it.
    //
    // Migration passes the exact downloaded legacy rev, making the primary
    // tombstone conditional. A mismatch leaves the pending ops marker intact;
    // the recovery loop imports the newer v2 payload and retries. Explicit
    // snapshot replacement omits the rev and intentionally force-overwrites.
    await provider.uploadFile(FILE_BASED_SYNC_CONSTANTS.BACKUP_FILE, encoded, null, true);
    // Overwrite the legacy single file in place (never remove it).
    await provider.uploadFile(
      FILE_BASED_SYNC_CONSTANTS.SYNC_FILE,
      encoded,
      expectedLegacyRev ?? null,
      expectedLegacyRev === undefined,
    );
  }

  private async _writePendingSplitMigration(
    provider: FileSyncProvider<SyncProviderId>,
    cfg: EncryptAndCompressCfg,
    encryptKey: string | undefined,
    legacy: FileBasedSyncData,
    legacyRev: string,
    clientId: string,
    opsRevToMatch: string | null,
  ): Promise<{ data: FileBasedOpsFile; rev: string }> {
    const schemaVersion = legacy.schemaVersion ?? 1;
    const opsData: FileBasedOpsFile = {
      version: FILE_BASED_SYNC_CONSTANTS.SPLIT_FILE_VERSION,
      syncVersion: legacy.syncVersion,
      schemaVersion,
      vectorClock: legacy.vectorClock,
      lastModified: Date.now(),
      clientId,
      recentOps: legacy.recentOps ?? [],
      oldestOpSyncVersion: legacy.oldestOpSyncVersion,
      snapshotRef: {
        syncVersion: legacy.syncVersion,
        vectorClock: legacy.vectorClock,
      },
      migration: { status: 'pending', legacyRev },
    };
    const encoded = await this._encryptAndCompressHandler.compressAndEncryptData(
      cfg,
      encryptKey,
      opsData,
      FILE_BASED_SYNC_CONSTANTS.SPLIT_FILE_VERSION,
    );
    this._assertUploadDataNotEmpty(
      encoded,
      'FileBasedSyncAdapter._writePendingSplitMigration',
    );
    const result = await provider.uploadFile(
      FILE_BASED_SYNC_CONSTANTS.OPS_FILE,
      encoded,
      opsRevToMatch,
      false,
    );
    return { data: opsData, rev: result.rev };
  }

  private _buildSplitMigrationState(
    legacy: FileBasedSyncData,
    clientId: string,
  ): FileBasedStateFile {
    return {
      version: FILE_BASED_SYNC_CONSTANTS.SPLIT_FILE_VERSION,
      syncVersion: legacy.syncVersion,
      schemaVersion: legacy.schemaVersion ?? 1,
      vectorClock: legacy.vectorClock,
      lastModified: Date.now(),
      clientId,
      state: legacy.state,
      archiveYoung: legacy.archiveYoung,
      archiveOld: legacy.archiveOld,
    };
  }

  private async _finalizeSplitMigrationMarker(
    provider: FileSyncProvider<SyncProviderId>,
    cfg: EncryptAndCompressCfg,
    encryptKey: string | undefined,
    pending: FileBasedOpsFile,
    pendingRev: string,
  ): Promise<{ data: FileBasedOpsFile; rev: string }> {
    const finalized: FileBasedOpsFile = { ...pending };
    delete finalized.migration;
    const encoded = await this._encryptAndCompressHandler.compressAndEncryptData(
      cfg,
      encryptKey,
      finalized,
      FILE_BASED_SYNC_CONSTANTS.SPLIT_FILE_VERSION,
    );
    this._assertUploadDataNotEmpty(
      encoded,
      'FileBasedSyncAdapter._finalizeSplitMigrationMarker',
    );
    const result = await provider.uploadFile(
      FILE_BASED_SYNC_CONSTANTS.OPS_FILE,
      encoded,
      pendingRev,
      false,
    );
    return { data: finalized, rev: result.rev };
  }

  /**
   * Completes or repairs a migration whose ops commit point is still marked
   * pending. The marker survives crashes and contains the full candidate ops
   * payload. A conditional tombstone either wins against the exact legacy rev
   * used to build it or fails and causes the newer v2 payload to be re-imported.
   */
  private async _resumePendingSplitMigration(
    provider: FileSyncProvider<SyncProviderId>,
    cfg: EncryptAndCompressCfg,
    encryptKey: string | undefined,
    initialPending: FileBasedOpsFile,
    initialPendingRev: string,
  ): Promise<{ data: FileBasedOpsFile; rev: string }> {
    let current = { data: initialPending, rev: initialPendingRev };
    const maxAttempts = 1 + this._MAX_UPLOAD_RETRIES;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (!this._isPendingSplitMigration(current.data)) return current;

      let legacy: { data: FileBasedSyncData; rev: string } | undefined;
      try {
        legacy = await this._downloadSyncFile(provider, cfg, encryptKey);
      } catch (e) {
        if (e instanceof SplitSyncFormatDetectedError) {
          try {
            return await this._finalizeSplitMigrationMarker(
              provider,
              cfg,
              encryptKey,
              current.data,
              current.rev,
            );
          } catch (finalizeError) {
            if (!(finalizeError instanceof UploadRevToMatchMismatchAPIError)) {
              throw finalizeError;
            }
            current = await this._downloadOpsFile(provider, cfg, encryptKey);
            continue;
          }
        }
        throw e;
      }

      if (legacy.rev !== current.data.migration?.legacyRev) {
        try {
          current = await this._writePendingSplitMigration(
            provider,
            cfg,
            encryptKey,
            legacy.data,
            legacy.rev,
            current.data.clientId,
            current.rev,
          );
        } catch (refreshError) {
          if (!(refreshError instanceof UploadRevToMatchMismatchAPIError)) {
            throw refreshError;
          }
          current = await this._downloadOpsFile(provider, cfg, encryptKey);
        }
        continue;
      }

      // The pending marker is the write permission. Only after winning its
      // conditional create/update may a migrator touch sync-state.json; this
      // prevents a stale losing migrator from overwriting a newer state file.
      // Rewriting here also repairs a crash after the marker write but before
      // the state write. The final marker records the resulting snapshot rev.
      const stateRev = await this._writeStateFile(
        provider,
        cfg,
        encryptKey,
        this._buildSplitMigrationState(legacy.data, current.data.clientId),
      );
      current = {
        data: {
          ...current.data,
          snapshotRef: { ...current.data.snapshotRef, rev: stateRev },
        },
        rev: current.rev,
      };

      try {
        await this._writeTombstoneAndNeutralizeBak(provider, cfg, encryptKey, legacy.rev);
      } catch (tombstoneError) {
        if (!(tombstoneError instanceof UploadRevToMatchMismatchAPIError)) {
          throw tombstoneError;
        }
        // A legacy writer won the conditional race. Re-read and rebuild the
        // pending split files from that newer v2 revision on the next attempt.
        continue;
      }

      try {
        return await this._finalizeSplitMigrationMarker(
          provider,
          cfg,
          encryptKey,
          current.data,
          current.rev,
        );
      } catch (finalizeError) {
        if (!(finalizeError instanceof UploadRevToMatchMismatchAPIError)) {
          throw finalizeError;
        }
        current = await this._downloadOpsFile(provider, cfg, encryptKey);
      }
    }

    throw new UploadRevToMatchMismatchAPIError(
      'FileBasedSyncAdapter: split migration did not stabilize after repeated concurrent writes.',
    );
  }

  /**
   * One-way migration of an existing single-file v2 `sync-data.json` to the split
   * format. Conditionally creates a pending `sync-ops.json` marker before
   * writing `sync-state.json`, so losing migrators cannot overwrite state. Only
   * a matching legacy rev can be tombstoned; the marker is finalized afterward
   * and can resume either side of a crash. Returns the finalized ops file (+
   * rev), or null for a truly fresh folder.
   */
  private async _maybeMigrateLegacyToSplit(
    provider: FileSyncProvider<SyncProviderId>,
    cfg: EncryptAndCompressCfg,
    encryptKey: string | undefined,
    clientId: string,
  ): Promise<{ data: FileBasedOpsFile; rev: string } | null> {
    let legacy: { data: FileBasedSyncData; rev: string };
    try {
      legacy = await this._downloadSyncFile(provider, cfg, encryptKey);
    } catch (e) {
      if (e instanceof RemoteFileNotFoundAPIError) return null; // truly fresh
      // Already a tombstone but the ops file is missing (migration crashed before
      // the ops write, or ops file was deleted): treat as fresh split — there is
      // no v2 payload left to preserve.
      if (e instanceof SplitSyncFormatDetectedError) return null;
      throw e; // legacy pfapi (__meta_) etc. must propagate
    }

    OpLog.warn(
      'FileBasedSyncAdapter: migrating legacy single-file sync-data.json to split format',
    );
    let pending: { data: FileBasedOpsFile; rev: string };
    try {
      pending = await this._writePendingSplitMigration(
        provider,
        cfg,
        encryptKey,
        legacy.data,
        legacy.rev,
        clientId,
        null,
      );
    } catch (e) {
      if (!(e instanceof UploadRevToMatchMismatchAPIError)) throw e;
      // Another split client created the marker first. Join its recoverable
      // migration instead of overwriting the commit point.
      pending = await this._downloadOpsFile(provider, cfg, encryptKey);
    }

    return this._resumePendingSplitMigration(
      provider,
      cfg,
      encryptKey,
      pending.data,
      pending.rev,
    );
  }

  /**
   * CONDITIONAL PUT of `sync-ops.json` (the concurrency gate). Mirrors the
   * single-file `_uploadWithMismatchFallback`: on a rev mismatch it re-downloads
   * to classify transient vs genuine concurrency and never force-overwrites.
   */
  private async _uploadOpsFileWithMismatchFallback(
    provider: FileSyncProvider<SyncProviderId>,
    cfg: EncryptAndCompressCfg,
    encryptKey: string | undefined,
    newOpsFile: FileBasedOpsFile,
    revToMatch: string | null,
  ): Promise<{ finalRev: string }> {
    const uploadData = await this._encryptAndCompressHandler.compressAndEncryptData(
      cfg,
      encryptKey,
      newOpsFile,
      FILE_BASED_SYNC_CONSTANTS.SPLIT_FILE_VERSION,
    );
    this._assertUploadDataNotEmpty(
      uploadData,
      'FileBasedSyncAdapter._uploadOpsFileWithMismatchFallback',
    );

    const maxAttempts = 1 + this._MAX_UPLOAD_RETRIES;
    let currentRevToMatch = revToMatch;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const uploadRes = await provider.uploadFile(
          FILE_BASED_SYNC_CONSTANTS.OPS_FILE,
          uploadData,
          currentRevToMatch,
          false,
        );
        return { finalRev: uploadRes.rev };
      } catch (e) {
        if (!(e instanceof UploadRevToMatchMismatchAPIError)) {
          throw e;
        }
      }

      if (attempt === maxAttempts) break;

      const { rev: freshRev } = await this._downloadOpsFile(provider, cfg, encryptKey);
      if (freshRev !== currentRevToMatch) {
        throw new UploadRevToMatchMismatchAPIError(
          'FileBasedSyncAdapter: Concurrent ops-file upload detected. Next sync cycle ' +
            'will download the concurrent ops and retry with a consistent ops file.',
        );
      }
      currentRevToMatch = freshRev;
    }

    throw new UploadRevToMatchMismatchAPIError(
      'FileBasedSyncAdapter: Ops-file upload retries exhausted after repeated rev mismatch.',
    );
  }

  /**
   * Split-format upload. Normal path appends ops to `sync-ops.json` and does a
   * single conditional PUT — NO snapshot build, NO `sync-state.json` write. When
   * appending would exceed the compaction threshold (or the folder has no
   * snapshot yet) it compacts: build snapshot, write `sync-state.json` FIRST,
   * then the trimmed `sync-ops.json` referencing it via snapshotRef.
   */
  private async _uploadOpsSplit(
    provider: FileSyncProvider<SyncProviderId>,
    cfg: EncryptAndCompressCfg,
    encryptKey: string | undefined,
    ops: SyncOperation[],
    clientId: string,
    providerKey: string,
    localStateSnapshot?: unknown,
  ): Promise<OpUploadResponse> {
    let opsFile: FileBasedOpsFile | null = null;
    let opsRev: string | null = null;

    const cached = this._getCachedOpsData(providerKey);
    if (cached) {
      opsFile = cached.data;
      opsRev = cached.rev;
    } else {
      try {
        const r = await this._downloadOpsFile(provider, cfg, encryptKey);
        opsFile = r.data;
        opsRev = r.rev;
      } catch (e) {
        if (e instanceof RemoteFileNotFoundAPIError) {
          // No ops file yet: migrate a legacy v2 folder in place, or start fresh.
          const migrated = await this._maybeMigrateLegacyToSplit(
            provider,
            cfg,
            encryptKey,
            clientId,
          );
          if (migrated) {
            opsFile = migrated.data;
            opsRev = migrated.rev;
          }
        } else {
          throw e;
        }
      }
    }

    if (opsFile && opsRev && this._isPendingSplitMigration(opsFile)) {
      const resumed = await this._resumePendingSplitMigration(
        provider,
        cfg,
        encryptKey,
        opsFile,
        opsRev,
      );
      opsFile = resumed.data;
      opsRev = resumed.rev;
    }

    if (ops.length === 0 && opsFile) {
      return { results: [], latestSeq: this._localSeqCounters.get(providerKey) || 0 };
    }

    const currentSyncVersion = opsFile?.syncVersion ?? 0;
    const newSyncVersion = currentSyncVersion + 1;

    const compactOps: SyncFileCompactOp[] = ops.map((op) => ({
      ...this._syncOpToCompact(op),
      sv: newSyncVersion,
    }));

    let mergedClock: VectorClock = opsFile?.vectorClock || {};
    for (const op of ops) {
      mergedClock = mergeVectorClocks(mergedClock, op.vectorClock);
    }
    const schemaVersion = ops[0]?.schemaVersion || opsFile?.schemaVersion || 1;

    const existingOps: SyncFileCompactOp[] = opsFile?.recentOps || [];
    const combinedOps = [...existingOps, ...compactOps];

    // Compaction is required when the folder has no snapshot yet (fresh/first
    // sync) OR appending would push the ops buffer past MAX_RECENT_OPS.
    //
    // Review follow-up: the trigger is MAX_RECENT_OPS (the buffer cap), NOT
    // SPLIT_COMPACTION_THRESHOLD (the post-compaction retained size). Triggering on
    // the retained size would recompact on every op-bearing sync once the folder
    // crosses it (rebuild sync-state.json + re-upload the snapshot every time —
    // worse than the single-file path). Triggering at the cap and trimming back to
    // the threshold leaves ~SPLIT_COMPACTION_THRESHOLD cheap op-only syncs between
    // compactions.
    let snapshotRef = opsFile?.snapshotRef;
    const needsCompaction =
      !snapshotRef || combinedOps.length > FILE_BASED_SYNC_CONSTANTS.MAX_RECENT_OPS;

    let finalOps = combinedOps;
    if (needsCompaction) {
      // The ONLY normal path that reads the full store snapshot.
      const stateData = await this._buildStateFileData(
        clientId,
        newSyncVersion,
        mergedClock,
        schemaVersion,
        localStateSnapshot,
      );
      // #9040: write the snapshot to an IMMUTABLE, per-compaction file first. This
      // is the snapshot the ops pointer references; because its name carries a
      // random suffix, a concurrent compactor writes a DIFFERENT file and can never
      // clobber it, so the winning ops pointer can never be stranded.
      const genStateFile = this._genStateFileName(newSyncVersion);
      const stateRev = await this._writeStateFile(
        provider,
        cfg,
        encryptKey,
        stateData,
        genStateFile,
      );
      // Compat: also refresh the fixed sync-state.json (+ its .bak) so pre-#9040
      // split clients — which don't read snapshotRef.file — can still hydrate.
      // This copy stays clobberable, but pre-#9040 clients already carried that
      // exposure, so it is no regression; post-#9040 clients use snapshotRef.file.
      await this._backupStateFile(provider, cfg, encryptKey);
      await this._writeStateFile(provider, cfg, encryptKey, stateData);
      snapshotRef = {
        syncVersion: newSyncVersion,
        vectorClock: mergedClock,
        rev: stateRev,
        file: genStateFile,
      };
      finalOps = combinedOps.slice(-FILE_BASED_SYNC_CONSTANTS.SPLIT_COMPACTION_THRESHOLD);
      OpLog.normal(
        `FileBasedSyncAdapter: split compaction wrote sync-state.json (syncVersion=${newSyncVersion}), ` +
          `trimmed recentOps ${combinedOps.length} → ${finalOps.length}`,
      );
    } else {
      finalOps = combinedOps.slice(-FILE_BASED_SYNC_CONSTANTS.MAX_RECENT_OPS);
    }

    // Unreachable: `needsCompaction` is true whenever `snapshotRef` was undefined,
    // and the compaction branch always assigns it. This guard narrows the type.
    if (!snapshotRef) {
      throw new InvalidDataSPError(
        'FileBasedSyncAdapter._uploadOpsSplit: missing snapshotRef after compaction decision',
      );
    }

    const newOpsFile: FileBasedOpsFile = {
      version: FILE_BASED_SYNC_CONSTANTS.SPLIT_FILE_VERSION,
      syncVersion: newSyncVersion,
      schemaVersion,
      vectorClock: mergedClock,
      lastModified: Date.now(),
      clientId,
      recentOps: finalOps,
      oldestOpSyncVersion: finalOps.length > 0 ? finalOps[0]?.sv : undefined,
      snapshotRef,
    };

    // Backup-before-overwrite (SPAP-8, same as the single-file path): preserve
    // the CURRENT remote ops file in .bak so an interrupted/corrupt write of the
    // hot file (rewritten on every op-bearing sync — the highest torn-write
    // exposure of any sync file) can be recovered on the next download.
    if (opsFile) {
      await this._writeBakFile(
        provider,
        cfg,
        encryptKey,
        FILE_BASED_SYNC_CONSTANTS.OPS_BACKUP_FILE,
        opsFile,
        FILE_BASED_SYNC_CONSTANTS.SPLIT_FILE_VERSION,
      );
    }

    // Commit point.
    let finalRev: string;
    try {
      ({ finalRev } = await this._uploadOpsFileWithMismatchFallback(
        provider,
        cfg,
        encryptKey,
        newOpsFile,
        opsRev,
      ));
    } catch (e) {
      // #9040: reclaim the immutable snapshot we just wrote — but ONLY on a
      // confirmed rev-mismatch rejection, which proves the server refused our ops
      // PUT, so a concurrent compactor won and our snapshot is a true orphan. Any
      // other error (network/5xx) is AMBIGUOUS: the PUT may have landed and
      // committed, in which case the snapshot is still referenced and MUST survive
      // (readers would otherwise strand on it). Deleting only applies when we
      // compacted; otherwise snapshotRef.file is the still-referenced predecessor.
      if (
        e instanceof UploadRevToMatchMismatchAPIError &&
        needsCompaction &&
        snapshotRef.file
      ) {
        await this._removeGenStateFile(provider, snapshotRef.file);
      }
      throw e;
    }

    // #9040: after the commit succeeds, reclaim the immutable snapshot the
    // superseded ops file referenced (no-op unless this sync compacted). Runs
    // post-commit so a concurrent reader of the OLD ops file still finds its
    // snapshot until it too advances.
    const previousGenStateFile = opsFile?.snapshotRef?.file;
    if (
      needsCompaction &&
      previousGenStateFile &&
      previousGenStateFile !== snapshotRef.file
    ) {
      await this._removeGenStateFile(provider, previousGenStateFile);
    }

    this._clearCachedOpsData(providerKey);
    this._expectedSyncVersions.set(providerKey, newSyncVersion);
    this._commitLastSeenRev(providerKey, finalRev);
    this._lastSeenVectorClocks.set(providerKey, mergedClock);
    this._persistState();

    const latestSeq = newSyncVersion;
    const startingSeq = Math.max(0, latestSeq - ops.length);
    return {
      results: ops.map((op, i) => ({
        opId: op.id,
        accepted: true,
        serverSeq: startingSeq + i + 1,
      })),
      latestSeq,
    };
  }

  /**
   * Split-format download. Normal path reads ONLY `sync-ops.json` (with the
   * SPAP-10 rev pre-check extended to the ops file). Fetches `sync-state.json`
   * ONLY when gap detection requires the snapshot or on a fresh seq-0 sync, and
   * validates it against the ops file's snapshotRef (mismatch ⇒ gap).
   */
  private async _downloadOpsSplit(
    provider: FileSyncProvider<SyncProviderId>,
    cfg: EncryptAndCompressCfg,
    encryptKey: string | undefined,
    sinceSeq: number,
    excludeClient: string | undefined,
    limit: number,
    providerKey: string,
  ): Promise<FileSnapshotOpDownloadResponse> {
    // SPAP-10 rev pre-check, extended to the ops file. Gated on `sinceSeq > 0`
    // (review follow-up): a forceFromSeq0 download (sinceSeq === 0) re-pulls the
    // full snapshot to REBUILD local state (e.g. USE_REMOTE), so it must never be
    // short-circuited by an unchanged rev — the same guard as the single-file path.
    const lastSeenRev = this._lastSeenRevs.get(providerKey);
    if (
      sinceSeq > 0 &&
      lastSeenRev &&
      !this._getCachedOpsData(providerKey) &&
      this._REV_PRECHECK_PROVIDERS.has(provider.id)
    ) {
      try {
        const { rev: remoteRev } = await provider.getFileRev(
          FILE_BASED_SYNC_CONSTANTS.OPS_FILE,
          lastSeenRev,
        );
        if (remoteRev === lastSeenRev) {
          const expectedVersion = this._expectedSyncVersions.get(providerKey) ?? 0;
          OpLog.normal(
            'FileBasedSyncAdapter: ops-file rev unchanged — skipping full download.',
          );
          return { ops: [], hasMore: false, latestSeq: expectedVersion };
        }
      } catch (e) {
        OpLog.normal(
          'FileBasedSyncAdapter: ops-file getFileRev pre-check failed; full download.',
          e,
        );
      }
    }

    let opsFile: FileBasedOpsFile;
    let opsRev: string;
    let recoveredFromBackup = false;
    try {
      const r = await this._downloadOpsFile(provider, cfg, encryptKey);
      opsFile = r.data;
      opsRev = r.rev;
      this._setCachedOpsData(providerKey, opsFile, opsRev);
    } catch (e) {
      if (e instanceof RemoteFileNotFoundAPIError) {
        // No ops file: read-only bootstrap from a legacy v2 file if present
        // (migration WRITES happen on the upload path).
        return this._tryLegacyReadOnlyDownload(provider, cfg, encryptKey, sinceSeq);
      }
      if (this._isRecoverableCorruption(e)) {
        // Corrupt/torn sync-ops.json (the hot file, rewritten every op-bearing
        // sync): recover from .bak — same SPAP-8 semantics as the single-file
        // path, including seeding the heal cache with the CORRUPT primary's rev
        // so this cycle's upload conditionally matches and heals it.
        const recovered = await this._readBakFile<FileBasedOpsFile>(
          provider,
          cfg,
          encryptKey,
          FILE_BASED_SYNC_CONSTANTS.OPS_BACKUP_FILE,
          FILE_BASED_SYNC_CONSTANTS.SPLIT_FILE_VERSION,
        );
        if (!recovered) throw e;
        recoveredFromBackup = true;
        OpLog.warn(
          'FileBasedSyncAdapter: Primary ops file unreadable; recovered from backup',
        );
        opsFile = recovered.data;
        opsRev = (e as { primaryRev?: string } | null)?.primaryRev ?? recovered.rev;
        this._setCachedOpsData(providerKey, opsFile, opsRev);
        this._notifyRecoveredCorruptPrimaryOnce(providerKey, opsRev);
      } else {
        throw e;
      }
    }

    if (this._isPendingSplitMigration(opsFile)) {
      const resumed = await this._resumePendingSplitMigration(
        provider,
        cfg,
        encryptKey,
        opsFile,
        opsRev,
      );
      opsFile = resumed.data;
      opsRev = resumed.rev;
      this._setCachedOpsData(providerKey, opsFile, opsRev);
    }

    // Gap detection on the ops file (mirrors the single-file logic).
    const previousExpectedVersion = this._expectedSyncVersions.get(providerKey) ?? 0;
    const syncVersionRegressed =
      previousExpectedVersion > 0 && opsFile.syncVersion < previousExpectedVersion;
    let versionWasReset = syncVersionRegressed;
    const lastSeenClock = this._lastSeenVectorClocks.get(providerKey);
    if (syncVersionRegressed && lastSeenClock) {
      const cmp = compareVectorClocks(opsFile.vectorClock, lastSeenClock);
      // EQUAL only — same rationale as the single-file path above: GREATER_THAN
      // proves the writer did strictly more work, NOT that this client received
      // the intervening ops. A dominating client's snapshot reset compacts ops
      // this client never saw into sync-state.json; suppressing the reset here
      // would skip the snapshot hydration and silently diverge.
      if (cmp === 'EQUAL') {
        versionWasReset = false;
      }
    }
    const snapshotReplacement =
      sinceSeq > 0 &&
      opsFile.recentOps.length === 0 &&
      (excludeClient !== undefined
        ? opsFile.clientId !== excludeClient
        : sinceSeq !== opsFile.syncVersion);
    // SPAP-33: `oldestOpSyncVersion > sinceSeq + 1` alone proves the op at
    // sinceSeq+1 was trimmed (see the single-file _downloadOps note). The old
    // `recentOps.length >= SPLIT_COMPACTION_THRESHOLD` clause suppressed a real gap
    // for a migrated/short buffer, so the behind client would apply ops without the
    // snapshot and silently diverge. Dropped.
    const partialTrimGap =
      sinceSeq > 0 &&
      opsFile.oldestOpSyncVersion !== undefined &&
      opsFile.oldestOpSyncVersion > sinceSeq + 1;
    let needsGapDetection = versionWasReset || snapshotReplacement || partialTrimGap;

    this._pendingExpectedSyncVersions.set(providerKey, opsFile.syncVersion);
    this._pendingVectorClocks.set(providerKey, opsFile.vectorClock);
    this._stageOrDropDownloadedRev(providerKey, opsRev, recoveredFromBackup);

    const isForceFromZero = sinceSeq === 0;
    const filteredOps: ServerSyncOperation[] = [];
    const snapshotAppliedOpIds: string[] = [];
    opsFile.recentOps.forEach((compactOp, index) => {
      if (excludeClient && compactOp.c === excludeClient) return;
      const op = this._compactToSyncOp(compactOp);
      filteredOps.push({
        serverSeq: index + 1,
        op,
        receivedAt: compactOp.t,
      });
      // An op belongs to the snapshot (record-as-applied, do not replay) iff it
      // is at or below the snapshot's syncVersion. `sv === undefined` marks a
      // legacy op carried over by the split migration: those predate per-op
      // versioning and are always fully contained in the migration snapshot, so
      // they are snapshot-included too. This is safe because _validateSnapshotRef
      // requires the loaded snapshot's clock to be EQUAL to snapshotRef, so the
      // boundary always matches what was hydrated; any op newer than the snapshot
      // carries an sv > snapshotRef.syncVersion and is reprocessed.
      if (compactOp.sv === undefined || compactOp.sv <= opsFile.snapshotRef.syncVersion) {
        snapshotAppliedOpIds.push(op.id);
      }
    });
    // Whole bounded ops buffer in one page (hasMore=false) — see the single-file
    // _downloadOps note. File-based providers have no server cursor, so there is no
    // next page; `limit` is not applied and the caller's appliedOpIds dedup filters
    // already-applied ops. The split buffer routinely exceeds DOWNLOAD_PAGE_SIZE
    // (it grows to MAX_RECENT_OPS between compactions), so truncating would break
    // normal catch-up.
    const limitedOps = filteredOps;
    const hasMore = false;
    const latestSeq = opsFile.syncVersion;

    let snapshotStateWithArchives: Record<string, unknown> | undefined;
    let snapshot: FileBasedStateFile | undefined;
    if (isForceFromZero || needsGapDetection) {
      const snap = await this._loadValidatedSnapshot(provider, cfg, encryptKey, opsFile);
      if (snap) {
        snapshot = snap;
        snapshotStateWithArchives = {
          ...(snap.state as Record<string, unknown>),
          ...(snap.archiveYoung ? { archiveYoung: snap.archiveYoung } : {}),
          ...(snap.archiveOld ? { archiveOld: snap.archiveOld } : {}),
        };
      } else {
        // No snapshot validates the ref ⇒ treat as gap so the caller re-syncs.
        needsGapDetection = true;
      }
    }

    return {
      ops: limitedOps,
      hasMore,
      latestSeq,
      snapshotVectorClock: snapshot?.vectorClock ?? opsFile.vectorClock,
      remoteLastModified: opsFile.lastModified,
      gapDetected: needsGapDetection,
      ...(snapshotStateWithArchives ? { snapshotState: snapshotStateWithArchives } : {}),
      ...(snapshotStateWithArchives ? { snapshotAppliedOpIds } : {}),
    };
  }

  /**
   * Read-only bootstrap for a split client that finds no `sync-ops.json`. If a
   * legacy v2 `sync-data.json` exists, returns its snapshot + ops so the client
   * can hydrate; the actual migration WRITE happens on the next upload. Returns
   * empty when the folder is truly fresh (or only a tombstone remains).
   */
  private async _tryLegacyReadOnlyDownload(
    provider: FileSyncProvider<SyncProviderId>,
    cfg: EncryptAndCompressCfg,
    encryptKey: string | undefined,
    sinceSeq: number,
  ): Promise<FileSnapshotOpDownloadResponse> {
    try {
      const { data } = await this._downloadSyncFile(provider, cfg, encryptKey);
      const filteredOps: ServerSyncOperation[] = [];
      data.recentOps.forEach((compactOp, index) => {
        filteredOps.push({
          serverSeq: index + 1,
          op: this._compactToSyncOp(compactOp),
          receivedAt: compactOp.t,
        });
      });
      const snapshotStateWithArchives = data.state
        ? {
            ...(data.state as Record<string, unknown>),
            ...(data.archiveYoung ? { archiveYoung: data.archiveYoung } : {}),
            ...(data.archiveOld ? { archiveOld: data.archiveOld } : {}),
          }
        : undefined;
      return {
        ops: filteredOps,
        hasMore: false,
        latestSeq: data.syncVersion,
        snapshotVectorClock: data.vectorClock,
        remoteLastModified: data.lastModified,
        gapDetected: sinceSeq > 0,
        ...(snapshotStateWithArchives
          ? { snapshotState: snapshotStateWithArchives }
          : {}),
        ...(snapshotStateWithArchives
          ? { snapshotAppliedOpIds: filteredOps.map(({ op }) => op.id) }
          : {}),
      };
    } catch (e) {
      // Fresh folder, or a tombstone with no ops file yet — nothing to apply.
      if (
        e instanceof RemoteFileNotFoundAPIError ||
        e instanceof SplitSyncFormatDetectedError
      ) {
        return { ops: [], hasMore: false, latestSeq: 0 };
      }
      throw e;
    }
  }

  /**
   * Split-format snapshot upload (force-upload / "Use Local" / recovery). Writes
   * `sync-state.json` FIRST, then a fresh `sync-ops.json` (empty recentOps,
   * snapshotRef pointing at the just-written snapshot), then a tombstone over
   * `sync-data.json` so OFF clients don't diverge.
   */
  private async _uploadSnapshotSplit(
    provider: FileSyncProvider<SyncProviderId>,
    cfg: EncryptAndCompressCfg,
    encryptKey: string | undefined,
    clientId: string,
    vectorClock: Record<string, number>,
    schemaVersion: number,
    providerKey: string,
    state: unknown,
    snapshotOpType?: RestorePointType,
  ): Promise<SnapshotUploadResponse> {
    const newSyncVersion = 1;
    const clock = vectorClock as VectorClock;

    // #9023: same concurrency guard as the single-file path — a REPAIR recovery
    // snapshot must not overwrite a remote that advanced since our last sync.
    // The commit-point sync-ops.json is what other clients read, so gate on ITS
    // rev vs the rev we last downloaded+applied (`_lastSeenRevs`). A rev, not a
    // vector clock, is used deliberately (see _uploadSnapshot). `getFileRev`
    // reads metadata only — no decode — so a torn/undecryptable remote does not
    // block the repair. Missing ops file → no history to clobber, safe.
    // NOTE: this pre-check closes the concurrent *merge* window; a conditional
    // (rev-matched) write across the two-file (state + ops) protocol to close the
    // residual sub-second check→write race is tracked as a follow-up.
    if (snapshotOpType === 'REPAIR') {
      const baseRev = this._lastSeenRevs.get(providerKey) ?? null;
      let remoteOpsRev: string | null = null;
      try {
        remoteOpsRev = (
          await provider.getFileRev(FILE_BASED_SYNC_CONSTANTS.OPS_FILE, null)
        ).rev;
      } catch (e) {
        if (!(e instanceof RemoteFileNotFoundAPIError)) {
          throw e;
        }
      }
      if (remoteOpsRev !== null && remoteOpsRev !== baseRev) {
        OpLog.warn(
          'FileBasedSyncAdapter: REPAIR split snapshot is stale (remote advanced ' +
            'since our last sync); requesting rebase instead of overwriting.',
        );
        return {
          accepted: false,
          error: 'REPAIR snapshot does not include current remote state',
          errorCode: REPAIR_STALE_ERROR_CODE,
        };
      }
    }

    const stateData = await this._buildStateFileData(
      clientId,
      newSyncVersion,
      clock,
      schemaVersion,
      state,
    );
    // sync-state.json.bak is deliberately NOT refreshed here: its adoption is
    // ref-validated (_loadValidatedSnapshot requires an EQUAL clock against the
    // ops file's snapshotRef), so a stale — even rotated-key — state .bak is
    // inert, and it must keep serving the COMPACTION crash window (state
    // written, ops not yet) it was backed up for.
    const stateRev = await this._writeStateFile(provider, cfg, encryptKey, stateData);

    const opsData: FileBasedOpsFile = {
      version: FILE_BASED_SYNC_CONSTANTS.SPLIT_FILE_VERSION,
      syncVersion: newSyncVersion,
      schemaVersion,
      vectorClock: clock,
      lastModified: Date.now(),
      clientId,
      recentOps: [],
      snapshotRef: { syncVersion: newSyncVersion, vectorClock: clock, rev: stateRev },
    };
    const opsEncoded = await this._encryptAndCompressHandler.compressAndEncryptData(
      cfg,
      encryptKey,
      opsData,
      FILE_BASED_SYNC_CONSTANTS.SPLIT_FILE_VERSION,
    );
    this._assertUploadDataNotEmpty(
      opsEncoded,
      'FileBasedSyncAdapter._uploadSnapshotSplit',
    );
    const opsRes = await this._forceUploadWithBakFirst(
      provider,
      FILE_BASED_SYNC_CONSTANTS.OPS_FILE,
      FILE_BASED_SYNC_CONSTANTS.OPS_BACKUP_FILE,
      opsEncoded,
    );
    await this._writeTombstoneAndNeutralizeBak(provider, cfg, encryptKey);

    this._expectedSyncVersions.set(providerKey, newSyncVersion);
    this._localSeqCounters.set(providerKey, newSyncVersion);
    this._commitLastSeenRev(providerKey, opsRes.rev);
    this._lastSeenVectorClocks.set(providerKey, clock);
    this._clearCachedOpsData(providerKey);
    this._persistState();

    return { accepted: true, serverSeq: newSyncVersion };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  private _assertUploadDataNotEmpty(uploadData: string, context: string): void {
    if (!uploadData || uploadData.trim().length === 0) {
      throw new InvalidDataSPError(
        `${context}: compressAndEncryptData() produced empty output. ` +
          `This should never happen and indicates a serialization or compression failure.`,
      );
    }
  }

  /**
   * Writes `data` to a `.bak` recovery artifact before its primary file is
   * overwritten (two-phase write).
   *
   * MUST be non-fatal: a provider that cannot write the backup (e.g. no copy
   * support, transient failure) must still be able to sync. The backup is a
   * recovery artifact — losing it only degrades recoverability, never sync.
   *
   * Force-overwrite is used here because .bak is a disposable recovery artifact,
   * NOT a source-of-truth sync file — the lost-update guarantee on the primary
   * (conditional PUT) is unaffected.
   */
  private async _writeBakFile<T>(
    provider: FileSyncProvider<SyncProviderId>,
    cfg: EncryptAndCompressCfg,
    encryptKey: string | undefined,
    bakPath: string,
    data: T,
    fileVersion: number,
  ): Promise<void> {
    try {
      const backupData = await this._encryptAndCompressHandler.compressAndEncryptData(
        cfg,
        encryptKey,
        data,
        fileVersion,
      );
      if (!backupData || backupData.trim().length === 0) {
        OpLog.warn(
          `FileBasedSyncAdapter: Skipping ${bakPath} — encoded backup data was empty`,
        );
        return;
      }
      await provider.uploadFile(bakPath, backupData, null, true);
      OpLog.normal(`FileBasedSyncAdapter: Wrote ${bakPath} before overwrite`);
    } catch (e) {
      // Non-fatal by design — proceed with the primary upload regardless.
      OpLog.warn(
        `FileBasedSyncAdapter: ${bakPath} write failed (non-fatal), proceeding`,
        e,
      );
    }
  }

  /**
   * Downloads + decodes a `.bak` recovery artifact. Returns null when the backup
   * is missing, undecodable, mode-mismatched, or has an unsupported version — the
   * caller then surfaces its ORIGINAL corruption error.
   */
  private async _readBakFile<T extends { version: number }>(
    provider: FileSyncProvider<SyncProviderId>,
    cfg: EncryptAndCompressCfg,
    encryptKey: string | undefined,
    bakPath: string,
    expectedVersion: number,
  ): Promise<{ data: T; rev: string } | null> {
    try {
      const response = await provider.downloadFile(bakPath);
      // Security: when encryption is expected, refuse a PLAINTEXT .bak. Decoding
      // trusts the file's own prefix flags, so a plaintext .bak decodes even
      // under a wrong/rotated key — silently suppressing the wrong-password
      // dialog and letting the heal upload clobber the encrypted primary (same
      // class as the E2EE-rotation revert).
      if (
        cfg.isEncrypt &&
        !extractSyncFileStateFromPrefix(response.dataStr).isEncrypted
      ) {
        OpLog.warn(
          `FileBasedSyncAdapter: ${bakPath} is plaintext but encryption is expected — refusing recovery`,
        );
        return null;
      }
      const data = await this._encryptAndCompressHandler.decompressAndDecryptData<T>(
        cfg,
        encryptKey,
        response.dataStr,
      );
      if (data.version !== expectedVersion) {
        OpLog.warn(
          `FileBasedSyncAdapter: ${bakPath} has unsupported version ${data.version}; cannot recover`,
        );
        return null;
      }
      return { data, rev: response.rev };
    } catch (e) {
      OpLog.warn(`FileBasedSyncAdapter: ${bakPath} recovery failed`, e);
      return null;
    }
  }

  /**
   * Force-writes the SAME payload to the `.bak` FIRST, then the primary. Used by
   * snapshot uploads (force-upload / "Use Local" / E2EE re-encryption): a
   * snapshot replaces the remote wholesale, so the pre-snapshot .bak must not
   * survive it — a stale .bak encrypted with a ROTATED-AWAY key would otherwise
   * be silently "recovered" by a still-old-key client (suppressing its
   * wrong-password prompt) and heal-uploaded back over the new-key primary,
   * reverting the rotation. Unlike the op-path backup, the .bak write here is
   * deliberately FATAL: leaving the stale artifact behind breaks the snapshot's
   * replace-everything contract, and aborting BEFORE the primary write leaves the
   * remote fully consistent for a retry. (.bak-first also means a crash between
   * the writes leaves a valid old primary + new .bak — nothing stale to recover.)
   */
  private async _forceUploadWithBakFirst(
    provider: FileSyncProvider<SyncProviderId>,
    primaryPath: string,
    bakPath: string,
    encoded: string,
  ): Promise<{ rev: string }> {
    await provider.uploadFile(bakPath, encoded, null, true);
    return provider.uploadFile(primaryPath, encoded, null, true);
  }

  /**
   * #9023: writes the primary sync file CONDITIONALLY on `revToMatch`, then (only
   * once the primary write wins) refreshes the .bak with the same payload. Used
   * for automatic REPAIR recovery snapshots so a concurrent write that landed
   * since our last sync throws UploadRevToMatchMismatchAPIError instead of being
   * silently overwritten. Primary-first (unlike `_forceUploadWithBakFirst`) so a
   * lost race leaves the .bak untouched — a stale repair payload must never
   * survive in .bak where a later corrupt-primary recovery could resurrect it and
   * re-drop the concurrent ops. A null `revToMatch` means "expect the file
   * absent" — the provider rejects the write if another client created it.
   */
  private async _conditionalUploadRepairSnapshot(
    provider: FileSyncProvider<SyncProviderId>,
    primaryPath: string,
    bakPath: string,
    encoded: string,
    revToMatch: string | null,
  ): Promise<{ rev: string }> {
    const res = await provider.uploadFile(primaryPath, encoded, revToMatch, false);
    await provider.uploadFile(bakPath, encoded, null, true);
    return res;
  }

  /**
   * Commits a freshly-written remote rev as last-seen and drops any rev still
   * staged by an earlier download whose apply never completed (e.g. a conflict
   * dialog aborted it) — promoting a stale staged rev later would clobber the
   * fresh one and re-open the SPAP-10 precheck to a wrong "unchanged" answer.
   */
  private _commitLastSeenRev(providerKey: string, rev: string): void {
    this._lastSeenRevs.set(providerKey, rev);
    this._pendingRevs.delete(providerKey);
    // A successful write establishes a newer authoritative remote baseline.
    // Discard metadata staged by any preceding download in this cycle so a later
    // cursor update cannot promote stale pre-write values over it.
    this._pendingExpectedSyncVersions.delete(providerKey);
    this._pendingVectorClocks.delete(providerKey);
  }

  /**
   * SPAP-10 (review follow-up): stage a downloaded file's rev as PENDING rather
   * than committing it to `_lastSeenRevs`. It is promoted to last-seen (and
   * persisted) only once the caller confirms the ops were durably applied, via
   * setLastServerSeq — the same ordering as the seq cursor. Committing it eagerly
   * would let a throw/crash between download and apply strand a rev ahead of
   * un-applied ops, so the next poll's cheap pre-check would skip them for good.
   *
   * EXCEPTION — .bak recovery: `rev` is then the CORRUPT primary's rev (kept in
   * the sync-cycle cache so this cycle's upload can heal it via a matching
   * conditional overwrite). It must NEVER reach `_lastSeenRevs`: promoting it
   * would make every later poll's pre-check read "unchanged" and skip the full
   * download, while the upload path (which has no .bak recovery) keeps failing
   * on the corrupt primary — wedging sync until another client rewrites the
   * file. Dropping both entries instead forces each poll to re-download,
   * re-recover, and re-seed the heal cache until the primary is actually healed.
   */
  private _stageOrDropDownloadedRev(
    providerKey: string,
    rev: string,
    recoveredFromBackup: boolean,
  ): void {
    if (recoveredFromBackup) {
      this._pendingRevs.delete(providerKey);
      this._lastSeenRevs.delete(providerKey);
    } else {
      this._pendingRevs.set(providerKey, rev);
    }
  }

  /**
   * De-dups the user-facing "recovered from backup" notice per corrupt primary
   * rev, so a download-only client (which cannot heal the file itself) does not
   * re-toast on every sync cycle.
   */
  private _notifyRecoveredCorruptPrimaryOnce(
    providerKey: string,
    corruptRev: string,
  ): void {
    if (this._lastRecoveredCorruptRev.get(providerKey) !== corruptRev) {
      this._lastRecoveredCorruptRev.set(providerKey, corruptRev);
      // Lazy resolve — absent in some unit harnesses (returns null → no notice).
      this._injector
        .get(SnackService, null)
        ?.open({ msg: T.F.SYNC.S.SYNC_DATA_RECOVERED_FROM_BACKUP });
    }
  }

  /**
   * Annotates a decode error with the corrupt primary file's rev so the .bak
   * recovery path can seed the heal cache with IT (not the .bak rev) and heal
   * the primary via a matching conditional overwrite. Returns the error for
   * rethrowing.
   */
  private _annotatePrimaryRev(e: unknown, rev: string): unknown {
    if (e && typeof e === 'object' && !('primaryRev' in e)) {
      (e as { primaryRev?: string }).primaryRev = rev;
    }
    return e;
  }

  /**
   * Whether a download error indicates a corrupt/empty/unparseable primary file
   * that we should attempt to recover from the .bak artifact. Missing files are
   * NOT included — that is a legitimate fresh-start signal handled separately.
   */
  private _isRecoverableCorruption(e: unknown): boolean {
    return (
      e instanceof SyncDataCorruptedError ||
      // Covers EmptyRemoteBodySPError (empty file) via its InvalidDataSPError base.
      e instanceof InvalidDataSPError ||
      e instanceof JsonParseError ||
      // A truncated/garbage ENCRYPTED or COMPRESSED primary file fails during the
      // decrypt/decompress stage rather than JSON parse. Without these, .bak
      // recovery silently no-ops for exactly the users who enable encryption or
      // compression — the interrupted-write case this feature targets. Safe to
      // include: if the .bak is also undecodable, _readBakFile returns null
      // and the original error still surfaces. DecryptError is only safe here
      // because snapshot uploads refresh .bak with the same payload/key as the
      // primary (see _forceUploadWithBakFirst) — a primary/.bak KEY mismatch
      // cannot exist on a remote whose snapshots were all written by fixed
      // clients. Mixed-fleet caveat: a pre-fix client's snapshot still leaves a
      // stale-key .bak behind until its first op-bearing sync refreshes it.
      e instanceof DecryptError ||
      e instanceof DecompressError
    );
  }

  /**
   * Downloads and decrypts the sync file.
   *
   * When sync-data.json is not found, checks for a legacy __meta_ file (written
   * by v16.x pfapi clients) and throws LegacySyncFormatDetectedError instead of
   * treating the missing file as a fresh start. This prevents silent divergence
   * when a new client first syncs to a provider still used by an old client.
   *
   * @returns The sync data and its revision (ETag) for conditional upload
   */
  private async _downloadSyncFile(
    provider: FileSyncProvider<SyncProviderId>,
    cfg: EncryptAndCompressCfg,
    encryptKey: string | undefined,
  ): Promise<{ data: FileBasedSyncData; rev: string }> {
    let response: Awaited<ReturnType<typeof provider.downloadFile>>;
    try {
      response = await provider.downloadFile(FILE_BASED_SYNC_CONSTANTS.SYNC_FILE);
    } catch (e) {
      if (e instanceof RemoteFileNotFoundAPIError) {
        // sync-data.json not found. Check for a legacy pfapi __meta_ file before
        // treating this as a fresh start — a v16.x device may be writing to the
        // same provider, causing silent divergence if we proceed.
        let legacyFileFound = false;
        try {
          await provider.getFileRev(FILE_BASED_SYNC_CONSTANTS.LEGACY_META_FILE, null);
          legacyFileFound = true;
        } catch (innerE) {
          // Why: WebDAV surfaces a corrupt/empty legacy __meta_ body as
          // InvalidDataSPError (not RemoteFileNotFoundAPIError). The presence
          // of the file — even if unreadable — still proves a v16.x client
          // touched this target, so treat it the same as a successful probe
          // rather than letting the unfriendly InvalidDataSPError escape.
          if (innerE instanceof InvalidDataSPError) {
            legacyFileFound = true;
          } else if (!(innerE instanceof RemoteFileNotFoundAPIError)) {
            throw innerE;
          }
          // __meta_ not found either → genuine fresh start
        }
        if (legacyFileFound) throw new LegacySyncFormatDetectedError();
      }
      throw e;
    }
    let data: FileBasedSyncData;
    try {
      data =
        await this._encryptAndCompressHandler.decompressAndDecryptData<FileBasedSyncData>(
          cfg,
          encryptKey,
          response.dataStr,
        );

      // SPAP-11: if sync-data.json is a v3 SPLIT tombstone, this folder was
      // migrated to the split format by another client. Signal that specifically
      // (distinct from generic corruption) so the caller can surface an actionable
      // "enable Surgical sync" notice and pause without re-creating a v2 file.
      // Checked before the version gate so a v3 tombstone doesn't read as corrupt.
      if (this._isSplitTombstone(data)) {
        throw new SplitSyncFormatDetectedError();
      }

      // Validate file version
      if (data.version !== FILE_BASED_SYNC_CONSTANTS.FILE_VERSION) {
        throw new SyncDataCorruptedError(
          `Unsupported file version: ${data.version} (expected ${FILE_BASED_SYNC_CONSTANTS.FILE_VERSION})`,
          FILE_BASED_SYNC_CONSTANTS.SYNC_FILE,
        );
      }
    } catch (decodeErr) {
      // A split tombstone is a valid signal, not corruption — let it propagate
      // by type without being annotated as a corrupt primary.
      if (decodeErr instanceof SplitSyncFormatDetectedError) {
        throw decodeErr;
      }
      // We already hold the corrupt primary's rev (from the download above), so
      // no extra request is needed to enable the heal-via-conditional-overwrite.
      throw this._annotatePrimaryRev(decodeErr, response.rev);
    }

    // SPAP-11 (Q4): a valid v2 sync-data.json can still coexist with a
    // sync-ops.json when a migration crashed after the ops commit but before the
    // tombstone write. A split-sync-OFF client must NOT proceed on the stale v2
    // file (it would diverge from the already-committed ops). Probe for the ops
    // file; if present, treat it exactly like the tombstone case (actionable
    // notice + pause). Skipped when split-sync is ON, because the migrator
    // legitimately reads the v2 file here to complete the migration. Best-effort:
    // any probe failure falls through to the normal single-file path.
    if (!this._isSplitSyncEnabled()) {
      let opsFilePresent = false;
      try {
        await provider.getFileRev(FILE_BASED_SYNC_CONSTANTS.OPS_FILE, null);
        opsFilePresent = true;
      } catch {
        // absent / probe failed → proceed on the single-file path
      }
      if (opsFilePresent) {
        throw new SplitSyncFormatDetectedError();
      }
    }

    return { data, rev: response.rev };
  }

  /**
   * Gets a unique key for a provider (for storing per-provider state).
   */
  private _getProviderKey(provider: FileSyncProvider<SyncProviderId>): string {
    return `${provider.id}`;
  }

  /**
   * Converts a SyncOperation to CompactOperation format.
   */
  private _syncOpToCompact(op: SyncOperation): CompactOperation {
    // Create a full Operation from SyncOperation, then encode.
    // Type assertions are needed because SyncOperation uses string types for
    // actionType/opType/entityType (for JSON serialization compatibility),
    // while Operation uses the specific enum/union types.
    const fullOp: Operation = {
      id: op.id,
      actionType: op.actionType as ActionType,
      opType: op.opType as OpType,
      entityType: op.entityType as EntityType,
      entityId: op.entityId,
      entityIds: op.entityIds,
      payload: op.payload,
      clientId: op.clientId,
      vectorClock: op.vectorClock,
      timestamp: op.timestamp,
      schemaVersion: op.schemaVersion,
      ...(op.syncImportReason
        ? { syncImportReason: op.syncImportReason as SyncImportReason }
        : {}),
      ...(op.repairBaseServerSeq !== undefined
        ? { repairBaseServerSeq: op.repairBaseServerSeq }
        : {}),
    };
    return encodeOperation(fullOp);
  }

  /**
   * Converts a CompactOperation to SyncOperation format.
   */
  private _compactToSyncOp(compact: CompactOperation): SyncOperation {
    const fullOp = decodeOperation(compact);
    return {
      id: fullOp.id,
      clientId: fullOp.clientId,
      actionType: fullOp.actionType,
      opType: fullOp.opType,
      entityType: fullOp.entityType,
      entityId: fullOp.entityId,
      entityIds: fullOp.entityIds,
      payload: fullOp.payload,
      vectorClock: fullOp.vectorClock,
      timestamp: fullOp.timestamp,
      schemaVersion: fullOp.schemaVersion,
      ...(fullOp.syncImportReason ? { syncImportReason: fullOp.syncImportReason } : {}),
      ...(fullOp.repairBaseServerSeq !== undefined
        ? { repairBaseServerSeq: fullOp.repairBaseServerSeq }
        : {}),
    };
  }
}

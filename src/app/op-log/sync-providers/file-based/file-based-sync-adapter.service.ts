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
import { EncryptAndCompressCfg } from '../../core/types/sync.types';
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
  SyncDataCorruptedError,
  UploadRevToMatchMismatchAPIError,
} from '../../core/errors/sync-errors';
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

  /**
   * SPAP-9: last-seen remote vector clock per provider+user. Used to tell a
   * benign (cosmetic) syncVersion reset apart from a genuine one: if the file's
   * causal clock did not regress, a lower syncVersion counter lost no data and
   * must not trigger the full-gap resync path.
   */
  private _lastSeenVectorClocks = new Map<string, VectorClock>();

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
      ): Promise<OpUploadResponse> => {
        return this._uploadOps(
          provider,
          encryptAndCompressCfg,
          encryptKey,
          ops,
          clientId,
          lastKnownServerSeq,
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
        _snapshotOpType?: RestorePointType, // Not used - file-based sync has no server-side op log
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
      await this._stateSnapshotService.getStateSnapshot(),
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
  ): Promise<OpUploadResponse> {
    const providerKey = this._getProviderKey(provider);

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
    );

    // Step 2.5: Backup-before-overwrite (two-phase write). Copy the CURRENT remote
    // content to sync-data.json.bak before overwriting the primary file, so an
    // interrupted/corrupt write can be recovered on the next download. Non-fatal:
    // a provider without copy support must still be able to sync.
    if (fileExists && currentData) {
      await this._backupCurrentRemote(provider, cfg, encryptKey, currentData);
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
    this._lastSeenRevs.set(providerKey, finalRev);

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
    try {
      const result = await this._downloadSyncFile(provider, cfg, encryptKey);
      syncData = result.data;
      rev = result.rev;

      // Cache data + rev for use in _uploadOps() (avoids redundant download)
      this._setCachedSyncData(providerKey, syncData, rev);
    } catch (e) {
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
        const recovered = await this._recoverFromBackup(provider, cfg, encryptKey);
        if (recovered) {
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
          // De-dup the user-facing notice: only surface it the first time we see a
          // given corrupt primary rev, so a download-only client (which cannot heal
          // the file itself) does not re-toast on every sync cycle.
          if (this._lastRecoveredCorruptRev.get(providerKey) !== primaryRev) {
            this._lastRecoveredCorruptRev.set(providerKey, primaryRev);
            // Lazy resolve — absent in some unit harnesses (returns null → no notice).
            this._injector
              .get(SnackService, null)
              ?.open({ msg: T.F.SYNC.S.SYNC_DATA_RECOVERED_FROM_BACKUP });
          }
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

    // Detect partial trimming: when recentOps hits MAX_RECENT_OPS and oldest ops
    // were trimmed, a slow-syncing client compares oldestOpSyncVersion against sinceSeq.
    // If the oldest surviving op was uploaded AFTER the client's last download,
    // AND the buffer is full (trimming occurred), ops between sinceSeq and
    // oldestOpSyncVersion were trimmed and the client never saw them.
    // SPAP-9 off-by-one fix: the client already holds every op up to and
    // including sinceSeq. The oldest surviving op has syncVersion
    // oldestOpSyncVersion, so the first op the client still needs is sinceSeq+1.
    // A gap exists only if that op was trimmed away, i.e. the oldest survivor is
    // at least sinceSeq+2 (oldestOpSyncVersion > sinceSeq + 1). The boundary
    // oldestOpSyncVersion === sinceSeq + 1 is contiguous and must NOT be a gap.
    const partialTrimGap =
      sinceSeq > 0 &&
      syncData.oldestOpSyncVersion !== undefined &&
      syncData.oldestOpSyncVersion > sinceSeq + 1 &&
      syncData.recentOps.length >= FILE_BASED_SYNC_CONSTANTS.MAX_RECENT_OPS;

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

    // Update expected version for next upload
    this._expectedSyncVersions.set(providerKey, syncData.syncVersion);
    // SPAP-9: remember this file's causal clock so the next download can decide
    // whether a syncVersion regression is cosmetic or a genuine reset.
    this._lastSeenVectorClocks.set(providerKey, syncData.vectorClock);
    // SPAP-10 (review follow-up): stage this file's rev as PENDING rather than
    // committing it to `_lastSeenRevs` here. It is promoted to last-seen (and
    // persisted) only once the caller confirms the ops were durably applied, via
    // setLastServerSeq — the same ordering as the seq cursor. Committing it eagerly
    // here would let a throw/crash between download and apply strand a rev ahead of
    // un-applied ops, so the next poll's cheap pre-check would skip them for good.
    this._pendingRevs.set(providerKey, rev);

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

    // Apply limit
    const limitedOps = filteredOps.slice(0, limit);
    const hasMore = filteredOps.length > limit;

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
      // Signal gap detection when sync version was reset or snapshot was replaced.
      // This triggers the download service to re-download from seq 0, which will include
      // the snapshotState for proper state replacement.
      gapDetected: needsGapDetection,
      // Include full state snapshot for fresh downloads (sinceSeq === 0)
      // This allows new clients to bootstrap with complete state, not just recent ops
      ...(snapshotStateWithArchives ? { snapshotState: snapshotStateWithArchives } : {}),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SNAPSHOT UPLOAD
  // ═══════════════════════════════════════════════════════════════════════════

  private async _uploadSnapshot(
    provider: FileSyncProvider<SyncProviderId>,
    cfg: EncryptAndCompressCfg,
    encryptKey: string | undefined,
    _state: unknown,
    clientId: string,
    reason: 'initial' | 'recovery' | 'migration',
    vectorClock: Record<string, number>,
    schemaVersion: number,
  ): Promise<SnapshotUploadResponse> {
    const providerKey = this._getProviderKey(provider);

    OpLog.normal(`FileBasedSyncAdapter: Uploading snapshot (reason=${reason})`);

    // For snapshots, we start fresh with syncVersion = 1
    const newSyncVersion = 1;

    // Always use fresh state from the NgRx store instead of the passed `_state` parameter.
    // 1. Consistency: _buildMergedSyncData also uses getStateSnapshot() for its state.
    // 2. Freshness: the passed state may come from an op payload created earlier in the
    //    sync cycle, so fetching directly ensures we capture the latest store state.
    // Note: double-encryption is not a concern here — file-based providers don't expose
    // getEncryptKey, so the upload service never applies payload-level encryption for them.
    const currentState = stripLocalOnlySyncSettingsFromAppData(
      await this._stateSnapshotService.getStateSnapshot(),
    );

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

    // Upload snapshot (no backup - snapshots replace state completely)
    const uploadData = await this._encryptAndCompressHandler.compressAndEncryptData(
      cfg,
      encryptKey,
      syncData,
      FILE_BASED_SYNC_CONSTANTS.FILE_VERSION,
    );
    this._assertUploadDataNotEmpty(uploadData, 'FileBasedSyncAdapter._uploadSnapshot');
    const snapshotUploadRes = await provider.uploadFile(
      FILE_BASED_SYNC_CONSTANTS.SYNC_FILE,
      uploadData,
      null,
      true,
    );

    // Reset local state
    this._expectedSyncVersions.set(providerKey, newSyncVersion);
    this._localSeqCounters.set(providerKey, newSyncVersion);
    // SPAP-10: record the rev of the snapshot we just wrote as the last-seen rev
    // so the next poll can skip a redundant full download.
    this._lastSeenRevs.set(providerKey, snapshotUploadRes.rev);
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
      // Delete main sync file — re-throw real errors (not "file not found")
      try {
        await provider.removeFile(FILE_BASED_SYNC_CONSTANTS.SYNC_FILE);
      } catch (e) {
        if (!(e instanceof RemoteFileNotFoundAPIError)) {
          throw e;
        }
      }

      // Delete backup file
      try {
        await provider.removeFile(FILE_BASED_SYNC_CONSTANTS.BACKUP_FILE);
      } catch (e) {
        if (!(e instanceof RemoteFileNotFoundAPIError)) {
          OpLog.warn('FileBasedSyncAdapter: Unexpected error deleting backup file', e);
        }
      }

      // Delete migration lock if exists
      try {
        await provider.removeFile(FILE_BASED_SYNC_CONSTANTS.MIGRATION_LOCK_FILE);
      } catch (e) {
        if (!(e instanceof RemoteFileNotFoundAPIError)) {
          OpLog.warn('FileBasedSyncAdapter: Unexpected error deleting migration lock', e);
        }
      }

      // Reset local state
      this._expectedSyncVersions.delete(providerKey);
      this._localSeqCounters.delete(providerKey);
      // SPAP-10: drop the last-seen rev so a stale value can't drive a false
      // "nothing new" short-circuit after the remote file has been deleted.
      this._lastSeenRevs.delete(providerKey);
      this._clearCachedSyncData(providerKey);
      this._persistState();

      return { success: true };
    } catch (e) {
      OpLog.err('FileBasedSyncAdapter: Failed to delete all data', e);
      return { success: false };
    }
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
   * Writes the CURRENT remote content to sync-data.json.bak before the primary
   * file is overwritten (two-phase write). We re-encode the already-in-hand
   * `currentData` from `_getCurrentSyncState()` rather than issuing another GET.
   *
   * MUST be non-fatal: a provider that cannot write the backup (e.g. no copy
   * support, transient failure) must still be able to sync. The backup is a
   * recovery artifact — losing it only degrades recoverability, never sync.
   *
   * Force-overwrite is used here because .bak is a disposable recovery artifact,
   * NOT the source-of-truth sync file — the lost-update guarantee on
   * sync-data.json is unaffected.
   */
  private async _backupCurrentRemote(
    provider: FileSyncProvider<SyncProviderId>,
    cfg: EncryptAndCompressCfg,
    encryptKey: string | undefined,
    currentData: FileBasedSyncData,
  ): Promise<void> {
    try {
      const backupData = await this._encryptAndCompressHandler.compressAndEncryptData(
        cfg,
        encryptKey,
        currentData,
        FILE_BASED_SYNC_CONSTANTS.FILE_VERSION,
      );
      if (!backupData || backupData.trim().length === 0) {
        OpLog.warn(
          'FileBasedSyncAdapter: Skipping backup — encoded backup data was empty',
        );
        return;
      }
      await provider.uploadFile(
        FILE_BASED_SYNC_CONSTANTS.BACKUP_FILE,
        backupData,
        null,
        true,
      );
      OpLog.normal('FileBasedSyncAdapter: Wrote backup before overwrite');
    } catch (e) {
      // Non-fatal by design — proceed with the primary upload regardless.
      OpLog.warn(
        'FileBasedSyncAdapter: Backup-before-overwrite failed (non-fatal), proceeding',
        e,
      );
    }
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
      // include: if the .bak is also undecodable, _recoverFromBackup returns null
      // and the original error still surfaces.
      e instanceof DecryptError ||
      e instanceof DecompressError
    );
  }

  /**
   * Attempts to recover sync data from sync-data.json.bak. Returns null if the
   * backup is missing, unreadable, or has an unsupported version.
   */
  private async _recoverFromBackup(
    provider: FileSyncProvider<SyncProviderId>,
    cfg: EncryptAndCompressCfg,
    encryptKey: string | undefined,
  ): Promise<{ data: FileBasedSyncData; rev: string } | null> {
    try {
      const response = await provider.downloadFile(FILE_BASED_SYNC_CONSTANTS.BACKUP_FILE);
      const data =
        await this._encryptAndCompressHandler.decompressAndDecryptData<FileBasedSyncData>(
          cfg,
          encryptKey,
          response.dataStr,
        );
      if (data.version !== FILE_BASED_SYNC_CONSTANTS.FILE_VERSION) {
        OpLog.warn(
          `FileBasedSyncAdapter: Backup has unsupported version ${data.version}; cannot recover`,
        );
        return null;
      }
      return { data, rev: response.rev };
    } catch (e) {
      OpLog.warn('FileBasedSyncAdapter: Backup recovery failed', e);
      return null;
    }
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

      // Validate file version
      if (data.version !== FILE_BASED_SYNC_CONSTANTS.FILE_VERSION) {
        throw new SyncDataCorruptedError(
          `Unsupported file version: ${data.version} (expected ${FILE_BASED_SYNC_CONSTANTS.FILE_VERSION})`,
          FILE_BASED_SYNC_CONSTANTS.SYNC_FILE,
        );
      }
    } catch (decodeErr) {
      // Annotate the corrupt primary file's current rev onto the error so the
      // download-time recovery path can seed the cache with IT (not the .bak rev)
      // and heal sync-data.json via a matching conditional overwrite, instead of
      // mismatching forever and re-recovering every cycle. We already hold the rev
      // here (from the download above), so no extra request is needed.
      if (decodeErr && typeof decodeErr === 'object' && !('primaryRev' in decodeErr)) {
        (decodeErr as { primaryRev?: string }).primaryRev = response.rev;
      }
      throw decodeErr;
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
    };
  }
}

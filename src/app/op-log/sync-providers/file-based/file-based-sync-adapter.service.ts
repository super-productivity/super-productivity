import { inject, Injectable } from '@angular/core';
import { SyncProviderId } from '../provider.const';
import {
  SyncProviderServiceInterface,
  OperationSyncCapable,
  SyncOperation,
  OpUploadResponse,
  OpDownloadResponse,
  ServerSyncOperation,
  SnapshotUploadResponse,
} from '../provider.interface';
import { EncryptAndCompressHandlerService } from '../../encryption/encrypt-and-compress-handler.service';
import { EncryptAndCompressCfg } from '../../core/types/sync.types';
import { CompactOperation } from '../../../core/persistence/operation-log/compact/compact-operation.types';
import {
  encodeOperation,
  decodeOperation,
} from '../../../core/persistence/operation-log/compact/operation-codec.service';
import {
  Operation,
  VectorClock,
  ActionType,
  OpType,
  EntityType,
} from '../../core/operation.types';
import {
  FileBasedSyncData,
  FILE_BASED_SYNC_CONSTANTS,
  SyncDataCorruptedError,
} from './file-based-sync.types';
import { OpLog } from '../../../core/log';
import {
  RemoteFileNotFoundAPIError,
  UploadRevToMatchMismatchAPIError,
} from '../../core/errors/sync-errors';
import { mergeVectorClocks } from '../../../core/util/vector-clock';
import { ArchiveDbAdapter } from '../../../core/persistence/archive-db-adapter.service';
import { StateSnapshotService } from '../../backup/state-snapshot.service';

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

  /** Expected sync version for optimistic locking, keyed by provider+user */
  private _expectedSyncVersions = new Map<string, number>();

  /** Local sequence counters (simulates server seq for file-based) */
  private _localSeqCounters = new Map<string, number>();

  /** Set of processed operation IDs per provider - prevents missing ops when array is trimmed */
  private _processedOpIds = new Map<string, Set<string>>();

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
        if (state.processedOps) {
          for (const [key, ids] of Object.entries(state.processedOps)) {
            this._processedOpIds.set(key, new Set(ids as string[]));
          }
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
      const processedOpsJson = localStorage.getItem(
        FILE_BASED_SYNC_CONSTANTS.SYNC_VERSION_STORAGE_KEY_PREFIX + 'processedOps',
      );

      if (syncVersionsJson || seqCountersJson || processedOpsJson) {
        if (syncVersionsJson) {
          const parsed = JSON.parse(syncVersionsJson);
          this._expectedSyncVersions = new Map(Object.entries(parsed));
        }
        if (seqCountersJson) {
          const parsed = JSON.parse(seqCountersJson);
          this._localSeqCounters = new Map(Object.entries(parsed));
        }
        if (processedOpsJson) {
          const parsed = JSON.parse(processedOpsJson);
          for (const [key, ids] of Object.entries(parsed)) {
            this._processedOpIds.set(key, new Set(ids as string[]));
          }
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
      // Build processed ops with trimming to prevent unbounded growth
      const processedOpsObj: Record<string, string[]> = {};
      for (const [key, ids] of this._processedOpIds) {
        const idsArray = Array.from(ids);
        processedOpsObj[key] = idsArray.slice(-FILE_BASED_SYNC_CONSTANTS.MAX_RECENT_OPS);
      }

      // Persist all state atomically in a single write
      const state = {
        syncVersions: Object.fromEntries(this._expectedSyncVersions),
        seqCounters: Object.fromEntries(this._localSeqCounters),
        processedOps: processedOpsObj,
      };
      localStorage.setItem(this._STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      OpLog.warn('FileBasedSyncAdapter: Failed to persist sync state', e);
    }
  }

  /**
   * Marks an operation as processed for a provider.
   */
  private _markOpProcessed(providerKey: string, opId: string): void {
    let processedSet = this._processedOpIds.get(providerKey);
    if (!processedSet) {
      processedSet = new Set();
      this._processedOpIds.set(providerKey, processedSet);
    }
    processedSet.add(opId);

    // Trim to prevent unbounded growth (keep most recent MAX_RECENT_OPS)
    if (processedSet.size > FILE_BASED_SYNC_CONSTANTS.MAX_RECENT_OPS * 2) {
      const idsArray = Array.from(processedSet);
      const trimmedIds = idsArray.slice(-FILE_BASED_SYNC_CONSTANTS.MAX_RECENT_OPS);
      this._processedOpIds.set(providerKey, new Set(trimmedIds));
    }
  }

  /**
   * Checks if an operation has been processed for a provider.
   */
  private _isOpProcessed(providerKey: string, opId: string): boolean {
    return this._processedOpIds.get(providerKey)?.has(opId) ?? false;
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
    provider: SyncProviderServiceInterface<SyncProviderId>,
    encryptAndCompressCfg: EncryptAndCompressCfg,
    encryptKey: string | undefined,
  ): OperationSyncCapable {
    // Load persisted state before creating adapter
    this._loadPersistedState();

    const providerKey = this._getProviderKey(provider);

    return {
      supportsOperationSync: true,

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
      ): Promise<OpDownloadResponse> => {
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
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UPLOAD OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Gets the current sync state from cache or by downloading.
   */
  private async _getCurrentSyncState(
    provider: SyncProviderServiceInterface<SyncProviderId>,
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
  ): Promise<{
    newData: FileBasedSyncData;
    existingOps: CompactOperation[];
    mergedOps: CompactOperation[];
  }> {
    const compactOps = ops.map((op) => this._syncOpToCompact(op));
    const newSyncVersion = currentSyncVersion + 1;

    // Build merged vector clock
    let mergedClock: VectorClock = currentData?.vectorClock || {};
    for (const op of ops) {
      mergedClock = mergeVectorClocks(mergedClock, op.vectorClock);
    }

    // Merge recentOps - add new ops, trim to limit
    const existingOps = currentData?.recentOps || [];
    const mergedOps = [...existingOps, ...compactOps].slice(
      -FILE_BASED_SYNC_CONSTANTS.MAX_RECENT_OPS,
    );

    // Load archive data from IndexedDB to include in sync file
    const archiveYoung = await this._archiveDbAdapter.loadArchiveYoung();
    const archiveOld = await this._archiveDbAdapter.loadArchiveOld();

    // Get current state from NgRx store - this keeps the snapshot up-to-date
    const currentState = await this._stateSnapshotService.getStateSnapshot();

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
    };

    return { newData, existingOps, mergedOps };
  }

  /**
   * Uploads sync data with retry on revision mismatch.
   * Returns the final sync version after upload.
   */
  private async _uploadWithRetry(
    provider: SyncProviderServiceInterface<SyncProviderId>,
    cfg: EncryptAndCompressCfg,
    encryptKey: string | undefined,
    newData: FileBasedSyncData,
    revToMatch: string | null,
    ops: SyncOperation[],
  ): Promise<number> {
    const uploadData = await this._encryptAndCompressHandler.compressAndEncryptData(
      cfg,
      encryptKey,
      newData,
      FILE_BASED_SYNC_CONSTANTS.FILE_VERSION,
    );

    try {
      await provider.uploadFile(
        FILE_BASED_SYNC_CONSTANTS.SYNC_FILE,
        uploadData,
        revToMatch,
        false,
      );
      return newData.syncVersion;
    } catch (e) {
      if (!(e instanceof UploadRevToMatchMismatchAPIError)) {
        throw e;
      }

      // Another client uploaded between our download and upload - retry once
      OpLog.normal(
        'FileBasedSyncAdapter: Rev mismatch detected, re-downloading and retrying...',
      );

      const { data: freshData, rev: freshRev } = await this._downloadSyncFile(
        provider,
        cfg,
        encryptKey,
      );

      // Re-merge operations with fresh data
      const compactOps = ops.map((op) => this._syncOpToCompact(op));
      const freshExistingOps = freshData.recentOps || [];
      const freshMergedOps = [...freshExistingOps, ...compactOps].slice(
        -FILE_BASED_SYNC_CONSTANTS.MAX_RECENT_OPS,
      );

      let freshMergedClock = freshData.vectorClock || {};
      for (const op of ops) {
        freshMergedClock = mergeVectorClocks(freshMergedClock, op.vectorClock);
      }

      const freshNewData: FileBasedSyncData = {
        ...newData,
        syncVersion: freshData.syncVersion + 1,
        vectorClock: freshMergedClock,
        recentOps: freshMergedOps,
        lastModified: Date.now(),
      };

      const freshUploadData =
        await this._encryptAndCompressHandler.compressAndEncryptData(
          cfg,
          encryptKey,
          freshNewData,
          FILE_BASED_SYNC_CONSTANTS.FILE_VERSION,
        );

      await provider.uploadFile(
        FILE_BASED_SYNC_CONSTANTS.SYNC_FILE,
        freshUploadData,
        freshRev,
        false,
      );

      OpLog.normal('FileBasedSyncAdapter: Retry upload successful');
      return freshNewData.syncVersion;
    }
  }

  /**
   * Finds piggybacked ops from other clients that we haven't processed yet.
   */
  private _collectPiggybackedOps(
    existingOps: CompactOperation[],
    providerKey: string,
    clientId: string,
  ): ServerSyncOperation[] {
    const newOps: ServerSyncOperation[] = [];
    existingOps.forEach((compactOp, index) => {
      if (!this._isOpProcessed(providerKey, compactOp.id) && compactOp.c !== clientId) {
        newOps.push({
          serverSeq: index + 1,
          op: this._compactToSyncOp(compactOp),
          receivedAt: compactOp.t,
        });
      }
    });
    return newOps;
  }

  private async _uploadOps(
    provider: SyncProviderServiceInterface<SyncProviderId>,
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
        `FileBasedSyncAdapter: Version changed (expected ${expectedVersion}, got ${currentSyncVersion}). Merging and piggybacking.`,
      );
    }

    // Step 2: Build merged sync data
    const { newData, existingOps, mergedOps } = await this._buildMergedSyncData(
      currentData,
      ops,
      clientId,
      currentSyncVersion,
    );

    // Step 3: Upload with retry on revision mismatch
    const finalSyncVersion = await this._uploadWithRetry(
      provider,
      cfg,
      encryptKey,
      newData,
      revToMatch,
      ops,
    );
    newData.syncVersion = finalSyncVersion;

    // Step 4: Post-upload processing
    this._clearCachedSyncData(providerKey);
    this._expectedSyncVersions.set(providerKey, finalSyncVersion);

    const latestSeq = mergedOps.length;

    // Step 5: Collect piggybacked ops
    const newOps = this._collectPiggybackedOps(existingOps, providerKey, clientId);

    // Mark all ops as processed
    for (const serverOp of newOps) {
      this._markOpProcessed(providerKey, serverOp.op.id);
    }
    for (const op of ops) {
      this._markOpProcessed(providerKey, op.id);
    }

    OpLog.normal(
      `FileBasedSyncAdapter: Upload complete (syncVersion=${finalSyncVersion}, latestSeq=${latestSeq}, piggybacked=${newOps.length})`,
    );

    this._persistState();

    // Build response
    const startingSeq = latestSeq - ops.length;
    return {
      results: ops.map((op, i) => ({
        opId: op.id,
        accepted: true,
        serverSeq: startingSeq + i + 1,
      })),
      latestSeq,
      newOps: newOps.length > 0 ? newOps : undefined,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DOWNLOAD OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  private async _downloadOps(
    provider: SyncProviderServiceInterface<SyncProviderId>,
    cfg: EncryptAndCompressCfg,
    encryptKey: string | undefined,
    sinceSeq: number,
    excludeClient?: string,
    limit: number = 500,
  ): Promise<OpDownloadResponse> {
    const providerKey = this._getProviderKey(provider);

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
      throw e;
    }

    // Detect syncVersion reset (e.g., another client uploaded a snapshot).
    // When syncVersion resets to a lower value, we need to signal this to trigger
    // a re-download from seq 0 so the caller can get the snapshotState.
    const previousExpectedVersion = this._expectedSyncVersions.get(providerKey) ?? 0;
    const versionWasReset =
      previousExpectedVersion > 0 && syncData.syncVersion < previousExpectedVersion;

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

    const needsGapDetection = versionWasReset || snapshotReplacement;

    if (needsGapDetection) {
      const reason = versionWasReset
        ? `sync version reset (${previousExpectedVersion} → ${syncData.syncVersion})`
        : `snapshot replacement (expected ops from seq ${sinceSeq}, but recentOps is empty)`;
      OpLog.warn(
        `FileBasedSyncAdapter: Gap detected - ${reason}. ` +
          'Another client may have uploaded a snapshot. Signaling gap detection.',
      );
    }

    // Update expected version for next upload
    this._expectedSyncVersions.set(providerKey, syncData.syncVersion);

    // Filter ops using operation IDs instead of synthetic seq numbers.
    // Synthetic seq numbers based on array indices shift when the array is trimmed,
    // causing ops to be missed. Operation IDs are stable identifiers.
    //
    // Note: sinceSeq === 0 indicates a fresh download request (e.g., forceFromSeq0),
    // in which case we should return ALL ops regardless of whether we've seen them.
    const isForceFromZero = sinceSeq === 0;
    const filteredOps: ServerSyncOperation[] = [];

    // NOTE: We no longer filter using _processedOpIds here.
    // The download service filters using appliedOpIds (from IndexedDB), which is
    // the source of truth for what's actually applied. _processedOpIds was getting
    // out of sync because ops could be "downloaded" but not applied (e.g., due to
    // interrupted sync, app crash, or filtering by appliedOpIds in the download service).
    //
    // By returning ALL ops from the file, we let the download service's appliedOpIds
    // filter decide what's truly new. This may download more data but ensures correctness.

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

    // Mark downloaded ops as processed (unless it's a force-from-zero request,
    // where the caller is expected to process and then call setLastServerSeq)
    if (!isForceFromZero) {
      for (const serverOp of limitedOps) {
        this._markOpProcessed(providerKey, serverOp.op.id);
      }
      this._persistState();
    }

    // Write archive to IndexedDB if present (for late-joiners who missed archive ops)
    // Only write on first download (sinceSeq === 0) to avoid overwriting local changes
    if (isForceFromZero) {
      if (syncData.archiveYoung) {
        await this._archiveDbAdapter.saveArchiveYoung(syncData.archiveYoung);
        OpLog.normal('FileBasedSyncAdapter: Wrote archiveYoung to IndexedDB');
      }
      if (syncData.archiveOld) {
        await this._archiveDbAdapter.saveArchiveOld(syncData.archiveOld);
        OpLog.normal('FileBasedSyncAdapter: Wrote archiveOld to IndexedDB');
      }
    }

    const result = {
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
      ...(isForceFromZero && syncData.state ? { snapshotState: syncData.state } : {}),
    };

    return result;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SNAPSHOT UPLOAD
  // ═══════════════════════════════════════════════════════════════════════════

  private async _uploadSnapshot(
    provider: SyncProviderServiceInterface<SyncProviderId>,
    cfg: EncryptAndCompressCfg,
    encryptKey: string | undefined,
    state: unknown,
    clientId: string,
    reason: 'initial' | 'recovery' | 'migration',
    vectorClock: Record<string, number>,
    schemaVersion: number,
  ): Promise<SnapshotUploadResponse> {
    const providerKey = this._getProviderKey(provider);

    OpLog.normal(`FileBasedSyncAdapter: Uploading snapshot (reason=${reason})`);

    // For snapshots, we start fresh with syncVersion = 1
    const newSyncVersion = 1;

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
      state,
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
    await provider.uploadFile(
      FILE_BASED_SYNC_CONSTANTS.SYNC_FILE,
      uploadData,
      null,
      true,
    );

    // Reset local state
    this._expectedSyncVersions.set(providerKey, newSyncVersion);
    this._localSeqCounters.set(providerKey, newSyncVersion);
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
    provider: SyncProviderServiceInterface<SyncProviderId>,
  ): Promise<{ success: boolean }> {
    const providerKey = this._getProviderKey(provider);

    OpLog.normal('FileBasedSyncAdapter: Deleting all sync data');

    try {
      // Delete main sync file
      try {
        await provider.removeFile(FILE_BASED_SYNC_CONSTANTS.SYNC_FILE);
      } catch (e) {
        // Only ignore "file not found" errors - log other unexpected errors
        if (!(e instanceof RemoteFileNotFoundAPIError)) {
          OpLog.warn('FileBasedSyncAdapter: Unexpected error deleting sync file', e);
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

      return { success: true };
    } catch (e) {
      OpLog.err('FileBasedSyncAdapter: Failed to delete all data', e);
      return { success: false };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Downloads and decrypts the sync file.
   * @returns The sync data and its revision (ETag) for conditional upload
   */
  private async _downloadSyncFile(
    provider: SyncProviderServiceInterface<SyncProviderId>,
    cfg: EncryptAndCompressCfg,
    encryptKey: string | undefined,
  ): Promise<{ data: FileBasedSyncData; rev: string }> {
    const response = await provider.downloadFile(FILE_BASED_SYNC_CONSTANTS.SYNC_FILE);
    const data =
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

    return { data, rev: response.rev };
  }

  /**
   * Gets a unique key for a provider (for storing per-provider state).
   */
  private _getProviderKey(
    provider: SyncProviderServiceInterface<SyncProviderId>,
  ): string {
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
    };
  }

  /**
   * Gets the current sync data for merging (used by external conflict resolution).
   */
  async getCurrentSyncData(
    provider: SyncProviderServiceInterface<SyncProviderId>,
    cfg: EncryptAndCompressCfg,
    encryptKey: string | undefined,
  ): Promise<FileBasedSyncData | null> {
    try {
      const { data } = await this._downloadSyncFile(provider, cfg, encryptKey);
      return data;
    } catch (e) {
      if (e instanceof RemoteFileNotFoundAPIError) {
        return null;
      }
      throw e;
    }
  }

  /**
   * Checks if a sync version conflict would occur with the given expected version.
   */
  wouldConflict(providerKey: string, currentSyncVersion: number): boolean {
    const expected = this._expectedSyncVersions.get(providerKey) || 0;
    return currentSyncVersion !== expected;
  }
}

import type { VectorClock } from '@sp/sync-core';

/**
 * Compact operations stored in file-based sync data carry the syncVersion at
 * which they were uploaded. The host owns the compact operation shape.
 */
export type SyncFileCompactOp<
  TCompactOperation extends object = Record<string, unknown>,
> = TCompactOperation & { sv?: number };

/**
 * Schema for the shared sync file used by file-based providers.
 *
 * The host supplies the snapshot state, compact operation, and archive payload
 * shapes. The provider package owns only the transport-level envelope.
 */
export interface FileBasedSyncData<
  TState = unknown,
  TCompactOperation extends object = Record<string, unknown>,
  TArchive = unknown,
> {
  /**
   * Schema version for this sync file format.
   * Increment when making breaking changes to FileBasedSyncData structure.
   */
  version: 2;

  /**
   * Content-based optimistic lock counter.
   * Incremented on each successful upload.
   */
  syncVersion: number;

  /**
   * Schema version of the host application data.
   */
  schemaVersion: number;

  /**
   * Causal state after all operations represented by this file.
   */
  vectorClock: VectorClock;

  /**
   * Timestamp of last successful sync (epoch ms).
   */
  lastModified: number;

  /**
   * Client ID that last modified this file.
   */
  clientId: string;

  /**
   * Complete host application state snapshot.
   */
  state: TState;

  /**
   * Recent or frequently mutable archive partition, host-defined.
   */
  archiveYoung?: TArchive;

  /**
   * Older archive partition, host-defined.
   */
  archiveOld?: TArchive;

  /**
   * Recent operations retained for conflict detection.
   */
  recentOps: SyncFileCompactOp<TCompactOperation>[];

  /**
   * The syncVersion of the oldest operation in recentOps.
   */
  oldestOpSyncVersion?: number;
}

export const FILE_BASED_SYNC_CONSTANTS = {
  SYNC_FILE: 'sync-data.json',
  BACKUP_FILE: 'sync-data.json.bak',
  MIGRATION_LOCK_FILE: 'migration.lock',
  FILE_VERSION: 2 as const,
  // SPAP-9: raised 500 -> 2000 to shrink the gap window. A client that missed up
  // to this many ops while offline can still catch up incrementally instead of
  // tripping snapshotReplacement/partialTrimGap detection and forcing a full
  // seq-0 resync (and the conflict dialog that path can surface). Compact ops are
  // small (~150-250 bytes serialized each), so the extra 1500 retained ops add
  // roughly ~0.3 MB to sync-data.json only when the buffer is actually full.
  MAX_RECENT_OPS: 2000,
  SYNC_VERSION_STORAGE_KEY_PREFIX: 'FILE_SYNC_VERSION_',
  LEGACY_META_FILE: '__meta_',
  // SPAP-9: when a seq-0 snapshot download has CONCURRENT vector clocks with the
  // local client, attempt an entity-level last-write-wins merge of the remote
  // recent ops instead of forcing the binary USE_LOCAL/USE_REMOTE conflict
  // dialog.
  //
  // Default OFF (review follow-up): the merge only replays the capped `recentOps`
  // buffer and never re-hydrates the compacted `snapshotState`, so a snapshot whose
  // compacted base holds an entity this client never downloaded would silently drop
  // that entity — turning a user-recoverable conflict dialog into permanent, global,
  // undetectable data loss. `_tryConcurrentSnapshotMerge` now additionally refuses to
  // merge unless the retained recentOps provably bridge the entire gap, but until that
  // guard is validated by a real multi-client E2E harness (SPAP-34) we keep the
  // feature opt-in and fall back to the conflict dialog. Flip to true only alongside
  // that validation.
  AUTO_MERGE_CONCURRENT_SNAPSHOT: false,
} as const;

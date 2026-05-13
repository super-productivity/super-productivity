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
  MAX_RECENT_OPS: 500,
  SYNC_VERSION_STORAGE_KEY_PREFIX: 'FILE_SYNC_VERSION_',
  LEGACY_META_FILE: '__meta_',
} as const;

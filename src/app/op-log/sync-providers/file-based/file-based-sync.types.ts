import { VectorClock } from '../../../core/util/vector-clock';
import { CompactOperation } from '../../../core/persistence/operation-log/compact/compact-operation.types';
import { ArchiveModel } from '../../../features/time-tracking/time-tracking.model';

/**
 * Wrapper type for compact ops stored in the sync file.
 * Extends CompactOperation with `sv` (syncVersion) — the syncVersion at which
 * this op was uploaded. Used for partial-trimming gap detection.
 *
 * This is a file-based sync transport concern, NOT a general operation property.
 */
export type SyncFileCompactOp = CompactOperation & { sv?: number };

/**
 * File-based sync data structure.
 * This is the schema for `sync-data.json` stored on WebDAV/Dropbox/LocalFile providers.
 *
 * Key design decisions:
 * - Single file contains both state snapshot AND recent operations
 * - `syncVersion` provides content-based optimistic locking (works without server ETags)
 * - `recentOps` enables entity-level conflict resolution even with full state uploads
 */
export interface FileBasedSyncData {
  /**
   * Schema version for this sync file format.
   * Increment when making breaking changes to FileBasedSyncData structure.
   */
  version: 2;

  /**
   * Content-based optimistic lock counter.
   * Incremented on each successful upload.
   * Used to detect concurrent modifications without relying on server ETags.
   */
  syncVersion: number;

  /**
   * Schema version of the application data.
   * Used for migration when data format changes.
   */
  schemaVersion: number;

  /**
   * Vector clock representing the causal state after all operations.
   * Used for conflict detection and determining operation ordering.
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
   * Complete application state snapshot.
   * This is the full AppDataComplete - tasks, projects, tags, config, etc.
   * Compressed and optionally encrypted before storage.
   */
  state: unknown;

  /**
   * Archive data for tasks archived within last 21 days.
   * Includes time-tracking data that may still be modified.
   * Optional for backward compatibility with older sync files.
   */
  archiveYoung?: ArchiveModel;

  /**
   * Archive data for tasks archived more than 21 days ago.
   * Contains older, inert data that rarely changes.
   * Optional for backward compatibility with older sync files.
   */
  archiveOld?: ArchiveModel;

  /**
   * Recent operations for conflict detection (last N operations).
   * Even though we upload full state, we need operations to:
   * 1. Detect which entities were modified
   * 2. Apply LWW at entity/field level instead of file level
   * 3. Merge non-conflicting changes from concurrent edits
   *
   * Limit: MAX_RECENT_OPS operations
   */
  recentOps: SyncFileCompactOp[];

  /**
   * The syncVersion (upload batch number) of the oldest operation in recentOps.
   * Used for partial-trimming gap detection: when recentOps hits MAX_RECENT_OPS
   * and oldest ops are trimmed, a slow-syncing client compares this against its
   * sinceSeq to detect missed ops — no cross-machine clock comparison needed.
   *
   * Undefined when recentOps is empty or when old ops lack `sv` (backward compat).
   */
  oldestOpSyncVersion?: number;
}

/**
 * Error thrown when sync data file is corrupted or invalid.
 */
export class SyncDataCorruptedError extends Error {
  constructor(
    message: string,
    public readonly filePath: string,
  ) {
    super(`Sync data corrupted at ${filePath}: ${message}`);
    this.name = 'SyncDataCorruptedError';
  }
}

/**
 * Constants for file-based sync
 */
export const FILE_BASED_SYNC_CONSTANTS = {
  /** Main sync data file name */
  SYNC_FILE: 'sync-data.json',

  /** Backup file name */
  BACKUP_FILE: 'sync-data.json.bak',

  /** Migration lock file name */
  MIGRATION_LOCK_FILE: 'migration.lock',

  /** Current file format version */
  FILE_VERSION: 2 as const,

  /** Maximum number of recent operations to keep */
  MAX_RECENT_OPS: 500,

  /** Storage key prefix for last known sync version */
  SYNC_VERSION_STORAGE_KEY_PREFIX: 'FILE_SYNC_VERSION_',

  /** Maximum number of upload retry attempts on revision mismatch */
  MAX_UPLOAD_RETRIES: 2,

  /** Base delay in ms for exponential backoff between retries */
  RETRY_BASE_DELAY_MS: 500,
} as const;

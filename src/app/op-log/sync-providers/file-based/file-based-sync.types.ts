import { VectorClock } from '../../../core/util/vector-clock';
import { CompactOperation } from '../../../core/persistence/operation-log/compact/compact-operation.types';
import { ArchiveModel } from '../../../features/time-tracking/time-tracking.model';

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
   * Default limit: 200 operations
   */
  recentOps: CompactOperation[];

  /**
   * Optional checksum for integrity verification.
   * SHA-256 hash of the uncompressed state JSON.
   */
  checksum?: string;
}

// Note: FileBasedOperationSyncCapable interface was removed.
// Use isFileBasedProvider() from operation-sync.util.ts instead.

/**
 * Error thrown when sync version conflict is detected.
 * Client expected one version but found another, indicating concurrent modification.
 */
export class SyncVersionConflictError extends Error {
  constructor(
    public readonly expectedVersion: number,
    public readonly actualVersion: number,
  ) {
    super(
      `Sync version conflict: expected ${expectedVersion}, found ${actualVersion}. ` +
        `Another device has synced since last download.`,
    );
    this.name = 'SyncVersionConflictError';
  }
}

/**
 * Error thrown when migration is already in progress by another client.
 */
export class MigrationInProgressError extends Error {
  constructor(
    public readonly lockingClientId: string,
    public readonly lockTimestamp: number,
  ) {
    super(
      `Migration in progress by client ${lockingClientId} since ${new Date(lockTimestamp).toISOString()}. ` +
        `Please wait for migration to complete.`,
    );
    this.name = 'MigrationInProgressError';
  }
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
  MAX_RECENT_OPS: 200,

  /** Migration lock timeout in milliseconds (5 minutes) */
  MIGRATION_LOCK_TIMEOUT_MS: 5 * 60 * 1000,

  /** Storage key prefix for last known sync version */
  SYNC_VERSION_STORAGE_KEY_PREFIX: 'FILE_SYNC_VERSION_',
} as const;

/**
 * Migration lock file content structure
 */
export interface MigrationLockContent {
  clientId: string;
  timestamp: number;
  stage: 'started' | 'downloading' | 'converting' | 'uploading' | 'cleaning';
}

/**
 * Result of parsing/validating sync data file
 */
export interface ParsedSyncData {
  data: FileBasedSyncData;
  isValid: boolean;
  validationErrors?: string[];
}

/**
 * Conflict resolution result for a single entity
 */
export interface EntityConflictResolution {
  entityType: string;
  entityId: string;
  winner: 'local' | 'remote';
  winnerTimestamp: number;
  loserTimestamp: number;
}

/**
 * Result of merging local and remote operations
 */
export interface MergeResult {
  /** Merged state to upload */
  mergedState: unknown;

  /** Operations to include in recentOps (combined and deduplicated) */
  mergedOps: CompactOperation[];

  /** Updated vector clock after merge */
  mergedVectorClock: VectorClock;

  /** Conflicts that were auto-resolved via LWW */
  autoResolvedConflicts: EntityConflictResolution[];

  /** True if local ops were rejected (remote won all conflicts) */
  localOpsRejected: boolean;
}

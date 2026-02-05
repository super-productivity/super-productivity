/**
 * IndexedDB object store and key constants for SUP_OPS database.
 *
 * Single source of truth for database structure.
 * Used by OperationLogStoreService and ArchiveStoreService.
 */

import { ArchiveModel } from '../../features/time-tracking/time-tracking.model';

/** Database name */
export const DB_NAME = 'SUP_OPS';

/** Current database schema version */
export const DB_VERSION = 4;

/** Object store names */
export const STORE_NAMES = {
  /** Operations log - stores all local and remote operations */
  OPS: 'ops' as const,
  /** State cache - stores compacted state snapshots */
  STATE_CACHE: 'state_cache' as const,
  /** Import backup - stores pre-import state for recovery */
  IMPORT_BACKUP: 'import_backup' as const,
  /** Vector clock - stores current client vector clock */
  VECTOR_CLOCK: 'vector_clock' as const,
  /** Archive young - recently archived tasks (< 21 days) */
  ARCHIVE_YOUNG: 'archive_young' as const,
  /** Archive old - older archived tasks (>= 21 days) */
  ARCHIVE_OLD: 'archive_old' as const,
} as const;

/** Common key used for singleton entries */
export const SINGLETON_KEY = 'current' as const;

/** Backup key for state cache backup */
export const BACKUP_KEY = 'backup' as const;

/** Index names for ops object store */
export const OPS_INDEXES = {
  BY_ID: 'byId' as const,
  BY_SYNCED_AT: 'bySyncedAt' as const,
  BY_SOURCE_AND_STATUS: 'bySourceAndStatus' as const,
} as const;

/**
 * Entry stored in archive_young or archive_old object stores.
 */
export interface ArchiveStoreEntry {
  id: typeof SINGLETON_KEY;
  data: ArchiveModel;
  lastModified: number;
}

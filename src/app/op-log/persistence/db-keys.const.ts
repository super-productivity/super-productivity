/**
 * IndexedDB object store and key constants for SUP_OPS database.
 *
 * Single source of truth for database structure.
 * Used by OperationLogStoreService and ArchiveStoreService.
 */

import { ArchiveModel } from '../../features/time-tracking/time-tracking.model';
import { CompleteBackup } from '../sync-exports';

/** Database name */
export const DB_NAME = 'SUP_OPS';

/**
 * Current database schema version.
 *
 * Versions 8 and 9 are deliberate downgrade barriers. Version 8 protects the
 * `archive_pending` reducer checkpoint from v7 readers; version 9 protects the
 * `reducerRejectedAt` replay quarantine from v8 readers. IndexedDB must reject
 * older readers rather than let incomplete work become invisible or replay a
 * terminal poison operation.
 */
export const DB_VERSION = 9;

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
  /** Profile data - stores complete backups for user profile switching */
  PROFILE_DATA: 'profile_data' as const,
  /** Client ID - sync device identity (singleton, key = SINGLETON_KEY) */
  CLIENT_ID: 'client_id' as const,
  /** Small persistence metadata records derived from ops */
  META: 'meta' as const,
} as const;

/** Common key used for singleton entries */
export const SINGLETON_KEY = 'current' as const;

/** Backup key for state cache backup */
export const BACKUP_KEY = 'backup' as const;

/** Meta key for derived full-state operation refs */
export const FULL_STATE_OPS_META_KEY = 'full_state_ops' as const;

/**
 * Meta key marking an interrupted USE_REMOTE raw rebuild: set atomically with
 * the baseline replacement, cleared after the server-history replay commits.
 * While set, the next sync must redo the raw (own-ops-included) rebuild —
 * the normal download path excludes this client's own ops server-side, so an
 * interrupted replay would otherwise silently lose them.
 */
export const RAW_REBUILD_INCOMPLETE_META_KEY = 'raw_rebuild_incomplete' as const;

/**
 * Meta key retaining the Undo provenance after a USE_REMOTE rebuild completed.
 * This is separate from the incomplete/resume marker: completion atomically
 * replaces the latter with this entry so a reload cannot strand the backup.
 */
export const RAW_REBUILD_RECOVERY_META_KEY = 'raw_rebuild_recovery' as const;

/** Versioned marker for the one-time legacy terminal remote failure repair. */
export const LEGACY_TERMINAL_REMOTE_FAILURES_MIGRATION_META_KEY =
  'legacy_terminal_remote_failures_migration' as const;

/** Increment when the legacy terminal remote failure repair needs to run again. */
export const LEGACY_TERMINAL_REMOTE_FAILURES_MIGRATION_VERSION = 1;

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

/**
 * Entry stored in the profile_data object store.
 */
export interface ProfileDataStoreEntry {
  id: string;
  data: CompleteBackup<any>;
  lastModified: number;
}

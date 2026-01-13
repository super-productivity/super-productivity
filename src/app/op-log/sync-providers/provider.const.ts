// NOTE: do not change!!
export enum SyncProviderId {
  'Dropbox' = 'Dropbox',
  'WebDAV' = 'WebDAV',
  'LocalFile' = 'LocalFile',
  'SuperSync' = 'SuperSync',
}

/**
 * Type-safe conversion from string-based sync provider value to SyncProviderId.
 * LegacySyncProvider and SyncProviderId have identical string values but are
 * separate types for historical reasons. This provides safe conversion with
 * runtime validation.
 */
export const toSyncProviderId = (
  value: string | null | undefined,
): SyncProviderId | null => {
  if (value === null || value === undefined) return null;
  if (Object.values(SyncProviderId).includes(value as SyncProviderId)) {
    return value as SyncProviderId;
  }
  return null;
};

export enum SyncStatus {
  InSync = 'InSync',
  UpdateRemote = 'UpdateRemote',
  UpdateRemoteAll = 'UpdateRemoteAll',
  UpdateLocal = 'UpdateLocal',
  UpdateLocalAll = 'UpdateLocalAll',
  Conflict = 'Conflict',
  IncompleteRemoteData = 'IncompleteRemoteData',
  NotConfigured = 'NotConfigured',
}

export enum ConflictReason {
  NoLastSync = 'NoLastSync',
  BothNewerLastSync = 'BothNewerLastSync',
  MatchingModelChangeButLastSyncMismatch = 'MatchingModelChangeButLastSyncMismatch',
  UnexpectedRevMismatch = 'UnexpectedRevMismatch',
}

export const REMOTE_FILE_CONTENT_PREFIX = 'pf_' as const;

/**
 * Database key prefix for private configuration storage.
 * Format: PRIVATE_CFG_PREFIX + providerId
 * NOTE: do not change - this is used to store OAuth tokens in IndexedDB!
 */
export const PRIVATE_CFG_PREFIX = '__sp_cred_' as const;

/**
 * Row shapes persisted by OperationLogStoreService, and the decoding of stored
 * operation rows (compact or full format).
 */
import { Operation, OperationLogEntry, VectorClock } from '../core/operation.types';
import { CompactOperation } from './compact/compact-operation.types';
import type { FullStateOpsMetaEntry } from './full-state-ops-meta';
import type { ImportBackupRef } from './import-backup-ring.util';
import { decodeOperation, isCompactOperation } from './compact/operation-codec.service';

/**
 * Stored operation log entry that can hold either compact or full operation format.
 * Used internally for backwards compatibility with existing data.
 */
export interface StoredOperationLogEntry {
  seq: number;
  op: Operation | CompactOperation;
  appliedAt: number;
  source: 'local' | 'remote';
  syncedAt?: number;
  rejectedAt?: number;
  reducerRejectedAt?: number;
  applicationStatus?: 'pending' | 'archive_pending' | 'applied' | 'failed';
  retryCount?: number;
}

/**
 * Decodes a stored entry to a full OperationLogEntry.
 * Handles both compact and full operation formats for backwards compatibility.
 */
export const decodeStoredEntry = (stored: StoredOperationLogEntry): OperationLogEntry => {
  const op = isCompactOperation(stored.op) ? decodeOperation(stored.op) : stored.op;
  return {
    seq: stored.seq,
    op,
    appliedAt: stored.appliedAt,
    source: stored.source,
    syncedAt: stored.syncedAt,
    rejectedAt: stored.rejectedAt,
    reducerRejectedAt: stored.reducerRejectedAt,
    applicationStatus: stored.applicationStatus,
    retryCount: stored.retryCount,
  };
};

/**
 * Extracts the operation ID from either compact or full format.
 * Both formats use 'id' as the key for IndexedDB index compatibility.
 */
export const getOpId = (op: Operation | CompactOperation): string => {
  return op.id;
};

/** A local row of `clientId` that is still pending: not synced, rejected or quarantined. */
export const isPendingLocalEntryOf = (
  entry: StoredOperationLogEntry | undefined,
  clientId: string,
): entry is StoredOperationLogEntry =>
  entry?.source === 'local' &&
  entry.syncedAt === undefined &&
  entry.rejectedAt === undefined &&
  entry.reducerRejectedAt === undefined &&
  decodeStoredEntry(entry).op.clientId === clientId;

export const getStoredOpType = (op: Operation | CompactOperation): string =>
  isCompactOperation(op) ? op.o : op.opType;

/**
 * Vector clock entry stored in the vector_clock object store.
 * Contains the clock and last update timestamp.
 */
export interface VectorClockEntry {
  clock: VectorClock;
  lastUpdate: number;
}

/**
 * Shape stored in the `state_cache` store (keyPath `id`).
 *
 * `id` is optional in the type so the read-side return types stay assignable
 * from the looser snapshot shapes callers/tests construct (the pre-migration
 * return types did not surface `id`); the field is always present on rows
 * actually written here.
 */
export interface StateCacheEntry {
  id?: string;
  state: unknown;
  lastAppliedOpSeq: number;
  vectorClock: VectorClock;
  compactedAt: number;
  schemaVersion?: number;
  compactionCounter?: number;
  snapshotEntityKeys?: string[];
}

export interface ReplayAnchorSnapshot {
  state: unknown;
  vectorClock: VectorClock;
  compactedAt: number;
  schemaVersion?: number;
}

export interface RawRebuildIncompleteEntry {
  incomplete: true;
  startedAt: number;
  preservedLocalOps: Operation[];
  backupRef?: ImportBackupRef;
}

export interface RawRebuildRecoveryEntry {
  backupId: string;
  backupSavedAt: number;
  completedAt: number;
}

export interface LegacyTerminalRemoteFailuresMigrationEntry {
  version: number;
}

export type OpLogMetaEntry =
  | FullStateOpsMetaEntry
  | RawRebuildIncompleteEntry
  | RawRebuildRecoveryEntry
  | LegacyTerminalRemoteFailuresMigrationEntry;

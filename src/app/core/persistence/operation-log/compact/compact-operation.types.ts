import { VectorClock } from '../../../util/vector-clock';

/**
 * Compact operation format for storage and network transfer.
 * Uses short keys to minimize size.
 *
 * Key mapping:
 * - id = id (kept full for IndexedDB index compatibility)
 * - a = actionType (short code from action-type-codes.ts)
 * - o = opType
 * - e = entityType
 * - d = entityId
 * - ds = entityIds
 * - p = payload
 * - c = clientId
 * - v = vectorClock
 * - t = timestamp
 * - s = schemaVersion
 */
export interface CompactOperation {
  /** id - UUID string (kept as 'id' for IndexedDB index compatibility) */
  id: string;

  /** actionType - short code (e.g., "HA" for "[Task Shared] addTask") */
  a: string;

  /** opType - "CRT", "UPD", "DEL", etc. */
  o: string;

  /** entityType - "TASK", "PROJECT", etc. */
  e: string;

  /** entityId (optional) */
  d?: string;

  /** entityIds for batch (optional) */
  ds?: string[];

  /** payload - unchanged */
  p: unknown;

  /** clientId */
  c: string;

  /** vectorClock - unchanged structure */
  v: VectorClock;

  /** timestamp */
  t: number;

  /** schemaVersion */
  s: number;
}

/**
 * Extended OperationLogEntry with format marker.
 */
export interface CompactOperationLogEntry {
  seq: number;
  op: CompactOperation;
  appliedAt: number;
  source: 'local' | 'remote';
  syncedAt?: number;
  rejectedAt?: number;
  applicationStatus?: 'pending' | 'applied' | 'failed';
  retryCount?: number;
}

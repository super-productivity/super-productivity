import { OpLogTx } from './op-log-db-adapter';
import { SINGLETON_KEY, STORE_NAMES } from './db-keys.const';
import { uuidv7 } from '../../util/uuid-v7';

/**
 * Pre-replacement snapshot ring inside the `import_backup` store.
 * See docs/sync-and-op-log/local-recovery-points.md for the row layout.
 *
 * Pure transaction helpers so the (already oversized) OperationLogStoreService
 * only keeps thin wrappers around them.
 */

/** How many full snapshots are kept per device. */
export const IMPORT_BACKUP_RING_SIZE = 3;

const RING_META_KEY = 'ring';

export type ImportBackupReason = 'REMOTE_IMPORT' | 'FORCE_DOWNLOAD' | 'LOCAL_IMPORT';

export interface ImportBackupRef {
  backupId: string;
  savedAt: number;
}

export interface ImportBackupMeta extends ImportBackupRef {
  reason: ImportBackupReason;
  taskCount: number;
}

export interface ImportBackupEntry extends ImportBackupRef {
  state: unknown;
}

/** Optional descriptor supplied by the capture site; defaults keep old callers working. */
export interface ImportBackupCaptureMeta {
  reason?: ImportBackupReason;
  taskCount?: number;
}

interface PointerRow {
  id: string;
  backupId?: string;
  savedAt: number;
  /** Only present on legacy single-slot rows written before the ring existed. */
  state?: unknown;
}

interface RingMetaRow {
  id: string;
  entries: ImportBackupMeta[];
}

interface SnapshotRow extends ImportBackupEntry {
  id: string;
}

const readRingMeta = async (tx: OpLogTx): Promise<ImportBackupMeta[]> => {
  const row = await tx.get<RingMetaRow>(STORE_NAMES.IMPORT_BACKUP, RING_META_KEY);
  return row?.entries ?? [];
};

/**
 * Writes a new snapshot, points the undo slot at it, and rotates the ring.
 * The evicted snapshots are deleted in this same transaction.
 */
export const saveImportBackupTx = async (
  tx: OpLogTx,
  state: unknown,
  meta: ImportBackupCaptureMeta = {},
): Promise<ImportBackupRef> => {
  const savedAt = Date.now();
  const backupId = uuidv7();
  const entry: ImportBackupMeta = {
    backupId,
    savedAt,
    reason: meta.reason ?? 'LOCAL_IMPORT',
    taskCount: meta.taskCount ?? 0,
  };
  const entries = [entry, ...(await readRingMeta(tx))];
  const kept = entries.slice(0, IMPORT_BACKUP_RING_SIZE);
  for (const evicted of entries.slice(IMPORT_BACKUP_RING_SIZE)) {
    await tx.delete(STORE_NAMES.IMPORT_BACKUP, evicted.backupId);
  }
  await tx.put(STORE_NAMES.IMPORT_BACKUP, {
    id: backupId,
    backupId,
    savedAt,
    state,
  } satisfies SnapshotRow);
  await tx.put(STORE_NAMES.IMPORT_BACKUP, {
    id: RING_META_KEY,
    entries: kept,
  } satisfies RingMetaRow);
  await tx.put(STORE_NAMES.IMPORT_BACKUP, {
    id: SINGLETON_KEY,
    backupId,
    savedAt,
  } satisfies PointerRow);
  return { backupId, savedAt };
};

/** Resolves the undo pointer to its snapshot; handles legacy in-slot rows. */
export const loadImportBackupTx = async (
  tx: OpLogTx,
): Promise<ImportBackupEntry | null> => {
  const pointer = await tx.get<PointerRow>(STORE_NAMES.IMPORT_BACKUP, SINGLETON_KEY);
  if (!pointer) {
    return null;
  }
  if (pointer.state !== undefined) {
    // Lazily give pre-token legacy rows an opaque identity so a same-millisecond
    // slot replacement cannot masquerade as the backup offered by a durable
    // Undo marker.
    const backupId = pointer.backupId ?? uuidv7();
    if (pointer.backupId === undefined) {
      await tx.put(STORE_NAMES.IMPORT_BACKUP, { ...pointer, backupId });
    }
    return { state: pointer.state, savedAt: pointer.savedAt, backupId };
  }
  return pointer.backupId ? loadImportBackupByIdTx(tx, pointer.backupId) : null;
};

export const loadImportBackupByIdTx = async (
  tx: OpLogTx,
  backupId: string,
): Promise<ImportBackupEntry | null> => {
  const row = await tx.get<SnapshotRow>(STORE_NAMES.IMPORT_BACKUP, backupId);
  return row ? { state: row.state, savedAt: row.savedAt, backupId: row.backupId } : null;
};

/** Newest first. Never loads snapshot state. */
export const listImportBackupsTx = (tx: OpLogTx): Promise<ImportBackupMeta[]> =>
  readRingMeta(tx);

/**
 * Drops all but the newest `keep` snapshots to make room when a capture fails
 * (typically storage quota). The undo pointer is retired if its snapshot goes.
 * Returns how many snapshots were evicted.
 */
export const pruneImportBackupRingTx = async (
  tx: OpLogTx,
  keep: number,
): Promise<number> => {
  const entries = await readRingMeta(tx);
  const evicted = entries.slice(keep);
  if (evicted.length === 0) {
    return 0;
  }
  for (const entry of evicted) {
    await tx.delete(STORE_NAMES.IMPORT_BACKUP, entry.backupId);
  }
  await tx.put(STORE_NAMES.IMPORT_BACKUP, {
    id: RING_META_KEY,
    entries: entries.slice(0, keep),
  } satisfies RingMetaRow);
  const pointer = await tx.get<PointerRow>(STORE_NAMES.IMPORT_BACKUP, SINGLETON_KEY);
  if (pointer?.backupId && evicted.some((e) => e.backupId === pointer.backupId)) {
    await tx.delete(STORE_NAMES.IMPORT_BACKUP, SINGLETON_KEY);
  }
  return evicted.length;
};

/**
 * Retires the undo pointer only; the snapshot stays browsable until it rotates
 * out. With `expectedBackupId` the pointer is left alone when it already points
 * at a newer capture.
 */
export const clearImportBackupTx = async (
  tx: OpLogTx,
  expectedBackupId?: string,
): Promise<void> => {
  if (expectedBackupId !== undefined) {
    const pointer = await tx.get<PointerRow>(STORE_NAMES.IMPORT_BACKUP, SINGLETON_KEY);
    if (pointer?.backupId !== expectedBackupId) {
      return;
    }
  }
  await tx.delete(STORE_NAMES.IMPORT_BACKUP, SINGLETON_KEY);
};

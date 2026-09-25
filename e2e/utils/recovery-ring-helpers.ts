import type { Page } from '@playwright/test';

export interface RecoveryRingEntry {
  backupId: string;
  reason: 'REMOTE_IMPORT' | 'FORCE_DOWNLOAD' | 'LOCAL_IMPORT';
  taskCount: number;
}

/**
 * Reads the local recovery ring metadata straight from IndexedDB
 * (docs/sync-and-op-log/local-recovery-points.md), newest first. Lets a spec
 * assert exactly which captures happened without going through the dialog.
 */
export const readRecoveryRing = (page: Page): Promise<RecoveryRingEntry[]> =>
  page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('SUP_OPS');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      const row = await new Promise<{ entries?: RecoveryRingEntry[] } | undefined>(
        (resolve, reject) => {
          const req = db
            .transaction(['import_backup'], 'readonly')
            .objectStore('import_backup')
            .get('ring');
          req.onsuccess = () =>
            resolve(req.result as { entries?: RecoveryRingEntry[] } | undefined);
          req.onerror = () => reject(req.error);
        },
      );
      return (row?.entries ?? []).map(({ backupId, reason, taskCount }) => ({
        backupId,
        reason,
        taskCount,
      }));
    } finally {
      db.close();
    }
  });

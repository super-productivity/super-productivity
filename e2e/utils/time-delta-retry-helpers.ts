import type { Page } from '@playwright/test';

export interface StoredDelta {
  op: { id: string; a: string; v: Record<string, number>; p: unknown };
  syncedAt?: number;
  rejectedAt?: number;
}

export const readDeltas = (client: { page: Page }): Promise<StoredDelta[]> =>
  client.page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('SUP_OPS');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const entries = await new Promise<StoredDelta[]>((resolve, reject) => {
        const request = db.transaction('ops').objectStore('ops').getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return entries.filter(({ op }) => op.a === 'KT');
    } finally {
      db.close();
    }
  });

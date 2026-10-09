import type { Page } from '@playwright/test';

export interface StoredOperation {
  op: {
    id: string;
    a: string;
    c: string;
    d?: string;
    ds?: string[];
    v: Record<string, number>;
    p: unknown;
  };
  source?: 'local' | 'remote';
  applicationStatus?: string;
  syncedAt?: number;
  rejectedAt?: number;
}

export const readStoredOps = (client: { page: Page }): Promise<StoredOperation[]> =>
  client.page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('SUP_OPS');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const entries = await new Promise<StoredOperation[]>((resolve, reject) => {
        const request = db.transaction('ops').objectStore('ops').getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return entries;
    } finally {
      db.close();
    }
  });

export const readDeltas = async (client: { page: Page }): Promise<StoredOperation[]> =>
  (await readStoredOps(client)).filter(({ op }) => op.a === 'KT');

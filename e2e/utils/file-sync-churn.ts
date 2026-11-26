import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/** Counts ops that are neither synced nor rejected in the app's op log. */
export const pendingOpCount = (page: Page): Promise<number> =>
  page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('SUP_OPS');
      request.onsuccess = (): void => resolve(request.result);
      request.onerror = (): void => reject(request.error);
    });
    try {
      return await new Promise<number>((resolve, reject) => {
        const request = db.transaction('ops').objectStore('ops').getAll();
        request.onsuccess = (): void =>
          resolve(
            (request.result as Array<{ syncedAt?: number; rejectedAt?: number }>).filter(
              (entry) => entry.syncedAt === undefined && entry.rejectedAt === undefined,
            ).length,
          );
        request.onerror = (): void => reject(request.error);
      });
    } finally {
      db.close();
    }
  });

/** Dispatches `count` real, persistent task updates into the app's store. */
export const dispatchTaskUpdates = async (
  page: Page,
  taskTitle: string,
  count: number,
  offset: number,
): Promise<void> => {
  const taskId = await page
    .locator('task', { hasText: taskTitle })
    .first()
    .getAttribute('data-task-id');
  expect(taskId).toBeTruthy();
  await page.evaluate(
    async ({ id, n, start }) => {
      const helpers = (
        window as unknown as {
          __e2eTestHelpers: {
            store: { dispatch: (action: unknown) => void };
            flushPendingWrites: () => Promise<void>;
            compact: () => Promise<unknown>;
          };
        }
      ).__e2eTestHelpers;
      // Small chunks, each flushed and followed by a quiet local compaction:
      // past the local compaction threshold every write starts a compaction,
      // which is deferred while dispatches keep arriving (an artefact of
      // dispatching thousands of ops in one burst, not of the sync path under
      // test). This direct compact() does not reset the write-path counter.
      const CHUNK = 50;
      for (let i = 0; i < n; i += CHUNK) {
        for (let j = i; j < Math.min(n, i + CHUNK); j++) {
          helpers.store.dispatch({
            type: '[Task Shared] updateTask',
            task: { id, changes: { notes: `churn ${start + j}` } },
            meta: {
              isPersistent: true,
              entityType: 'TASK',
              entityId: id,
              opType: 'UPD',
            },
          });
        }
        await helpers.flushPendingWrites();
        await helpers.compact();
      }
    },
    { id: taskId!, n: count, start: offset },
  );
};

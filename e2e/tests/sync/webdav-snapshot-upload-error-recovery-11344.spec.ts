import type { Page } from '@playwright/test';
import { expect, test } from '../../fixtures/webdav.fixture';
import { SyncPage } from '../../pages/sync.page';
import { WorkViewPage } from '../../pages/work-view.page';
import {
  closeContextsSafely,
  createSyncFolder,
  generateSyncFolderName,
  setupSyncClient,
  waitForSyncComplete,
  WEBDAV_CONFIG_TEMPLATE,
} from '../../utils/sync-helpers';
import { waitForAppReady, waitForStatePersistence } from '../../utils/waits';

const task = (page: Page, title: string): ReturnType<Page['locator']> =>
  page.locator('task').filter({ hasText: title });

/**
 * Persists the state released versions (v19.1.0 to v19.3.1) left behind after
 * classifying the failed upload as a rejection: the never-synced
 * SERVER_MIGRATION SYNC_IMPORT carries `rejectedAt`. Returns how many entries
 * were marked.
 */
const markPendingMigrationRejected = (page: Page): Promise<number> =>
  page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('SUP_OPS');
      open.onsuccess = (): void => resolve(open.result);
      open.onerror = (): void => reject(open.error);
    });
    try {
      return await new Promise<number>((resolve, reject) => {
        const tx = db.transaction('ops', 'readwrite');
        const store = tx.objectStore('ops');
        const read = store.getAll();
        let marked = 0;
        read.onsuccess = (): void => {
          for (const entry of read.result as Array<{
            op: { o: string; r?: string };
            source: string;
            syncedAt?: number;
            rejectedAt?: number;
          }>) {
            if (
              entry.source === 'local' &&
              entry.op.o === 'SYNC_IMPORT' &&
              entry.op.r === 'SERVER_MIGRATION' &&
              entry.syncedAt === undefined
            ) {
              entry.rejectedAt ??= Date.now();
              store.put(entry);
              marked++;
            }
          }
        };
        tx.oncomplete = (): void => resolve(marked);
        tx.onerror = (): void => reject(tx.error);
      });
    } finally {
      db.close();
    }
  });

/**
 * #11344 / #11352: a synced device moves to an empty folder and seeds it with a
 * server-migration snapshot. If that one upload fails with an error the client
 * does not recognise as transient (here a 403 from the WebDAV server, e.g. a
 * read-only share or a misconfigured folder; a revoked app password or an
 * unrecognised mobile network error behaves the same), the snapshot was marked
 * permanently rejected. From then on every sync stopped with "A previous
 * server-migration snapshot was rejected", even after the server problem was
 * gone. (Once another device fills the folder, the same rejection shows as
 * "Upload blocked because pending operations depend on a rejected full-state
 * baseline"; that later state is not covered here.)
 */
test.describe('@webdav a failed snapshot upload does not stop file sync for good', () => {
  test.beforeEach(async ({ webdavServerUp }) => {
    void webdavServerUp;
  });

  for (const stuckByOlderVersion of [false, true]) {
    test(
      stuckByOlderVersion
        ? 'a client an older version left with a rejected migration snapshot syncs again'
        : 'seeds the moved-to folder once the server accepts writes again',
      async ({ browser, baseURL, request }) => {
        test.setTimeout(240000);
        const firstFolder = generateSyncFolderName('snapshot-upload-error');
        const movedFolder = `${firstFolder}-moved`;
        const beforeMove = `Before move ${firstFolder}`;
        const whileStuck = `While stuck ${firstFolder}`;
        await createSyncFolder(request, firstFolder);
        await createSyncFolder(request, movedFolder);

        const a = await setupSyncClient(browser, baseURL);
        let b: Awaited<ReturnType<typeof setupSyncClient>> | undefined;
        try {
          const syncA = new SyncPage(a.page);
          const workA = new WorkViewPage(a.page);
          await workA.waitForTaskList();
          await workA.addTask(beforeMove);
          await waitForStatePersistence(a.page);
          await syncA.setupWebdavSync({
            ...WEBDAV_CONFIG_TEMPLATE,
            syncFolderPath: `/${firstFolder}`,
          });
          expect(await waitForSyncComplete(a.page, syncA)).toBe('success');

          // The moved-to folder refuses writes while the migration snapshot uploads.
          let refusedWrites = 0;
          await a.page.route(`**/${movedFolder}/**`, async (route) => {
            if (route.request().method() !== 'PUT') return route.continue();
            refusedWrites++;
            await route.fulfill({ status: 403, body: 'Forbidden' });
          });
          await syncA.setupWebdavSync(
            { ...WEBDAV_CONFIG_TEMPLATE, syncFolderPath: `/${movedFolder}` },
            { isReconfigure: true },
          );
          await expect.poll(() => refusedWrites).toBeGreaterThan(0);
          await expect(syncA.syncSpinner).toBeHidden({ timeout: 30000 });

          if (stuckByOlderVersion) {
            expect(await markPendingMigrationRejected(a.page)).toBe(1);
          }

          // The server problem is fixed. Work done meanwhile must not be lost.
          await a.page.unroute(`**/${movedFolder}/**`);
          await workA.addTask(whileStuck);
          await waitForStatePersistence(a.page);
          if (stuckByOlderVersion) {
            // Drop in-memory op-log caches so the persisted state is what runs.
            await a.page.reload();
            await waitForAppReady(a.page);
            await workA.waitForTaskList();
          }
          await syncA.triggerSync();
          expect(await waitForSyncComplete(a.page, syncA)).toBe('success');
          await expect(syncA.syncErrorIcon).toBeHidden();

          // A second device joining the moved-to folder gets both tasks.
          b = await setupSyncClient(browser, baseURL);
          const syncB = new SyncPage(b.page);
          const workB = new WorkViewPage(b.page);
          await workB.waitForTaskList();
          await syncB.setupWebdavSync({
            ...WEBDAV_CONFIG_TEMPLATE,
            syncFolderPath: `/${movedFolder}`,
          });
          expect(await waitForSyncComplete(b.page, syncB)).toBe('success');
          await expect(task(b.page, beforeMove)).toBeVisible();
          await expect(task(b.page, whileStuck)).toBeVisible();

          // A's uploads are no longer blocked, and it still takes B's edits.
          const fromB = `From B ${firstFolder}`;
          await workB.addTask(fromB);
          await waitForStatePersistence(b.page);
          await syncB.triggerSync();
          expect(await waitForSyncComplete(b.page, syncB)).toBe('success');
          const afterRecovery = `After recovery ${firstFolder}`;
          await workA.addTask(afterRecovery);
          await waitForStatePersistence(a.page);
          await syncA.triggerSync();
          expect(await waitForSyncComplete(a.page, syncA)).toBe('success');
          await syncB.triggerSync();
          expect(await waitForSyncComplete(b.page, syncB)).toBe('success');
          for (const title of [beforeMove, whileStuck, fromB, afterRecovery]) {
            await expect(task(a.page, title)).toBeVisible();
            await expect(task(b.page, title)).toBeVisible();
          }
        } finally {
          await closeContextsSafely(a.context, b?.context);
        }
      },
    );
  }
});

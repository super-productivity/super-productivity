import { expect, test } from '../../fixtures/supersync.fixture';
import { ImportPage } from '../../pages/import.page';
import {
  closeClient,
  createSimulatedClient,
  createTestUser,
  getSuperSyncConfig,
  waitForTask,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { waitForAppReady } from '../../utils/waits';

const getArchiveTaskIds = async (
  client: SimulatedE2EClient,
): Promise<{ old: string[]; young: string[] }> =>
  client.page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('SUP_OPS');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    const readIds = async (storeName: string): Promise<string[]> =>
      new Promise<string[]>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const request = tx.objectStore(storeName).get('current');
        request.onsuccess = () => {
          const result = request.result as
            | { data?: { task?: { ids?: string[] } } }
            | undefined;
          resolve(result?.data?.task?.ids ?? []);
        };
        request.onerror = () => reject(request.error);
      });

    const [young, old] = await Promise.all([
      readIds('archive_young'),
      readIds('archive_old'),
    ]);
    db.close();
    return { old, young };
  });

/**
 * Backup-import tests that only assert active NgRx state miss the two archive
 * object stores, which are persisted and replayed outside the ordinary reducers.
 */
test.describe('@supersync @import Backup Import Archives', () => {
  test('a late client receives active and archived imported data', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(180000);
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);

      const importPage = new ImportPage(clientA.page);
      await importPage.navigateToImportPage();
      await importPage.importBackupFile(
        ImportPage.getFixturePath('test-backup-with-archives.json'),
      );
      await clientA.page.goto('/#/project/INBOX_PROJECT/tasks', {
        waitUntil: 'domcontentloaded',
      });
      await waitForAppReady(clientA.page);
      await waitForTask(clientA.page, 'E2E Archive Import - Active Task');
      expect(await getArchiveTaskIds(clientA)).toEqual({
        old: ['archived-old-task-1'],
        young: ['archived-young-task-1', 'archived-young-task-2'],
      });

      await clientA.sync.setupSuperSync(syncConfig);
      await clientA.sync.syncAndWait();

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();
      await clientB.page.goto('/#/project/INBOX_PROJECT/tasks', {
        waitUntil: 'domcontentloaded',
      });
      await waitForAppReady(clientB.page);
      await waitForTask(clientB.page, 'E2E Archive Import - Active Task');

      expect(await getArchiveTaskIds(clientB)).toEqual({
        old: ['archived-old-task-1'],
        young: ['archived-young-task-1', 'archived-young-task-2'],
      });
      expect(await clientB.sync.hasSyncError()).toBe(false);
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});

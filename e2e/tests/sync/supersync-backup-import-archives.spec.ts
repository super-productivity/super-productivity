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

type ArchiveStoreSummary = {
  old: {
    ids: string[];
    task: unknown;
    timeTracking: unknown;
  };
  young: {
    ids: string[];
    task: unknown;
    timeTracking: unknown;
  };
};

const getArchiveSummary = async (
  client: SimulatedE2EClient,
): Promise<ArchiveStoreSummary> =>
  client.page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('SUP_OPS');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    type ArchiveData = {
      task?: {
        ids?: string[];
        entities?: Record<string, unknown>;
      };
      timeTracking?: {
        project?: Record<string, Record<string, unknown>>;
      };
    };
    const readArchive = async (storeName: string): Promise<ArchiveData> =>
      new Promise<ArchiveData>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const request = tx.objectStore(storeName).get('current');
        request.onsuccess = () => {
          const result = request.result as { data?: ArchiveData } | undefined;
          resolve(result?.data ?? {});
        };
        request.onerror = () => reject(request.error);
      });

    const [young, old] = await Promise.all([
      readArchive('archive_young'),
      readArchive('archive_old'),
    ]);
    const oldTask = old.task?.entities?.['archived-old-task-1'] as
      | { id?: string; title?: string; timeSpent?: number; notes?: string }
      | undefined;
    const youngTask = young.task?.entities?.['archived-young-task-1'] as
      | {
          id?: string;
          title?: string;
          timeSpent?: number;
          timeSpentOnDay?: Record<string, number>;
        }
      | undefined;
    db.close();
    return {
      old: {
        ids: old.task?.ids ?? [],
        task: oldTask
          ? {
              id: oldTask.id,
              title: oldTask.title,
              timeSpent: oldTask.timeSpent,
              notes: oldTask.notes,
            }
          : undefined,
        timeTracking: old.timeTracking?.project?.['INBOX_PROJECT']?.['2024-10-15'],
      },
      young: {
        ids: young.task?.ids ?? [],
        task: youngTask
          ? {
              id: youngTask.id,
              title: youngTask.title,
              timeSpent: youngTask.timeSpent,
              timeSpentOnDay: youngTask.timeSpentOnDay,
            }
          : undefined,
        timeTracking: young.timeTracking?.project?.['INBOX_PROJECT']?.['2024-11-25'],
      },
    };
  });

const EXPECTED_ARCHIVE_SUMMARY: ArchiveStoreSummary = {
  old: {
    ids: ['archived-old-task-1'],
    task: {
      id: 'archived-old-task-1',
      title: 'E2E Archive Import - Old Archived Task',
      timeSpent: 3600000,
      notes: 'This task was archived more than 21 days ago',
    },
    timeTracking: { s: 32400000, e: 50400000 },
  },
  young: {
    ids: ['archived-young-task-1', 'archived-young-task-2'],
    task: {
      id: 'archived-young-task-1',
      title: 'E2E Archive Import - Young Archived Task 1',
      timeSpent: 5400000,
      timeSpentOnDay: Object.fromEntries([
        ['2024-11-25', 3600000],
        ['2024-11-26', 1800000],
      ]),
    },
    timeTracking: { s: 32400000, e: 61200000 },
  },
};

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
      expect(await getArchiveSummary(clientA)).toEqual(EXPECTED_ARCHIVE_SUMMARY);

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

      expect(await getArchiveSummary(clientB)).toEqual(EXPECTED_ARCHIVE_SUMMARY);
      expect(await clientB.sync.hasSyncError()).toBe(false);
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});

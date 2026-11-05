import type { Page } from '@playwright/test';
import { expect, test } from '../../fixtures/webdav.fixture';
import { SyncPage } from '../../pages/sync.page';
import { TaskPage } from '../../pages/task.page';
import { WorkViewPage } from '../../pages/work-view.page';
import {
  closeContextsSafely,
  createSyncFolder,
  generateSyncFolderName,
  readPrefixedFile,
  setupSyncClient,
  waitForSyncComplete,
  WEBDAV_CONFIG_TEMPLATE,
} from '../../utils/sync-helpers';
import { flushPendingWrites } from '../../utils/waits';

interface ArchivedTask extends Record<string, unknown> {
  id: string;
  title: string;
}

interface ArchiveEntry {
  id: string;
  data: {
    task: { ids: unknown; entities: Record<string, ArchivedTask> };
  };
}

interface RemoteSnapshot {
  version: number;
  syncVersion: number;
  taskArchiveSnapshotVersion?: number;
  state: { task: { entities: Record<string, ArchivedTask> } };
  archiveYoung: { task: { ids: string[]; entities: Record<string, ArchivedTask> } };
  archiveOld: { task: { ids: string[]; entities: Record<string, ArchivedTask> } };
}

interface TestWindow {
  __e2eTestHelpers: { store: { dispatch: (action: unknown) => void } };
}

const authorization = `Basic ${Buffer.from('admin:admin').toString('base64')}`;

/** Read the native row so the normalizing application adapter cannot hide corruption. */
const readYoungArchive = (page: Page): Promise<ArchiveEntry | undefined> =>
  page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open('SUP_OPS');
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    });
    try {
      return await new Promise<ArchiveEntry | undefined>((resolve, reject) => {
        const transaction = db.transaction('archive_young', 'readonly');
        const request = transaction.objectStore('archive_young').get('current');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  });

/** Keep the real owner entity, but invalidate its task index as in issue #7487. */
const corruptYoungTaskIndex = (
  page: Page,
  taskId: string,
  missingData: boolean,
): Promise<void> =>
  page.evaluate(
    async ({ id, missingData: omitData }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const opening = indexedDB.open('SUP_OPS');
        opening.onsuccess = () => resolve(opening.result);
        opening.onerror = () => reject(opening.error);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = db.transaction('archive_young', 'readwrite');
          const store = transaction.objectStore('archive_young');
          const request = store.get('current');
          transaction.oncomplete = () => resolve();
          transaction.onabort = () => reject(transaction.error);
          transaction.onerror = () => reject(transaction.error);
          request.onsuccess = () => {
            const entry = request.result as ArchiveEntry | undefined;
            if (!entry?.data.task.entities[id]) {
              transaction.abort();
              reject(new Error('Expected the real archived owner before corruption'));
              return;
            }
            store.put(
              omitData
                ? { id: entry.id }
                : {
                    ...entry,
                    data: {
                      ...entry.data,
                      task: { ...entry.data.task, ids: 'invalid-task-index' },
                    },
                  },
            );
          };
        });
      } finally {
        db.close();
      }
    },
    { id: taskId, missingData },
  );

for (const missingData of [false, true]) {
  test(`@webdav omits task archive proof for ${missingData ? 'a row without data' : 'a malformed task index'}`, async ({
    browser,
    baseURL,
    request,
    webdavServerUp,
  }) => {
    void webdavServerUp;
    test.slow();
    const folder = generateSyncFolderName('snapshot-integrity');
    const remoteUrl = `${WEBDAV_CONFIG_TEMPLATE.baseUrl}${folder}/DEV/sync-data.json`;
    await createSyncFolder(request, folder);
    const client = await setupSyncClient(browser, baseURL);
    try {
      const { page } = client;
      const work = new WorkViewPage(page);
      const sync = new SyncPage(page);
      const tasks = new TaskPage(page);
      await work.waitForTaskList();
      await page.evaluate(() => {
        (window as unknown as TestWindow).__e2eTestHelpers.store.dispatch({
          type: '[Global Config] Update Global Config Section',
          sectionKey: 'sync',
          sectionCfg: { isManualSyncOnly: true, isUseSplitSyncFiles: false },
        });
      });
      const ownerTitle = `Archived integrity owner ${folder}`;
      await work.addTask(ownerTitle);
      await flushPendingWrites(page);
      await sync.setupWebdavSync({
        ...WEBDAV_CONFIG_TEMPLATE,
        syncFolderPath: `/${folder}`,
        isUseSplitSyncFiles: false,
      });
      expect(await waitForSyncComplete(page, sync)).toBe('success');
      const initial = await readPrefixedFile<RemoteSnapshot>(
        request,
        remoteUrl,
        authorization,
      );

      await tasks.markTaskAsDone(tasks.getTaskByText(ownerTitle).first());
      await page.locator('.e2e-finish-day').click();
      await page.waitForURL(/daily-summary/);
      await page
        .locator(
          'daily-summary button[mat-flat-button]:has(mat-icon:has-text("wb_sunny"))',
        )
        .click();
      await page.waitForURL(/(active\/tasks|tag\/TODAY\/tasks)/);
      await expect
        .poll(async () => {
          const archive = await readYoungArchive(page);
          return Object.values(archive?.data.task.entities ?? {}).find(
            (task) => task.title === ownerTitle,
          )?.id;
        })
        .toBeTruthy();
      const archived = Object.values(
        (await readYoungArchive(page))!.data.task.entities,
      ).find((task) => task.title === ownerTitle)!;
      await expect(tasks.getTaskByText(ownerTitle)).toHaveCount(0);

      // This new operation forces an ordinary upload after initial/full-state sync.
      const healthyPendingTitle = `Healthy pending capture ${folder}`;
      await work.addTask(healthyPendingTitle);
      await flushPendingWrites(page);
      await sync.triggerSync();
      expect(await waitForSyncComplete(page, sync)).toBe('success');
      const healthy = await readPrefixedFile<RemoteSnapshot>(
        request,
        remoteUrl,
        authorization,
      );
      expect(healthy.version).toBe(2);
      expect(healthy.syncVersion).toBeGreaterThan(initial.syncVersion);
      expect(healthy.taskArchiveSnapshotVersion).toBe(1);
      expect(
        Object.values(healthy.state.task.entities).map((task) => task.title),
      ).toContain(healthyPendingTitle);
      expect(healthy.state.task.entities[archived.id]).toBeUndefined();
      expect(healthy.archiveYoung.task.entities[archived.id]).toEqual(archived);
      expect(healthy.archiveOld.task.entities[archived.id]).toBeUndefined();

      await corruptYoungTaskIndex(page, archived.id, missingData);
      const corrupt = await readYoungArchive(page);
      if (missingData) expect(Object.hasOwn(corrupt!, 'data')).toBe(false);
      else {
        expect(corrupt!.data.task.ids).toBe('invalid-task-index');
        expect(corrupt!.data.task.entities[archived.id]).toEqual(archived);
      }

      const corruptPendingTitle = `Pending after archive corruption ${folder}`;
      await work.addTask(corruptPendingTitle);
      await flushPendingWrites(page);
      await sync.triggerSync();
      expect(await waitForSyncComplete(page, sync)).toBe('success');
      const published = await readPrefixedFile<RemoteSnapshot>(
        request,
        remoteUrl,
        authorization,
      );
      expect(published.version).toBe(2);
      expect(published.syncVersion).toBeGreaterThan(healthy.syncVersion);
      expect(
        Object.values(published.state.task.entities).map((task) => task.title),
      ).toContain(corruptPendingTitle);
      expect(published.state.task.entities[archived.id]).toBeUndefined();
      expect(published.archiveYoung.task).toEqual({ ids: [], entities: {} });
      expect(published.archiveOld.task.entities[archived.id]).toBeUndefined();
      expect(Object.hasOwn(published, 'taskArchiveSnapshotVersion')).toBe(false);

      // Publication normalized its copy; the native row still contains the owner.
      const retained = await readYoungArchive(page);
      if (missingData) expect(Object.hasOwn(retained!, 'data')).toBe(false);
      else {
        expect(retained!.data.task.ids).toBe('invalid-task-index');
        expect(retained!.data.task.entities[archived.id]).toEqual(archived);
      }
    } finally {
      await closeContextsSafely(client.context);
    }
  });
}

import { test, expect } from '../../fixtures/webdav.fixture';
import { SyncPage } from '../../pages/sync.page';
import { WorkViewPage } from '../../pages/work-view.page';
import {
  WEBDAV_CONFIG_TEMPLATE,
  createUniqueSyncFolder,
  createWebDavFolder,
  setupClient,
  waitForSync,
} from '../../utils/sync-helpers';

test.describe('@webdav WebDAV Sync Task Order', () => {
  // Run sync tests serially to avoid WebDAV server contention
  test.describe.configure({ mode: 'serial' });

  test('should preserve task order after sync', async ({ browser, baseURL, request }) => {
    test.slow();
    const SYNC_FOLDER_NAME = createUniqueSyncFolder('task-order');
    await createWebDavFolder(request, SYNC_FOLDER_NAME);
    const WEBDAV_CONFIG = {
      ...WEBDAV_CONFIG_TEMPLATE,
      syncFolderPath: `/${SYNC_FOLDER_NAME}`,
    };

    const url = baseURL || 'http://localhost:4242';

    // --- Client A ---
    const { context: contextA, page: pageA } = await setupClient(browser, url);
    const syncPageA = new SyncPage(pageA);
    const workViewPageA = new WorkViewPage(pageA);
    await workViewPageA.waitForTaskList();

    // Configure Sync on Client A
    await syncPageA.setupWebdavSync(WEBDAV_CONFIG);
    await expect(syncPageA.syncBtn).toBeVisible();

    // Create 3 tasks in specific order
    const timestamp = Date.now();
    const task1 = `First Task ${timestamp}`;
    const task2 = `Second Task ${timestamp}`;
    const task3 = `Third Task ${timestamp}`;

    await workViewPageA.addTask(task1);
    await workViewPageA.addTask(task2);
    await workViewPageA.addTask(task3);

    // Verify all 3 tasks exist on Client A
    const tasksA = pageA.locator('task');
    await expect(tasksA).toHaveCount(3);

    // Capture the order on Client A (get task titles in order)
    const taskTitlesA: string[] = [];
    for (let i = 0; i < 3; i++) {
      const title = await tasksA.nth(i).locator('.task-title').textContent();
      taskTitlesA.push(title?.trim() || '');
    }
    console.log('Task order on Client A:', taskTitlesA);

    // Wait for state to settle
    await pageA.waitForTimeout(500);

    // Sync Client A (Upload)
    await syncPageA.triggerSync();
    await waitForSync(pageA, syncPageA);

    // --- Client B ---
    const { context: contextB, page: pageB } = await setupClient(browser, url);
    const syncPageB = new SyncPage(pageB);
    const workViewPageB = new WorkViewPage(pageB);
    await workViewPageB.waitForTaskList();

    // Configure Sync on Client B
    await syncPageB.setupWebdavSync(WEBDAV_CONFIG);
    await expect(syncPageB.syncBtn).toBeVisible();

    // Sync Client B (Download)
    await syncPageB.triggerSync();
    await waitForSync(pageB, syncPageB);

    // Verify all 3 tasks appear on Client B
    const tasksB = pageB.locator('task');
    await expect(tasksB).toHaveCount(3);

    // Verify order matches Client A
    const taskTitlesB: string[] = [];
    for (let i = 0; i < 3; i++) {
      const title = await tasksB.nth(i).locator('.task-title').textContent();
      taskTitlesB.push(title?.trim() || '');
    }
    console.log('Task order on Client B:', taskTitlesB);

    // Assert order is preserved
    for (let i = 0; i < 3; i++) {
      expect(taskTitlesB[i]).toBe(taskTitlesA[i]);
    }

    // Cleanup
    await contextA.close();
    await contextB.close();
  });
});

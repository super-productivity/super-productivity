import { test, expect } from '../../fixtures/test.fixture';
import { SyncPage } from '../../pages/sync.page';
import { WorkViewPage } from '../../pages/work-view.page';
import { waitForAppReady, waitForStatePersistence } from '../../utils/waits';
import { isWebDavServerUp } from '../../utils/check-webdav';
import {
  WEBDAV_CONFIG_TEMPLATE,
  setupSyncClient,
  createSyncFolder,
  waitForSyncComplete,
  generateSyncFolderName,
  dismissTourIfVisible,
} from '../../utils/sync-helpers';

test.describe('WebDAV Sync Full Flow', () => {
  // Run sync tests serially to avoid WebDAV server contention
  test.describe.configure({ mode: 'serial' });

  // Use a unique folder for each test run to avoid collisions
  const SYNC_FOLDER_NAME = generateSyncFolderName('e2e-full');

  const WEBDAV_CONFIG = {
    ...WEBDAV_CONFIG_TEMPLATE,
    syncFolderPath: `/${SYNC_FOLDER_NAME}`,
  };

  test.beforeAll(async () => {
    const isUp = await isWebDavServerUp(WEBDAV_CONFIG_TEMPLATE.baseUrl);
    if (!isUp) {
      console.warn('WebDAV server not reachable. Skipping WebDAV tests.');
      test.skip(true, 'WebDAV server not reachable');
    }
  });

  test('should sync data between two clients', async ({ browser, baseURL, request }) => {
    test.slow(); // Sync tests might take longer
    console.log('Using baseURL:', baseURL);
    const url = baseURL || 'http://localhost:4242';

    // Create the sync folder on WebDAV server to avoid 409 Conflict (parent missing)
    await createSyncFolder(request, SYNC_FOLDER_NAME);

    // --- Client A ---
    const { context: contextA, page: pageA } = await setupSyncClient(browser, url);
    const syncPageA = new SyncPage(pageA);
    const workViewPageA = new WorkViewPage(pageA);
    await workViewPageA.waitForTaskList();

    // Configure Sync on Client A
    await syncPageA.setupWebdavSync(WEBDAV_CONFIG);
    await expect(syncPageA.syncBtn).toBeVisible();

    // Add Task on Client A
    const taskName = 'Task from Client A';
    await workViewPageA.addTask(taskName);
    await expect(pageA.locator('task')).toHaveCount(1);

    // Sync Client A (Upload)
    await syncPageA.triggerSync();
    await waitForSyncComplete(pageA, syncPageA);

    // --- Client B ---
    const { context: contextB, page: pageB } = await setupSyncClient(browser, url);
    const syncPageB = new SyncPage(pageB);
    const workViewPageB = new WorkViewPage(pageB);
    await workViewPageB.waitForTaskList();

    // Configure Sync on Client B (Same path)
    await syncPageB.setupWebdavSync(WEBDAV_CONFIG);
    await expect(syncPageB.syncBtn).toBeVisible();

    // Sync Client B (Download)
    await syncPageB.triggerSync();
    await waitForSyncComplete(pageB, syncPageB);

    // Verify Task appears on Client B
    await expect(pageB.locator('task')).toHaveCount(1);
    await expect(pageB.locator('task').first()).toContainText(taskName);

    // --- Sync Update (A -> B) ---
    // Add another task on Client A
    const taskName2 = 'Task 2 from Client A';
    await workViewPageA.addTask(taskName2);

    await syncPageA.triggerSync();
    await waitForSyncComplete(pageA, syncPageA);

    // Sync Client B
    await syncPageB.triggerSync();
    await waitForSyncComplete(pageB, syncPageB);

    await expect(pageB.locator('task')).toHaveCount(2);
    await expect(pageB.locator('task').first()).toContainText(taskName2);

    // --- Deletion Sync (A -> B) ---
    console.log('Testing Deletion Sync...');
    // Delete first task on Client A
    await pageA.locator('task').first().click({ button: 'right' });
    await pageA.locator('.mat-mdc-menu-content button.color-warn').click();

    // Handle the confirmation dialog (isConfirmBeforeTaskDelete defaults to true)
    const confirmBtn = pageA.locator('[e2e="confirmBtn"]');
    await confirmBtn.waitFor({ state: 'visible', timeout: 5000 });
    await confirmBtn.click();

    // Wait for deletion to be reflected in UI
    await expect(pageA.locator('task')).toHaveCount(1, { timeout: 10000 }); // Should be 1 left

    // Wait for state persistence before syncing
    await waitForStatePersistence(pageA);
    // Extra wait to ensure deletion is fully persisted
    await pageA.waitForTimeout(1000);

    await syncPageA.triggerSync();
    await waitForSyncComplete(pageA, syncPageA);

    // Retry sync on B up to 3 times to handle eventual consistency
    let taskCountOnB = 2;
    for (let attempt = 1; attempt <= 3 && taskCountOnB !== 1; attempt++) {
      console.log(`Deletion sync attempt ${attempt} on Client B...`);

      // Wait before syncing
      await pageB.waitForTimeout(500);

      await syncPageB.triggerSync();
      await waitForSyncComplete(pageB, syncPageB);

      // Wait for sync state to persist
      await waitForStatePersistence(pageB);
      await pageB.waitForTimeout(500);

      // Reload to ensure UI reflects synced state
      await pageB.reload();
      await waitForAppReady(pageB);
      await dismissTourIfVisible(pageB);
      await workViewPageB.waitForTaskList();

      taskCountOnB = await pageB.locator('task').count();
      console.log(`After attempt ${attempt}: ${taskCountOnB} tasks on Client B`);
    }

    await expect(pageB.locator('task')).toHaveCount(1, { timeout: 5000 });

    // --- Conflict Resolution ---
    console.log('Testing Conflict Resolution...');
    // Create new task "Conflict Task" on A
    await workViewPageA.addTask('Conflict Task');
    await syncPageA.triggerSync();
    await waitForSyncComplete(pageA, syncPageA);

    await syncPageB.triggerSync();
    await waitForSyncComplete(pageB, syncPageB);

    // Edit on A: "Conflict Task A"
    const taskA = pageA.locator('task', { hasText: 'Conflict Task' }).first();
    await taskA.click(); // Select
    const titleA = taskA.locator('.task-title');
    await titleA.click();
    await titleA.locator('input, textarea').fill('Conflict Task A');
    await pageA.keyboard.press('Enter');

    // Wait for state persistence and ensure timestamps differ between edits
    await waitForStatePersistence(pageA);

    // Edit on B: "Conflict Task B"
    const taskB = pageB.locator('task', { hasText: 'Conflict Task' }).first();
    await taskB.click();
    const titleB = taskB.locator('.task-title');
    await titleB.click();
    await titleB.locator('input, textarea').fill('Conflict Task B');
    await pageB.keyboard.press('Enter');

    // Sync A (Uploads "A")
    await syncPageA.triggerSync();
    await waitForSyncComplete(pageA, syncPageA);

    // Sync B (Downloads "A" but has "B") -> Conflict
    await syncPageB.triggerSync();
    const result = await waitForSyncComplete(pageB, syncPageB);

    if (result === 'success') {
      console.log(
        'Warning: No conflict detected (Auto-merged or overwrite). Checking content...',
      );
      const isA = await pageB.locator('task', { hasText: 'Conflict Task A' }).isVisible();
      const isB = await pageB.locator('task', { hasText: 'Conflict Task B' }).isVisible();
      console.log(`Content on B: A=${isA}, B=${isB}`);
      // If it was merged/overwritten, we skip the resolution steps
    } else {
      expect(result).toBe('conflict');

      // Resolve conflict: Use Remote (A)
      console.log('Resolving conflict with Remote...');
      await pageB.locator('dialog-sync-conflict button', { hasText: /Remote/i }).click();

      // Handle potential confirmation dialog
      const confirmDialog = pageB.locator('dialog-confirm');
      try {
        await confirmDialog.waitFor({ state: 'visible', timeout: 3000 });
        await confirmDialog.locator('button[color="warn"]').click();
      } catch {
        // Confirmation might not appear
      }

      await waitForSyncComplete(pageB, syncPageB);

      await expect(pageB.locator('task', { hasText: 'Conflict Task A' })).toBeVisible();
      await expect(
        pageB.locator('task', { hasText: 'Conflict Task B' }),
      ).not.toBeVisible();
    }

    // Cleanup
    await contextA.close();
    await contextB.close();
  });
});

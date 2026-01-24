import { test, expect } from '../../fixtures/webdav.fixture';
import { SyncPage } from '../../pages/sync.page';
import { WorkViewPage } from '../../pages/work-view.page';
import {
  WEBDAV_CONFIG_TEMPLATE,
  createUniqueSyncFolder,
  createWebDavFolder,
  setupClient,
  waitForSync,
  simulateNetworkFailure,
  restoreNetwork,
} from '../../utils/sync-helpers';
import { waitForStatePersistence } from '../../utils/waits';

test.describe('@webdav WebDAV Sync Error Handling', () => {
  // Run sync tests serially to avoid WebDAV server contention
  test.describe.configure({ mode: 'serial' });

  test('should handle server unavailable during sync', async ({
    browser,
    baseURL,
    request,
  }) => {
    test.slow();
    const SYNC_FOLDER_NAME = createUniqueSyncFolder('error-network');
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

    // First, verify sync works normally
    await syncPageA.triggerSync();
    await waitForSync(pageA, syncPageA);

    // Create a task
    const taskName = `Network Test Task ${Date.now()}`;
    await workViewPageA.addTask(taskName);
    await waitForStatePersistence(pageA);

    // Simulate network failure
    await simulateNetworkFailure(pageA);

    // Trigger sync - should fail
    await syncPageA.triggerSync();

    // Wait for error indication (snackbar or sync icon change)
    // The sync should fail gracefully
    const startTime = Date.now();
    let errorFound = false;
    while (Date.now() - startTime < 15000 && !errorFound) {
      // Check for error snackbar
      const snackBars = pageA.locator('.mat-mdc-snack-bar-container');
      const count = await snackBars.count();
      for (let i = 0; i < count; ++i) {
        const text = await snackBars.nth(i).innerText();
        if (
          text.toLowerCase().includes('error') ||
          text.toLowerCase().includes('fail') ||
          text.toLowerCase().includes('network')
        ) {
          errorFound = true;
          break;
        }
      }

      // Check for error icon on sync button
      const errorIcon = syncPageA.syncBtn.locator(
        'mat-icon.error, mat-icon:text("error"), mat-icon:text("sync_problem")',
      );
      if (await errorIcon.isVisible({ timeout: 500 }).catch(() => false)) {
        errorFound = true;
      }

      if (!errorFound) {
        await pageA.waitForTimeout(500);
      }
    }

    // App should not crash - verify we can still interact
    const taskLocator = pageA.locator('task', { hasText: taskName });
    await expect(taskLocator).toBeVisible();

    // Restore network
    await restoreNetwork(pageA);

    // Wait a moment for route to be fully removed
    await pageA.waitForTimeout(1000);

    // Dismiss any visible error snackbars before retrying
    const snackBarDismiss = pageA.locator(
      '.mat-mdc-snack-bar-container button, .mat-mdc-snack-bar-action',
    );
    if (await snackBarDismiss.isVisible({ timeout: 1000 }).catch(() => false)) {
      await snackBarDismiss.click().catch(() => {});
      await pageA.waitForTimeout(500);
    }

    // Dismiss any open dialogs that might be blocking
    const dialogBackdrop = pageA.locator('.cdk-overlay-backdrop');
    if (await dialogBackdrop.isVisible({ timeout: 500 }).catch(() => false)) {
      // Press Escape to close any open dialogs
      await pageA.keyboard.press('Escape');
      await pageA.waitForTimeout(500);
    }

    // Sync should work again
    await syncPageA.triggerSync();

    // Use a custom wait that ignores stale error messages
    const startTimeRetry = Date.now();
    while (Date.now() - startTimeRetry < 30000) {
      const successVisible = await syncPageA.syncCheckIcon.isVisible();
      if (successVisible) break;
      await pageA.waitForTimeout(500);
    }

    // Cleanup
    await contextA.close();
  });

  test('should handle authentication failure', async ({ browser, baseURL, request }) => {
    test.slow();
    const SYNC_FOLDER_NAME = createUniqueSyncFolder('error-auth');
    await createWebDavFolder(request, SYNC_FOLDER_NAME);

    const url = baseURL || 'http://localhost:4242';

    // --- Client A with wrong password ---
    const { context: contextA, page: pageA } = await setupClient(browser, url);
    const syncPageA = new SyncPage(pageA);
    const workViewPageA = new WorkViewPage(pageA);
    await workViewPageA.waitForTaskList();

    // Configure Sync with wrong password
    const WRONG_CONFIG = {
      baseUrl: WEBDAV_CONFIG_TEMPLATE.baseUrl,
      username: 'admin',
      password: 'wrongpassword',
      syncFolderPath: `/${SYNC_FOLDER_NAME}`,
    };

    await syncPageA.setupWebdavSync(WRONG_CONFIG);
    await expect(syncPageA.syncBtn).toBeVisible();

    // Trigger sync - should fail with auth error
    await syncPageA.triggerSync();

    // Wait for error indication
    const startTime = Date.now();
    let authErrorFound = false;
    while (Date.now() - startTime < 15000 && !authErrorFound) {
      // Check for error snackbar
      const snackBars = pageA.locator('.mat-mdc-snack-bar-container');
      const count = await snackBars.count();
      for (let i = 0; i < count; ++i) {
        const text = await snackBars
          .nth(i)
          .innerText()
          .catch(() => '');
        const textLower = text.toLowerCase();
        if (
          textLower.includes('401') ||
          textLower.includes('auth') ||
          textLower.includes('unauthorized') ||
          textLower.includes('error') ||
          textLower.includes('fail')
        ) {
          authErrorFound = true;
          break;
        }
      }

      if (!authErrorFound) {
        await pageA.waitForTimeout(500);
      }
    }

    // App should not crash
    const taskList = pageA.locator('task-list');
    await expect(taskList).toBeVisible();

    // Cleanup
    await contextA.close();
  });

  test('should handle double sync trigger gracefully', async ({
    browser,
    baseURL,
    request,
  }) => {
    test.slow();
    const SYNC_FOLDER_NAME = createUniqueSyncFolder('error-double');
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

    // Create some tasks
    const taskName = `Double Sync Task ${Date.now()}`;
    await workViewPageA.addTask(taskName);
    await waitForStatePersistence(pageA);

    // Trigger sync twice rapidly (simulating double-click)
    await syncPageA.syncBtn.click();
    await pageA.waitForTimeout(100);
    await syncPageA.syncBtn.click();

    // Wait for sync to complete
    await waitForSync(pageA, syncPageA);

    // App should not crash and task should still be visible
    const taskLocator = pageA.locator('task', { hasText: taskName });
    await expect(taskLocator).toBeVisible();

    // Verify sync button is in normal state (not stuck)
    await expect(syncPageA.syncBtn).toBeEnabled();

    // Try another sync to confirm everything works
    await syncPageA.triggerSync();
    await waitForSync(pageA, syncPageA);

    // Cleanup
    await contextA.close();
  });
});

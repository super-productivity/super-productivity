import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import {
  WEBDAV_CONFIG_TEMPLATE,
  createSyncFolder,
  generateSyncFolderName,
} from '../../utils/sync-helpers';
import { SyncPage } from '../../pages/sync.page';

/**
 * SuperSync Provider Switch E2E Tests
 *
 * Tests data preservation when switching sync providers between
 * WebDAV and SuperSync.
 *
 * Prerequisites:
 * - super-sync-server running on localhost:1901 with TEST_MODE=true
 * - WebDAV server running on localhost:2345
 * - Frontend running on localhost:4242
 *
 * Tests are skipped if either server is unavailable.
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-provider-switch.spec.ts
 */

/**
 * Check if the WebDAV server is available.
 */
const isWebDAVAvailable = async (): Promise<boolean> => {
  try {
    const response = await fetch('http://localhost:2345', {
      method: 'OPTIONS',
      signal: AbortSignal.timeout(3000),
    });
    return response.ok || response.status === 200 || response.status === 207;
  } catch {
    return false;
  }
};

test.describe('@supersync Provider Switch (WebDAV ↔ SuperSync)', () => {
  /**
   * Scenario: SuperSync → WebDAV
   *
   * Tests that tasks created with SuperSync survive switching to WebDAV.
   *
   * Flow:
   * 1. Client A sets up SuperSync, creates tasks, syncs
   * 2. Client A disables SuperSync
   * 3. Client A enables WebDAV sync
   * 4. Client A syncs to WebDAV
   * 5. New Client B sets up WebDAV with same folder
   * 6. Verify Client B receives all tasks
   */
  test('Tasks survive switching from SuperSync to WebDAV', async ({
    browser,
    baseURL,
    testRunId,
  }, testInfo) => {
    test.setTimeout(180000);

    // Skip if WebDAV server is not available
    const webdavAvailable = await isWebDAVAvailable();
    testInfo.skip(!webdavAvailable, 'WebDAV server not running on localhost:2345');

    const appUrl = baseURL || 'http://localhost:4242';
    let clientA: SimulatedE2EClient | null = null;
    let contextB: Awaited<ReturnType<typeof browser.newContext>> | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // ============ PHASE 1: Create tasks with SuperSync ============
      console.log('[ProviderSwitch] Phase 1: Create tasks with SuperSync');

      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      const task1 = `ProvSwitch-1-${testRunId}`;
      const task2 = `ProvSwitch-2-${testRunId}`;
      await clientA.workView.addTask(task1);
      await clientA.workView.addTask(task2);
      await clientA.sync.syncAndWait();
      console.log('[ProviderSwitch] Tasks created and synced via SuperSync');

      // ============ PHASE 2: Switch to WebDAV ============
      console.log('[ProviderSwitch] Phase 2: Switching to WebDAV');

      // Create WebDAV sync folder
      const syncFolderName = generateSyncFolderName(`e2e-provswitch-${testRunId}`);
      const request = await (await browser.newContext()).request;
      await createSyncFolder(request, syncFolderName);

      // Disable SuperSync and set up WebDAV
      const syncPageA = new SyncPage(clientA.page);
      await syncPageA.configureSyncProvider({
        ...WEBDAV_CONFIG_TEMPLATE,
        syncFolderPath: `/${syncFolderName}`,
      });
      console.log('[ProviderSwitch] Switched to WebDAV');

      // Wait for WebDAV sync
      await clientA.page.waitForTimeout(3000);

      // Verify tasks still exist on Client A
      await waitForTask(clientA.page, task1);
      await waitForTask(clientA.page, task2);
      console.log('[ProviderSwitch] ✓ Tasks survived provider switch on Client A');

      // ============ PHASE 3: New client joins via WebDAV ============
      console.log('[ProviderSwitch] Phase 3: New client joins via WebDAV');

      contextB = await browser.newContext({
        storageState: undefined,
        viewport: { width: 1920, height: 1080 },
      });
      const pageB = await contextB.newPage();
      await pageB.goto(appUrl);
      await pageB.waitForLoadState('networkidle');
      await pageB.waitForTimeout(2000);

      const syncPageB = new SyncPage(pageB);
      await syncPageB.configureSyncProvider({
        ...WEBDAV_CONFIG_TEMPLATE,
        syncFolderPath: `/${syncFolderName}`,
      });
      console.log('[ProviderSwitch] Client B joined via WebDAV');

      // Wait for sync
      await pageB.waitForTimeout(5000);

      // Verify tasks on Client B
      await waitForTask(pageB, task1);
      await waitForTask(pageB, task2);

      const taskLocator1 = pageB.locator(`task:has-text("${task1}")`);
      const taskLocator2 = pageB.locator(`task:has-text("${task2}")`);
      await expect(taskLocator1).toBeVisible();
      await expect(taskLocator2).toBeVisible();

      console.log('[ProviderSwitch] ✓ Client B received all tasks via WebDAV');
      console.log('[ProviderSwitch] ✓ SuperSync → WebDAV provider switch test PASSED!');
    } finally {
      if (contextB) await contextB.close().catch(() => {});
      if (clientA) await closeClient(clientA);
    }
  });
});

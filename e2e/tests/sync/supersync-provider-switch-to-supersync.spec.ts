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
  setupSyncClient,
  waitForSyncComplete,
  closeContextsSafely,
} from '../../utils/sync-helpers';
import { SyncPage } from '../../pages/sync.page';
import { SuperSyncPage } from '../../pages/supersync.page';
import { WorkViewPage } from '../../pages/work-view.page';
import { waitForStatePersistence } from '../../utils/waits';

/**
 * SuperSync Provider Switch (WebDAV → SuperSync) E2E Tests
 *
 * Scenario I.7: Switching from WebDAV to SuperSync migrates data via SYNC_IMPORT
 *
 * When a client that has been syncing to WebDAV switches to SuperSync,
 * the server migration logic detects the empty SuperSync server and the
 * client's existing synced ops, creating a SYNC_IMPORT to migrate data.
 * Another client joining the SuperSync account should receive all tasks.
 *
 * Prerequisites:
 * - super-sync-server running on localhost:1901 with TEST_MODE=true
 * - WebDAV server running on localhost:2345
 * - Frontend running on localhost:4242
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-provider-switch-to-supersync.spec.ts
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

test.describe('@supersync Provider Switch WebDAV to SuperSync', () => {
  /**
   * Scenario I.7: Switching from WebDAV to SuperSync migrates data via SYNC_IMPORT
   *
   * Actions:
   * 1. Client A sets up WebDAV sync, creates tasks, syncs to WebDAV
   * 2. Client A switches to SuperSync (new empty server) on the same page
   * 3. Server migration detects empty server + client has synced ops
   *
   * Verify:
   * - Tasks are preserved after provider switch
   * - Client B joining SuperSync receives all tasks
   */
  test('Switching from WebDAV to SuperSync migrates data via SYNC_IMPORT', async ({
    browser,
    baseURL,
    testRunId,
  }, testInfo) => {
    test.setTimeout(180000);

    // Skip if WebDAV server is not available
    const webdavAvailable = await isWebDAVAvailable();
    testInfo.skip(!webdavAvailable, 'WebDAV server not running on localhost:2345');

    const appUrl = baseURL || 'http://localhost:4242';
    let contextA: Awaited<ReturnType<typeof browser.newContext>> | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // Create WebDAV sync folder
      const syncFolderName = generateSyncFolderName(`e2e-to-supersync-${testRunId}`);
      const webdavRequestContext = await browser.newContext();
      try {
        await createSyncFolder(webdavRequestContext.request, syncFolderName);
      } finally {
        await webdavRequestContext.close();
      }

      const webdavConfig = {
        ...WEBDAV_CONFIG_TEMPLATE,
        syncFolderPath: `/${syncFolderName}`,
      };

      // ============ PHASE 1: Set up WebDAV and create tasks ============
      console.log('[I.7] Phase 1: Set up WebDAV sync and create tasks');

      // Use setupSyncClient which auto-accepts confirm dialogs
      const { context, page: pageA } = await setupSyncClient(browser, appUrl);
      contextA = context;
      const syncPageA = new SyncPage(pageA);
      const workViewPageA = new WorkViewPage(pageA);

      await workViewPageA.waitForTaskList();
      await syncPageA.setupWebdavSync(webdavConfig);
      await expect(syncPageA.syncBtn).toBeVisible();
      console.log('[I.7] Client A: WebDAV sync configured');

      // Create tasks
      const task1 = `WebDAV-To-SS-1-${testRunId}`;
      const task2 = `WebDAV-To-SS-2-${testRunId}`;
      await workViewPageA.addTask(task1);
      await workViewPageA.addTask(task2);
      await expect(pageA.locator('task')).toHaveCount(2);
      console.log(`[I.7] Client A: Created tasks: ${task1}, ${task2}`);

      // Sync to WebDAV
      await waitForStatePersistence(pageA);
      await syncPageA.triggerSync();
      await waitForSyncComplete(pageA, syncPageA);
      console.log('[I.7] Client A: Synced to WebDAV');

      // ============ PHASE 2: Switch to SuperSync on the same page ============
      console.log('[I.7] Phase 2: Switching to SuperSync (same browser context)');

      // Use SuperSyncPage on the SAME page to switch providers
      // setupSuperSync right-clicks the sync button to open settings,
      // which works even when another provider is already configured
      const superSyncPageA = new SuperSyncPage(pageA);
      await superSyncPageA.setupSuperSync({
        ...syncConfig,
        isEncryptionEnabled: true,
        password: 'test-password-123',
      });
      console.log('[I.7] Client A: Switched to SuperSync with encryption');

      // Sync to upload all data to SuperSync
      await superSyncPageA.syncAndWait();
      console.log('[I.7] Client A: Synced to SuperSync');

      // Verify tasks still exist after the switch
      await expect(pageA.locator('task', { hasText: task1 })).toBeVisible({
        timeout: 10000,
      });
      await expect(pageA.locator('task', { hasText: task2 })).toBeVisible({
        timeout: 10000,
      });
      console.log('[I.7] Client A: Tasks preserved after switch to SuperSync');

      // ============ PHASE 3: Client B joins SuperSync ============
      console.log('[I.7] Phase 3: Client B joins SuperSync');

      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.sync.setupSuperSync({
        ...syncConfig,
        isEncryptionEnabled: true,
        password: 'test-password-123',
      });
      await clientB.sync.syncAndWait();

      // Verify Client B received the tasks
      await waitForTask(clientB.page, task1);
      await waitForTask(clientB.page, task2);
      console.log('[I.7] Client B: Received tasks from SuperSync');

      // No errors on either client
      const hasErrorA = await superSyncPageA.hasSyncError();
      const hasErrorB = await clientB.sync.hasSyncError();
      expect(hasErrorA).toBe(false);
      expect(hasErrorB).toBe(false);

      console.log(
        '[I.7] ✓ WebDAV → SuperSync provider switch migrated data successfully',
      );
    } finally {
      if (contextA) await closeContextsSafely(contextA);
      if (clientB) await closeClient(clientB);
    }
  });
});

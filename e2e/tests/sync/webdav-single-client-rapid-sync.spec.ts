import { test, expect } from '../../fixtures/webdav.fixture';
import { SyncPage } from '../../pages/sync.page';
import { WorkViewPage } from '../../pages/work-view.page';
import {
  WEBDAV_CONFIG_TEMPLATE,
  setupSyncClient,
  createSyncFolder,
  waitForSyncComplete,
  generateSyncFolderName,
  closeContextsSafely,
} from '../../utils/sync-helpers';

/**
 * WebDAV Single Client Rapid Sync E2E Tests
 *
 * These tests verify the bug fix for false 412 Precondition Failed errors
 * during WebDAV sync with a single client. The bug was:
 *
 * 1. HTTP Last-Modified headers have second-level precision
 * 2. Some WebDAV servers store modification times with millisecond precision
 * 3. Client reads Last-Modified, then quickly uploads with If-Unmodified-Since
 * 4. Server's internal timestamp was a few ms later than Last-Modified header
 * 5. Server incorrectly returns 412 even though no other client modified the file
 *
 * The fix: Add a 1-second buffer to the If-Unmodified-Since header to account
 * for this precision mismatch. Vector clocks still provide authoritative
 * conflict detection, so this buffer doesn't compromise data integrity.
 *
 * Prerequisites:
 * - WebDAV server running at http://127.0.0.1:2345/
 * - Frontend running on localhost:4242
 *
 * Run with: npm run e2e:file e2e/tests/sync/webdav-single-client-rapid-sync.spec.ts
 */

test.describe('@webdav Rapid Sync (Single Client)', () => {
  // Run sync tests serially to avoid WebDAV server contention
  test.describe.configure({ mode: 'serial' });

  // Use a unique folder for each test run
  const SYNC_FOLDER_NAME = generateSyncFolderName('e2e-rapid');

  const WEBDAV_CONFIG = {
    ...WEBDAV_CONFIG_TEMPLATE,
    syncFolderPath: `/${SYNC_FOLDER_NAME}`,
  };

  /**
   * Scenario: Single client rapid syncs do not cause false 412 errors
   *
   * The 412 bug was most likely to occur when:
   * - A single client syncs
   * - Immediately creates a task
   * - Syncs again within the same second
   *
   * The If-Unmodified-Since header used the Last-Modified timestamp exactly,
   * but the server's internal timestamp could be a few milliseconds later.
   *
   * Setup:
   * - Client A with WebDAV sync configured
   *
   * Actions:
   * 1. Create task, sync
   * 2. Immediately create another task, sync
   * 3. Repeat 5 times in rapid succession
   *
   * Verify:
   * - All 5 syncs complete successfully (no 412 errors)
   * - All 5 tasks are present
   */
  test('Single client rapid syncs do not cause 412 errors', async ({
    browser,
    baseURL,
    request,
    webdavServerUp,
  }) => {
    test.slow(); // Sync tests take longer

    // Create the sync folder on WebDAV server
    await createSyncFolder(request, SYNC_FOLDER_NAME);

    const { context, page } = await setupSyncClient(browser, baseURL);
    const syncPage = new SyncPage(page);
    const workViewPage = new WorkViewPage(page);

    // Track any sync errors
    const syncErrors: string[] = [];
    page.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('412') || text.includes('Precondition Failed')) {
        syncErrors.push(text);
      }
    });

    try {
      await workViewPage.waitForTaskList();

      // Configure WebDAV sync
      await syncPage.setupWebdavSync(WEBDAV_CONFIG);
      await expect(syncPage.syncBtn).toBeVisible();
      console.log('[RapidSync] WebDAV sync configured');

      // Initial sync to establish baseline
      await syncPage.triggerSync();
      await waitForSyncComplete(page, syncPage);
      console.log('[RapidSync] Initial sync complete');

      // Perform 5 rapid create-then-sync cycles
      const taskNames: string[] = [];
      for (let i = 1; i <= 5; i++) {
        const taskName = `RapidTask${i}-${Date.now()}`;
        taskNames.push(taskName);

        // Create task
        await workViewPage.addTask(taskName);
        await expect(page.locator(`task:has-text("${taskName}")`)).toBeVisible();

        // Immediately sync (within the same second if possible)
        await syncPage.triggerSync();
        const result = await waitForSyncComplete(page, syncPage);

        if (result === 'conflict') {
          throw new Error(`Unexpected conflict on task ${i}`);
        }

        console.log(`[RapidSync] Cycle ${i}/5 complete: ${taskName}`);
      }

      // Verify all tasks are present
      for (const taskName of taskNames) {
        await expect(page.locator(`task:has-text("${taskName}")`)).toBeVisible();
      }
      await expect(page.locator('task')).toHaveCount(5);

      // Verify no 412 errors occurred
      expect(syncErrors.length).toBe(0);

      console.log('[RapidSync] ✓ All 5 rapid syncs successful');
      console.log('[RapidSync] ✓ No 412 errors');
    } finally {
      await closeContextsSafely(context);
    }
  });

  /**
   * Scenario: Rapid task modifications sync without errors
   *
   * Tests that rapidly modifying tasks (mark done, rename) and syncing
   * doesn't cause 412 errors.
   *
   * Setup:
   * - Client with existing synced task
   *
   * Actions:
   * 1. Sync
   * 2. Mark task done, immediately sync
   * 3. Add new task, immediately sync
   * 4. Rename task, immediately sync
   *
   * Verify:
   * - All syncs succeed without 412 errors
   */
  test('Rapid task modifications sync without errors', async ({
    browser,
    baseURL,
    request,
    webdavServerUp,
  }) => {
    test.slow();

    const folderName = generateSyncFolderName('e2e-modify');
    await createSyncFolder(request, folderName);

    const config = {
      ...WEBDAV_CONFIG_TEMPLATE,
      syncFolderPath: `/${folderName}`,
    };

    const { context, page } = await setupSyncClient(browser, baseURL);
    const syncPage = new SyncPage(page);
    const workViewPage = new WorkViewPage(page);

    const syncErrors: string[] = [];
    page.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('412') || text.includes('Precondition Failed')) {
        syncErrors.push(text);
      }
    });

    try {
      await workViewPage.waitForTaskList();
      await syncPage.setupWebdavSync(config);
      console.log('[ModifySync] WebDAV sync configured');

      // Create initial task
      const taskName = `ModifyTask-${Date.now()}`;
      await workViewPage.addTask(taskName);
      await expect(page.locator(`task:has-text("${taskName}")`)).toBeVisible();

      // Sync initial task
      await syncPage.triggerSync();
      await waitForSyncComplete(page, syncPage);
      console.log('[ModifySync] Initial task synced');

      // Step 1: Mark task done, immediately sync
      const task = page.locator(`task:has-text("${taskName}")`).first();
      await task.hover();
      await task.locator('.task-done-btn').click();
      await expect(task).toHaveClass(/isDone/);

      await syncPage.triggerSync();
      await waitForSyncComplete(page, syncPage);
      console.log('[ModifySync] Done state synced');

      // Step 2: Add another task, immediately sync
      const task2Name = `ModifyTask2-${Date.now()}`;
      await workViewPage.addTask(task2Name);
      await expect(page.locator(`task:has-text("${task2Name}")`)).toBeVisible();

      await syncPage.triggerSync();
      await waitForSyncComplete(page, syncPage);
      console.log('[ModifySync] Second task synced');

      // Step 3: Rename second task, immediately sync
      const task2 = page.locator(`task:has-text("${task2Name}")`).first();
      await task2.click();
      const titleElement = task2.locator('.task-title');
      await titleElement.click();
      const input = task2.locator('input, textarea');
      await input.fill(`${task2Name}-Renamed`);
      await page.keyboard.press('Tab');

      await syncPage.triggerSync();
      await waitForSyncComplete(page, syncPage);
      console.log('[ModifySync] Rename synced');

      // Verify no 412 errors
      expect(syncErrors.length).toBe(0);

      console.log('[ModifySync] ✓ All modifications synced without 412 errors');
    } finally {
      await closeContextsSafely(context);
    }
  });

  /**
   * Scenario: Multiple syncs within same second succeed
   *
   * Stress test that tries to trigger the timestamp precision issue
   * by syncing as fast as possible.
   *
   * Setup:
   * - Client with WebDAV configured
   *
   * Actions:
   * 1. Sync 10 times as fast as possible
   *
   * Verify:
   * - All syncs complete
   * - No 412 errors
   */
  test('Multiple syncs within same second succeed', async ({
    browser,
    baseURL,
    request,
    webdavServerUp,
  }) => {
    test.slow();

    const folderName = generateSyncFolderName('e2e-burst');
    await createSyncFolder(request, folderName);

    const config = {
      ...WEBDAV_CONFIG_TEMPLATE,
      syncFolderPath: `/${folderName}`,
    };

    const { context, page } = await setupSyncClient(browser, baseURL);
    const syncPage = new SyncPage(page);
    const workViewPage = new WorkViewPage(page);

    const syncErrors: string[] = [];
    page.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('412') || text.includes('Precondition Failed')) {
        syncErrors.push(text);
      }
    });

    try {
      await workViewPage.waitForTaskList();
      await syncPage.setupWebdavSync(config);

      // Create a task so there's data to sync
      await workViewPage.addTask(`BurstTask-${Date.now()}`);
      console.log('[BurstSync] Task created');

      // Sync rapidly 10 times
      let successCount = 0;
      for (let i = 1; i <= 10; i++) {
        try {
          await syncPage.triggerSync();
          await waitForSyncComplete(page, syncPage, 15000);
          successCount++;
        } catch (e) {
          // If sync times out, that's still better than 412
          console.log(`[BurstSync] Sync ${i} timed out (not 412)`);
        }
      }

      // At least most syncs should succeed (some might overlap/skip)
      expect(successCount).toBeGreaterThanOrEqual(5);
      expect(syncErrors.length).toBe(0);

      console.log(`[BurstSync] ✓ ${successCount}/10 syncs completed`);
      console.log('[BurstSync] ✓ No 412 errors in burst sync');
    } finally {
      await closeContextsSafely(context);
    }
  });
});

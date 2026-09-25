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
 * These tests verify that serialized create/change-and-sync cycles from a
 * single client complete without errors and reach a second client. They do
 * not force operations into the same externally visible WebDAV revision;
 * deterministic same-revision coverage is tracked in #9147.
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
   * Scenario: Single client rapid syncs complete without errors
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
   * - All 5 syncs complete successfully
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

    const { context: contextA, page } = await setupSyncClient(browser, baseURL);
    let contextB: Awaited<ReturnType<typeof setupSyncClient>>['context'] | null = null;
    const syncPage = new SyncPage(page);
    const workViewPage = new WorkViewPage(page);

    // Track any sync errors — use specific patterns to avoid false positives
    // from unrelated console output that happens to contain "412" (e.g. body sizes)
    const syncErrors: string[] = [];
    page.on('console', (msg) => {
      const text = msg.text();
      if (/HTTP 412|status[:\s]+412|Precondition Failed/i.test(text)) {
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

        // Start the next serialized sync immediately after local creation.
        await syncPage.triggerSync();
        const result = await waitForSyncComplete(page, syncPage);

        if (result === 'conflict') {
          throw new Error(`Unexpected conflict on task ${i}`);
        }

        console.log(`[RapidSync] Cycle ${i}/5 complete: ${taskName}`);
      }

      // Verify all tasks are present (allow extra time for Angular to settle after rapid syncing)
      for (const taskName of taskNames) {
        await expect(page.locator(`task:has-text("${taskName}")`)).toBeVisible({
          timeout: 10000,
        });
      }
      await expect(page.locator('task')).toHaveCount(5, { timeout: 10000 });

      // A second client is the durable oracle: local DOM state alone cannot prove
      // that any of the rapid sync cycles reached the remote file.
      const secondClient = await setupSyncClient(browser, baseURL);
      contextB = secondClient.context;
      const syncPageB = new SyncPage(secondClient.page);
      const workViewPageB = new WorkViewPage(secondClient.page);
      await workViewPageB.waitForTaskList();
      await syncPageB.setupWebdavSync(WEBDAV_CONFIG);
      await syncPageB.triggerSync();
      await waitForSyncComplete(secondClient.page, syncPageB);

      for (const taskName of taskNames) {
        await expect(
          secondClient.page.locator(`task:has-text("${taskName}")`),
        ).toBeVisible({ timeout: 10000 });
      }
      await expect(secondClient.page.locator('task')).toHaveCount(5, {
        timeout: 10000,
      });

      // Verify no 412 errors occurred
      expect(syncErrors.length).toBe(0);

      console.log('[RapidSync] ✓ All 5 rapid syncs successful');
      console.log('[RapidSync] ✓ No 412 errors');
    } finally {
      await closeContextsSafely(contextA, contextB);
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

    const { context: contextA, page } = await setupSyncClient(browser, baseURL);
    let contextB: Awaited<ReturnType<typeof setupSyncClient>>['context'] | null = null;
    const syncPage = new SyncPage(page);
    const workViewPage = new WorkViewPage(page);

    const syncErrors: string[] = [];
    page.on('console', (msg) => {
      const text = msg.text();
      if (/HTTP 412|status[:\s]+412|Precondition Failed/i.test(text)) {
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
      await task.locator('done-toggle').click();
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

      // Verify the remote result from a fresh client, including the two state
      // changes this scenario claims to exercise.
      const secondClient = await setupSyncClient(browser, baseURL);
      contextB = secondClient.context;
      const syncPageB = new SyncPage(secondClient.page);
      const workViewPageB = new WorkViewPage(secondClient.page);
      await workViewPageB.waitForTaskList();
      await syncPageB.setupWebdavSync(config);
      await syncPageB.triggerSync();
      await waitForSyncComplete(secondClient.page, syncPageB);

      const syncedDoneTask = secondClient.page
        .locator(`task:has-text("${taskName}")`)
        .first();
      await expect(syncedDoneTask).toHaveClass(/isDone/, { timeout: 10000 });
      await expect(
        secondClient.page.locator(`task:has-text("${task2Name}-Renamed")`),
      ).toBeVisible({ timeout: 10000 });
      await expect(
        secondClient.page.locator('task-title').getByText(task2Name, { exact: true }),
      ).toHaveCount(0);

      // Verify no 412 errors
      expect(syncErrors.length).toBe(0);

      console.log('[ModifySync] ✓ All modifications synced without 412 errors');
    } finally {
      await closeContextsSafely(contextA, contextB);
    }
  });
});

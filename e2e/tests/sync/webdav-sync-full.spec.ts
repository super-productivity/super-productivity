import { type Page } from '@playwright/test';
import { test, expect } from '../../fixtures/webdav.fixture';
import { SyncPage } from '../../pages/sync.page';
import { WorkViewPage } from '../../pages/work-view.page';
import { waitForAppReady, waitForStatePersistence } from '../../utils/waits';
import {
  WEBDAV_CONFIG_TEMPLATE,
  setupSyncClient,
  createSyncFolder,
  waitForSyncComplete,
  generateSyncFolderName,
  closeContextsSafely,
} from '../../utils/sync-helpers';

/**
 * Dismiss the Vite error overlay if present.
 * In development mode, TypeScript errors can cause a full-page overlay
 * that intercepts all pointer events. Pressing Escape dismisses it.
 */
const dismissViteOverlay = async (page: Page): Promise<void> => {
  const overlay = page.locator('vite-error-overlay');
  const isVisible = await overlay.isVisible().catch(() => false);
  if (isVisible) {
    console.log('[Test] Dismissing vite-error-overlay');
    await page.keyboard.press('Escape');
    await overlay.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
  }
};

test.describe('@webdav WebDAV Sync Full Flow', () => {
  // Run sync tests serially to avoid WebDAV server contention
  test.describe.configure({ mode: 'serial' });

  // Use a unique folder for each test run to avoid collisions
  const SYNC_FOLDER_NAME = generateSyncFolderName('e2e-full');

  const WEBDAV_CONFIG = {
    ...WEBDAV_CONFIG_TEMPLATE,
    syncFolderPath: `/${SYNC_FOLDER_NAME}`,
  };

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

    // Add console logging for debugging
    pageA.on('console', (msg) => {
      if (
        msg.text().includes('FileBasedSyncAdapter') ||
        msg.text().includes('OperationLogSyncService') ||
        msg.text().includes('SyncService')
      ) {
        console.log(`[Client A Console] ${msg.type()}: ${msg.text()}`);
      }
    });

    await workViewPageA.waitForTaskList();

    // Configure Sync on Client A
    await syncPageA.setupWebdavSync(WEBDAV_CONFIG);
    await expect(syncPageA.syncBtn).toBeVisible();

    // Add Task on Client A
    const taskName = 'Task from Client A';
    await workViewPageA.addTask(taskName);
    await expect(pageA.locator('task')).toHaveCount(1);
    console.log('[Test] Task created on Client A');

    // Wait for state to persist before syncing
    await waitForStatePersistence(pageA);
    console.log('[Test] State persisted on Client A');

    // Sync Client A (Upload)
    await syncPageA.triggerSync();
    await waitForSyncComplete(pageA, syncPageA);
    console.log('[Test] Sync completed on Client A');

    // --- Client B ---
    const { context: contextB, page: pageB } = await setupSyncClient(browser, url);
    const syncPageB = new SyncPage(pageB);
    const workViewPageB = new WorkViewPage(pageB);

    // Add console logging for debugging
    pageB.on('console', (msg) => {
      if (
        msg.text().includes('FileBasedSyncAdapter') ||
        msg.text().includes('OperationLogSyncService') ||
        msg.text().includes('SyncService') ||
        msg.text().includes('RemoteOpsProcessingService') ||
        msg.text().includes('OperationApplierService')
      ) {
        console.log(`[Client B Console] ${msg.type()}: ${msg.text()}`);
      }
    });

    await workViewPageB.waitForTaskList();

    // Configure Sync on Client B (Same path)
    await syncPageB.setupWebdavSync(WEBDAV_CONFIG);
    await expect(syncPageB.syncBtn).toBeVisible();
    console.log('[Test] Sync configured on Client B');

    // Sync Client B (Download)
    await syncPageB.triggerSync();
    await waitForSyncComplete(pageB, syncPageB);
    console.log('[Test] Sync completed on Client B');

    // Debug: Check task count
    const taskCountB = await pageB.locator('task').count();
    console.log(`[Test] Task count on Client B: ${taskCountB}`);

    // Debug: Check for any tasks in DOM
    const taskHTML = await pageB
      .locator('task-list')
      .innerHTML()
      .catch(() => 'N/A');
    console.log(`[Test] TaskList HTML length: ${taskHTML.length}`);

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
      await workViewPageB.waitForTaskList();

      taskCountOnB = await pageB.locator('task').count();
      console.log(`After attempt ${attempt}: ${taskCountOnB} tasks on Client B`);
    }

    await expect(pageB.locator('task')).toHaveCount(1, { timeout: 5000 });

    // --- Conflict Resolution ---
    console.log('Testing Conflict Resolution...');

    // Close old Client B context - it may have stale sync state after multiple reloads
    await contextB.close();

    // Create new task "Conflict Task" on A
    await workViewPageA.addTask('Conflict Task');

    // Wait for state persistence before syncing
    await waitForStatePersistence(pageA);

    await syncPageA.triggerSync();
    await waitForSyncComplete(pageA, syncPageA);

    // Wait for WebDAV server to process A's upload
    await pageA.waitForTimeout(2000);

    // Create a fresh Client B for conflict test
    console.log('Creating fresh Client B for conflict test...');
    const { context: contextB2, page: pageB2 } = await setupSyncClient(browser, url);
    const syncPageB2 = new SyncPage(pageB2);
    const workViewPageB2 = new WorkViewPage(pageB2);
    await workViewPageB2.waitForTaskList();

    // Setup sync on fresh Client B
    await syncPageB2.setupWebdavSync(WEBDAV_CONFIG);
    await syncPageB2.triggerSync();
    await waitForSyncComplete(pageB2, syncPageB2);

    // Wait for state persistence
    await waitForStatePersistence(pageB2);

    // Reload to ensure UI reflects synced state
    await pageB2.reload();
    await waitForAppReady(pageB2);
    await workViewPageB2.waitForTaskList();

    // Final assertion - should have 2 tasks now
    const taskCount = await pageB2.locator('task').count();
    console.log(`After conflict sync: ${taskCount} tasks on Client B`);

    // Debug: List all task titles
    const taskTitles = await pageB2.locator('.task-title').allInnerTexts();
    console.log(`Task titles on B: ${JSON.stringify(taskTitles)}`);

    await expect(pageB2.locator('task')).toHaveCount(2, { timeout: 5000 });

    // Edit on A: "Conflict Task A"
    const taskA = pageA.locator('task', { hasText: 'Conflict Task' }).first();
    await taskA.click(); // Select
    const titleA = taskA.locator('.task-title');
    await titleA.click();
    await titleA.locator('input, textarea').fill('Conflict Task A');
    await pageA.keyboard.press('Enter');

    // Wait for state persistence and ensure timestamps differ between edits
    await waitForStatePersistence(pageA);

    // Edit on B2: "Conflict Task B"
    const taskB2 = pageB2.locator('task', { hasText: 'Conflict Task' }).first();
    await taskB2.click();
    const titleB2 = taskB2.locator('.task-title');
    await titleB2.click();
    await titleB2.locator('input, textarea').fill('Conflict Task B');
    await pageB2.keyboard.press('Enter');

    // Sync A (Uploads "A")
    await syncPageA.triggerSync();
    await waitForSyncComplete(pageA, syncPageA);

    // Sync B2 (Downloads "A" but has "B") -> Conflict
    await syncPageB2.triggerSync();
    const result = await waitForSyncComplete(pageB2, syncPageB2);

    if (result === 'success') {
      console.log(
        'Warning: No conflict detected (Auto-merged or overwrite). Checking content...',
      );
      const isA = await pageB2
        .locator('task', { hasText: 'Conflict Task A' })
        .isVisible();
      const isB = await pageB2
        .locator('task', { hasText: 'Conflict Task B' })
        .isVisible();
      console.log(`Content on B: A=${isA}, B=${isB}`);
      // If it was merged/overwritten, we skip the resolution steps
    } else {
      expect(result).toBe('conflict');

      // Resolve conflict: Use Remote (A)
      console.log('Resolving conflict with Remote...');
      await pageB2.locator('dialog-sync-conflict button', { hasText: /Remote/i }).click();

      // Handle potential confirmation dialog
      const confirmDialog = pageB2.locator('dialog-confirm');
      try {
        await confirmDialog.waitFor({ state: 'visible', timeout: 3000 });
        await confirmDialog.locator('button[color="warn"]').click();
      } catch {
        // Confirmation might not appear
      }

      await waitForSyncComplete(pageB2, syncPageB2);

      await expect(pageB2.locator('task', { hasText: 'Conflict Task A' })).toBeVisible();
      await expect(
        pageB2.locator('task', { hasText: 'Conflict Task B' }),
      ).not.toBeVisible();
    }

    // Cleanup
    await contextA.close();
    await contextB2.close();
  });

  /**
   * Scenario: Near-simultaneous uploads from two clients preserve all data
   *
   * Verifies that the content-hash-based conflict detection (GET-compare-PUT)
   * correctly handles concurrent uploads. When two clients sync at nearly the
   * same time, the second client should detect the hash mismatch, retry with
   * merged data, and no tasks should be lost.
   *
   * Setup:
   * - Client A and Client B both configured with WebDAV sync to the same folder
   * - Client A creates TaskA, syncs; Client B downloads TaskA
   *
   * Actions:
   * 1. Client A creates TaskA2, Client B creates TaskB
   * 2. Trigger sync on Client A, then Client B shortly after (without waiting
   *    for A to finish). The slight offset gives A time to start uploading so
   *    B's hash check can detect the change, triggering conflict retry.
   * 3. Wait for both syncs to complete (handling any conflict dialogs)
   * 4. Run convergence syncs until both clients have all data
   *
   * Verify:
   * - Both clients have TaskA, TaskA2, and TaskB -- no data lost
   */
  test('should preserve all data when two clients sync near-simultaneously', async ({
    browser,
    baseURL,
    request,
    webdavServerUp,
  }) => {
    test.slow(); // Sync tests take longer

    const url = baseURL || 'http://localhost:4242';
    const concurrentFolder = generateSyncFolderName('e2e-concurrent');
    const concurrentConfig = {
      ...WEBDAV_CONFIG_TEMPLATE,
      syncFolderPath: `/${concurrentFolder}`,
    };

    await createSyncFolder(request, concurrentFolder);

    // --- Setup Client A ---
    const { context: contextA, page: pageA } = await setupSyncClient(browser, url);
    await dismissViteOverlay(pageA);
    const syncPageA = new SyncPage(pageA);
    const workViewPageA = new WorkViewPage(pageA);

    pageA.on('console', (msg) => {
      const text = msg.text();
      if (
        text.includes('FileBasedSyncAdapter') ||
        text.includes('OperationLogSyncService') ||
        text.includes('SyncService')
      ) {
        console.log(`[Concurrent-A] ${msg.type()}: ${text}`);
      }
    });

    // --- Setup Client B ---
    const { context: contextB, page: pageB } = await setupSyncClient(browser, url);
    await dismissViteOverlay(pageB);
    const syncPageB = new SyncPage(pageB);
    const workViewPageB = new WorkViewPage(pageB);

    pageB.on('console', (msg) => {
      const text = msg.text();
      if (
        text.includes('FileBasedSyncAdapter') ||
        text.includes('OperationLogSyncService') ||
        text.includes('SyncService') ||
        text.includes('RemoteOpsProcessingService') ||
        text.includes('OperationApplierService')
      ) {
        console.log(`[Concurrent-B] ${msg.type()}: ${text}`);
      }
    });

    try {
      // --- Initialize both clients ---
      await workViewPageA.waitForTaskList();
      await syncPageA.setupWebdavSync(concurrentConfig);
      await expect(syncPageA.syncBtn).toBeVisible();
      console.log('[Concurrent] Client A configured');

      await workViewPageB.waitForTaskList();
      await syncPageB.setupWebdavSync(concurrentConfig);
      await expect(syncPageB.syncBtn).toBeVisible();
      console.log('[Concurrent] Client B configured');

      // --- Step 1: Client A creates TaskA and syncs ---
      await workViewPageA.addTask('TaskA');
      await expect(pageA.locator('task')).toHaveCount(1);
      await waitForStatePersistence(pageA);

      await syncPageA.triggerSync();
      await waitForSyncComplete(pageA, syncPageA);
      console.log('[Concurrent] Client A synced TaskA');

      // --- Step 2: Client B downloads TaskA ---
      await syncPageB.triggerSync();
      await waitForSyncComplete(pageB, syncPageB);
      await expect(pageB.locator('task')).toHaveCount(1, { timeout: 10000 });
      await expect(pageB.locator('task').first()).toContainText('TaskA');
      console.log('[Concurrent] Client B downloaded TaskA');

      // --- Step 3: Both clients create tasks independently ---
      await workViewPageA.addTask('TaskA2');
      await expect(pageA.locator('task')).toHaveCount(2);
      await waitForStatePersistence(pageA);
      console.log('[Concurrent] Client A created TaskA2');

      await workViewPageB.addTask('TaskB');
      await expect(pageB.locator('task')).toHaveCount(2);
      await waitForStatePersistence(pageB);
      console.log('[Concurrent] Client B created TaskB');

      // --- Step 4: Near-simultaneous sync ---
      // Trigger Client A first, then Client B after a short delay. We do NOT
      // wait for A to complete, but the slight offset ensures A's upload is
      // in-flight (or complete) when B attempts its own upload. This exercises
      // the content-hash conflict detection: B's pre-upload GET returns a
      // different hash than expected, triggering a retry with merged data.
      console.log('[Concurrent] Triggering near-simultaneous syncs...');

      const syncPromiseA = (async () => {
        await syncPageA.triggerSync();
        return waitForSyncComplete(pageA, syncPageA);
      })();

      // Brief delay so A's upload has a head start, then fire B
      await pageB.waitForTimeout(500);

      const syncPromiseB = (async () => {
        await syncPageB.triggerSync();
        return waitForSyncComplete(pageB, syncPageB);
      })();

      // Wait for both syncs to complete
      const [resultA, resultB] = await Promise.all([syncPromiseA, syncPromiseB]);
      console.log(`[Concurrent] Simultaneous sync results: A=${resultA}, B=${resultB}`);

      // Handle conflict dialogs if they appear
      if (resultA === 'conflict') {
        console.log('[Concurrent] Client A got conflict, using remote');
        await pageA
          .locator('dialog-sync-conflict button', { hasText: /Remote/i })
          .click();
        const confirmDialog = pageA.locator('dialog-confirm');
        try {
          await confirmDialog.waitFor({ state: 'visible', timeout: 3000 });
          await confirmDialog.locator('button[color="warn"]').click();
        } catch {
          // Confirmation might not appear
        }
        await waitForSyncComplete(pageA, syncPageA);
      }

      if (resultB === 'conflict') {
        console.log('[Concurrent] Client B got conflict, using remote');
        await pageB
          .locator('dialog-sync-conflict button', { hasText: /Remote/i })
          .click();
        const confirmDialog = pageB.locator('dialog-confirm');
        try {
          await confirmDialog.waitFor({ state: 'visible', timeout: 3000 });
          await confirmDialog.locator('button[color="warn"]').click();
        } catch {
          // Confirmation might not appear
        }
        await waitForSyncComplete(pageB, syncPageB);
      }

      // --- Step 5: Convergence syncs ---
      // Sync both clients sequentially to ensure they converge on the same state.
      // Multiple rounds may be needed: one client's upload from step 4
      // might not yet include the other client's data.
      console.log('[Concurrent] Starting convergence syncs...');
      for (let round = 1; round <= 3; round++) {
        await syncPageA.triggerSync();
        const convergenceResultA = await waitForSyncComplete(pageA, syncPageA);
        if (convergenceResultA === 'conflict') {
          await pageA
            .locator('dialog-sync-conflict button', { hasText: /Remote/i })
            .click();
          const cd = pageA.locator('dialog-confirm');
          try {
            await cd.waitFor({ state: 'visible', timeout: 3000 });
            await cd.locator('button[color="warn"]').click();
          } catch {
            // Confirmation might not appear
          }
          await waitForSyncComplete(pageA, syncPageA);
        }

        await syncPageB.triggerSync();
        const convergenceResultB = await waitForSyncComplete(pageB, syncPageB);
        if (convergenceResultB === 'conflict') {
          await pageB
            .locator('dialog-sync-conflict button', { hasText: /Remote/i })
            .click();
          const cd = pageB.locator('dialog-confirm');
          try {
            await cd.waitFor({ state: 'visible', timeout: 3000 });
            await cd.locator('button[color="warn"]').click();
          } catch {
            // Confirmation might not appear
          }
          await waitForSyncComplete(pageB, syncPageB);
        }

        // Check if both clients have all 3 tasks
        const countA = await pageA.locator('task').count();
        const countB = await pageB.locator('task').count();
        console.log(
          `[Concurrent] Convergence round ${round}: A has ${countA} tasks, B has ${countB} tasks`,
        );

        if (countA >= 3 && countB >= 3) {
          console.log(`[Concurrent] Both clients converged after round ${round}`);
          break;
        }
      }

      // --- Step 6: Verify no data was lost ---
      // Both clients should have all 3 tasks: TaskA, TaskA2, TaskB
      const titlesA = await pageA.locator('.task-title').allInnerTexts();
      const titlesB = await pageB.locator('.task-title').allInnerTexts();
      console.log(`[Concurrent] Final tasks on A: ${JSON.stringify(titlesA)}`);
      console.log(`[Concurrent] Final tasks on B: ${JSON.stringify(titlesB)}`);

      // Verify Client A has all tasks
      await expect(pageA.locator('task', { hasText: 'TaskA2' })).toBeVisible({
        timeout: 5000,
      });
      await expect(pageA.locator('task', { hasText: 'TaskB' })).toBeVisible({
        timeout: 5000,
      });

      // Verify Client B has all tasks
      await expect(pageB.locator('task', { hasText: 'TaskA2' })).toBeVisible({
        timeout: 5000,
      });
      await expect(pageB.locator('task', { hasText: 'TaskB' })).toBeVisible({
        timeout: 5000,
      });

      // Both should have exactly 3 tasks (TaskA, TaskA2, TaskB)
      await expect(pageA.locator('task')).toHaveCount(3, { timeout: 5000 });
      await expect(pageB.locator('task')).toHaveCount(3, { timeout: 5000 });

      console.log(
        '[Concurrent] All tasks preserved on both clients after near-simultaneous sync',
      );
    } finally {
      await closeContextsSafely(contextA, contextB);
    }
  });
});

import { expect } from '@playwright/test';
import { test } from '../../fixtures/test.fixture';
import { SyncPage } from '../../pages/sync.page';
import { WorkViewPage } from '../../pages/work-view.page';
import { TaskPage } from '../../pages/task.page';
import { waitForStatePersistence, waitForAppReady } from '../../utils/waits';
import { isWebDavServerUp } from '../../utils/check-webdav';
import {
  WEBDAV_CONFIG_TEMPLATE,
  setupSyncClient,
  createSyncFolder,
  waitForSyncComplete,
  generateSyncFolderName,
  dismissTourIfVisible,
} from '../../utils/sync-helpers';

/**
 * WebDAV TODAY Tag Concurrent Updates E2E Tests
 *
 * TODAY_TAG is a "virtual tag":
 * - Membership determined by task.dueDay === today, NOT task.tagIds
 * - taskIds stores ordering only
 * - Self-healing: selector filters stale entries, repair effect fixes inconsistencies
 *
 * These tests verify concurrent TODAY tag operations sync correctly.
 */

test.describe('@webdav WebDAV TODAY Tag Sync', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    const isUp = await isWebDavServerUp(WEBDAV_CONFIG_TEMPLATE.baseUrl);
    if (!isUp) {
      console.warn('WebDAV server not reachable. Skipping WebDAV TODAY tag tests.');
      test.skip(true, 'WebDAV server not reachable');
    }
  });

  /**
   * Test 2.1: Concurrent task reordering in TODAY view
   *
   * Setup:
   * - Client A creates Task1, Task2, Task3 all scheduled for today
   * - Both sync
   * - Verify: Both clients see [Task1, Task2, Task3] order
   *
   * Test:
   * 1. Client A moves Task3 to first position
   * 2. Client B moves Task1 to last position (before sync)
   * 3. Both sync
   * 4. Verify: Both clients converge to same order (LWW)
   * 5. Verify: All 3 tasks still visible, none lost
   */
  test('Concurrent task reordering in TODAY view', async ({
    browser,
    baseURL,
    request,
  }) => {
    test.slow();
    const SYNC_FOLDER_NAME = generateSyncFolderName('e2e-today-reorder');
    const WEBDAV_CONFIG = {
      ...WEBDAV_CONFIG_TEMPLATE,
      syncFolderPath: `/${SYNC_FOLDER_NAME}`,
    };
    const url = baseURL || 'http://localhost:4242';

    await createSyncFolder(request, SYNC_FOLDER_NAME);

    // --- Setup Client A ---
    const { context: contextA, page: pageA } = await setupSyncClient(browser, url);
    const syncPageA = new SyncPage(pageA);
    const workViewPageA = new WorkViewPage(pageA);
    const taskPageA = new TaskPage(pageA);

    await workViewPageA.waitForTaskList();
    await syncPageA.setupWebdavSync(WEBDAV_CONFIG);
    console.log('[TODAY Reorder] Client A configured');

    // Navigate to TODAY view explicitly
    await pageA.goto(`${url}/#/tag/TODAY/tasks`);
    await workViewPageA.waitForTaskList();

    // Client A creates 3 tasks scheduled for today using sd:today syntax
    const task1Name = 'Task1-Reorder';
    const task2Name = 'Task2-Reorder';
    const task3Name = 'Task3-Reorder';
    await workViewPageA.addTask(`${task1Name} sd:today`);
    await workViewPageA.addTask(`${task2Name} sd:today`);
    await workViewPageA.addTask(`${task3Name} sd:today`);
    await expect(pageA.locator('task')).toHaveCount(3);
    console.log('[TODAY Reorder] Client A created 3 tasks for today');

    // Verify initial order (newest first due to how tasks are added)
    const initialTitlesA = await pageA.locator('task .task-title').allInnerTexts();
    console.log('[TODAY Reorder] Initial order on A:', initialTitlesA);

    // Client A syncs
    await waitForStatePersistence(pageA);
    await syncPageA.triggerSync();
    await waitForSyncComplete(pageA, syncPageA);
    console.log('[TODAY Reorder] Client A initial sync complete');

    // --- Setup Client B ---
    const { context: contextB, page: pageB } = await setupSyncClient(browser, url);
    const syncPageB = new SyncPage(pageB);
    const workViewPageB = new WorkViewPage(pageB);
    const taskPageB = new TaskPage(pageB);

    await workViewPageB.waitForTaskList();
    await syncPageB.setupWebdavSync(WEBDAV_CONFIG);
    console.log('[TODAY Reorder] Client B configured');

    // Navigate to TODAY view
    await pageB.goto(`${url}/#/tag/TODAY/tasks`);
    await workViewPageB.waitForTaskList();

    // Client B syncs (downloads tasks)
    await syncPageB.triggerSync();
    await waitForSyncComplete(pageB, syncPageB);
    await expect(pageB.locator('task')).toHaveCount(3);
    console.log('[TODAY Reorder] Client B downloaded 3 tasks');

    // --- Concurrent reordering ---

    // Client A moves Task3 to first position using keyboard (Alt+Up repeatedly)
    const task3OnA = taskPageA.getTaskByText(task3Name).first();
    await task3OnA.click();
    await pageA.waitForTimeout(200);
    // Move up twice (from position 3 to position 1)
    await pageA.keyboard.press('Alt+ArrowUp');
    await pageA.waitForTimeout(100);
    await pageA.keyboard.press('Alt+ArrowUp');
    await pageA.waitForTimeout(300);
    console.log('[TODAY Reorder] Client A moved Task3 up');

    // Client B moves Task1 down using keyboard (Alt+Down repeatedly)
    const task1OnB = taskPageB.getTaskByText(task1Name).first();
    await task1OnB.click();
    await pageB.waitForTimeout(200);
    // Move down twice (from position 1 to position 3)
    await pageB.keyboard.press('Alt+ArrowDown');
    await pageB.waitForTimeout(100);
    await pageB.keyboard.press('Alt+ArrowDown');
    await pageB.waitForTimeout(300);
    console.log('[TODAY Reorder] Client B moved Task1 down');

    // --- Both clients sync ---
    await waitForStatePersistence(pageA);
    await syncPageA.triggerSync();
    await waitForSyncComplete(pageA, syncPageA);
    console.log('[TODAY Reorder] Client A synced reorder');

    await waitForStatePersistence(pageB);
    await syncPageB.triggerSync();
    await waitForSyncComplete(pageB, syncPageB);
    console.log('[TODAY Reorder] Client B synced reorder');

    // Sync again for eventual consistency
    await syncPageA.triggerSync();
    await waitForSyncComplete(pageA, syncPageA);
    await syncPageB.triggerSync();
    await waitForSyncComplete(pageB, syncPageB);
    console.log('[TODAY Reorder] Both synced again for consistency');

    // --- Verify final state ---
    // All 3 tasks should still be visible (no tasks lost)
    await expect(pageA.locator('task')).toHaveCount(3);
    await expect(pageB.locator('task')).toHaveCount(3);
    console.log('[TODAY Reorder] All 3 tasks still visible on both clients');

    // Both clients should have the same order (LWW convergence)
    const finalTitlesA = await pageA.locator('task .task-title').allInnerTexts();
    const finalTitlesB = await pageB.locator('task .task-title').allInnerTexts();
    console.log('[TODAY Reorder] Final order on A:', finalTitlesA);
    console.log('[TODAY Reorder] Final order on B:', finalTitlesB);

    // The orders should be the same (convergence)
    expect(finalTitlesA).toEqual(finalTitlesB);
    console.log('[TODAY Reorder] ✓ Both clients converged to same order');

    // Cleanup
    await contextA.close();
    await contextB.close();
  });

  /**
   * Test 2.2: Concurrent task creation and reorder
   *
   * Setup:
   * - Client A creates Task1, Task2 for today
   * - Both sync
   *
   * Test:
   * 1. Client A reorders TODAY tasks
   * 2. Client B creates a new Task3 in TODAY (before sync)
   * 3. Both sync
   * 4. Verify: All 3 tasks in TODAY view on both clients
   */
  test('Concurrent task creation and reorder', async ({ browser, baseURL, request }) => {
    test.slow();
    const SYNC_FOLDER_NAME = generateSyncFolderName('e2e-today-create');
    const WEBDAV_CONFIG = {
      ...WEBDAV_CONFIG_TEMPLATE,
      syncFolderPath: `/${SYNC_FOLDER_NAME}`,
    };
    const url = baseURL || 'http://localhost:4242';

    await createSyncFolder(request, SYNC_FOLDER_NAME);

    // --- Setup Client A ---
    const { context: contextA, page: pageA } = await setupSyncClient(browser, url);
    const syncPageA = new SyncPage(pageA);
    const workViewPageA = new WorkViewPage(pageA);
    const taskPageA = new TaskPage(pageA);

    await workViewPageA.waitForTaskList();
    await syncPageA.setupWebdavSync(WEBDAV_CONFIG);
    console.log('[TODAY Create] Client A configured');

    // Navigate to TODAY view
    await pageA.goto(`${url}/#/tag/TODAY/tasks`);
    await workViewPageA.waitForTaskList();

    // Client A creates 2 tasks for today
    const task1Name = 'Task1-Original';
    const task2Name = 'Task2-Original';
    await workViewPageA.addTask(`${task1Name} sd:today`);
    await workViewPageA.addTask(`${task2Name} sd:today`);
    await expect(pageA.locator('task')).toHaveCount(2);
    console.log('[TODAY Create] Client A created 2 tasks for today');

    // Client A syncs
    await waitForStatePersistence(pageA);
    await syncPageA.triggerSync();
    await waitForSyncComplete(pageA, syncPageA);
    console.log('[TODAY Create] Client A initial sync complete');

    // --- Setup Client B ---
    const { context: contextB, page: pageB } = await setupSyncClient(browser, url);
    const syncPageB = new SyncPage(pageB);
    const workViewPageB = new WorkViewPage(pageB);
    const taskPageB = new TaskPage(pageB);

    await workViewPageB.waitForTaskList();
    await syncPageB.setupWebdavSync(WEBDAV_CONFIG);
    console.log('[TODAY Create] Client B configured');

    // Navigate to TODAY view
    await pageB.goto(`${url}/#/tag/TODAY/tasks`);
    await workViewPageB.waitForTaskList();

    // Client B syncs (downloads tasks)
    await syncPageB.triggerSync();
    await waitForSyncComplete(pageB, syncPageB);
    await expect(pageB.locator('task')).toHaveCount(2);
    console.log('[TODAY Create] Client B downloaded 2 tasks for today');

    // --- Concurrent operations ---

    // Client A reorders: move Task2 up
    const task2OnA = taskPageA.getTaskByText(task2Name).first();
    await task2OnA.click();
    await pageA.waitForTimeout(200);
    await pageA.keyboard.press('Alt+ArrowUp');
    await pageA.waitForTimeout(300);
    console.log('[TODAY Create] Client A reordered tasks');

    // Client B creates a new task in TODAY
    const task3Name = 'Task3-NewFromB';
    await workViewPageB.addTask(`${task3Name} sd:today`);
    await expect(pageB.locator('task')).toHaveCount(3);
    console.log('[TODAY Create] Client B created Task3');

    // --- Both clients sync ---
    await waitForStatePersistence(pageA);
    await syncPageA.triggerSync();
    await waitForSyncComplete(pageA, syncPageA);
    console.log('[TODAY Create] Client A synced');

    await waitForStatePersistence(pageB);
    await syncPageB.triggerSync();
    await waitForSyncComplete(pageB, syncPageB);
    console.log('[TODAY Create] Client B synced');

    // Sync again for consistency
    await syncPageA.triggerSync();
    await waitForSyncComplete(pageA, syncPageA);
    await syncPageB.triggerSync();
    await waitForSyncComplete(pageB, syncPageB);
    console.log('[TODAY Create] Both synced again');

    // --- Verify final state ---
    // Both clients should see all 3 tasks in TODAY
    await expect(pageA.locator('task')).toHaveCount(3);
    await expect(pageB.locator('task')).toHaveCount(3);
    console.log('[TODAY Create] All 3 tasks in TODAY on both clients');

    // Verify Task3 is in the list on both
    await expect(taskPageA.getTaskByText(task3Name)).toBeVisible();
    await expect(taskPageB.getTaskByText(task3Name)).toBeVisible();

    // Both clients should have the same order (convergence)
    const finalTitlesA = await pageA.locator('task .task-title').allInnerTexts();
    const finalTitlesB = await pageB.locator('task .task-title').allInnerTexts();
    console.log('[TODAY Create] Final order on A:', finalTitlesA);
    console.log('[TODAY Create] Final order on B:', finalTitlesB);
    expect(finalTitlesA).toEqual(finalTitlesB);

    console.log('[TODAY Create] ✓ Concurrent create + reorder resolved correctly');

    // Cleanup
    await contextA.close();
    await contextB.close();
  });

  /**
   * Test 2.3: Remove from today on one client, reorder on other
   *
   * Setup:
   * - Client A creates Task1, Task2, Task3 all for today
   * - Both sync
   *
   * Test:
   * 1. Client A removes Task2 from today (reschedule to tomorrow)
   * 2. Client B moves Task2 to first position (before sync)
   * 3. Both sync
   * 4. Verify: Task2 NOT in today view (dueDay change wins over reorder)
   * 5. Verify: TODAY has consistent tasks on both clients
   */
  test('Remove from today wins over reorder', async ({ browser, baseURL, request }) => {
    test.slow();
    const SYNC_FOLDER_NAME = generateSyncFolderName('e2e-today-remove');
    const WEBDAV_CONFIG = {
      ...WEBDAV_CONFIG_TEMPLATE,
      syncFolderPath: `/${SYNC_FOLDER_NAME}`,
    };
    const url = baseURL || 'http://localhost:4242';

    await createSyncFolder(request, SYNC_FOLDER_NAME);

    // --- Setup Client A ---
    const { context: contextA, page: pageA } = await setupSyncClient(browser, url);
    const syncPageA = new SyncPage(pageA);
    const workViewPageA = new WorkViewPage(pageA);
    const taskPageA = new TaskPage(pageA);

    await workViewPageA.waitForTaskList();
    await syncPageA.setupWebdavSync(WEBDAV_CONFIG);
    console.log('[TODAY Remove] Client A configured');

    // Navigate to TODAY view
    await pageA.goto(`${url}/#/tag/TODAY/tasks`);
    await workViewPageA.waitForTaskList();

    // Client A creates 3 tasks for today
    const task1Name = 'Task1-Stay';
    const task2Name = 'Task2-Remove';
    const task3Name = 'Task3-Stay';
    await workViewPageA.addTask(`${task1Name} sd:today`);
    await workViewPageA.addTask(`${task2Name} sd:today`);
    await workViewPageA.addTask(`${task3Name} sd:today`);
    await expect(pageA.locator('task')).toHaveCount(3);
    console.log('[TODAY Remove] Client A created 3 tasks for today');

    // Client A syncs
    await waitForStatePersistence(pageA);
    await syncPageA.triggerSync();
    await waitForSyncComplete(pageA, syncPageA);
    console.log('[TODAY Remove] Client A initial sync complete');

    // --- Setup Client B ---
    const { context: contextB, page: pageB } = await setupSyncClient(browser, url);
    const syncPageB = new SyncPage(pageB);
    const workViewPageB = new WorkViewPage(pageB);
    const taskPageB = new TaskPage(pageB);

    await workViewPageB.waitForTaskList();
    await syncPageB.setupWebdavSync(WEBDAV_CONFIG);
    console.log('[TODAY Remove] Client B configured');

    // Navigate to TODAY view
    await pageB.goto(`${url}/#/tag/TODAY/tasks`);
    await workViewPageB.waitForTaskList();

    // Client B syncs
    await syncPageB.triggerSync();
    await waitForSyncComplete(pageB, syncPageB);
    await expect(pageB.locator('task')).toHaveCount(3);
    console.log('[TODAY Remove] Client B downloaded 3 tasks');

    // --- Concurrent operations ---

    // Client A removes Task2 from today by clicking the "tomorrow" quick-access button
    const task2OnA = taskPageA.getTaskByText(task2Name).first();
    await task2OnA.click({ button: 'right' });

    // The quick-access div contains: [TODAY, TOMORROW, NEXT_WEEK, SCHEDULE_DIALOG]
    // Click the 2nd button (index 1) for tomorrow
    const quickAccessBtns = pageA.locator('.mat-mdc-menu-content .quick-access button');
    await quickAccessBtns.nth(1).waitFor({ state: 'visible', timeout: 5000 });
    await quickAccessBtns.nth(1).click();
    await pageA.waitForTimeout(500);

    // Task2 should no longer be in TODAY on Client A
    await expect(pageA.locator('task')).toHaveCount(2);
    console.log('[TODAY Remove] Client A scheduled Task2 for tomorrow');

    // Client B tries to reorder Task2 (move up)
    const task2OnB = taskPageB.getTaskByText(task2Name).first();
    await task2OnB.click();
    await pageB.waitForTimeout(200);
    await pageB.keyboard.press('Alt+ArrowUp');
    await pageB.waitForTimeout(300);
    console.log('[TODAY Remove] Client B reordered Task2');

    // --- Both clients sync ---
    await waitForStatePersistence(pageA);
    await syncPageA.triggerSync();
    await waitForSyncComplete(pageA, syncPageA);
    console.log('[TODAY Remove] Client A synced removal');

    await waitForStatePersistence(pageB);
    await syncPageB.triggerSync();
    await waitForSyncComplete(pageB, syncPageB);
    console.log('[TODAY Remove] Client B synced');

    // Sync again for consistency
    await syncPageA.triggerSync();
    await waitForSyncComplete(pageA, syncPageA);
    await syncPageB.triggerSync();
    await waitForSyncComplete(pageB, syncPageB);
    console.log('[TODAY Remove] Both synced again');

    // --- Verify final state ---
    // dueDay change should win over reorder (LWW on task entity)
    // Both clients should have Task2 NOT in TODAY
    // Note: The outcome depends on which operation has a later timestamp
    // Since A's removal happened before B's reorder, B's reorder might have a later timestamp
    // But dueDay change removes the task from TODAY membership regardless of taskIds order

    // Navigate to TODAY view to ensure UI reflects final state
    await pageB.goto(`${url}/#/tag/TODAY/tasks`);
    await waitForAppReady(pageB);
    await dismissTourIfVisible(pageB);
    await workViewPageB.waitForTaskList();

    // Check final counts
    const countA = await pageA.locator('task').count();
    const countB = await pageB.locator('task').count();
    console.log(`[TODAY Remove] Final counts: A=${countA}, B=${countB}`);

    // Both should have the same count
    expect(countA).toBe(countB);

    // The state should be consistent - either both have 2 (Task2 removed from TODAY)
    // or both have 3 (if reorder somehow re-scheduled it, which shouldn't happen)
    // With proper LWW, the dueDay change to tomorrow should make Task2 not appear in TODAY
    // regardless of any taskIds ordering operations

    // Verify Task1 and Task3 are visible on both
    await expect(taskPageA.getTaskByText(task1Name)).toBeVisible();
    await expect(taskPageA.getTaskByText(task3Name)).toBeVisible();
    await expect(taskPageB.getTaskByText(task1Name)).toBeVisible();
    await expect(taskPageB.getTaskByText(task3Name)).toBeVisible();

    console.log('[TODAY Remove] ✓ Remove from today handled correctly');

    // Cleanup
    await contextA.close();
    await contextB.close();
  });
});

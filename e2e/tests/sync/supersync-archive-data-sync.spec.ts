import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';

/**
 * SuperSync Archive Data Sync E2E Tests - Server Migration Scenario
 *
 * This test specifically verifies the bug fix in ServerMigrationService.handleServerMigration()
 * which was using getStateSnapshot() (returns empty archives) instead of
 * getStateSnapshotAsync() (loads real archives from IndexedDB).
 *
 * The bug caused archived tasks to be lost when:
 * 1. A client switches sync providers (triggers server migration)
 * 2. Another client syncs from the new provider
 * 3. The SYNC_IMPORT operation had empty archives
 *
 * This test triggers server migration by having a client switch sync providers.
 *
 * Prerequisites:
 * - super-sync-server running on localhost:1901 with TEST_MODE=true
 * - Frontend running on localhost:4242
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-archive-data-sync.spec.ts
 */

/**
 * Helper to mark a task as done using keyboard shortcut
 */
const markTaskDone = async (
  page: SimulatedE2EClient['page'],
  taskName: string,
): Promise<void> => {
  const task = page.locator(`task:not(.ng-animating):has-text("${taskName}")`).first();
  await task.waitFor({ state: 'visible', timeout: 10000 });

  await task.focus();
  await page.waitForTimeout(100);
  await task.press('d');

  await expect(task).toHaveClass(/isDone/, { timeout: 10000 });
};

/**
 * Helper to archive done tasks via Daily Summary
 */
const archiveDoneTasks = async (page: SimulatedE2EClient['page']): Promise<void> => {
  const finishDayBtn = page.locator('.e2e-finish-day');
  await finishDayBtn.waitFor({ state: 'visible', timeout: 10000 });
  await finishDayBtn.click();

  await page.waitForURL(/daily-summary/);

  const saveAndGoHomeBtn = page.locator(
    'daily-summary button[mat-flat-button]:has(mat-icon:has-text("wb_sunny"))',
  );
  await saveAndGoHomeBtn.waitFor({ state: 'visible', timeout: 10000 });
  await saveAndGoHomeBtn.click();

  await page.waitForURL(/(active\/tasks|tag\/TODAY\/tasks)/);
};

/**
 * Helper to check worklog for archived task entries
 */
const checkWorklogForArchivedTasks = async (
  page: SimulatedE2EClient['page'],
): Promise<number> => {
  await page.goto('/#/tag/TODAY/worklog');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);

  // Try to expand week rows to see task entries
  const weekRows = page.locator('.week-row');
  const weekCount = await weekRows.count();
  for (let i = 0; i < Math.min(weekCount, 3); i++) {
    const row = weekRows.nth(i);
    if (await row.isVisible()) {
      await row.click().catch(() => {});
      await page.waitForTimeout(300);
    }
  }

  // Count task entries in worklog
  const taskEntries = await page
    .locator('.task-summary-table .task-title, .worklog-task, worklog-task')
    .count()
    .catch(() => 0);

  return taskEntries;
};

test.describe('@supersync Server Migration Archive Sync', () => {
  /**
   * Scenario: Server migration should include archive data in SYNC_IMPORT
   *
   * This test triggers the exact code path that had the bug:
   * ServerMigrationService.handleServerMigration() creates a SYNC_IMPORT
   * when a client with existing synced data connects to a new/empty server.
   *
   * Steps:
   * 1. Client A connects to Provider 1 (user1)
   * 2. Client A creates a task, marks it done, and archives it
   * 3. Client A syncs to Provider 1
   * 4. Client A switches to Provider 2 (user2) - TRIGGERS SERVER MIGRATION
   *    - lastServerSeq is 0 for new provider
   *    - Server (user2) is empty
   *    - Client A has previously synced ops (from user1)
   *    - handleServerMigration() creates SYNC_IMPORT with full state
   * 5. Client A syncs to Provider 2 (uploads SYNC_IMPORT)
   * 6. Client B connects to Provider 2 and syncs
   * 7. Verify Client B has the archived task in worklog
   *
   * Before the fix: SYNC_IMPORT had empty archives (DEFAULT_ARCHIVE)
   * After the fix: SYNC_IMPORT includes real archives from IndexedDB
   */
  test('Server migration SYNC_IMPORT should include archived tasks', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      // Create TWO different sync providers (users)
      const user1 = await createTestUser(testRunId + '-provider1');
      const user2 = await createTestUser(testRunId + '-provider2');
      const syncConfig1 = getSuperSyncConfig(user1);
      const syncConfig2 = getSuperSyncConfig(user2);

      // ============ PHASE 1: Client A connects to Provider 1 ============
      console.log('[Migration Archive] Phase 1: Client A connecting to Provider 1');

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig1);
      await clientA.sync.syncAndWait();
      console.log('[Migration Archive] Client A connected to Provider 1');

      // ============ PHASE 2: Client A creates and archives a task ============
      console.log('[Migration Archive] Phase 2: Creating and archiving task');

      const archivedTaskName = `MigrationArchiveTest-${testRunId}`;
      await clientA.workView.addTask(archivedTaskName);
      await waitForTask(clientA.page, archivedTaskName);
      console.log(`[Migration Archive] Created task: ${archivedTaskName}`);

      // Mark task as done
      await markTaskDone(clientA.page, archivedTaskName);
      console.log('[Migration Archive] Marked task as done');

      // Archive the task via Daily Summary
      await archiveDoneTasks(clientA.page);
      console.log('[Migration Archive] Archived task');

      // Verify task is no longer in work view (archived)
      const taskInWorkView = clientA.page.locator(`task:has-text("${archivedTaskName}")`);
      await expect(taskInWorkView).not.toBeVisible({ timeout: 5000 });
      console.log('[Migration Archive] Verified task is archived (not in work view)');

      // ============ PHASE 3: Client A syncs to Provider 1 ============
      console.log('[Migration Archive] Phase 3: Syncing to Provider 1');

      await clientA.sync.syncAndWait();
      console.log('[Migration Archive] Client A synced to Provider 1');

      // Verify archived task appears in worklog on Client A
      const worklogCountA = await checkWorklogForArchivedTasks(clientA.page);
      console.log(`[Migration Archive] Client A worklog entries: ${worklogCountA}`);
      expect(worklogCountA).toBeGreaterThan(0);

      // ============ PHASE 4: Client A switches to Provider 2 (TRIGGERS MIGRATION) ============
      console.log(
        '[Migration Archive] Phase 4: Switching to Provider 2 (server migration)',
      );

      // This is the KEY step that triggers handleServerMigration():
      // - Client A has previously synced ops (from Provider 1)
      // - Provider 2 is empty (lastServerSeq = 0)
      // - handleServerMigration() creates SYNC_IMPORT with full state
      await clientA.sync.setupSuperSync(syncConfig2);
      console.log('[Migration Archive] Client A configured for Provider 2');

      // Sync to Provider 2 - this uploads the SYNC_IMPORT
      await clientA.sync.syncAndWait();
      console.log(
        '[Migration Archive] Client A synced to Provider 2 (SYNC_IMPORT uploaded)',
      );

      // ============ PHASE 5: Client B connects to Provider 2 and syncs ============
      console.log('[Migration Archive] Phase 5: Client B joining Provider 2');

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig2);
      await clientB.sync.syncAndWait();
      console.log('[Migration Archive] Client B synced from Provider 2');

      // Wait for state to settle
      await clientB.page.waitForTimeout(2000);

      // ============ PHASE 6: Verify Client B has archived task in worklog ============
      console.log('[Migration Archive] Phase 6: Verifying Client B has archived task');

      // Check worklog on Client B for archived tasks
      const worklogCountB = await checkWorklogForArchivedTasks(clientB.page);
      console.log(`[Migration Archive] Client B worklog entries: ${worklogCountB}`);

      // CRITICAL ASSERTION: Client B should have archived task entries
      // Before the fix: This would be 0 because SYNC_IMPORT had empty archives
      // After the fix: This should be > 0 because SYNC_IMPORT includes real archives
      expect(worklogCountB).toBeGreaterThan(
        0,
        'Client B should have archived task entries from server migration SYNC_IMPORT',
      );

      console.log('[Migration Archive] ✓ Server migration archive test PASSED!');
      console.log(
        '[Migration Archive] Archives were correctly included in SYNC_IMPORT during server migration',
      );
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});

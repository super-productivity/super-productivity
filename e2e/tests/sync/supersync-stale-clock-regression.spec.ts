import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { ImportPage } from '../../pages/import.page';

/**
 * SuperSync Stale Clock Regression E2E Tests
 *
 * These tests verify the fix for the stale clock bug that caused data loss:
 *
 * BUG SCENARIO:
 * 1. Client A imports backup (creates SYNC_IMPORT)
 * 2. Client A syncs (uploads SYNC_IMPORT)
 * 3. Client B syncs (receives SYNC_IMPORT)
 * 4. Client B reloads (triggers hydration)
 * 5. During hydration, loadAllData triggers reducers (e.g., TODAY_TAG repair)
 * 6. BUG: Operations created during loadAllData got stale vector clocks
 * 7. On next sync, server rejected ops as CONFLICT_STALE
 * 8. BUG 2: CONFLICT_STALE was treated as permanent rejection (not merged)
 *
 * FIX:
 * - Bug 1: mergeRemoteOpClocks is now called BEFORE loadAllData dispatch
 * - Bug 2: CONFLICT_STALE is now handled like CONFLICT_CONCURRENT (merged)
 *
 * Prerequisites:
 * - super-sync-server running on localhost:1901 with TEST_MODE=true
 * - Frontend running on localhost:4242
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-stale-clock-regression.spec.ts
 */

test.describe('@supersync @regression Stale Clock Regression', () => {
  /**
   * Regression test: Operations created during SYNC_IMPORT hydration use correct clock
   *
   * This test verifies that when a client reloads after receiving a SYNC_IMPORT,
   * any operations created during hydration (like TODAY_TAG repair) have the
   * correctly merged vector clock and sync successfully.
   *
   * Setup: Client A and B with shared SuperSync account
   *
   * Actions:
   * 1. Client A creates task scheduled for today
   * 2. Client A syncs
   * 3. Client B syncs (gets A's data)
   * 4. Client A imports backup (creates SYNC_IMPORT)
   * 5. Client A syncs (uploads SYNC_IMPORT)
   * 6. Client B syncs (receives SYNC_IMPORT)
   * 7. Client B RELOADS (triggers hydration with SYNC_IMPORT in tail)
   * 8. Client B syncs again (any ops created during hydration should succeed)
   * 9. Client A syncs (receives any merged ops from B)
   *
   * Verify:
   * - Both clients have consistent imported data after all syncs
   * - No sync errors on either client
   * - B's reload + sync didn't cause data loss
   */
  test('Operations created during SYNC_IMPORT hydration use merged clock (regression)', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    const uniqueId = Date.now();
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // ============ PHASE 1: Setup Both Clients ============
      console.log('[Stale Clock] Phase 1: Setting up both clients');

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // Initial sync to establish vector clocks
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      console.log('[Stale Clock] Both clients synced initially');

      // ============ PHASE 2: Create Task Scheduled for Today ============
      console.log('[Stale Clock] Phase 2: Creating task scheduled for today');

      // This task will affect TODAY_TAG, which may trigger repair during hydration
      const taskToday = `Today-Task-${uniqueId}`;
      await clientA.workView.addTask(taskToday);

      // Schedule for today by opening task details and setting due date
      // Note: Using the planner page or task context menu might be needed
      // For simplicity, just create a regular task - TODAY_TAG repair happens
      // when there's any state inconsistency during loadAllData

      await clientA.sync.syncAndWait();
      console.log(`[Stale Clock] Client A created and synced: ${taskToday}`);

      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, taskToday);
      console.log('[Stale Clock] Client B received the task');

      // ============ PHASE 3: Client A Imports Backup ============
      console.log('[Stale Clock] Phase 3: Client A importing backup');

      const importPage = new ImportPage(clientA.page);
      await importPage.navigateToImportPage();

      // Import backup (contains different tasks - E2E Import Test tasks)
      const backupPath = ImportPage.getFixturePath('test-backup.json');
      await importPage.importBackupFile(backupPath);
      console.log('[Stale Clock] Client A imported backup');

      // Reload page after import to ensure UI reflects the imported state
      // (bulk state updates from BACKUP_IMPORT may not trigger component re-renders)
      await clientA.page.reload();
      await clientA.page.waitForLoadState('networkidle');

      // Re-enable sync after import (import overwrites globalConfig)
      await clientA.sync.setupSuperSync(syncConfig);

      // Wait for imported task to be visible
      await waitForTask(clientA.page, 'E2E Import Test - Active Task With Subtask');
      console.log('[Stale Clock] Client A has imported tasks');

      // ============ PHASE 4: Sync to Propagate SYNC_IMPORT ============
      console.log('[Stale Clock] Phase 4: Syncing to propagate SYNC_IMPORT');

      await clientA.sync.syncAndWait();
      console.log('[Stale Clock] Client A synced (SYNC_IMPORT uploaded)');

      await clientB.sync.syncAndWait();
      console.log('[Stale Clock] Client B synced (received SYNC_IMPORT)');

      // ============ PHASE 5: Client B Reloads (Triggers Hydration) ============
      console.log('[Stale Clock] Phase 5: Client B reloading (triggers hydration)');

      // This is the CRITICAL step - reload triggers fresh hydration
      // With the bug, operations created during loadAllData would get stale clocks
      await clientB.page.reload();
      await clientB.page.waitForLoadState('networkidle');
      console.log('[Stale Clock] Client B reloaded, hydration complete');

      // Navigate to work view and wait for imported task to appear
      await clientB.page.goto('/#/work-view');
      await clientB.page.waitForLoadState('networkidle');
      await waitForTask(clientB.page, 'E2E Import Test - Active Task With Subtask');
      console.log('[Stale Clock] Client B showing imported data after reload');

      // ============ PHASE 6: Client B Syncs After Reload ============
      console.log('[Stale Clock] Phase 6: Client B syncing after reload');

      // This sync should succeed - any ops created during hydration should have correct clocks
      // With the bug, ops would be rejected as CONFLICT_STALE and treated as permanent rejection
      await clientB.sync.syncAndWait();
      console.log('[Stale Clock] Client B synced after reload');

      // Client A syncs to receive any merged ops from B
      await clientA.sync.syncAndWait();
      console.log('[Stale Clock] Client A synced to receive B updates');

      // Brief wait for state to settle
      await clientA.page.waitForTimeout(1000);
      await clientB.page.waitForTimeout(1000);

      // ============ PHASE 7: Verify Consistent State ============
      console.log('[Stale Clock] Phase 7: Verifying consistent state');

      // Navigate both to work view
      await clientA.page.goto('/#/work-view');
      await clientA.page.waitForLoadState('networkidle');
      await clientB.page.goto('/#/work-view');
      await clientB.page.waitForLoadState('networkidle');

      // Both clients should have imported tasks
      const importedTaskOnA = clientA.page.locator(
        'task:has-text("E2E Import Test - Active Task With Subtask")',
      );
      const importedTaskOnB = clientB.page.locator(
        'task:has-text("E2E Import Test - Active Task With Subtask")',
      );

      await expect(importedTaskOnA).toBeVisible({ timeout: 5000 });
      await expect(importedTaskOnB).toBeVisible({ timeout: 5000 });
      console.log('[Stale Clock] Both clients have imported tasks');

      // Original task should be gone (clean slate from import)
      const originalTaskOnA = clientA.page.locator(`task:has-text("${taskToday}")`);
      const originalTaskOnB = clientB.page.locator(`task:has-text("${taskToday}")`);

      await expect(originalTaskOnA).not.toBeVisible({ timeout: 5000 });
      await expect(originalTaskOnB).not.toBeVisible({ timeout: 5000 });
      console.log('[Stale Clock] Original tasks are gone (clean slate)');

      // Check for sync error indicators
      // The snack bar would show if there were rejected ops
      const errorSnack = clientB.page.locator('simple-snack-bar.error');
      await expect(errorSnack).not.toBeVisible({ timeout: 2000 });
      console.log('[Stale Clock] No sync errors on Client B');

      console.log('[Stale Clock] Stale clock regression test PASSED!');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Regression test: Multiple reloads after SYNC_IMPORT don't cause accumulating errors
   *
   * With the original bug, each reload could create more stale ops that get rejected.
   * This test verifies that multiple reload cycles don't cause accumulating issues.
   */
  test('Multiple reloads after SYNC_IMPORT remain stable (no accumulating errors)', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // ============ Setup ============
      console.log('[Multi-Reload] Setting up clients');

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();

      // ============ Import Backup ============
      console.log('[Multi-Reload] Client A importing backup');

      const importPage = new ImportPage(clientA.page);
      await importPage.navigateToImportPage();
      const backupPath = ImportPage.getFixturePath('test-backup.json');
      await importPage.importBackupFile(backupPath);

      // Reload page after import to ensure UI reflects the imported state
      await clientA.page.reload();
      await clientA.page.waitForLoadState('networkidle');

      await clientA.sync.setupSuperSync(syncConfig);
      await waitForTask(clientA.page, 'E2E Import Test - Active Task With Subtask');

      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      console.log('[Multi-Reload] SYNC_IMPORT propagated');

      // ============ Multiple Reload Cycles ============
      console.log('[Multi-Reload] Starting reload cycles');

      for (let cycle = 1; cycle <= 3; cycle++) {
        console.log(`[Multi-Reload] Reload cycle ${cycle}/3`);

        // Reload Client B
        await clientB.page.reload();
        await clientB.page.waitForLoadState('networkidle');

        // Navigate and verify state
        await clientB.page.goto('/#/work-view');
        await clientB.page.waitForLoadState('networkidle');
        await waitForTask(clientB.page, 'E2E Import Test - Active Task With Subtask');

        // Sync after reload
        await clientB.sync.syncAndWait();

        // Check for errors
        const errorSnack = clientB.page.locator('simple-snack-bar.error');
        const isErrorVisible = await errorSnack.isVisible().catch(() => false);
        if (isErrorVisible) {
          throw new Error(
            `Sync error appeared on reload cycle ${cycle} - stale clock bug may not be fixed`,
          );
        }

        console.log(`[Multi-Reload] Cycle ${cycle} completed without errors`);
      }

      // ============ Final Verification ============
      console.log('[Multi-Reload] Final verification');

      // Sync A to get any updates from B
      await clientA.sync.syncAndWait();

      await clientA.page.goto('/#/work-view');
      await clientB.page.goto('/#/work-view');
      await clientA.page.waitForLoadState('networkidle');
      await clientB.page.waitForLoadState('networkidle');

      // Both should have imported task
      await expect(
        clientA.page.locator(
          'task:has-text("E2E Import Test - Active Task With Subtask")',
        ),
      ).toBeVisible();
      await expect(
        clientB.page.locator(
          'task:has-text("E2E Import Test - Active Task With Subtask")',
        ),
      ).toBeVisible();

      console.log('[Multi-Reload] Multi-reload regression test PASSED!');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});

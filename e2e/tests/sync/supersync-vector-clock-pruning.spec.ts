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
import { expectTaskOnAllClients } from '../../utils/supersync-assertions';

/**
 * SuperSync Post-Import Operation Flow E2E Tests
 *
 * These tests verify ordinary post-import operations across real clients. They
 * deliberately do not claim vector-clock pruning coverage: production pruning
 * requires more than MAX_VECTOR_CLOCK_SIZE (20) durable client identities and
 * is covered only by lower-level tests today.
 *
 * Prerequisites:
 * - super-sync-server running on localhost:1901 with TEST_MODE=true
 * - Frontend running on localhost:4242
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-vector-clock-pruning.spec.ts
 */

test.describe.configure({ mode: 'serial' });

test.describe('@supersync Post-Import Operation Flow', () => {
  /**
   * Scenario: Tasks created after receiving SYNC_IMPORT sync correctly
   *
   * This verifies the adjacent two-client flow: after receiving a SYNC_IMPORT,
   * the receiving client can create new tasks that sync back to the import
   * client. No vector-clock entry is pruned in this scenario.
   *
   * Setup: Client A and B with shared SuperSync account
   *
   * Actions:
   * 1. Client A imports backup (creates SYNC_IMPORT)
   * 2. Client A syncs (uploads SYNC_IMPORT)
   * 3. Client B syncs (receives SYNC_IMPORT, merges clocks)
   * 4. Client B creates new tasks
   * 5. Client B syncs (uploads tasks)
   * 6. Client A syncs (downloads tasks from B)
   *
   * Verify:
   * - Both clients have the tasks created by B after the import
   * - No sync errors or data loss
   */
  test('Tasks created after receiving SYNC_IMPORT sync correctly', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    const uniqueId = `${testRunId}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // ============ PHASE 1: Setup Both Clients ============
      console.log('[Post Import] Phase 1: Setting up both clients');

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // Initial sync to establish connection
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      console.log('[Post Import] Both clients synced initially');

      // ============ PHASE 2: Client A Imports Backup ============
      console.log('[Post Import] Phase 2: Client A importing backup');

      const importPage = new ImportPage(clientA.page);
      await importPage.navigateToImportPage();

      // Import backup (creates SYNC_IMPORT with A's clock)
      const backupPath = ImportPage.getFixturePath('test-backup.json');
      await importPage.importBackupFile(backupPath);
      console.log('[Post Import] Client A imported backup');

      // Reload page after import - use goto instead of reload for reliability
      await clientA.page.goto(clientA.page.url(), {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await clientA.page.waitForLoadState('networkidle');

      // Re-enable sync after import - use 'local' to preserve imported data
      await clientA.sync.setupSuperSync({ ...syncConfig, syncImportChoice: 'local' });

      // Verify imported data is visible
      await waitForTask(clientA.page, 'E2E Import Test - Active Task With Subtask');
      console.log('[Post Import] Client A showing imported data');

      // ============ PHASE 3: Sync SYNC_IMPORT to Server ============
      console.log('[Post Import] Phase 3: Syncing SYNC_IMPORT to server');

      await clientA.sync.syncAndWait();
      console.log('[Post Import] Client A synced (SYNC_IMPORT uploaded)');

      // ============ PHASE 4: Client B Receives SYNC_IMPORT ============
      console.log('[Post Import] Phase 4: Client B receiving SYNC_IMPORT');

      await clientB.sync.syncAndWait();
      console.log('[Post Import] Client B synced (received SYNC_IMPORT)');

      // Navigate to work view and verify import applied
      await clientB.page.goto('/#/work-view');
      await clientB.page.waitForLoadState('networkidle');
      await waitForTask(clientB.page, 'E2E Import Test - Active Task With Subtask');
      console.log('[Post Import] Client B showing imported data');

      // ============ PHASE 5: Client B Creates New Tasks ============
      console.log('[Post Import] Phase 5: Client B creating new tasks after import');

      // Create multiple tasks to verify the fix works for multiple ops
      const task1 = `PostImport-Task1-${uniqueId}`;
      const task2 = `PostImport-Task2-${uniqueId}`;
      const task3 = `PostImport-Task3-${uniqueId}`;

      await clientB.workView.addTask(task1);
      await waitForTask(clientB.page, task1);
      console.log(`[Post Import] Client B created: ${task1}`);

      await clientB.workView.addTask(task2);
      await waitForTask(clientB.page, task2);
      console.log(`[Post Import] Client B created: ${task2}`);

      await clientB.workView.addTask(task3);
      await waitForTask(clientB.page, task3);
      console.log(`[Post Import] Client B created: ${task3}`);

      // ============ PHASE 6: Client B Syncs New Tasks ============
      console.log('[Post Import] Phase 6: Client B syncing new tasks');

      await clientB.sync.syncAndWait();
      console.log('[Post Import] Client B synced (new tasks uploaded)');

      // Check for sync errors (would appear if tasks were rejected)
      const errorSnack = clientB.page.locator('simple-snack-bar.error');
      await expect(errorSnack).not.toBeVisible({ timeout: 5000 });
      console.log('[Post Import] No sync errors on Client B');

      // ============ PHASE 7: Client A Downloads New Tasks ============
      console.log('[Post Import] Phase 7: Client A downloading new tasks from B');

      await clientA.sync.syncAndWait();
      console.log('[Post Import] Client A synced (downloaded B tasks)');

      // Navigate to work view
      await clientA.page.goto('/#/work-view');
      await clientA.page.waitForLoadState('networkidle');

      // ============ PHASE 8: Verify Both Clients Have All Tasks ============
      console.log('[Post Import] Phase 8: Verifying both clients have all tasks');

      // Verify tasks on Client A (originally created by B)
      await waitForTask(clientA.page, task1);
      await waitForTask(clientA.page, task2);
      await waitForTask(clientA.page, task3);
      console.log('[Post Import] Client A has all tasks created by B');

      // Verify tasks on Client B (confirm they still exist)
      await expect(clientB.page.locator(`task:has-text("${task1}")`)).toBeVisible();
      await expect(clientB.page.locator(`task:has-text("${task2}")`)).toBeVisible();
      await expect(clientB.page.locator(`task:has-text("${task3}")`)).toBeVisible();
      console.log('[Post Import] Client B still has all tasks');

      // Also verify imported task is on both
      await expectTaskOnAllClients(
        [clientA, clientB],
        'E2E Import Test - Active Task With Subtask',
      );

      console.log('[Post Import] Post-import operation flow PASSED!');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario: Multiple sync cycles after SYNC_IMPORT maintain consistency
   *
   * This test verifies that the fix is stable across multiple sync cycles.
   * The import client's entry should remain protected across all operations.
   *
   * Actions:
   * 1. Client A imports backup, syncs
   * 2. Client B receives import, creates tasks, syncs
   * 3. Client A creates tasks, syncs
   * 4. Client B receives A's tasks, creates more tasks, syncs
   * 5. Verify all tasks are on both clients
   */
  test('Multiple sync cycles after SYNC_IMPORT maintain task consistency', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    const uniqueId = `${testRunId}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // ============ Setup ============
      console.log('[Multi-Cycle] Setting up clients');

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();

      // ============ Import Backup ============
      console.log('[Multi-Cycle] Client A importing backup');

      const importPage = new ImportPage(clientA.page);
      await importPage.navigateToImportPage();
      const backupPath = ImportPage.getFixturePath('test-backup.json');
      await importPage.importBackupFile(backupPath);

      await clientA.page.goto(clientA.page.url(), {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await clientA.page.waitForLoadState('networkidle');
      await clientA.sync.setupSuperSync({ ...syncConfig, syncImportChoice: 'local' });
      await waitForTask(clientA.page, 'E2E Import Test - Active Task With Subtask');

      await clientA.sync.syncAndWait();
      console.log('[Multi-Cycle] SYNC_IMPORT uploaded');

      // ============ Cycle 1: B receives import, creates task ============
      console.log('[Multi-Cycle] Cycle 1: B receives import and creates task');

      await clientB.sync.syncAndWait();
      await clientB.page.goto('/#/work-view');
      await clientB.page.waitForLoadState('networkidle');
      await waitForTask(clientB.page, 'E2E Import Test - Active Task With Subtask');

      const taskB1 = `TaskB1-${uniqueId}`;
      await clientB.workView.addTask(taskB1);
      await clientB.sync.syncAndWait();
      console.log(`[Multi-Cycle] B created and synced: ${taskB1}`);

      // ============ Cycle 2: A receives B's task, creates own task ============
      console.log('[Multi-Cycle] Cycle 2: A receives B task and creates own');

      await clientA.sync.syncAndWait();
      await clientA.page.goto('/#/work-view');
      await clientA.page.waitForLoadState('networkidle');
      await waitForTask(clientA.page, taskB1);

      const taskA1 = `TaskA1-${uniqueId}`;
      await clientA.workView.addTask(taskA1);
      await clientA.sync.syncAndWait();
      console.log(`[Multi-Cycle] A created and synced: ${taskA1}`);

      // ============ Cycle 3: B receives A's task, creates another ============
      console.log('[Multi-Cycle] Cycle 3: B receives A task and creates another');

      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, taskA1);

      const taskB2 = `TaskB2-${uniqueId}`;
      await clientB.workView.addTask(taskB2);
      await clientB.sync.syncAndWait();
      console.log(`[Multi-Cycle] B created and synced: ${taskB2}`);

      // ============ Final sync and verification ============
      console.log('[Multi-Cycle] Final sync and verification');

      await clientA.sync.syncAndWait();
      await clientA.page.goto('/#/work-view');
      await clientA.page.waitForLoadState('networkidle');
      await clientB.page.goto('/#/work-view');
      await clientB.page.waitForLoadState('networkidle');

      // All created tasks should be on both clients
      await expectTaskOnAllClients([clientA, clientB], taskB1);
      await expectTaskOnAllClients([clientA, clientB], taskA1);
      await expectTaskOnAllClients([clientA, clientB], taskB2);

      // Imported task should still be there
      await expectTaskOnAllClients(
        [clientA, clientB],
        'E2E Import Test - Active Task With Subtask',
      );

      // Check for errors
      const errorSnackA = clientA.page.locator('simple-snack-bar.error');
      const errorSnackB = clientB.page.locator('simple-snack-bar.error');
      await expect(errorSnackA).not.toBeVisible({ timeout: 5000 });
      await expect(errorSnackB).not.toBeVisible({ timeout: 5000 });

      console.log('[Multi-Cycle] Multi-cycle test PASSED!');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  // NOTE: The "Reload after SYNC_IMPORT" scenario is already covered by
  // supersync-superseded-clock-regression.spec.ts tests. That test verifies that
  // reloading after receiving SYNC_IMPORT doesn't cause superseded clock issues.
  // Together they cover the ordinary post-import flow, not clock pruning.
});

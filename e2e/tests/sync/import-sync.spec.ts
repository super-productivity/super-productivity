import { test as base, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { ImportPage } from '../../pages/import.page';
import { waitForAppReady } from '../../utils/waits';

/**
 * Import + Sync E2E Tests
 *
 * These tests verify that imported backup data syncs correctly between clients.
 * This includes active tasks, subtasks, and replacement of existing state.
 *
 * Prerequisites:
 * - super-sync-server running on localhost:1901 with TEST_MODE=true
 * - Frontend running on localhost:4242
 *
 * Run with: npm run e2e:playwright -- --grep @importsync
 */

/** Default encryption password used by setupSuperSync's mandatory encryption dialog */
const ENCRYPTION_PASSWORD = 'e2e-default-encryption-pw';

base.describe('@importsync @supersync Import + Sync E2E', () => {
  /**
   * Scenario: Import backup file and sync to second client
   *
   * This test verifies that importing a backup file creates sync operations
   * that propagate the imported active data to other clients.
   *
   * Setup: Client A and B with shared SuperSync account, empty server
   *
   * Actions:
   * 1. Client A imports JSON backup file containing:
   *    - Active tasks with a parent/subtask relationship
   * 2. Client A syncs
   * 3. Client B syncs
   *
   * Verify:
   * - Client B has all active tasks and the imported subtask relationship
   */
  base(
    'Import backup file on Client A, sync to Client B',
    async ({ browser, baseURL, testRunId }) => {
      let clientA: SimulatedE2EClient | null = null;
      let clientB: SimulatedE2EClient | null = null;

      try {
        // Create shared test user
        const user = await createTestUser(testRunId);
        const syncConfig = getSuperSyncConfig(user);

        // ============ PHASE 1: Client A Sets Up Sync and Imports Backup ============
        console.log('[Import Test] Phase 1: Client A importing backup');
        clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
        await clientA.sync.setupSuperSync({
          ...syncConfig,
          isEncryptionEnabled: true,
          password: ENCRYPTION_PASSWORD,
        });

        // Navigate to import page
        const importPage = new ImportPage(clientA.page);
        await importPage.navigateToImportPage();

        // Import the test backup file
        const backupPath = ImportPage.getFixturePath('test-backup.json');
        await importPage.importBackupFile(backupPath);
        console.log('[Import Test] Client A imported backup successfully');

        // Navigate to INBOX project view after import to verify tasks are visible.
        // The backup tasks have projectId: INBOX_PROJECT and dueDay in the past,
        // which may not appear in the TODAY virtual tag (depends on date filtering).
        // Using the project view ensures we see all tasks regardless of dueDay.
        await clientA.page.goto('/#/project/INBOX_PROJECT/tasks', {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
        await waitForAppReady(clientA.page);

        // Wait for import to complete and verify tasks are visible
        // The backup contains tasks with "E2E Import Test" in their titles
        await waitForTask(clientA.page, 'E2E Import Test - Active Task With Subtask');
        await waitForTask(clientA.page, 'E2E Import Test - Simple Active Task');
        console.log('[Import Test] Client A has imported tasks visible');

        // Re-enable sync after import (import overwrites globalConfig including sync settings)
        console.log('[Import Test] Re-enabling sync after import');
        await clientA.sync.setupSuperSync({
          ...syncConfig,
          isEncryptionEnabled: true,
          password: ENCRYPTION_PASSWORD,
          syncImportChoice: 'local',
        });

        // ============ PHASE 2: Client A Syncs to Server ============
        console.log('[Import Test] Phase 2: Client A syncing to server');
        await clientA.sync.syncAndWait();
        console.log('[Import Test] Client A sync complete');

        // ============ PHASE 3: Client B Downloads via Sync ============
        console.log('[Import Test] Phase 3: Client B syncing from server');
        clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
        // Client B must use explicit encryption config to enter the password dialog
        // instead of the enable-encryption dialog (which would wipe server data).
        await clientB.sync.setupSuperSync({
          ...syncConfig,
          isEncryptionEnabled: true,
          password: ENCRYPTION_PASSWORD,
        });
        await clientB.sync.syncAndWait();
        console.log('[Import Test] Client B sync complete');

        // Navigate Client B to INBOX project view to see imported tasks
        await clientB.page.goto('/#/project/INBOX_PROJECT/tasks', {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
        await waitForAppReady(clientB.page);

        // ============ PHASE 4: Verify Active Tasks on Client B ============
        console.log('[Import Test] Phase 4: Verifying active tasks on Client B');

        // Check for active tasks
        await waitForTask(clientB.page, 'E2E Import Test - Active Task With Subtask');
        await waitForTask(clientB.page, 'E2E Import Test - Simple Active Task');

        // Verify both active tasks are visible
        const activeTask1 = clientB.page
          .locator('task:has-text("E2E Import Test - Active Task With Subtask")')
          .first();
        const activeTask2 = clientB.page
          .locator('task:has-text("E2E Import Test - Simple Active Task")')
          .first();
        await expect(activeTask1).toBeVisible({ timeout: 10000 });
        await expect(activeTask2).toBeVisible({ timeout: 10000 });
        console.log('[Import Test] Client B has both active tasks');

        // The imported subtask is nested under its parent and follows the
        // parent's visibility toggle, proving the relationship survived sync.
        const subTask = activeTask1
          .locator('task')
          .filter({ hasText: 'E2E Import Test - Subtask of Active Task' })
          .first();
        const toggleSubTasksBtn = activeTask1.locator('.toggle-sub-tasks-btn');
        await expect(toggleSubTasksBtn).toBeVisible();
        await expect(subTask).toBeVisible();
        await toggleSubTasksBtn.click();
        await expect(subTask).toBeHidden();
        await toggleSubTasksBtn.click();
        await expect(subTask).toBeVisible();
        console.log('[Import Test] Client B has subtask visible');

        // ============ PHASE 5: Final Verification ============
        console.log('[Import Test] Phase 5: Final state verification');

        // Go back to project view on both clients and wait for app to be ready
        await clientA.page.goto('/#/project/INBOX_PROJECT/tasks');
        await waitForAppReady(clientA.page);
        await clientB.page.goto('/#/project/INBOX_PROJECT/tasks');
        await waitForAppReady(clientB.page);

        // Wait for tasks to render before counting
        await waitForTask(clientA.page, 'E2E Import Test - Active Task With Subtask');
        await waitForTask(clientB.page, 'E2E Import Test - Active Task With Subtask');

        // Count tasks on both clients - should match
        const taskCountA = await clientA.page.locator('task').count();
        const taskCountB = await clientB.page.locator('task').count();

        console.log(`[Import Test] Client A task count: ${taskCountA}`);
        console.log(`[Import Test] Client B task count: ${taskCountB}`);

        // Both clients should have same number of tasks
        expect(taskCountA).toBe(taskCountB);
        expect(taskCountA).toBeGreaterThanOrEqual(2); // At least the 2 active tasks

        console.log('[Import Test] ✓ Import + Sync test passed!');
      } finally {
        if (clientA) await closeClient(clientA);
        if (clientB) await closeClient(clientB);
      }
    },
  );

  /**
   * Scenario: Import with existing data (replacement scenario)
   *
   * Tests that importing a backup on one client replaces the old baseline on
   * every client after sync.
   *
   * Actions:
   * 1. Client A creates a task "Existing Task A"
   * 2. Client A syncs
   * 3. Client B syncs (gets Existing Task A)
   * 4. Client B creates a task "Existing Task B"
   * 5. Client A imports backup (which adds new tasks)
   * 6. Client A syncs
   * 7. Client B syncs
   *
   * Verify:
   * - Both clients have the imported tasks
   * - Neither client keeps Existing Task A or Existing Task B
   */
  base(
    'Import replaces existing synced data on all clients',
    async ({ browser, baseURL, testRunId }) => {
      const uniqueId = Date.now();
      let clientA: SimulatedE2EClient | null = null;
      let clientB: SimulatedE2EClient | null = null;

      try {
        const user = await createTestUser(testRunId);
        const syncConfig = getSuperSyncConfig(user);

        // ============ PHASE 1: Setup and Create Initial Tasks ============
        console.log('[Merge Test] Phase 1: Creating initial tasks');

        clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
        await clientA.sync.setupSuperSync({
          ...syncConfig,
          isEncryptionEnabled: true,
          password: ENCRYPTION_PASSWORD,
        });

        // Client A creates a task
        const existingTaskA = `ExistingA-${uniqueId}`;
        await clientA.workView.addTask(existingTaskA);
        await clientA.sync.syncAndWait();
        console.log(`[Merge Test] Client A created and synced: ${existingTaskA}`);

        // Client B gets the task.
        // Must use explicit encryption config so Client B enters the password dialog
        // instead of the enable-encryption dialog (which would wipe Client A's data).
        clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
        await clientB.sync.setupSuperSync({
          ...syncConfig,
          isEncryptionEnabled: true,
          password: ENCRYPTION_PASSWORD,
        });
        await clientB.sync.syncAndWait();
        await waitForTask(clientB.page, existingTaskA);

        // Client B creates another task
        const existingTaskB = `ExistingB-${uniqueId}`;
        await clientB.workView.addTask(existingTaskB);
        await clientB.sync.syncAndWait();
        console.log(`[Merge Test] Client B created and synced: ${existingTaskB}`);

        // ============ PHASE 2: Client A Imports Backup ============
        console.log('[Merge Test] Phase 2: Client A importing backup');

        // Client A syncs to get Client B's task first
        await clientA.sync.syncAndWait();
        await waitForTask(clientA.page, existingTaskB);

        // Navigate to import page
        const importPage = new ImportPage(clientA.page);
        await importPage.navigateToImportPage();

        // Import the backup
        const backupPath = ImportPage.getFixturePath('test-backup.json');
        await importPage.importBackupFile(backupPath);
        console.log('[Merge Test] Client A imported backup');

        // Navigate to tasks view after import.
        // Use explicit URL instead of page.url() because after import the page may be on
        // the settings/import route, and the imported state may redirect to /#/config.
        await clientA.page.goto('/#/tag/TODAY/tasks', {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
        await waitForAppReady(clientA.page);

        // Re-enable sync after import (import overwrites globalConfig including sync settings)
        console.log('[Merge Test] Re-enabling sync after import');
        await clientA.sync.setupSuperSync({
          ...syncConfig,
          isEncryptionEnabled: true,
          password: ENCRYPTION_PASSWORD,
          syncImportChoice: 'local',
        });

        // ============ PHASE 3: Sync After Import ============
        console.log('[Merge Test] Phase 3: Syncing after import');

        await clientA.sync.syncAndWait();
        await clientB.sync.syncAndWait();

        // Reload Client B after sync to ensure UI reflects synced state
        // Use goto (current URL) instead of reload - more reliable with service workers
        await clientB.page.goto(clientB.page.url(), {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
        await waitForAppReady(clientB.page);

        for (const client of [clientA, clientB]) {
          await client.page.goto('/#/project/INBOX_PROJECT/tasks', {
            waitUntil: 'domcontentloaded',
            timeout: 30000,
          });
          await waitForAppReady(client.page);
        }

        // ============ PHASE 4: Verify Merged Data ============
        console.log('[Merge Test] Phase 4: Verifying merged data');

        // Client A should have imported tasks
        await waitForTask(clientA.page, 'E2E Import Test - Active Task With Subtask');
        console.log('[Merge Test] Client A has imported tasks');

        // Client B should also have imported tasks after sync
        await waitForTask(clientB.page, 'E2E Import Test - Active Task With Subtask');
        console.log('[Merge Test] Client B received imported tasks via sync');

        for (const client of [clientA, clientB]) {
          await expect(
            client.page.locator(`task:has-text("${existingTaskA}")`),
          ).not.toBeVisible();
          await expect(
            client.page.locator(`task:has-text("${existingTaskB}")`),
          ).not.toBeVisible();
        }

        console.log('[Merge Test] ✓ Import replacement test passed!');
      } finally {
        if (clientA) await closeClient(clientA);
        if (clientB) await closeClient(clientB);
      }
    },
  );
});

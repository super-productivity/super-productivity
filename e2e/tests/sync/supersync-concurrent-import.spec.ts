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
 * SuperSync Concurrent SYNC_IMPORT E2E Tests
 *
 * These tests verify the race condition handling when two clients create
 * SYNC_IMPORT operations simultaneously. This is a verified test gap from
 * the SuperSync implementation review.
 *
 * Scenario: Both Client A and B import backups at nearly the same time,
 * creating concurrent SYNC_IMPORT operations. The system must handle
 * this gracefully without data loss or corruption.
 *
 * Prerequisites:
 * - super-sync-server running on localhost:1901 with TEST_MODE=true
 * - Frontend running on localhost:4242
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-concurrent-import.spec.ts
 */

test.describe('@supersync @concurrent-import Concurrent SYNC_IMPORT handling', () => {
  /**
   * Scenario: Two clients import backups concurrently
   *
   * This tests the race condition where:
   * 1. Both Client A and B have sync enabled with same account
   * 2. Client A imports a backup (creates SYNC_IMPORT A)
   * 3. Client B imports a backup nearly simultaneously (creates SYNC_IMPORT B)
   * 4. Both clients sync their SYNC_IMPORT operations
   *
   * Expected behavior:
   * - One client's import wins (Last-Write-Wins by timestamp)
   * - The other client eventually receives the winning import
   * - No crashes, data corruption, or infinite loops occur
   * - Final state is consistent across both clients
   */
  test('Both clients eventually converge to a consistent state', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.slow();

    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // ============ PHASE 1: Setup Both Clients with Sync ============
      console.log('[Concurrent Import] Phase 1: Setup both clients with sync');

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);

      // Setup sync on both clients (initially empty)
      await clientA.sync.setupSuperSync(syncConfig);
      await clientB.sync.setupSuperSync(syncConfig);

      console.log('[Concurrent Import] Both clients synced with empty state');

      // ============ PHASE 2: Both Clients Import Backups Nearly Simultaneously ============
      console.log('[Concurrent Import] Phase 2: Both clients import backups');

      // Disable sync on both clients to control timing
      await clientA.sync.disableSync();
      await clientB.sync.disableSync();

      // Client A navigates to import page
      const importPageA = new ImportPage(clientA.page);
      await importPageA.navigateToImportPage();
      const backupPathA = ImportPage.getFixturePath('test-backup.json');

      // Client B navigates to import page
      const importPageB = new ImportPage(clientB.page);
      await importPageB.navigateToImportPage();
      const backupPathB = ImportPage.getFixturePath('test-backup.json');

      // Import on both clients as close together as possible
      // (In practice, there will be some timing gap, but this tests the race)
      await Promise.all([
        importPageA.importBackupFile(backupPathA),
        importPageB.importBackupFile(backupPathB),
      ]);

      console.log('[Concurrent Import] Both clients imported backups');

      // Reload both clients to ensure UI reflects imported state
      await Promise.all([
        clientA.page.goto(clientA.page.url(), {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        }),
        clientB.page.goto(clientB.page.url(), {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        }),
      ]);

      await Promise.all([
        clientA.page.waitForLoadState('networkidle'),
        clientB.page.waitForLoadState('networkidle'),
      ]);

      // ============ PHASE 3: Both Clients Sync Their SYNC_IMPORT ============
      console.log('[Concurrent Import] Phase 3: Both clients sync their imports');

      // Re-enable sync on both - this will trigger initial sync and upload pending SYNC_IMPORT
      await clientA.sync.setupSuperSync(syncConfig);
      await clientB.sync.setupSuperSync(syncConfig);

      console.log('[Concurrent Import] Both clients completed initial sync');

      // ============ PHASE 4: Handle Any Conflict Dialogs ============
      console.log('[Concurrent Import] Phase 4: Handle conflict dialogs if any');

      // Check if either client shows a conflict dialog and handle it
      const dialogA = clientA.page.locator('dialog-sync-import-conflict');
      const dialogB = clientB.page.locator('dialog-sync-import-conflict');

      const dialogAVisible = await dialogA.isVisible().catch(() => false);
      const dialogBVisible = await dialogB.isVisible().catch(() => false);

      if (dialogAVisible) {
        console.log('[Concurrent Import] Client A shows conflict dialog - using server');
        const useRemoteButton = dialogA.getByRole('button', { name: /server/i });
        await useRemoteButton.click();
        await expect(dialogA).not.toBeVisible({ timeout: 10000 });
        await clientA.sync.waitForSyncToComplete({
          timeout: 30000,
          skipSpinnerCheck: true,
        });
      }

      if (dialogBVisible) {
        console.log('[Concurrent Import] Client B shows conflict dialog - using server');
        const useRemoteButton = dialogB.getByRole('button', { name: /server/i });
        await useRemoteButton.click();
        await expect(dialogB).not.toBeVisible({ timeout: 10000 });
        await clientB.sync.waitForSyncToComplete({
          timeout: 30000,
          skipSpinnerCheck: true,
        });
      }

      // ============ PHASE 5: Sync Both Clients Again to Ensure Convergence ============
      console.log('[Concurrent Import] Phase 5: Final sync for convergence');

      // Final sync on both
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();

      // ============ PHASE 6: Verify Consistent State ============
      console.log('[Concurrent Import] Phase 6: Verify consistent state');

      // Navigate both clients to work view
      await clientA.page.goto('/#/work-view');
      await clientB.page.goto('/#/work-view');
      await clientA.page.waitForLoadState('networkidle');
      await clientB.page.waitForLoadState('networkidle');

      // Both clients should have the imported task
      // (The specific task comes from test-backup.json fixture)
      const expectedTask = 'E2E Import Test - Active Task With Subtask';

      await waitForTask(clientA.page, expectedTask);
      await waitForTask(clientB.page, expectedTask);

      console.log('[Concurrent Import] ✓ Both clients have consistent state');

      // Verify no error dialogs are showing
      const errorDialogA = clientA.page.locator('mat-dialog-container:has-text("Error")');
      const errorDialogB = clientB.page.locator('mat-dialog-container:has-text("Error")');

      await expect(errorDialogA).not.toBeVisible({ timeout: 2000 });
      await expect(errorDialogB).not.toBeVisible({ timeout: 2000 });

      console.log('[Concurrent Import] ✓ No error dialogs present');
      console.log('[Concurrent Import] ✓ Concurrent SYNC_IMPORT test PASSED!');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario: Client imports while another client's import is uploading
   *
   * This tests a more extreme race condition where:
   * 1. Client A starts uploading a SYNC_IMPORT
   * 2. Client B imports and starts uploading its SYNC_IMPORT before A completes
   *
   * The server must handle this atomically.
   */
  test('System handles import during another upload gracefully', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.slow();

    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // Setup both clients
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);

      // Client A: Create some initial state and sync
      await clientA.sync.setupSuperSync(syncConfig);
      const uniqueId = Date.now();
      const taskA = `Task-A-Initial-${uniqueId}`;
      await clientA.workView.addTask(taskA);
      await clientA.sync.syncAndWait();

      // Client B: Setup sync (gets A's state)
      await clientB.sync.setupSuperSync(syncConfig);
      await waitForTask(clientB.page, taskA);

      console.log('[Race Import] Initial state established on both clients');

      // Disable sync and create the race condition
      await clientA.sync.disableSync();
      await clientB.sync.disableSync();

      // Both clients import
      const importPageA = new ImportPage(clientA.page);
      const importPageB = new ImportPage(clientB.page);

      await Promise.all([
        importPageA.navigateToImportPage(),
        importPageB.navigateToImportPage(),
      ]);

      const backupPath = ImportPage.getFixturePath('test-backup.json');

      // Import on A first, then B quickly after
      await importPageA.importBackupFile(backupPath);
      await importPageB.importBackupFile(backupPath);

      // Reload both
      await Promise.all([
        clientA.page.goto(clientA.page.url(), {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        }),
        clientB.page.goto(clientB.page.url(), {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        }),
      ]);

      // Re-enable sync - this will trigger uploads from both
      await clientA.sync.setupSuperSync(syncConfig);
      await clientB.sync.setupSuperSync(syncConfig);

      // Handle any conflict dialogs that appear
      for (const client of [clientA, clientB]) {
        const dialog = client.page.locator('dialog-sync-import-conflict');
        if (await dialog.isVisible().catch(() => false)) {
          const useRemoteButton = dialog.getByRole('button', { name: /server/i });
          await useRemoteButton.click();
          await expect(dialog).not.toBeVisible({ timeout: 10000 });
          await client.sync.waitForSyncToComplete({
            timeout: 30000,
            skipSpinnerCheck: true,
          });
        }
      }

      // Final sync to ensure convergence
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();

      // Verify both have consistent state (the imported backup task)
      await clientA.page.goto('/#/work-view');
      await clientB.page.goto('/#/work-view');
      await clientA.page.waitForLoadState('networkidle');
      await clientB.page.waitForLoadState('networkidle');

      const expectedTask = 'E2E Import Test - Active Task With Subtask';
      await waitForTask(clientA.page, expectedTask);
      await waitForTask(clientB.page, expectedTask);

      // The initial task (Task-A-Initial) should be GONE (replaced by import)
      const taskAOnClientA = clientA.page.locator(`task:has-text("${taskA}")`);
      const taskAOnClientB = clientB.page.locator(`task:has-text("${taskA}")`);
      await expect(taskAOnClientA).not.toBeVisible({ timeout: 5000 });
      await expect(taskAOnClientB).not.toBeVisible({ timeout: 5000 });

      console.log('[Race Import] ✓ Both clients converged to imported state');
      console.log('[Race Import] ✓ Test PASSED!');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});

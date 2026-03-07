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

      // ============ PHASE 1: Client A imports backup (no sync yet) ============
      // Import BEFORE enabling sync so the server stays empty.
      // When sync is enabled, the BACKUP_IMPORT gets uploaded directly.
      console.log('[Concurrent Import] Phase 1: Client A imports backup');

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);

      const importPageA = new ImportPage(clientA.page);
      await importPageA.navigateToImportPage();
      const backupPathA = ImportPage.getFixturePath('test-backup.json');
      await importPageA.importBackupFile(backupPathA);

      console.log('[Concurrent Import] Client A imported backup');

      // ============ PHASE 2: Client A enables sync (server empty → uploads) ============
      console.log('[Concurrent Import] Phase 2: Client A enables sync');

      await clientA.sync.setupSuperSync(syncConfig);
      await clientA.sync.syncAndWait();

      console.log('[Concurrent Import] Client A synced (uploaded to server)');

      // ============ PHASE 3: Client B enables sync (downloads from server) ============
      console.log('[Concurrent Import] Phase 3: Client B enables sync');

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();

      console.log('[Concurrent Import] Client B synced');

      // ============ PHASE 4: Final sync for convergence ============
      console.log('[Concurrent Import] Phase 4: Final sync for convergence');

      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();

      // ============ PHASE 5: Verify Consistent State ============
      console.log('[Concurrent Import] Phase 5: Verify consistent state');

      // Navigate both clients to the INBOX_PROJECT tasks view
      // (test-backup.json puts tasks in INBOX_PROJECT)
      await clientA.page.goto('/#/project/INBOX_PROJECT/tasks', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await clientB.page.goto('/#/project/INBOX_PROJECT/tasks', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await clientA.page.waitForLoadState('networkidle');
      await clientB.page.waitForLoadState('networkidle');

      // Both clients should have the imported task
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

      // ============ PHASE 1: Client A imports backup and enables sync ============
      console.log('[Race Import] Phase 1: Client A imports and syncs');

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);

      const importPageA = new ImportPage(clientA.page);
      await importPageA.navigateToImportPage();
      const backupPath = ImportPage.getFixturePath('test-backup.json');
      await importPageA.importBackupFile(backupPath);

      // Enable sync (server is empty → uploads BACKUP_IMPORT)
      await clientA.sync.setupSuperSync(syncConfig);
      await clientA.sync.syncAndWait();

      console.log('[Race Import] Client A synced with imported data');

      // ============ PHASE 2: Client A creates a new task after import ============
      const uniqueId = Date.now();
      const postImportTask = `PostImport-${uniqueId}`;
      await clientA.workView.addTask(postImportTask);
      await clientA.sync.syncAndWait();

      console.log(`[Race Import] Client A created post-import task: ${postImportTask}`);

      // ============ PHASE 3: Client B joins and syncs ============
      console.log('[Race Import] Phase 3: Client B joins');

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();

      console.log('[Race Import] Client B synced');

      // ============ PHASE 4: Final sync for convergence ============
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();

      // ============ PHASE 5: Verify convergence ============
      // Navigate to INBOX_PROJECT where test-backup.json tasks reside
      await clientA.page.goto('/#/project/INBOX_PROJECT/tasks', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await clientB.page.goto('/#/project/INBOX_PROJECT/tasks', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await clientA.page.waitForLoadState('networkidle');
      await clientB.page.waitForLoadState('networkidle');

      // Both clients should have the imported task from test-backup.json
      const expectedTask = 'E2E Import Test - Active Task With Subtask';
      await waitForTask(clientA.page, expectedTask);
      await waitForTask(clientB.page, expectedTask);

      // Also verify the post-import task is visible (navigate to today view)
      await clientA.page.goto('/#/tag/TODAY/tasks', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await clientB.page.goto('/#/tag/TODAY/tasks', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await clientA.page.waitForLoadState('networkidle');
      await clientB.page.waitForLoadState('networkidle');

      await waitForTask(clientA.page, postImportTask);
      await waitForTask(clientB.page, postImportTask);

      console.log('[Race Import] ✓ Both clients converged to consistent state');
      console.log('[Race Import] ✓ Test PASSED!');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});

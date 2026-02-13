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
 * SuperSync lastSeq Preservation Regression Tests
 *
 * Verifies that clean-slate (SYNC_IMPORT) preserves the server's `lastSeq`
 * so other clients don't miss operations on reused sequence numbers.
 *
 * Regression test for commit 63937689e0.
 *
 * Prerequisites:
 * - super-sync-server running on localhost:1901 with TEST_MODE=true
 * - Frontend running on localhost:4242
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-lastseq-preservation.spec.ts
 */

test.describe('@supersync lastSeq Preservation After Import', () => {
  /**
   * Scenario: Post-import tasks reach other clients via preserved lastSeq
   *
   * If lastSeq is NOT preserved after clean-slate, the server would reuse
   * sequence numbers, causing Client B to think it's already up-to-date
   * (its lastSeq >= server's new seqs) and miss the new operations.
   *
   * Flow:
   * 1. Client A creates pre-import tasks, syncs
   * 2. Client B syncs (gets pre-import tasks, records its lastSeq)
   * 3. Client A imports backup (triggers clean-slate SYNC_IMPORT)
   * 4. Client A creates NEW post-import tasks, syncs
   * 5. Client B syncs
   * 6. Verify Client B gets ALL post-import tasks (and no pre-import tasks)
   */
  test('Post-import tasks sync to other clients when lastSeq is preserved', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(180000);
    const appUrl = baseURL || 'http://localhost:4242';
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // ============ PHASE 1: Setup and create pre-import tasks ============
      console.log('[lastSeq] Phase 1: Setup and create pre-import tasks');

      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // Client A creates pre-import tasks
      const preImportTask1 = `PreImport-1-${testRunId}`;
      const preImportTask2 = `PreImport-2-${testRunId}`;
      await clientA.workView.addTask(preImportTask1);
      await clientA.workView.addTask(preImportTask2);
      await clientA.sync.syncAndWait();
      console.log('[lastSeq] Client A created and synced pre-import tasks');

      // Client B syncs to establish its lastSeq pointer
      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, preImportTask1);
      await waitForTask(clientB.page, preImportTask2);
      console.log(
        '[lastSeq] Client B received pre-import tasks and has a lastSeq pointer',
      );

      // ============ PHASE 2: Client A imports backup (clean-slate) ============
      console.log('[lastSeq] Phase 2: Client A imports backup');

      const importPage = new ImportPage(clientA.page);
      await importPage.navigateToImportPage();

      const backupPath = ImportPage.getFixturePath('test-backup.json');
      await importPage.importBackupFile(backupPath);
      console.log('[lastSeq] Client A imported backup');

      // Reload page after import
      await clientA.page.goto(clientA.page.url(), {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await clientA.page.waitForLoadState('networkidle');

      // Re-enable sync after import (import overwrites globalConfig)
      await clientA.sync.setupSuperSync(syncConfig);

      // Wait for imported task to be visible
      await waitForTask(clientA.page, 'E2E Import Test - Active Task With Subtask');
      console.log('[lastSeq] Client A has imported tasks');

      // Client A syncs (uploads SYNC_IMPORT)
      await clientA.sync.syncAndWait();
      console.log('[lastSeq] Client A synced (SYNC_IMPORT uploaded)');

      // ============ PHASE 3: Client A creates post-import tasks ============
      console.log('[lastSeq] Phase 3: Client A creates post-import tasks');

      // Navigate back to work view
      await clientA.page.goto('/#/work-view');
      await clientA.page.waitForLoadState('networkidle');

      const postImportTask1 = `PostImport-1-${testRunId}`;
      const postImportTask2 = `PostImport-2-${testRunId}`;
      const postImportTask3 = `PostImport-3-${testRunId}`;
      await clientA.workView.addTask(postImportTask1);
      await clientA.workView.addTask(postImportTask2);
      await clientA.workView.addTask(postImportTask3);

      // Sync post-import tasks
      await clientA.sync.syncAndWait();
      console.log('[lastSeq] Client A created and synced post-import tasks');

      // ============ PHASE 4: Client B syncs and should get all post-import tasks ============
      console.log('[lastSeq] Phase 4: Client B syncs to receive post-import tasks');

      // Client B syncs - should receive SYNC_IMPORT + post-import tasks
      await clientB.sync.syncAndWait();
      // Extra sync round for convergence
      await clientB.sync.syncAndWait();
      console.log('[lastSeq] Client B synced');

      // Navigate to work view
      await clientB.page.goto('/#/work-view');
      await clientB.page.waitForLoadState('networkidle');

      // ============ PHASE 5: Verify ============
      console.log('[lastSeq] Phase 5: Verifying results');

      // CRITICAL: Post-import tasks should be present on Client B
      await waitForTask(clientB.page, postImportTask1);
      await waitForTask(clientB.page, postImportTask2);
      await waitForTask(clientB.page, postImportTask3);
      console.log('[lastSeq] ✓ Client B received ALL post-import tasks');

      // Pre-import tasks should be GONE (clean slate)
      const preTask1OnB = clientB.page.locator(`task:has-text("${preImportTask1}")`);
      const preTask2OnB = clientB.page.locator(`task:has-text("${preImportTask2}")`);
      await expect(preTask1OnB).not.toBeVisible({ timeout: 5000 });
      await expect(preTask2OnB).not.toBeVisible({ timeout: 5000 });
      console.log('[lastSeq] ✓ Pre-import tasks are GONE on Client B');

      // Imported backup task should be present
      await waitForTask(clientB.page, 'E2E Import Test - Active Task With Subtask');
      console.log('[lastSeq] ✓ Imported backup tasks present on Client B');

      console.log('[lastSeq] ✓ lastSeq preservation test PASSED!');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});

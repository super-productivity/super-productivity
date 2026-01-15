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
 * SuperSync Import Clean Slate E2E Tests
 *
 * These tests verify the "clean slate" semantics of SYNC_IMPORT:
 * When a backup is imported, ALL concurrent work from ALL clients is dropped.
 * The import is an explicit user action to restore to a specific state.
 *
 * Prerequisites:
 * - super-sync-server running on localhost:1901 with TEST_MODE=true
 * - Frontend running on localhost:4242
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-import-clean-slate.spec.ts
 */

test.describe('@supersync @cleanslate Import Clean Slate Semantics', () => {
  /**
   * Scenario: Import drops all concurrent work from both clients
   *
   * This is the core "clean slate" test. After an import, ONLY the imported
   * data should exist - all work created by any client before the import
   * (that the import didn't know about) should be gone.
   *
   * Setup: Client A and B with shared SuperSync account
   *
   * Actions:
   * 1. Client A creates task "Task-A-Before"
   * 2. Client A syncs
   * 3. Client B syncs (gets Task-A-Before)
   * 4. Client B creates task "Task-B-Concurrent"
   * 5. Client B syncs (uploads Task-B-Concurrent)
   * 6. Client A creates task "Task-A-Concurrent"
   * 7. Client A imports backup (contains different tasks)
   * 8. Client A syncs (uploads SYNC_IMPORT)
   * 9. Client B syncs (receives SYNC_IMPORT)
   *
   * Verify:
   * - Client A ONLY has imported tasks (no Task-A-Before, Task-A-Concurrent, Task-B-Concurrent)
   * - Client B ONLY has imported tasks (no Task-A-Before, Task-A-Concurrent, Task-B-Concurrent)
   *
   * Why: The import creates a SYNC_IMPORT operation that represents a complete
   * fresh start. All operations created before it (even if already synced)
   * are dropped because they reference state that no longer exists.
   */
  test('Import drops ALL concurrent work from both clients (clean slate)', async ({
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
      console.log('[Clean Slate] Phase 1: Setting up both clients');

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // ============ PHASE 2: Create Pre-Import Tasks on Both Clients ============
      console.log('[Clean Slate] Phase 2: Creating pre-import tasks');

      // Client A creates and syncs first task
      const taskABefore = `Task-A-Before-${uniqueId}`;
      await clientA.workView.addTask(taskABefore);
      await clientA.sync.syncAndWait();
      console.log(`[Clean Slate] Client A created: ${taskABefore}`);

      // Client B syncs to get A's task
      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, taskABefore);
      console.log('[Clean Slate] Client B received Task-A-Before');

      // Client B creates and syncs a concurrent task
      const taskBConcurrent = `Task-B-Concurrent-${uniqueId}`;
      await clientB.workView.addTask(taskBConcurrent);
      await clientB.sync.syncAndWait();
      console.log(`[Clean Slate] Client B created: ${taskBConcurrent}`);

      // Client A creates another task (will NOT sync before import)
      const taskAConcurrent = `Task-A-Concurrent-${uniqueId}`;
      await clientA.workView.addTask(taskAConcurrent);
      console.log(`[Clean Slate] Client A created: ${taskAConcurrent}`);

      // ============ PHASE 3: Client A Imports Backup ============
      console.log('[Clean Slate] Phase 3: Client A importing backup');

      // Navigate to import page
      const importPage = new ImportPage(clientA.page);
      await importPage.navigateToImportPage();

      // Import the backup file (contains "E2E Import Test" tasks)
      const backupPath = ImportPage.getFixturePath('test-backup.json');
      await importPage.importBackupFile(backupPath);
      console.log('[Clean Slate] Client A imported backup');

      // Reload page after import to ensure UI reflects the imported state
      // (bulk state updates from BACKUP_IMPORT may not trigger component re-renders)
      await clientA.page.reload();
      await clientA.page.waitForLoadState('networkidle');

      // Re-enable sync after import (import overwrites globalConfig)
      await clientA.sync.setupSuperSync(syncConfig);

      // Wait for imported task to be visible
      await waitForTask(clientA.page, 'E2E Import Test - Active Task With Subtask');
      console.log('[Clean Slate] Client A has imported tasks');

      // ============ PHASE 4: Sync to Propagate SYNC_IMPORT ============
      console.log('[Clean Slate] Phase 4: Syncing to propagate SYNC_IMPORT');

      // Client A syncs (uploads SYNC_IMPORT)
      await clientA.sync.syncAndWait();
      console.log('[Clean Slate] Client A synced (SYNC_IMPORT uploaded)');

      // Client B syncs (receives SYNC_IMPORT - should drop all concurrent work)
      await clientB.sync.syncAndWait();
      console.log('[Clean Slate] Client B synced (received SYNC_IMPORT)');

      // Wait for state to settle - allow UI to update
      await clientA.page.waitForTimeout(1000);
      await clientB.page.waitForTimeout(1000);

      // ============ PHASE 5: Verify Clean Slate on Both Clients ============
      console.log('[Clean Slate] Phase 5: Verifying clean slate');

      // Navigate back to work view to see tasks
      await clientA.page.goto('/#/work-view');
      await clientA.page.waitForLoadState('networkidle');
      await clientB.page.goto('/#/work-view');
      await clientB.page.waitForLoadState('networkidle');

      // Wait for imported task to appear
      await waitForTask(clientA.page, 'E2E Import Test - Active Task With Subtask');
      await waitForTask(clientB.page, 'E2E Import Test - Active Task With Subtask');

      // CRITICAL VERIFICATION: Pre-import tasks should be GONE
      console.log('[Clean Slate] Verifying pre-import tasks are gone...');

      // Check Client A - should NOT have pre-import tasks
      const taskABeforeOnA = clientA.page.locator(`task:has-text("${taskABefore}")`);
      const taskAConcurrentOnA = clientA.page.locator(
        `task:has-text("${taskAConcurrent}")`,
      );
      const taskBConcurrentOnA = clientA.page.locator(
        `task:has-text("${taskBConcurrent}")`,
      );

      await expect(taskABeforeOnA).not.toBeVisible({ timeout: 5000 });
      await expect(taskAConcurrentOnA).not.toBeVisible({ timeout: 5000 });
      await expect(taskBConcurrentOnA).not.toBeVisible({ timeout: 5000 });
      console.log('[Clean Slate] ✓ Client A: All pre-import tasks are GONE');

      // Check Client B - should NOT have pre-import tasks
      const taskABeforeOnB = clientB.page.locator(`task:has-text("${taskABefore}")`);
      const taskAConcurrentOnB = clientB.page.locator(
        `task:has-text("${taskAConcurrent}")`,
      );
      const taskBConcurrentOnB = clientB.page.locator(
        `task:has-text("${taskBConcurrent}")`,
      );

      await expect(taskABeforeOnB).not.toBeVisible({ timeout: 5000 });
      await expect(taskAConcurrentOnB).not.toBeVisible({ timeout: 5000 });
      await expect(taskBConcurrentOnB).not.toBeVisible({ timeout: 5000 });
      console.log('[Clean Slate] ✓ Client B: All pre-import tasks are GONE');

      // Verify both clients have imported tasks
      const importedTask1OnA = clientA.page.locator(
        'task:has-text("E2E Import Test - Active Task With Subtask")',
      );
      const importedTask1OnB = clientB.page.locator(
        'task:has-text("E2E Import Test - Active Task With Subtask")',
      );

      await expect(importedTask1OnA).toBeVisible({ timeout: 5000 });
      await expect(importedTask1OnB).toBeVisible({ timeout: 5000 });
      console.log('[Clean Slate] ✓ Both clients have imported tasks');

      console.log('[Clean Slate] ✓ Clean slate test PASSED!');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario: Late joiner with synced ops - ops are dropped after import
   *
   * This tests the "late joiner" scenario that was previously handled by
   * _replayLocalSyncedOpsAfterImport (now removed).
   *
   * Setup: Client A and B with shared SuperSync account
   *
   * Actions:
   * 1. Client B creates task "Task-B-Local"
   * 2. Client B syncs (uploads Task-B-Local to server)
   * 3. Client A imports backup (doesn't know about Task-B-Local)
   * 4. Client A syncs (uploads SYNC_IMPORT)
   * 5. Client B syncs (receives SYNC_IMPORT, piggybacked with own ops)
   *
   * Verify:
   * - Client B does NOT have "Task-B-Local" after sync
   * - Client B ONLY has imported tasks
   *
   * Why: Even though Client B's ops were already on the server, the SYNC_IMPORT
   * represents a complete state reset. Client B's ops are not replayed because
   * they reference state that no longer exists after the import.
   */
  test('Late joiner synced ops are dropped after import (no replay)', async ({
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

      // ============ PHASE 1: Client B Creates and Syncs ============
      console.log('[Late Joiner] Phase 1: Client B creates and syncs');

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // Client B creates and syncs a task
      const taskBLocal = `Task-B-Local-${uniqueId}`;
      await clientB.workView.addTask(taskBLocal);
      await clientB.sync.syncAndWait();
      console.log(`[Late Joiner] Client B created and synced: ${taskBLocal}`);

      // Verify task exists on B
      await waitForTask(clientB.page, taskBLocal);
      console.log('[Late Joiner] Task-B-Local confirmed on Client B');

      // ============ PHASE 2: Client A Imports (Without Syncing First) ============
      console.log('[Late Joiner] Phase 2: Client A imports backup');

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);
      // DO NOT sync before import - A doesn't know about B's task

      // Navigate to import page
      const importPage = new ImportPage(clientA.page);
      await importPage.navigateToImportPage();

      // Import backup
      const backupPath = ImportPage.getFixturePath('test-backup.json');
      await importPage.importBackupFile(backupPath);
      console.log('[Late Joiner] Client A imported backup');

      // Reload page after import to ensure UI reflects the imported state
      await clientA.page.reload();
      await clientA.page.waitForLoadState('networkidle');

      // Re-enable sync after import
      await clientA.sync.setupSuperSync(syncConfig);

      // ============ PHASE 3: Both Clients Sync ============
      console.log('[Late Joiner] Phase 3: Both clients sync');

      // Client A syncs (uploads SYNC_IMPORT)
      await clientA.sync.syncAndWait();
      console.log('[Late Joiner] Client A synced');

      // Client B syncs (receives SYNC_IMPORT)
      // This is where the old code would replay Task-B-Local
      // With clean slate semantics, Task-B-Local should be dropped
      await clientB.sync.syncAndWait();
      console.log('[Late Joiner] Client B synced');

      // Wait for state to settle - allow UI to update
      await clientB.page.waitForTimeout(1000);

      // ============ PHASE 4: Verify Clean Slate on Client B ============
      console.log('[Late Joiner] Phase 4: Verifying clean slate on Client B');

      // Navigate back to work view to see tasks
      await clientB.page.goto('/#/work-view');
      await clientB.page.waitForLoadState('networkidle');

      // Wait for imported task
      await waitForTask(clientB.page, 'E2E Import Test - Active Task With Subtask');

      // CRITICAL: Task-B-Local should be GONE (not replayed)
      const taskBLocalOnB = clientB.page.locator(`task:has-text("${taskBLocal}")`);
      await expect(taskBLocalOnB).not.toBeVisible({ timeout: 5000 });
      console.log('[Late Joiner] ✓ Task-B-Local is GONE (not replayed)');

      // Verify imported task is present
      const importedTaskOnB = clientB.page.locator(
        'task:has-text("E2E Import Test - Active Task With Subtask")',
      );
      await expect(importedTaskOnB).toBeVisible({ timeout: 5000 });
      console.log('[Late Joiner] ✓ Client B has imported tasks');

      console.log('[Late Joiner] ✓ Late joiner test PASSED!');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario: Import invalidates PENDING (unsynced) operations from other clients
   *
   * This tests the critical case where Client B has pending operations that
   * haven't been uploaded yet when Client A imports a backup. These pending
   * ops are CONCURRENT to the import (no knowledge of import) and should be
   * filtered out.
   *
   * Setup: Client A and B with shared SuperSync account
   *
   * Actions:
   * 1. Client A and B both sync (empty state, both know each other)
   * 2. Client B creates task "Task-B-Pending" but does NOT sync (pending locally)
   * 3. Client A imports backup (doesn't know about B's pending task)
   * 4. Client A syncs (uploads SYNC_IMPORT)
   * 5. Client B syncs (receives SYNC_IMPORT, B's pending ops are CONCURRENT)
   *
   * Verify:
   * - Client B does NOT have "Task-B-Pending" after sync
   * - Client B ONLY has imported tasks
   * - B's pending task is correctly filtered due to clean slate semantics
   *
   * Why: The import creates a SYNC_IMPORT operation. Client B's pending ops
   * have a vector clock that is CONCURRENT with the import (created without
   * knowledge of the import). These must be dropped per clean slate semantics.
   */
  test('Import invalidates PENDING (unsynced) operations from other clients', async ({
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

      // ============ PHASE 1: Setup Both Clients with Initial Sync ============
      console.log(
        '[Pending Invalidation] Phase 1: Setting up both clients with initial sync',
      );

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);
      await clientA.sync.syncAndWait(); // Initial sync to establish vector clock

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait(); // Initial sync to establish vector clock

      console.log('[Pending Invalidation] Both clients synced initially');

      // ============ PHASE 2: Client B Creates Task but Does NOT Sync ============
      console.log(
        '[Pending Invalidation] Phase 2: Client B creates task (pending, not synced)',
      );

      const taskBPending = `Task-B-Pending-${uniqueId}`;
      await clientB.workView.addTask(taskBPending);
      await waitForTask(clientB.page, taskBPending);
      console.log(
        `[Pending Invalidation] Client B created: ${taskBPending} (NOT synced)`,
      );

      // Verify task exists locally on B
      const taskBLocator = clientB.page.locator(`task:has-text("${taskBPending}")`);
      await expect(taskBLocator).toBeVisible();

      // ============ PHASE 3: Client A Imports Backup ============
      console.log('[Pending Invalidation] Phase 3: Client A importing backup');

      // Navigate to import page
      const importPage = new ImportPage(clientA.page);
      await importPage.navigateToImportPage();

      // Import the backup file (contains "E2E Import Test" tasks)
      const backupPath = ImportPage.getFixturePath('test-backup.json');
      await importPage.importBackupFile(backupPath);
      console.log('[Pending Invalidation] Client A imported backup');

      // Reload page after import to ensure UI reflects the imported state
      await clientA.page.reload();
      await clientA.page.waitForLoadState('networkidle');

      // Re-enable sync after import (import overwrites globalConfig)
      await clientA.sync.setupSuperSync(syncConfig);

      // Wait for imported task to be visible
      await waitForTask(clientA.page, 'E2E Import Test - Active Task With Subtask');
      console.log('[Pending Invalidation] Client A has imported tasks');

      // ============ PHASE 4: Sync to Propagate SYNC_IMPORT ============
      console.log('[Pending Invalidation] Phase 4: Syncing to propagate SYNC_IMPORT');

      // Client A syncs (uploads SYNC_IMPORT)
      await clientA.sync.syncAndWait();
      console.log('[Pending Invalidation] Client A synced (SYNC_IMPORT uploaded)');

      // ============ PHASE 5: Client B Syncs (Pending Ops Should Be Invalidated) ============
      console.log(
        '[Pending Invalidation] Phase 5: Client B syncs (pending ops invalidated)',
      );

      // This is the CRITICAL sync - B's pending task was created BEFORE the import
      // but B hasn't synced it yet. When B syncs now:
      // 1. B tries to upload Task-B-Pending (has old vector clock)
      // 2. B receives SYNC_IMPORT
      // 3. B's pending ops are CONCURRENT to SYNC_IMPORT
      // 4. Clean slate semantics: B's pending ops are filtered/dropped
      await clientB.sync.syncAndWait();
      console.log('[Pending Invalidation] Client B synced (received SYNC_IMPORT)');

      // Wait for state to settle - allow UI to update
      await clientB.page.waitForTimeout(1000);

      // ============ PHASE 6: Verify Clean Slate on Client B ============
      console.log('[Pending Invalidation] Phase 6: Verifying clean slate');

      // Navigate back to work view to see tasks
      await clientB.page.goto('/#/work-view');
      await clientB.page.waitForLoadState('networkidle');

      // Wait for imported task to appear
      await waitForTask(clientB.page, 'E2E Import Test - Active Task With Subtask');

      // CRITICAL VERIFICATION: B's pending task should be GONE
      console.log('[Pending Invalidation] Verifying pending task is gone...');

      const taskBPendingOnB = clientB.page.locator(`task:has-text("${taskBPending}")`);
      await expect(taskBPendingOnB).not.toBeVisible({ timeout: 5000 });
      console.log(
        '[Pending Invalidation] ✓ Task-B-Pending is GONE (correctly invalidated)',
      );

      // Verify imported task is present on B
      const importedTaskOnB = clientB.page.locator(
        'task:has-text("E2E Import Test - Active Task With Subtask")',
      );
      await expect(importedTaskOnB).toBeVisible({ timeout: 5000 });
      console.log('[Pending Invalidation] ✓ Client B has imported tasks');

      // Also verify on Client A - should NOT have B's pending task
      await clientA.page.goto('/#/work-view');
      await clientA.page.waitForLoadState('networkidle');
      const taskBPendingOnA = clientA.page.locator(`task:has-text("${taskBPending}")`);
      await expect(taskBPendingOnA).not.toBeVisible({ timeout: 5000 });
      console.log(
        "[Pending Invalidation] ✓ Client A also does not have B's pending task",
      );

      console.log('[Pending Invalidation] ✓ Pending invalidation test PASSED!');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});

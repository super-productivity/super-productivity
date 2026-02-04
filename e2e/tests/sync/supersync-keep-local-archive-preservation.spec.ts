import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  archiveTask,
  hasTaskInWorklog,
  navigateToWorkView,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { ImportPage } from '../../pages/import.page';

/**
 * SuperSync "Keep Local" Archive Preservation E2E Tests
 *
 * These tests verify the bug fix for archive corruption during "Keep Local"
 * conflict resolution. The bug was:
 *
 * 1. downloadOps() wrote REMOTE archives to IndexedDB immediately
 * 2. LocalDataConflictError was thrown
 * 3. User clicked "Keep local" (Use My Data)
 * 4. forceUploadLocalState read archives from IndexedDB (now had REMOTE data!)
 * 5. NgRx still had LOCAL entity data (projects/tasks)
 * 6. Validation failed: archived tasks referenced entities that didn't exist
 *
 * The fix: Archives are now written only during hydrateFromRemoteSync() AFTER
 * conflict resolution, ensuring local archives remain intact when choosing
 * "Keep Local".
 *
 * Prerequisites:
 * - super-sync-server running on localhost:1901 with TEST_MODE=true
 * - Frontend running on localhost:4242
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-keep-local-archive-preservation.spec.ts
 */

test.describe('@supersync @archive Keep Local Archive Preservation', () => {
  /**
   * Scenario: Keep local (Use My Data) works without validation errors
   *
   * This test verifies that when a client imports data and chooses "Use My Data"
   * during a sync conflict, no validation errors occur. This was the main
   * symptom of the archive corruption bug.
   *
   * Setup:
   * - Client A creates and archives a task, syncs (server has A's data with archive)
   * - Client B imports backup (creates SYNC_IMPORT)
   *
   * Actions:
   * 1. Client B configures sync
   * 2. Conflict dialog appears
   * 3. Client B clicks "Use My Data"
   *
   * Verify:
   * - No validation errors
   * - Client B keeps imported data
   * - Sync works after "Use My Data"
   */
  test('Keep local works without validation errors when server has archives', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.slow();
    const uniqueId = Date.now();
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    // Capture console errors
    const consoleErrors: string[] = [];

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // ============ PHASE 1: Client A creates and archives a task ============
      console.log('[KeepLocal] Phase 1: Client A creates archived data');

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      // Create and archive task on Client A
      const taskAName = `TaskA-Remote-${uniqueId}`;
      await clientA.workView.addTask(taskAName);
      await waitForTask(clientA.page, taskAName);
      console.log(`[KeepLocal] Client A created: ${taskAName}`);

      // Archive the task
      await archiveTask(clientA, taskAName);
      console.log('[KeepLocal] Client A archived task');

      // Sync Client A (uploads archive to server)
      await navigateToWorkView(clientA);
      await clientA.sync.syncAndWait();
      console.log('[KeepLocal] Client A synced with archived task');

      // ============ PHASE 2: Client B imports backup ============
      console.log('[KeepLocal] Phase 2: Client B imports backup');

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);

      // Capture console errors on Client B
      clientB.page.on('console', (msg) => {
        if (msg.type() === 'error') {
          const text = msg.text();
          // Ignore known harmless errors
          if (
            !text.includes('ServiceWorker') &&
            !text.includes('NG05604') &&
            !text.includes('pf] Auto-fixing')
          ) {
            consoleErrors.push(text);
          }
        }
      });

      // Import backup (creates SYNC_IMPORT)
      const importPage = new ImportPage(clientB.page);
      await importPage.navigateToImportPage();
      const backupPath = ImportPage.getFixturePath('test-backup.json');
      await importPage.importBackupFile(backupPath);
      console.log('[KeepLocal] Client B imported backup');

      // Reload to ensure imported state is applied
      await clientB.page.goto('/#/tag/TODAY/tasks', {
        waitUntil: 'domcontentloaded',
      });
      await clientB.page.waitForLoadState('networkidle');

      // ============ PHASE 3: Client B syncs and chooses "Keep Local" ============
      console.log('[KeepLocal] Phase 3: Client B syncs and chooses Keep Local');

      await clientB.sync.setupSuperSync({ ...syncConfig, waitForInitialSync: false });

      const dialog = clientB.page.locator('dialog-sync-import-conflict');
      await expect(dialog).toBeVisible({ timeout: 30000 });
      console.log('[KeepLocal] Conflict dialog appeared');

      // Click "Use My Data" (keep local/imported)
      const useMyDataBtn = dialog.getByRole('button', { name: /my data/i });
      await useMyDataBtn.click();
      console.log('[KeepLocal] Clicked "Use My Data"');

      // Wait for dialog to close and operation to complete
      await expect(dialog).not.toBeVisible({ timeout: 10000 });
      await clientB.page.waitForTimeout(3000);

      // ============ PHASE 4: Verify no validation errors ============
      console.log('[KeepLocal] Phase 4: Checking for errors');

      // Filter for validation-related errors (the bug symptom)
      const validationErrors = consoleErrors.filter(
        (e) =>
          e.toLowerCase().includes('validation') ||
          e.toLowerCase().includes('entity') ||
          (e.toLowerCase().includes('not found') && e.toLowerCase().includes('project')),
      );

      if (validationErrors.length > 0) {
        console.log('[KeepLocal] Validation errors found:', validationErrors);
      }
      expect(validationErrors.length).toBe(0);
      console.log('[KeepLocal] ✓ No validation errors');

      // ============ PHASE 5: Verify imported data preserved ============
      console.log('[KeepLocal] Phase 5: Verifying imported data preserved');

      await navigateToWorkView(clientB);
      await waitForTask(clientB.page, 'E2E Import Test - Active Task With Subtask');
      console.log('[KeepLocal] ✓ Imported data preserved');

      // Verify remote task is NOT present
      const hasRemoteTask = await clientB.page
        .locator(`task:has-text("${taskAName}")`)
        .isVisible()
        .catch(() => false);
      expect(hasRemoteTask).toBe(false);
      console.log('[KeepLocal] ✓ Remote data NOT present');

      // Verify sync works after "Use My Data"
      await clientB.sync.syncAndWait();
      const hasError = await clientB.sync.hasSyncError();
      expect(hasError).toBe(false);
      console.log('[KeepLocal] ✓ Sync works after Keep Local');

      console.log('[KeepLocal] ✓ Keep local test PASSED!');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario: Use Server Data correctly downloads remote data including archives
   *
   * Control test to verify "Use Server Data" still works correctly.
   *
   * Setup:
   * - Client A creates and archives a task, syncs
   * - Client B imports backup
   *
   * Actions:
   * 1. Client B configures sync
   * 2. Conflict dialog appears
   * 3. Client B clicks "Use Server Data"
   *
   * Verify:
   * - Client B gets server data (including A's archived task)
   * - Imported data is replaced
   */
  test('Use Server Data correctly downloads remote archives', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.slow();
    const uniqueId = Date.now();
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // ============ PHASE 1: Client A creates and archives a task ============
      console.log('[UseServer] Phase 1: Client A creates and archives task');

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      const taskAName = `TaskA-Server-${uniqueId}`;
      await clientA.workView.addTask(taskAName);
      await waitForTask(clientA.page, taskAName);
      await archiveTask(clientA, taskAName);
      await navigateToWorkView(clientA);
      await clientA.sync.syncAndWait();
      console.log('[UseServer] Client A synced with archive');

      // ============ PHASE 2: Client B imports backup ============
      console.log('[UseServer] Phase 2: Client B imports backup');

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);

      const importPage = new ImportPage(clientB.page);
      await importPage.navigateToImportPage();
      const backupPath = ImportPage.getFixturePath('test-backup.json');
      await importPage.importBackupFile(backupPath);

      await clientB.page.goto('/#/tag/TODAY/tasks', {
        waitUntil: 'domcontentloaded',
      });
      await clientB.page.waitForLoadState('networkidle');

      // ============ PHASE 3: Client B syncs and chooses Use Server Data ============
      console.log('[UseServer] Phase 3: Client B chooses Use Server Data');

      await clientB.sync.setupSuperSync({ ...syncConfig, waitForInitialSync: false });

      const dialog = clientB.page.locator('dialog-sync-import-conflict');
      await expect(dialog).toBeVisible({ timeout: 30000 });

      const useServerBtn = dialog.getByRole('button', { name: /server/i });
      await useServerBtn.click();

      await expect(dialog).not.toBeVisible({ timeout: 10000 });

      // Wait for sync to complete
      await clientB.sync.waitForSyncToComplete({
        timeout: 30000,
        skipSpinnerCheck: true,
      });
      await clientB.page.waitForTimeout(2000);

      // ============ PHASE 4: Verify server data received ============
      console.log('[UseServer] Phase 4: Verifying server data received');

      // Client B should have A's archived task in worklog
      const hasRemoteArchive = await hasTaskInWorklog(clientB, taskAName);
      expect(hasRemoteArchive).toBe(true);
      console.log('[UseServer] ✓ Remote archive DOWNLOADED');

      // Client B should NOT have imported task
      await navigateToWorkView(clientB);
      const hasImportedTask = await clientB.page
        .locator('task:has-text("E2E Import Test - Active Task With Subtask")')
        .isVisible()
        .catch(() => false);
      expect(hasImportedTask).toBe(false);
      console.log('[UseServer] ✓ Imported data REPLACED');

      console.log('[UseServer] ✓ Use Server Data test PASSED!');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario: Keep local preserves local archives created before import
   *
   * Tests that archives created locally BEFORE importing a backup are preserved
   * when choosing "Use My Data".
   *
   * Setup:
   * - Client A creates and archives a task, syncs
   * - Client B creates and archives a local task
   * - Client B imports backup (SYNC_IMPORT)
   *
   * Actions:
   * 1. Client B configures sync
   * 2. Conflict dialog appears
   * 3. Client B clicks "Use My Data"
   *
   * Verify:
   * - Sync completes without errors
   * - Note: The import replaces local state, so B's pre-import archive is gone
   *   but the import's state is preserved (not corrupted by remote archives)
   */
  test('Keep local preserves imported state without corruption', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.slow();
    const uniqueId = Date.now();
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // ============ PHASE 1: Client A creates server state with archive ============
      console.log('[Preserve] Phase 1: Client A creates server state');

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      const taskAName = `ServerArchive-${uniqueId}`;
      await clientA.workView.addTask(taskAName);
      await waitForTask(clientA.page, taskAName);
      await archiveTask(clientA, taskAName);
      await navigateToWorkView(clientA);
      await clientA.sync.syncAndWait();
      console.log('[Preserve] Client A synced with archive');

      // ============ PHASE 2: Client B imports backup ============
      console.log('[Preserve] Phase 2: Client B imports backup');

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);

      const importPage = new ImportPage(clientB.page);
      await importPage.navigateToImportPage();
      const backupPath = ImportPage.getFixturePath('test-backup.json');
      await importPage.importBackupFile(backupPath);

      await clientB.page.goto('/#/tag/TODAY/tasks', {
        waitUntil: 'domcontentloaded',
      });
      await clientB.page.waitForLoadState('networkidle');

      // Verify imported state
      await waitForTask(clientB.page, 'E2E Import Test - Active Task With Subtask');
      console.log('[Preserve] Client B has imported data');

      // ============ PHASE 3: Client B syncs and keeps local ============
      console.log('[Preserve] Phase 3: Client B syncs and keeps local');

      await clientB.sync.setupSuperSync({ ...syncConfig, waitForInitialSync: false });

      const dialog = clientB.page.locator('dialog-sync-import-conflict');
      await expect(dialog).toBeVisible({ timeout: 30000 });

      const useMyDataBtn = dialog.getByRole('button', { name: /my data/i });
      await useMyDataBtn.click();

      await expect(dialog).not.toBeVisible({ timeout: 10000 });
      await clientB.page.waitForTimeout(3000);

      // ============ PHASE 4: Verify state is not corrupted ============
      console.log('[Preserve] Phase 4: Verifying state integrity');

      // Navigate around to trigger any lazy validation
      await navigateToWorkView(clientB);
      await clientB.page.goto('/#/tag/TODAY/worklog');
      await clientB.page.waitForLoadState('networkidle');
      await navigateToWorkView(clientB);

      // Imported data should be preserved
      await waitForTask(clientB.page, 'E2E Import Test - Active Task With Subtask');
      console.log('[Preserve] ✓ Imported state preserved');

      // Sync should work without errors
      await clientB.sync.syncAndWait();
      const hasError = await clientB.sync.hasSyncError();
      expect(hasError).toBe(false);
      console.log('[Preserve] ✓ Sync works, no corruption');

      // Server data should NOT be present
      const hasServerArchive = await hasTaskInWorklog(clientB, taskAName);
      expect(hasServerArchive).toBe(false);
      console.log('[Preserve] ✓ Server archive NOT present');

      console.log('[Preserve] ✓ State preservation test PASSED!');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});

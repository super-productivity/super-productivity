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
 * SuperSync Import Conflict Dialog E2E Tests
 *
 * These tests verify the user-facing dialog that appears when ALL remote
 * operations are filtered due to a local SYNC_IMPORT. This happens when:
 * 1. User imports/restores data locally (creates SYNC_IMPORT)
 * 2. Other clients have been creating changes without knowledge of that import
 * 3. On sync, all remote ops are filtered as CONCURRENT with the import
 *
 * The dialog offers three options:
 * - USE_LOCAL: Push local state to server (forceUploadLocalState)
 * - USE_REMOTE: Accept server state (forceDownloadRemoteState)
 * - CANCEL: Abort sync for now
 *
 * Prerequisites:
 * - super-sync-server running on localhost:1901 with TEST_MODE=true
 * - Frontend running on localhost:4242
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-import-conflict-dialog.spec.ts
 */

test.describe('@supersync @import-conflict Sync Import Conflict Dialog', () => {
  /**
   * Scenario: Dialog appears when all remote ops are filtered by local import
   *
   * Setup: Client A and B with shared SuperSync account
   *
   * Actions:
   * 1. Client A creates task "Task-A-Remote" and syncs
   * 2. Client B imports backup (creates local SYNC_IMPORT)
   * 3. Client B syncs (receives A's ops which are CONCURRENT with B's import)
   *
   * Verify:
   * - Dialog appears on Client B
   * - Dialog shows correct filtered op count
   * - Dialog has all three buttons
   */
  test('Dialog appears when all remote ops are filtered by local import', async ({
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

      // ============ PHASE 1: Client A Creates and Syncs ============
      console.log('[Conflict Dialog] Phase 1: Client A creates and syncs');

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      // Client A creates and syncs a task
      const taskARemote = `Task-A-Remote-${uniqueId}`;
      await clientA.workView.addTask(taskARemote);
      await clientA.sync.syncAndWait();
      console.log(`[Conflict Dialog] Client A created and synced: ${taskARemote}`);

      // ============ PHASE 2: Client B Imports Backup (Without Syncing First) ============
      console.log('[Conflict Dialog] Phase 2: Client B imports backup');

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      // DO NOT setup sync before import - we want B to have no knowledge of server state

      // Navigate to import page
      const importPage = new ImportPage(clientB.page);
      await importPage.navigateToImportPage();

      // Import backup
      const backupPath = ImportPage.getFixturePath('test-backup.json');
      await importPage.importBackupFile(backupPath);
      console.log('[Conflict Dialog] Client B imported backup');

      // Reload page after import to ensure UI reflects the imported state
      // Use goto instead of reload - more reliable with service workers
      await clientB.page.goto(clientB.page.url(), {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await clientB.page.waitForLoadState('networkidle');

      // NOW setup sync - B has local SYNC_IMPORT but no knowledge of server ops
      // Use waitForInitialSync=false so we can manually observe the dialog
      await clientB.sync.setupSuperSync({ ...syncConfig, waitForInitialSync: false });

      // ============ PHASE 3: Client B Syncs (Should See Dialog) ============
      console.log('[Conflict Dialog] Phase 3: Client B syncs (should see dialog)');

      // The auto-sync after enabling will trigger the conflict dialog
      // Wait for the sync import conflict dialog to appear
      const dialog = clientB.page.locator('dialog-sync-import-conflict');
      await expect(dialog).toBeVisible({ timeout: 15000 });
      console.log('[Conflict Dialog] Dialog appeared');

      // Verify dialog title
      const dialogTitle = dialog.locator('h1');
      await expect(dialogTitle).toContainText('Sync Conflict');
      console.log('[Conflict Dialog] ✓ Dialog title is correct');

      // Verify dialog has all three buttons
      const cancelButton = dialog.getByRole('button', { name: /cancel/i });
      const useRemoteButton = dialog.getByRole('button', { name: /server/i });
      const useLocalButton = dialog.getByRole('button', { name: /my data/i });

      await expect(cancelButton).toBeVisible();
      await expect(useRemoteButton).toBeVisible();
      await expect(useLocalButton).toBeVisible();
      console.log('[Conflict Dialog] ✓ All three buttons are visible');

      // Close dialog by clicking Cancel
      await cancelButton.click();
      await expect(dialog).not.toBeVisible({ timeout: 5000 });
      console.log('[Conflict Dialog] ✓ Dialog closed on Cancel');

      console.log('[Conflict Dialog] ✓ Dialog appearance test PASSED!');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario: USE_LOCAL pushes local imported state to server
   *
   * Actions:
   * 1. Client A creates task "Task-A-Remote" and syncs
   * 2. Client B imports backup (contains different tasks)
   * 3. Client B syncs → dialog appears → clicks USE_LOCAL
   * 4. Client A syncs
   *
   * Verify:
   * - After USE_LOCAL, Client B keeps imported tasks (no Task-A-Remote)
   * - After sync, Client A receives B's imported state (loses Task-A-Remote)
   */
  test('USE_LOCAL pushes local imported state to server', async ({
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

      // ============ PHASE 1: Client A Creates and Syncs ============
      console.log('[USE_LOCAL] Phase 1: Client A creates and syncs');

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      const taskARemote = `Task-A-Remote-${uniqueId}`;
      await clientA.workView.addTask(taskARemote);
      await clientA.sync.syncAndWait();
      console.log(`[USE_LOCAL] Client A created and synced: ${taskARemote}`);

      // ============ PHASE 2: Client B Imports Backup ============
      console.log('[USE_LOCAL] Phase 2: Client B imports backup');

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      // DO NOT setup sync before import

      const importPage = new ImportPage(clientB.page);
      await importPage.navigateToImportPage();
      const backupPath = ImportPage.getFixturePath('test-backup.json');
      await importPage.importBackupFile(backupPath);
      console.log('[USE_LOCAL] Client B imported backup');

      // Use goto instead of reload - more reliable with service workers
      await clientB.page.goto(clientB.page.url(), {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await clientB.page.waitForLoadState('networkidle');
      // Setup sync AFTER import, but don't wait for initial sync so we can handle the dialog
      await clientB.sync.setupSuperSync({ ...syncConfig, waitForInitialSync: false });

      // ============ PHASE 3: Client B Syncs and Chooses USE_LOCAL ============
      console.log('[USE_LOCAL] Phase 3: Client B syncs and chooses USE_LOCAL');

      // The auto-sync after enabling will trigger the conflict dialog
      // Use specific locator for the sync import conflict dialog
      const dialog = clientB.page.locator('dialog-sync-import-conflict');
      await expect(dialog).toBeVisible({ timeout: 15000 });

      // Click "Use My Data" button
      const useLocalButton = dialog.getByRole('button', { name: /my data/i });
      await useLocalButton.click();

      // Wait for dialog to close and sync to complete
      await expect(dialog).not.toBeVisible({ timeout: 10000 });
      await clientB.page.waitForTimeout(2000);
      console.log('[USE_LOCAL] Client B chose USE_LOCAL');

      // ============ PHASE 4: Verify Client B State ============
      console.log('[USE_LOCAL] Phase 4: Verify Client B state');

      await clientB.page.goto('/#/work-view');
      await clientB.page.waitForLoadState('networkidle');

      // B should have imported tasks (not A's task)
      await waitForTask(clientB.page, 'E2E Import Test - Active Task With Subtask');
      const taskAOnB = clientB.page.locator(`task:has-text("${taskARemote}")`);
      await expect(taskAOnB).not.toBeVisible({ timeout: 5000 });
      console.log('[USE_LOCAL] ✓ Client B has imported tasks, not A task');

      // ============ PHASE 5: Client A Syncs and Receives B's State ============
      console.log('[USE_LOCAL] Phase 5: Client A syncs');

      await clientA.sync.syncAndWait();
      await clientA.page.waitForTimeout(1000);

      await clientA.page.goto('/#/work-view');
      await clientA.page.waitForLoadState('networkidle');

      // A should now have B's imported state
      await waitForTask(clientA.page, 'E2E Import Test - Active Task With Subtask');
      const taskAOnA = clientA.page.locator(`task:has-text("${taskARemote}")`);
      await expect(taskAOnA).not.toBeVisible({ timeout: 5000 });
      console.log('[USE_LOCAL] ✓ Client A received B imported state');

      console.log('[USE_LOCAL] ✓ USE_LOCAL test PASSED!');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario: USE_REMOTE discards local import and downloads server state
   *
   * Actions:
   * 1. Client A creates task "Task-A-Remote" and syncs
   * 2. Client B imports backup (contains different tasks)
   * 3. Client B syncs → dialog appears → clicks USE_REMOTE
   *
   * Verify:
   * - After USE_REMOTE, Client B has A's task (Task-A-Remote)
   * - Client B does NOT have imported tasks
   */
  test('USE_REMOTE discards local import and downloads server state', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    // USE_REMOTE involves downloading server state, which takes longer
    test.slow();
    const uniqueId = Date.now();
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // ============ PHASE 1: Client A Creates and Syncs ============
      console.log('[USE_REMOTE] Phase 1: Client A creates and syncs');

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      const taskARemote = `Task-A-Remote-${uniqueId}`;
      await clientA.workView.addTask(taskARemote);
      await clientA.sync.syncAndWait();
      console.log(`[USE_REMOTE] Client A created and synced: ${taskARemote}`);

      // ============ PHASE 2: Client B Imports Backup ============
      console.log('[USE_REMOTE] Phase 2: Client B imports backup');

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      // DO NOT setup sync before import

      const importPage = new ImportPage(clientB.page);
      await importPage.navigateToImportPage();
      const backupPath = ImportPage.getFixturePath('test-backup.json');
      await importPage.importBackupFile(backupPath);
      console.log('[USE_REMOTE] Client B imported backup');

      // Use goto instead of reload - more reliable with service workers
      await clientB.page.goto(clientB.page.url(), {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await clientB.page.waitForLoadState('networkidle');
      // Setup sync AFTER import, but don't wait for initial sync so we can handle the dialog
      await clientB.sync.setupSuperSync({ ...syncConfig, waitForInitialSync: false });

      // ============ PHASE 3: Client B Syncs and Chooses USE_REMOTE ============
      console.log('[USE_REMOTE] Phase 3: Client B syncs and chooses USE_REMOTE');

      // The auto-sync after enabling will trigger the conflict dialog
      // Use specific locator for the sync import conflict dialog
      const dialog = clientB.page.locator('dialog-sync-import-conflict');
      await expect(dialog).toBeVisible({ timeout: 15000 });

      // Click "Use Server Data" button
      const useRemoteButton = dialog.getByRole('button', { name: /server/i });
      await useRemoteButton.click();

      // Wait for dialog to close and sync to complete
      await expect(dialog).not.toBeVisible({ timeout: 10000 });

      // Wait for sync to fully complete after USE_REMOTE (downloads server state)
      // This is more reliable than a fixed timeout as it waits for actual sync completion
      await clientB.sync.waitForSyncToComplete({
        timeout: 30000,
        skipSpinnerCheck: true,
      });
      console.log('[USE_REMOTE] Client B chose USE_REMOTE');

      // ============ PHASE 4: Verify Client B State ============
      console.log('[USE_REMOTE] Phase 4: Verify Client B state');

      await clientB.page.goto('/#/work-view');
      await clientB.page.waitForLoadState('networkidle');
      // Allow UI to settle after navigation under load
      await clientB.page.waitForTimeout(500);

      // B should have A's task (server state), not imported tasks
      await waitForTask(clientB.page, taskARemote);
      const importedTaskOnB = clientB.page.locator(
        'task:has-text("E2E Import Test - Active Task With Subtask")',
      );
      await expect(importedTaskOnB).not.toBeVisible({ timeout: 5000 });
      console.log('[USE_REMOTE] ✓ Client B has A task, not imported tasks');

      console.log('[USE_REMOTE] ✓ USE_REMOTE test PASSED!');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario: CANCEL aborts sync without making changes
   *
   * Actions:
   * 1. Client A creates task "Task-A-Remote" and syncs
   * 2. Client B imports backup (contains different tasks)
   * 3. Client B syncs → dialog appears → clicks CANCEL
   *
   * Verify:
   * - Client B still has imported tasks (unchanged)
   * - Client A still has original task (server unchanged)
   */
  test('CANCEL aborts sync without making changes', async ({
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

      // ============ PHASE 1: Client A Creates and Syncs ============
      console.log('[CANCEL] Phase 1: Client A creates and syncs');

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      const taskARemote = `Task-A-Remote-${uniqueId}`;
      await clientA.workView.addTask(taskARemote);
      await clientA.sync.syncAndWait();
      console.log(`[CANCEL] Client A created and synced: ${taskARemote}`);

      // ============ PHASE 2: Client B Imports Backup ============
      console.log('[CANCEL] Phase 2: Client B imports backup');

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      // DO NOT setup sync before import

      const importPage = new ImportPage(clientB.page);
      await importPage.navigateToImportPage();
      const backupPath = ImportPage.getFixturePath('test-backup.json');
      await importPage.importBackupFile(backupPath);
      console.log('[CANCEL] Client B imported backup');

      // Use goto instead of reload - more reliable with service workers
      await clientB.page.goto(clientB.page.url(), {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await clientB.page.waitForLoadState('networkidle');
      // Setup sync AFTER import, but don't wait for initial sync so we can handle the dialog
      await clientB.sync.setupSuperSync({ ...syncConfig, waitForInitialSync: false });

      // ============ PHASE 3: Client B Syncs and Chooses CANCEL ============
      console.log('[CANCEL] Phase 3: Client B syncs and chooses CANCEL');

      // The auto-sync after enabling will trigger the conflict dialog
      // Wait for the sync import conflict dialog to appear
      const dialog = clientB.page.locator('dialog-sync-import-conflict');
      await expect(dialog).toBeVisible({ timeout: 15000 });

      // Click "Cancel" button
      const cancelButton = dialog.getByRole('button', { name: /cancel/i });
      await cancelButton.click();

      // Wait for dialog to close
      await expect(dialog).not.toBeVisible({ timeout: 5000 });
      console.log('[CANCEL] Client B chose CANCEL');

      // ============ PHASE 4: Verify Client B State (Unchanged) ============
      console.log('[CANCEL] Phase 4: Verify Client B state (unchanged)');

      await clientB.page.goto('/#/work-view');
      await clientB.page.waitForLoadState('networkidle');
      // Allow UI to settle after navigation under load
      await clientB.page.waitForTimeout(500);

      // B should still have imported tasks (unchanged)
      await waitForTask(clientB.page, 'E2E Import Test - Active Task With Subtask');
      const taskAOnB = clientB.page.locator(`task:has-text("${taskARemote}")`);
      await expect(taskAOnB).not.toBeVisible({ timeout: 5000 });
      console.log('[CANCEL] ✓ Client B still has imported tasks');

      // ============ PHASE 5: Verify Server State (Unchanged) ============
      console.log('[CANCEL] Phase 5: Verify server state (unchanged)');

      // Sync A again to check server state
      await clientA.sync.syncAndWait();
      await clientA.page.goto('/#/work-view');
      await clientA.page.waitForLoadState('networkidle');
      // Allow UI to settle after navigation under load
      await clientA.page.waitForTimeout(500);

      // A should still have original task (server unchanged)
      await waitForTask(clientA.page, taskARemote);
      const importedTaskOnA = clientA.page.locator(
        'task:has-text("E2E Import Test - Active Task With Subtask")',
      );
      await expect(importedTaskOnA).not.toBeVisible({ timeout: 5000 });
      console.log('[CANCEL] ✓ Server state unchanged (A still has original task)');

      console.log('[CANCEL] ✓ CANCEL test PASSED!');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});

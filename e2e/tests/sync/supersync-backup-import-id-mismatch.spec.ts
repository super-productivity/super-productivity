import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  hasTask,
  handleEncryptionWarningDialog,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * SuperSync Backup Import Replay Regression Tests
 *
 * The user-facing invariant is that tasks created after a backup import survive
 * later syncs, including concurrent sync and repeated download cycles. The exact
 * snapshot-operation ID forwarding is covered at the upload-service boundary;
 * mandatory SuperSync encryption replaces the initial snapshot before a browser
 * test can observe that transport-level detail directly.
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-backup-import-id-mismatch.spec.ts
 */

/**
 * Helper to export backup by triggering the UI export button.
 * This ensures the backup data is in the correct format for import.
 */
const exportBackup = async (page: SimulatedE2EClient['page']): Promise<string> => {
  // Navigate to settings page
  await page.goto('/#/config');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);

  // Navigate to Sync & Backup tab where Import/Export section is located
  const syncBackupTab = page.locator(
    'mat-tab-header .mat-mdc-tab:has-text("Sync & Backup"), mat-tab-header .mat-tab-label:has-text("Sync & Backup")',
  );
  await syncBackupTab.waitFor({ state: 'visible', timeout: 10000 });
  await syncBackupTab.click();
  await page.waitForTimeout(500);

  // Expand Import/Export section
  const importExportSection = page.locator('collapsible:has-text("Import/Export")');
  await importExportSection.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);

  const collapsibleHeader = importExportSection.locator('.collapsible-header, .header');
  await collapsibleHeader.click();
  await page.waitForTimeout(500);

  // Set up download handler before clicking export
  const tempDir = os.tmpdir();
  const backupPath = path.join(tempDir, `sp-backup-idmismatch-${Date.now()}.json`);

  // Wait for download and save to temp file
  const downloadPromise = page.waitForEvent('download');

  // Click the export button (export current data).
  // Use exact name match — after #7141, a sibling "Export Data (anonymized)"
  // button shares the "Export" prefix and would break a loose has-text selector.
  const exportBtn = page.getByRole('button', { name: 'Export Data', exact: true });
  await exportBtn.waitFor({ state: 'visible', timeout: 5000 });
  await exportBtn.click();

  const download = await downloadPromise;
  await download.saveAs(backupPath);

  // Navigate back to tasks
  await page.goto('/#/tag/TODAY/tasks');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);

  return backupPath;
};

/**
 * Helper to import backup file.
 * Returns true if import succeeded, false if it failed.
 */
const importBackup = async (
  page: SimulatedE2EClient['page'],
  backupPath: string,
): Promise<boolean> => {
  // Track console errors during import
  let importFailed = false;
  const errorHandler = (msg: { text: () => string }): void => {
    if (msg.text().includes('Import process failed')) {
      importFailed = true;
    }
  };
  page.on('console', errorHandler);

  await page.goto('/#/config');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);

  // Navigate to Sync & Backup tab where Import/Export section is located
  const syncBackupTab = page.locator(
    'mat-tab-header .mat-mdc-tab:has-text("Sync & Backup"), mat-tab-header .mat-tab-label:has-text("Sync & Backup")',
  );
  await syncBackupTab.waitFor({ state: 'visible', timeout: 10000 });
  await syncBackupTab.click();
  await page.waitForTimeout(500);

  const importExportSection = page.locator('collapsible:has-text("Import/Export")');
  await importExportSection.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);

  const collapsibleHeader = importExportSection.locator('.collapsible-header, .header');
  await collapsibleHeader.click();
  await page.waitForTimeout(500);

  const fileInput = page.locator('file-imex input[type="file"]');
  await fileInput.setInputFiles(backupPath);

  await handleEncryptionWarningDialog(page, '[importBackup]');

  // Wait for import to complete (app navigates to TODAY tag) or error
  const startTime = Date.now();
  const timeout = 30000;
  while (Date.now() - startTime < timeout) {
    if (importFailed) {
      page.off('console', errorHandler);
      return false;
    }
    const url = page.url();
    if (url.includes('tag') && url.includes('TODAY')) {
      break;
    }
    await page.waitForTimeout(500);
  }

  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);

  page.off('console', errorHandler);
  return !importFailed;
};

test.describe('@supersync Backup Import Replay Regression', () => {
  /**
   * CRITICAL BUG REPRODUCTION TEST - With concurrent client causing rejection
   *
   * This test more closely reproduces the actual bug scenario:
   * 1. Client A imports backup → BACKUP_IMPORT with local ID X
   * 2. Client A syncs → server creates BACKUP_IMPORT with ID Y
   * 3. Client A creates new task
   * 4. Client B syncs (causes concurrent operations on server)
   * 5. Client A syncs → some ops may be rejected, triggering re-download
   * 6. Re-download returns BACKUP_IMPORT with ID Y
   * 7. Client A doesn't recognize ID Y → re-applies old state → DATA LOST
   */
  test('Tasks should survive when concurrent client causes operation rejection', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;
    let backupPath: string | null = null;

    try {
      const user = await createTestUser(testRunId + '-concurrent');
      const syncConfig = getSuperSyncConfig(user);

      // ============ Setup: Client A connects first ============
      console.log('[Concurrent Test] Phase 1: Client A setup');

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);
      await clientA.sync.syncAndWait();

      // Create initial task
      const initialTaskName = `InitialConcurrent-${testRunId}`;
      await clientA.workView.addTask(initialTaskName);
      await waitForTask(clientA.page, initialTaskName);
      await clientA.sync.syncAndWait();
      console.log(`[Concurrent Test] Created initial task: ${initialTaskName}`);

      // ============ Client A exports and imports backup ============
      console.log('[Concurrent Test] Phase 2: Export and import backup');

      backupPath = await exportBackup(clientA.page);
      const importSuccess = await importBackup(clientA.page, backupPath);
      if (!importSuccess) {
        throw new Error('Backup import failed');
      }
      console.log('[Concurrent Test] Backup imported');

      // Re-setup sync and sync (uploads BACKUP_IMPORT)
      await clientA.sync.setupSuperSync(syncConfig);
      await clientA.sync.syncAndWait();
      console.log(
        '[Concurrent Test] BACKUP_IMPORT uploaded (server assigns different ID)',
      );

      // ============ Client A creates task AFTER backup import ============
      console.log('[Concurrent Test] Phase 3: Create task after import');

      const taskAfterImportName = `TaskAfterConcurrent-${testRunId}`;
      await clientA.workView.addTask(taskAfterImportName);
      await waitForTask(clientA.page, taskAfterImportName);
      console.log(`[Concurrent Test] Created post-import task: ${taskAfterImportName}`);

      // ============ Client B joins and creates concurrent operations ============
      console.log('[Concurrent Test] Phase 4: Client B creates concurrent operations');

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();

      // Client B creates a task (this creates concurrent ops on server)
      const clientBTask = `ClientBTask-${testRunId}`;
      await clientB.workView.addTask(clientBTask);
      await waitForTask(clientB.page, clientBTask);
      await clientB.sync.syncAndWait();
      console.log(`[Concurrent Test] Client B created task: ${clientBTask}`);

      // ============ Client A syncs (may trigger rejection/re-download) ============
      console.log(
        '[Concurrent Test] Phase 5: Client A syncs with concurrent server state',
      );

      // Verify task exists before sync
      const hasBefore = await hasTask(clientA.page, taskAfterImportName);
      console.log(`[Concurrent Test] Before sync - TaskAfterImport exists: ${hasBefore}`);
      expect(hasBefore).toBe(true);

      await clientA.sync.syncAndWait();
      console.log('[Concurrent Test] Client A sync completed');

      // Wait for state to settle
      await clientA.page.waitForTimeout(2000);

      // ============ Verify task survived ============
      console.log('[Concurrent Test] Phase 6: Verify task survived');

      await clientA.page.goto('/#/tag/TODAY/tasks');
      await clientA.page.waitForLoadState('networkidle');
      await clientA.page.waitForTimeout(1000);

      const hasAfter = await hasTask(clientA.page, taskAfterImportName);
      console.log(`[Concurrent Test] After sync - TaskAfterImport exists: ${hasAfter}`);

      // CRITICAL ASSERTION
      expect(
        hasAfter,
        'TaskAfterImport should survive concurrent sync. ' +
          'Bug: BACKUP_IMPORT was re-applied with server ID.',
      ).toBe(true);

      console.log('[Concurrent Test] ✓ Test PASSED');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
      if (backupPath && fs.existsSync(backupPath)) {
        fs.unlinkSync(backupPath);
      }
    }
  });

  /**
   * Additional verification: Check that a second sync also doesn't lose data
   *
   * This ensures the fix is robust - even multiple syncs after backup import
   * should not lose data.
   */
  test('Multiple syncs after backup import should not lose data', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    let clientA: SimulatedE2EClient | null = null;
    let backupPath: string | null = null;

    try {
      const user = await createTestUser(testRunId + '-multisync');
      const syncConfig = getSuperSyncConfig(user);

      // Setup
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);
      await clientA.sync.syncAndWait();

      // Create initial task
      const initialTaskName = `InitialMulti-${testRunId}`;
      await clientA.workView.addTask(initialTaskName);
      await waitForTask(clientA.page, initialTaskName);
      await clientA.sync.syncAndWait();

      // Export and import backup
      backupPath = await exportBackup(clientA.page);
      const importSuccess = await importBackup(clientA.page, backupPath);
      if (!importSuccess) {
        throw new Error('Backup import failed - cannot test multi-sync scenario');
      }

      // Re-setup sync and sync after import
      await clientA.sync.setupSuperSync(syncConfig);
      await clientA.sync.syncAndWait();

      // Create task after import
      const taskAfterImportName = `TaskAfterMulti-${testRunId}`;
      await clientA.workView.addTask(taskAfterImportName);
      await waitForTask(clientA.page, taskAfterImportName);

      // Multiple syncs - each could potentially trigger the bug
      console.log('[Multi-Sync Test] Performing multiple syncs...');
      for (let i = 1; i <= 3; i++) {
        await clientA.sync.syncAndWait();
        console.log(`[Multi-Sync Test] Sync ${i} completed`);

        await clientA.page.waitForTimeout(500);

        // Check after each sync
        const hasNew = await hasTask(clientA.page, taskAfterImportName);
        expect(
          hasNew,
          `TaskAfterImport should exist after sync ${i}. Bug: BACKUP_IMPORT re-applied.`,
        ).toBe(true);
      }

      console.log('[Multi-Sync Test] ✓ All syncs completed, task survived');
    } finally {
      if (clientA) await closeClient(clientA);
      if (backupPath && fs.existsSync(backupPath)) {
        fs.unlinkSync(backupPath);
      }
    }
  });
});

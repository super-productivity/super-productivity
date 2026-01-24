import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  hasTask,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * SuperSync Backup Import ID Mismatch Bug Reproduction Test
 *
 * BUG: When a backup is imported and synced, the client creates a BACKUP_IMPORT
 * operation with a local ID. However, uploadSnapshot() does NOT send this ID to
 * the server - the server generates its own ID. When the client later downloads
 * operations, it doesn't recognize the server's BACKUP_IMPORT (different ID) as
 * a duplicate, so it RE-APPLIES the old backup state, overwriting any tasks
 * created after the import.
 *
 * ROOT CAUSE: Missing op.id parameter in uploadSnapshot() interface at
 * src/app/op-log/sync-providers/provider.interface.ts:277-284
 *
 * EXPECTED: Tasks created after backup import should survive subsequent syncs.
 * ACTUAL (BUG): Tasks created after backup import are LOST because the old
 * BACKUP_IMPORT state is re-applied.
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

  // Click the export button (export current data)
  const exportBtn = page.locator('file-imex button:has-text("Export")');
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

test.describe('@supersync Backup Import ID Mismatch Bug', () => {
  /**
   * CRITICAL BUG VERIFICATION TEST
   *
   * This test verifies that the BACKUP_IMPORT operation ID mismatch bug exists.
   *
   * BUG: When uploading a BACKUP_IMPORT via uploadSnapshot(), the client's op.id
   * is NOT sent to the server. The server generates its own ID for the operation.
   *
   * This test:
   * 1. Client A imports backup (creates BACKUP_IMPORT with LOCAL ID)
   * 2. Client A syncs (uploads BACKUP_IMPORT - server generates DIFFERENT ID)
   * 3. Query IndexedDB for local BACKUP_IMPORT op ID
   * 4. Query server API for the operation ID it stored
   * 5. VERIFY: The IDs are DIFFERENT (this proves the bug exists)
   *
   * When the bug is FIXED, the IDs should match and this test should FAIL.
   */
  test('BUG: Server stores BACKUP_IMPORT with different ID than client (ID mismatch)', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    let clientA: SimulatedE2EClient | null = null;
    let backupPath: string | null = null;

    try {
      const user = await createTestUser(testRunId + '-idmismatch');
      const syncConfig = getSuperSyncConfig(user);

      // ============ PHASE 1: Setup - Connect and sync ============
      console.log('[ID Mismatch Test] Phase 1: Setting up client');

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);
      await clientA.sync.syncAndWait();
      console.log('[ID Mismatch Test] Client A connected and synced');

      // Create initial task that will be in the backup
      const initialTaskName = `InitialTask-${testRunId}`;
      await clientA.workView.addTask(initialTaskName);
      await waitForTask(clientA.page, initialTaskName);
      await clientA.sync.syncAndWait();
      console.log(`[ID Mismatch Test] Created and synced initial task`);

      // ============ PHASE 2: Export and import backup ============
      console.log('[ID Mismatch Test] Phase 2: Export and import backup');

      backupPath = await exportBackup(clientA.page);
      const importSuccess = await importBackup(clientA.page, backupPath);
      if (!importSuccess) {
        throw new Error('Backup import failed');
      }
      console.log(
        '[ID Mismatch Test] Backup imported (BACKUP_IMPORT created with local ID)',
      );

      // ============ PHASE 3: Get local BACKUP_IMPORT op ID from IndexedDB ============
      console.log('[ID Mismatch Test] Phase 3: Getting local BACKUP_IMPORT op ID');

      // Wait for IndexedDB writes to complete
      await clientA.page.waitForTimeout(1000);

      const localOpData = await clientA.page.evaluate(async () => {
        // Open SUP_OPS database
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('SUP_OPS');
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });

        // Compact operation format uses short keys:
        // o = opType, a = actionType, e = entityType, etc.
        interface CompactOp {
          id: string;
          o: string; // opType
          a: string; // actionType short code
          e: string; // entityType
        }

        // Get all operations from the 'ops' store
        const ops = await new Promise<Array<{ seq: number; op: CompactOp }>>(
          (resolve, reject) => {
            const tx = db.transaction('ops', 'readonly');
            const store = tx.objectStore('ops');
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
          },
        );

        db.close();

        // Debug: Log all operations
        const debugInfo = ops.map((entry) => ({
          seq: entry.seq,
          opType: entry.op?.o,
          entityType: entry.op?.e,
          id: entry.op?.id?.substring(0, 20),
        }));

        // Find BACKUP_IMPORT operation (opType 'BACKUP_IMPORT')
        const backupImportOp = ops.find((entry) => entry.op?.o === 'BACKUP_IMPORT');

        return {
          opId: backupImportOp?.op.id || null,
          debugInfo,
          totalOps: ops.length,
        };
      });

      console.log(
        `[ID Mismatch Test] Debug: Found ${localOpData.totalOps} ops:`,
        JSON.stringify(localOpData.debugInfo),
      );
      const localOpId = localOpData.opId;

      console.log(`[ID Mismatch Test] Local BACKUP_IMPORT op ID: ${localOpId}`);
      expect(localOpId).toBeTruthy();

      // ============ PHASE 4: Sync to upload BACKUP_IMPORT ============
      console.log('[ID Mismatch Test] Phase 4: Syncing to upload BACKUP_IMPORT');

      await clientA.sync.setupSuperSync(syncConfig);
      await clientA.sync.syncAndWait();
      console.log('[ID Mismatch Test] Sync completed - BACKUP_IMPORT uploaded to server');

      // ============ PHASE 5: Query server for the operation ID it stored ============
      console.log('[ID Mismatch Test] Phase 5: Querying server for stored operation ID');

      // Query the PostgreSQL database directly to get the server's operation ID
      // The download API doesn't return the SYNC_IMPORT due to server optimization
      // (it skips to the SYNC_IMPORT's seq but doesn't include the operation itself)
      const { execSync } = await import('child_process');

      // Query the database for SYNC_IMPORT operations for this user
      // Database uses snake_case column names: user_id, op_type, server_seq
      const dbQuery =
        `SELECT id, op_type FROM operations ` +
        `WHERE user_id = '${user.userId}' ` +
        `AND op_type IN ('SYNC_IMPORT', 'BACKUP_IMPORT', 'REPAIR') ` +
        `ORDER BY server_seq DESC LIMIT 1;`;

      let serverOpId: string | null = null;
      try {
        const dbResult = execSync(
          `docker exec super-productivity-db-1 psql -U supersync -d supersync_db -t -A -c "${dbQuery}"`,
          { encoding: 'utf8' },
        ).trim();

        console.log(`[ID Mismatch Test] Database query result: ${dbResult}`);

        if (dbResult) {
          // Result format: "uuid|op_type"
          const [opId] = dbResult.split('|');
          serverOpId = opId || null;
        }
      } catch (err) {
        console.error(`[ID Mismatch Test] Database query failed:`, err);
      }

      console.log(`[ID Mismatch Test] Server operation ID from database: ${serverOpId}`);

      // ============ PHASE 6: CRITICAL ASSERTION - IDs should match ============
      console.log('[ID Mismatch Test] Phase 6: Comparing local and server op IDs');
      console.log(`[ID Mismatch Test]   Local ID:  ${localOpId}`);
      console.log(`[ID Mismatch Test]   Server ID: ${serverOpId}`);

      // BUG: The IDs are DIFFERENT because uploadSnapshot doesn't send op.id
      // When the bug is FIXED, this assertion should PASS (IDs match)
      // Currently, this test FAILS because the IDs are different
      expect(serverOpId).toBeTruthy();
      expect(
        localOpId,
        'BUG: Local BACKUP_IMPORT op ID should match server op ID. ' +
          'The server generated a different ID because uploadSnapshot() does not send op.id. ' +
          `Local: ${localOpId}, Server: ${serverOpId}`,
      ).toBe(serverOpId);

      console.log('[ID Mismatch Test] ✓ IDs MATCH - Bug is fixed!');
    } finally {
      if (clientA) await closeClient(clientA);
      if (backupPath && fs.existsSync(backupPath)) {
        fs.unlinkSync(backupPath);
      }
    }
  });

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

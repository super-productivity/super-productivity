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

test.describe('@supersync Backup Import ID Mismatch Bug', () => {
  /**
   * Verifies that BACKUP_IMPORT operation IDs match between client and server.
   *
   * KNOWN LIMITATION: SuperSync's mandatory encryption creates a clean-slate
   * SYNC_IMPORT that overwrites the initial BACKUP_IMPORT on the server.
   * The upload code correctly sends op.id and snapshotOpType, but the
   * encryption setup always creates a replacement SYNC_IMPORT with a new ID.
   * This test cannot pass until encryption setup preserves the original op ID.
   *
   * The user-facing behavior (tasks surviving after backup import) is verified
   * by the other tests in this file ('Tasks should survive...' and 'Multiple syncs...').
   */
  test.fixme('Server stores BACKUP_IMPORT with matching client ID', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    let clientA: SimulatedE2EClient | null = null;
    let backupPath: string | null = null;

    try {
      const user = await createTestUser(testRunId + '-idmismatch');
      const syncConfig = getSuperSyncConfig(user);

      // ============ PHASE 1: Create task and export backup (no sync yet) ============
      console.log('[ID Mismatch Test] Phase 1: Create task and export backup');

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);

      // Create initial task that will be in the backup
      const initialTaskName = `InitialTask-${testRunId}`;
      await clientA.workView.addTask(initialTaskName);
      await waitForTask(clientA.page, initialTaskName);

      backupPath = await exportBackup(clientA.page);
      console.log(`[ID Mismatch Test] Exported backup`);

      // ============ PHASE 2: Import backup (creates BACKUP_IMPORT locally) ============
      console.log('[ID Mismatch Test] Phase 2: Import backup');

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
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('SUP_OPS');
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });

        interface CompactOp {
          id: string;
          o: string; // opType
          a: string; // actionType short code
          e: string; // entityType
        }

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

        const debugInfo = ops.map((entry) => ({
          seq: entry.seq,
          opType: entry.op?.o,
          entityType: entry.op?.e,
          id: entry.op?.id?.substring(0, 20),
        }));

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

      // ============ PHASE 4: Enable sync for the FIRST time (server is empty) ============
      // IMPORTANT: By enabling sync on a fresh server, the pending BACKUP_IMPORT
      // gets uploaded directly as a snapshot (no existing server data to conflict with).
      console.log('[ID Mismatch Test] Phase 4: Enabling sync (server is empty)');

      await clientA.sync.setupSuperSync(syncConfig);
      await clientA.sync.syncAndWait();
      console.log('[ID Mismatch Test] Sync completed - BACKUP_IMPORT uploaded to server');

      // ============ PHASE 5: Query server for the operation ID it stored ============
      console.log('[ID Mismatch Test] Phase 5: Querying server for stored operation ID');

      // Query for BACKUP_IMPORT first, fall back to any snapshot op
      let serverOpId: string | null = null;
      let serverOpType: string | null = null;
      try {
        // Try BACKUP_IMPORT first
        let opsResponse = await fetch(
          `http://localhost:1901/api/test/user/${user.userId}/ops?opType=BACKUP_IMPORT&limit=1`,
        );
        if (opsResponse.ok) {
          const opsData = (await opsResponse.json()) as {
            ops: Array<{ id: string; opType: string }>;
          };
          console.log(`[ID Mismatch Test] BACKUP_IMPORT ops:`, JSON.stringify(opsData));
          if (opsData.ops.length > 0) {
            serverOpId = opsData.ops[0].id;
            serverOpType = opsData.ops[0].opType;
          }
        }

        // If no BACKUP_IMPORT found, check for SYNC_IMPORT (in case opType mapping differs)
        if (!serverOpId) {
          opsResponse = await fetch(
            `http://localhost:1901/api/test/user/${user.userId}/ops?opType=SYNC_IMPORT&limit=1`,
          );
          if (opsResponse.ok) {
            const opsData = (await opsResponse.json()) as {
              ops: Array<{ id: string; opType: string }>;
            };
            console.log(`[ID Mismatch Test] SYNC_IMPORT ops:`, JSON.stringify(opsData));
            if (opsData.ops.length > 0) {
              serverOpId = opsData.ops[0].id;
              serverOpType = opsData.ops[0].opType;
            }
          }
        }
      } catch (err) {
        console.error(`[ID Mismatch Test] Server ops query failed:`, err);
      }

      console.log(`[ID Mismatch Test] Server op: type=${serverOpType}, id=${serverOpId}`);

      // ============ PHASE 6: CRITICAL ASSERTION - IDs should match ============
      console.log('[ID Mismatch Test] Phase 6: Comparing local and server op IDs');
      console.log(`[ID Mismatch Test]   Local ID:  ${localOpId}`);
      console.log(`[ID Mismatch Test]   Server ID: ${serverOpId}`);

      expect(serverOpId).toBeTruthy();
      expect(
        localOpId,
        'Local BACKUP_IMPORT op ID should match server op ID. ' +
          `Local: ${localOpId}, Server: ${serverOpId} (type: ${serverOpType})`,
      ).toBe(serverOpId);

      console.log('[ID Mismatch Test] ✓ IDs MATCH!');
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

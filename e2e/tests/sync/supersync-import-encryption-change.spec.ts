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
 * SuperSync Import with Encryption State Change E2E Tests
 *
 * These tests verify that importing data with different encryption settings
 * properly handles the encryption state change:
 * - Server data is wiped (encrypted ops can't mix with unencrypted)
 * - A fresh snapshot is uploaded with correct encryption settings
 * - Other clients can sync with the new encryption state
 *
 * This is the "tabula rasa" behavior for encryption state changes during import.
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-import-encryption-change.spec.ts
 */

test.describe('@supersync @encryption Import with Encryption State Change', () => {
  /**
   * Scenario: Import unencrypted backup while encrypted sync is active
   *
   * This tests the critical case where:
   * - Client has encryption enabled with existing encrypted data on server
   * - Client imports a backup that doesn't have encryption enabled
   * - Server should be wiped and fresh unencrypted snapshot uploaded
   * - New clients should sync without encryption
   *
   * Setup: Client A with encryption enabled
   *
   * Actions:
   * 1. Client A sets up SuperSync with encryption enabled
   * 2. Client A creates task "EncryptedTask" and syncs (encrypted)
   * 3. Client A imports backup (has encryption disabled)
   * 4. Server data should be wiped and unencrypted snapshot uploaded
   * 5. Client B sets up SuperSync WITHOUT encryption
   * 6. Client B syncs and should get imported data
   *
   * Verify:
   * - Client A has imported tasks (not EncryptedTask)
   * - Client B can sync WITHOUT encryption and has imported tasks
   * - No encryption errors occur
   */
  test('Import unencrypted backup while encrypted sync is active', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    const uniqueId = Date.now();
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const baseConfig = getSuperSyncConfig(user);
      const encryptionPassword = `pass-${testRunId}`;

      // ============ PHASE 1: Setup Client A with Encryption ============
      console.log('[EncryptionChange] Phase 1: Setting up Client A with encryption');

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync({
        ...baseConfig,
        isEncryptionEnabled: true,
        password: encryptionPassword,
      });

      // Create and sync encrypted task
      const encryptedTask = `EncryptedTask-${uniqueId}`;
      await clientA.workView.addTask(encryptedTask);
      await clientA.sync.syncAndWait();
      console.log(`[EncryptionChange] Client A created encrypted: ${encryptedTask}`);

      // Verify task exists
      await waitForTask(clientA.page, encryptedTask);

      // ============ PHASE 2: Import Unencrypted Backup ============
      console.log('[EncryptionChange] Phase 2: Client A importing unencrypted backup');

      // Navigate to import page
      const importPage = new ImportPage(clientA.page);
      await importPage.navigateToImportPage();

      // Import the backup file (has encryption disabled)
      const backupPath = ImportPage.getFixturePath('test-backup.json');

      // Set file on input (this triggers the import flow)
      const fileInput = clientA.page.locator('file-imex input[type="file"]');
      await fileInput.setInputFiles(backupPath);

      // Handle "Encryption Settings Will Change" dialog that appears when
      // importing a backup with different encryption settings
      const encryptionChangeDialog = clientA.page.locator(
        'mat-dialog-container:has-text("Encryption Settings Will Change")',
      );
      await encryptionChangeDialog.waitFor({ state: 'visible', timeout: 10000 });
      console.log('[EncryptionChange] Encryption change dialog appeared');

      const importAndChangeBtn = encryptionChangeDialog.locator(
        'button:has-text("Import and Change Encryption")',
      );
      await importAndChangeBtn.click();
      console.log('[EncryptionChange] Clicked Import and Change Encryption');

      // Wait for dialog to close and import to complete
      await encryptionChangeDialog.waitFor({ state: 'hidden', timeout: 15000 });

      // Wait for import to complete - app redirects to TODAY tag
      await clientA.page.waitForURL(/tag\/TODAY/, { timeout: 30000 });
      console.log('[EncryptionChange] Client A imported unencrypted backup');

      // Navigate to work view
      await clientA.page.goto('/#/work-view');
      await clientA.page.waitForLoadState('networkidle');

      // Wait for imported tasks to be visible
      await waitForTask(clientA.page, 'E2E Import Test - Active Task With Subtask');
      console.log('[EncryptionChange] Client A has imported tasks visible after import');

      // Re-setup sync after import (import overwrites globalConfig)
      // Use encryption disabled since the imported backup has encryption disabled
      await clientA.sync.setupSuperSync({
        ...baseConfig,
        isEncryptionEnabled: false,
      });
      console.log('[EncryptionChange] Client A re-enabled sync without encryption');

      // ============ PHASE 3: Sync After Import ============
      console.log('[EncryptionChange] Phase 3: Client A syncing after import');

      await clientA.sync.syncAndWait();
      console.log('[EncryptionChange] Client A synced successfully');

      // ============ PHASE 4: Client B Syncs Without Encryption ============
      console.log('[EncryptionChange] Phase 4: Client B syncing without encryption');

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      // Setup WITHOUT encryption - should work since import disabled encryption
      await clientB.sync.setupSuperSync({
        ...baseConfig,
        isEncryptionEnabled: false,
      });

      await clientB.sync.syncAndWait();
      console.log('[EncryptionChange] Client B synced successfully');

      // ============ PHASE 5: Verify Clean Slate ============
      console.log('[EncryptionChange] Phase 5: Verifying encryption state change');

      // Navigate to work view on both clients
      await clientA.page.goto('/#/work-view');
      await clientA.page.waitForLoadState('networkidle');
      await clientB.page.goto('/#/work-view');
      await clientB.page.waitForLoadState('networkidle');

      // Wait for imported task to appear on both
      await waitForTask(clientA.page, 'E2E Import Test - Active Task With Subtask');
      await waitForTask(clientB.page, 'E2E Import Test - Active Task With Subtask');

      // CRITICAL: Original encrypted task should be GONE
      const encryptedTaskOnA = clientA.page.locator(`task:has-text("${encryptedTask}")`);
      const encryptedTaskOnB = clientB.page.locator(`task:has-text("${encryptedTask}")`);

      await expect(encryptedTaskOnA).not.toBeVisible({ timeout: 5000 });
      await expect(encryptedTaskOnB).not.toBeVisible({ timeout: 5000 });
      console.log('[EncryptionChange] ✓ Original encrypted task is GONE');

      // Verify imported tasks are present on both clients
      const importedTaskOnA = clientA.page.locator(
        'task:has-text("E2E Import Test - Active Task With Subtask")',
      );
      const importedTaskOnB = clientB.page.locator(
        'task:has-text("E2E Import Test - Active Task With Subtask")',
      );

      await expect(importedTaskOnA).toBeVisible({ timeout: 5000 });
      await expect(importedTaskOnB).toBeVisible({ timeout: 5000 });
      console.log('[EncryptionChange] ✓ Both clients have imported tasks');

      // Verify no encryption errors on Client B (would indicate encrypted data leaked)
      const hasError = await clientB.sync.hasSyncError();
      expect(hasError).toBe(false);
      console.log('[EncryptionChange] ✓ No encryption errors on Client B');

      console.log('[EncryptionChange] ✓ Import encryption change test PASSED!');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario: Import encrypted backup while unencrypted sync is active
   *
   * Tests the reverse scenario where:
   * - Client has unencrypted sync active
   * - Client imports a backup that has encryption enabled
   * - Server should be wiped and encrypted snapshot uploaded
   *
   * Setup: Client A with unencrypted sync
   *
   * Actions:
   * 1. Client A sets up SuperSync without encryption
   * 2. Client A creates task "UnencryptedTask" and syncs
   * 3. Client A imports backup (has encryption enabled in globalConfig.sync)
   * 4. After import, user must provide encryption password for sync
   * 5. Server data should be wiped and encrypted snapshot uploaded
   * 6. Client B sets up SuperSync WITH encryption using same password
   * 7. Client B syncs and should get imported data
   *
   * Verify:
   * - Client A has imported tasks (not UnencryptedTask)
   * - Client B can sync WITH encryption and has imported tasks
   * - No encryption errors occur
   */
  test('Import encrypted backup while unencrypted sync is active', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    const uniqueId = Date.now();
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const baseConfig = getSuperSyncConfig(user);
      const encryptionPassword = `pass-${testRunId}`;

      // ============ PHASE 1: Setup Client A WITHOUT Encryption ============
      console.log(
        '[EncryptionChange-Reverse] Phase 1: Setting up Client A without encryption',
      );

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync({
        ...baseConfig,
        isEncryptionEnabled: false,
      });

      // Create and sync unencrypted task
      const unencryptedTask = `UnencryptedTask-${uniqueId}`;
      await clientA.workView.addTask(unencryptedTask);
      await clientA.sync.syncAndWait();
      console.log(
        `[EncryptionChange-Reverse] Client A created unencrypted: ${unencryptedTask}`,
      );

      // Verify task exists
      await waitForTask(clientA.page, unencryptedTask);

      // ============ PHASE 2: Import Encrypted Backup ============
      console.log(
        '[EncryptionChange-Reverse] Phase 2: Client A importing encrypted backup',
      );

      // Navigate to import page
      const importPage = new ImportPage(clientA.page);
      await importPage.navigateToImportPage();

      // Import the encrypted backup file (has encryption enabled in globalConfig.sync)
      const backupPath = ImportPage.getFixturePath('test-backup-encrypted.json');

      // Set file on input (this triggers the import flow)
      const fileInput = clientA.page.locator('file-imex input[type="file"]');
      await fileInput.setInputFiles(backupPath);

      // The "Encryption Settings Will Change" dialog may or may not appear.
      // It depends on whether the app detects the encryption mismatch.
      // Wait to see if either the dialog appears or the import completes directly.
      const encryptionChangeDialog = clientA.page.locator(
        'mat-dialog-container:has-text("Encryption Settings Will Change")',
      );

      const importOutcome = await Promise.race([
        encryptionChangeDialog
          .waitFor({ state: 'visible', timeout: 10000 })
          .then(() => 'encryption_dialog' as const),
        clientA.page
          .waitForURL(/tag\/TODAY/, { timeout: 10000 })
          .then(() => 'import_completed' as const),
      ]).catch(() => 'timeout' as const);

      if (importOutcome === 'encryption_dialog') {
        console.log('[EncryptionChange-Reverse] Encryption change dialog appeared');
        const importAndChangeBtn = encryptionChangeDialog.locator(
          'button:has-text("Import and Change Encryption")',
        );
        await importAndChangeBtn.click();
        console.log('[EncryptionChange-Reverse] Clicked Import and Change Encryption');
        await encryptionChangeDialog.waitFor({ state: 'hidden', timeout: 15000 });
        await clientA.page.waitForURL(/tag\/TODAY/, { timeout: 30000 });
      } else if (importOutcome === 'import_completed') {
        console.log(
          '[EncryptionChange-Reverse] Import completed without encryption dialog',
        );
      } else {
        // Timeout - check if import actually completed
        const currentUrl = clientA.page.url();
        if (currentUrl.includes('tag/TODAY')) {
          console.log('[EncryptionChange-Reverse] Import completed (detected via URL)');
        } else {
          throw new Error(
            `Import timed out waiting for dialog or completion. Current URL: ${currentUrl}`,
          );
        }
      }
      console.log('[EncryptionChange-Reverse] Client A imported encrypted backup');

      // Navigate to work view
      await clientA.page.goto('/#/work-view');
      await clientA.page.waitForLoadState('networkidle');

      // Wait for imported tasks to be visible
      await waitForTask(clientA.page, 'E2E Import Test - Encrypted Task With Subtask');
      console.log(
        '[EncryptionChange-Reverse] Client A has imported tasks visible after import',
      );

      // Re-setup sync after import with encryption enabled
      // The backup had isEncryptionEnabled: true, so we need to provide a password
      await clientA.sync.setupSuperSync({
        ...baseConfig,
        isEncryptionEnabled: true,
        password: encryptionPassword,
      });
      console.log('[EncryptionChange-Reverse] Client A re-enabled sync with encryption');

      // ============ PHASE 3: Sync After Import ============
      console.log('[EncryptionChange-Reverse] Phase 3: Client A syncing after import');

      await clientA.sync.syncAndWait();
      console.log('[EncryptionChange-Reverse] Client A synced successfully');

      // ============ PHASE 4: Client B Syncs With Encryption ============
      console.log('[EncryptionChange-Reverse] Phase 4: Client B syncing with encryption');

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      // Setup WITH encryption - should work since import enabled encryption
      await clientB.sync.setupSuperSync({
        ...baseConfig,
        isEncryptionEnabled: true,
        password: encryptionPassword,
      });

      await clientB.sync.syncAndWait();
      console.log('[EncryptionChange-Reverse] Client B synced successfully');

      // ============ PHASE 5: Verify Clean Slate ============
      console.log(
        '[EncryptionChange-Reverse] Phase 5: Verifying encryption state change',
      );

      // Navigate to work view on both clients
      await clientA.page.goto('/#/work-view');
      await clientA.page.waitForLoadState('networkidle');
      await clientB.page.goto('/#/work-view');
      await clientB.page.waitForLoadState('networkidle');

      // Wait for imported task to appear on both
      await waitForTask(clientA.page, 'E2E Import Test - Encrypted Task With Subtask');
      await waitForTask(clientB.page, 'E2E Import Test - Encrypted Task With Subtask');

      // CRITICAL: Original unencrypted task should be GONE
      const unencryptedTaskOnA = clientA.page.locator(
        `task:has-text("${unencryptedTask}")`,
      );
      const unencryptedTaskOnB = clientB.page.locator(
        `task:has-text("${unencryptedTask}")`,
      );

      await expect(unencryptedTaskOnA).not.toBeVisible({ timeout: 5000 });
      await expect(unencryptedTaskOnB).not.toBeVisible({ timeout: 5000 });
      console.log('[EncryptionChange-Reverse] Original unencrypted task is GONE');

      // Verify imported tasks are present on both clients
      const importedTaskOnA = clientA.page.locator(
        'task:has-text("E2E Import Test - Encrypted Task With Subtask")',
      );
      const importedTaskOnB = clientB.page.locator(
        'task:has-text("E2E Import Test - Encrypted Task With Subtask")',
      );

      await expect(importedTaskOnA).toBeVisible({ timeout: 5000 });
      await expect(importedTaskOnB).toBeVisible({ timeout: 5000 });
      console.log('[EncryptionChange-Reverse] Both clients have imported tasks');

      // Verify no encryption errors on Client B
      const hasError = await clientB.sync.hasSyncError();
      expect(hasError).toBe(false);
      console.log('[EncryptionChange-Reverse] No encryption errors on Client B');

      console.log('[EncryptionChange-Reverse] Import encrypted backup test PASSED!');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario: Bidirectional sync works after encryption state change via import
   *
   * After importing with encryption change, verify that:
   * - Both clients can create new tasks
   * - Tasks sync correctly in both directions
   * - No encryption mismatches occur
   */
  test('Bidirectional sync works after encryption change via import', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    const uniqueId = Date.now();
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const baseConfig = getSuperSyncConfig(user);
      const encryptionPassword = `pass-${testRunId}`;

      // ============ Setup with encryption, then import unencrypted ============
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync({
        ...baseConfig,
        isEncryptionEnabled: true,
        password: encryptionPassword,
      });

      // Initial sync to establish account
      await clientA.sync.syncAndWait();

      // Import unencrypted backup
      const importPage = new ImportPage(clientA.page);
      await importPage.navigateToImportPage();
      const backupPath = ImportPage.getFixturePath('test-backup.json');

      // Set file on input (this triggers the import flow)
      const fileInput = clientA.page.locator('file-imex input[type="file"]');
      await fileInput.setInputFiles(backupPath);

      // Handle "Encryption Settings Will Change" dialog
      const encryptionChangeDialog = clientA.page.locator(
        'mat-dialog-container:has-text("Encryption Settings Will Change")',
      );
      await encryptionChangeDialog.waitFor({ state: 'visible', timeout: 10000 });
      const importAndChangeBtn = encryptionChangeDialog.locator(
        'button:has-text("Import and Change Encryption")',
      );
      await importAndChangeBtn.click();
      await encryptionChangeDialog.waitFor({ state: 'hidden', timeout: 15000 });

      // Wait for import to complete - import redirects to TODAY tag
      await clientA.page.waitForURL(/tag\/TODAY/, { timeout: 30000 });
      await clientA.page.goto('/#/work-view');
      await clientA.page.waitForLoadState('networkidle');

      // Wait for imported tasks BEFORE re-configuring sync
      await waitForTask(clientA.page, 'E2E Import Test - Active Task With Subtask');

      // Re-configure without encryption and sync
      await clientA.sync.setupSuperSync({
        ...baseConfig,
        isEncryptionEnabled: false,
      });
      await clientA.sync.syncAndWait();

      // ============ Setup Client B without encryption ============
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync({
        ...baseConfig,
        isEncryptionEnabled: false,
      });
      await clientB.sync.syncAndWait();

      // Navigate to work view after setup
      await clientB.page.goto('/#/work-view');
      await clientB.page.waitForLoadState('networkidle');

      // Wait for Client B to have imported data
      await waitForTask(clientB.page, 'E2E Import Test - Active Task With Subtask');

      // ============ Bidirectional sync test ============
      // Client A creates a task
      const taskFromA = `FromA-${uniqueId}`;
      await clientA.workView.addTask(taskFromA);
      await clientA.sync.syncAndWait();

      // Client B syncs and should see A's task
      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, taskFromA);

      // Client B creates a task
      const taskFromB = `FromB-${uniqueId}`;
      await clientB.workView.addTask(taskFromB);
      await clientB.sync.syncAndWait();

      // Client A syncs and should see B's task
      await clientA.sync.syncAndWait();
      await waitForTask(clientA.page, taskFromB);

      // Verify both clients have both tasks
      await expect(clientA.page.locator(`task:has-text("${taskFromA}")`)).toBeVisible();
      await expect(clientA.page.locator(`task:has-text("${taskFromB}")`)).toBeVisible();
      await expect(clientB.page.locator(`task:has-text("${taskFromA}")`)).toBeVisible();
      await expect(clientB.page.locator(`task:has-text("${taskFromB}")`)).toBeVisible();

      console.log('[BidiSync] ✓ Bidirectional sync works after encryption change!');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});

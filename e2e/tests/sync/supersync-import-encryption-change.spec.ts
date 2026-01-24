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
      await importPage.importBackupFile(backupPath);
      console.log('[EncryptionChange] Client A imported unencrypted backup');

      // Reload page after import to ensure UI reflects the imported state
      await clientA.page.reload();
      await clientA.page.waitForLoadState('networkidle');

      // Re-setup sync after import (import overwrites globalConfig)
      // But now without encryption since the imported backup has encryption disabled
      await clientA.sync.setupSuperSync({
        ...baseConfig,
        isEncryptionEnabled: false,
      });

      // Wait for imported task to be visible
      await waitForTask(clientA.page, 'E2E Import Test - Active Task With Subtask');
      console.log('[EncryptionChange] Client A has imported tasks');

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
   * Note: This test requires a backup file with encryption enabled.
   * For now, we skip this test as we need to create such a fixture.
   */
  test.skip('Import encrypted backup while unencrypted sync is active', async () => {
    // This test requires an encrypted backup fixture
    // TODO: Create test-backup-encrypted.json with encryption settings
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
      await importPage.importBackupFile(backupPath);

      // Reload and reconfigure without encryption
      await clientA.page.reload();
      await clientA.page.waitForLoadState('networkidle');
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

      // Wait for both to have imported data
      await waitForTask(clientA.page, 'E2E Import Test - Active Task With Subtask');
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

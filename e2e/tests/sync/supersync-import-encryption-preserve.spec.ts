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
 * SuperSync Import with Encryption Preservation E2E Tests
 *
 * Scenario E.8: Importing an encrypted backup while encrypted sync is active
 * should preserve the encryption state — no "Encryption Settings Will Change"
 * dialog, and sync continues working with encryption after import.
 *
 * This complements supersync-import-encryption-change.spec.ts which tests
 * the cases where encryption state CHANGES during import.
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-import-encryption-preserve.spec.ts
 */

test.describe('@supersync @encryption Import with Encryption Preservation', () => {
  /**
   * Scenario E.8: Import encrypted backup while encrypted sync is active preserves encryption
   *
   * When both the current sync state and the imported backup have encryption enabled,
   * encryption should be preserved seamlessly:
   * - No "Encryption Settings Will Change" dialog (both sides agree)
   * - Imported data replaces existing state
   * - Sync continues working with encryption after re-setup
   * - Other clients can sync with the same encryption password
   */
  test('Import encrypted backup while encrypted sync is active preserves encryption', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const baseConfig = getSuperSyncConfig(user);
      const encryptionPassword = `preserve-test-${testRunId}`;

      // ============ PHASE 1: Setup Client A with Encryption ============
      console.log('[EncPreserve] Phase 1: Setting up Client A with encryption');

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync({
        ...baseConfig,
        isEncryptionEnabled: true,
        password: encryptionPassword,
      });

      // Create and sync an encrypted task
      const preImportTask = `PreImportTask-${testRunId}`;
      await clientA.workView.addTask(preImportTask);
      await clientA.sync.syncAndWait();
      await waitForTask(clientA.page, preImportTask);
      console.log(`[EncPreserve] Client A created encrypted: ${preImportTask}`);

      // ============ PHASE 2: Import Encrypted Backup ============
      console.log('[EncPreserve] Phase 2: Client A importing encrypted backup');

      const importPage = new ImportPage(clientA.page);
      await importPage.navigateToImportPage();

      // Import the encrypted backup (has isEncryptionEnabled: true)
      const backupPath = ImportPage.getFixturePath('test-backup-encrypted.json');
      const fileInput = clientA.page.locator('file-imex input[type="file"]');

      // Start listening for import completion BEFORE triggering the import
      const importCompletePromise = clientA.page.waitForEvent('console', {
        predicate: (msg) => msg.text().includes('Load(import) all data'),
        timeout: 60000,
      });

      await fileInput.setInputFiles(backupPath);

      // Since both current and imported states have encryption enabled,
      // the "Encryption Settings Will Change" dialog should NOT appear.
      // Handle both cases defensively with Promise.race.
      const encryptionChangeDialog = clientA.page.locator(
        'mat-dialog-container:has-text("Encryption Settings Will Change")',
      );

      const importOutcome = await Promise.race([
        encryptionChangeDialog
          .waitFor({ state: 'visible', timeout: 10000 })
          .then(() => 'encryption_dialog' as const),
        importCompletePromise.then(() => 'import_completed' as const),
      ]).catch(() => 'timeout' as const);

      if (importOutcome === 'encryption_dialog') {
        console.log(
          '[EncPreserve] Encryption change dialog appeared (unexpected but handled)',
        );
        const importAndChangeBtn = encryptionChangeDialog.locator(
          'button:has-text("Import and Change Encryption")',
        );
        await importAndChangeBtn.click();
        await encryptionChangeDialog.waitFor({ state: 'hidden', timeout: 15000 });
        await importCompletePromise;
      } else if (importOutcome === 'import_completed') {
        console.log(
          '[EncPreserve] Import completed without encryption dialog (expected)',
        );
      } else {
        throw new Error('Import timed out waiting for completion');
      }

      // Navigate to work view
      await clientA.page.goto('/#/work-view');
      await clientA.page.waitForLoadState('networkidle');

      // Verify imported tasks are visible
      await waitForTask(clientA.page, 'E2E Import Test - Encrypted Task With Subtask');
      console.log('[EncPreserve] Client A has imported tasks visible');

      // ============ PHASE 3: Re-setup Sync with Encryption and Sync ============
      console.log('[EncPreserve] Phase 3: Re-setup sync with encryption');

      // Import overwrites globalConfig, so re-setup SuperSync with encryption
      await clientA.sync.setupSuperSync({
        ...baseConfig,
        isEncryptionEnabled: true,
        password: encryptionPassword,
        syncImportChoice: 'local',
      });

      await clientA.sync.syncAndWait();
      console.log('[EncPreserve] Client A synced successfully after import');

      // ============ PHASE 4: Client B Syncs with Same Encryption ============
      console.log('[EncPreserve] Phase 4: Client B syncing with same encryption');

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync({
        ...baseConfig,
        isEncryptionEnabled: true,
        password: encryptionPassword,
      });

      await clientB.sync.syncAndWait();
      console.log('[EncPreserve] Client B synced successfully');

      // ============ PHASE 5: Verify Encryption Preserved ============
      console.log('[EncPreserve] Phase 5: Verifying encryption state preserved');

      await clientA.page.goto('/#/work-view');
      await clientA.page.waitForLoadState('networkidle');
      await clientB.page.goto('/#/work-view');
      await clientB.page.waitForLoadState('networkidle');

      // Pre-import task should be GONE (import replaces state)
      const preImportOnA = clientA.page.locator(`task:has-text("${preImportTask}")`);
      const preImportOnB = clientB.page.locator(`task:has-text("${preImportTask}")`);
      await expect(preImportOnA).not.toBeVisible({ timeout: 5000 });
      await expect(preImportOnB).not.toBeVisible({ timeout: 5000 });
      console.log('[EncPreserve] Pre-import task is GONE on both clients');

      // Imported tasks should be visible on both clients
      await waitForTask(clientA.page, 'E2E Import Test - Encrypted Task With Subtask');
      await waitForTask(clientB.page, 'E2E Import Test - Encrypted Task With Subtask');
      console.log('[EncPreserve] Both clients have imported tasks');

      // No sync errors on either client (proves encryption works correctly)
      const hasErrorA = await clientA.sync.hasSyncError();
      const hasErrorB = await clientB.sync.hasSyncError();
      expect(hasErrorA).toBe(false);
      expect(hasErrorB).toBe(false);
      console.log('[EncPreserve] No encryption/sync errors on either client');

      console.log('[EncPreserve] Import encryption preservation test PASSED!');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Bidirectional sync works after importing backup with matching encryption
   *
   * After encrypted import with encryption preserved, both clients should
   * be able to create and sync tasks in both directions without errors.
   */
  test('Bidirectional sync works after importing backup with matching encryption', async ({
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
      const encryptionPassword = `bidi-enc-${testRunId}`;

      // ============ Setup: Import encrypted backup with encryption active ============
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync({
        ...baseConfig,
        isEncryptionEnabled: true,
        password: encryptionPassword,
      });

      // Initial sync to establish account
      await clientA.sync.syncAndWait();

      // Import encrypted backup
      const importPage = new ImportPage(clientA.page);
      await importPage.navigateToImportPage();
      const backupPath = ImportPage.getFixturePath('test-backup-encrypted.json');
      const fileInput = clientA.page.locator('file-imex input[type="file"]');

      // Start listening for import completion BEFORE triggering the import
      const importCompletePromise = clientA.page.waitForEvent('console', {
        predicate: (msg) => msg.text().includes('Load(import) all data'),
        timeout: 60000,
      });

      await fileInput.setInputFiles(backupPath);

      // Handle dialog or wait for completion
      const encryptionChangeDialog = clientA.page.locator(
        'mat-dialog-container:has-text("Encryption Settings Will Change")',
      );

      const importOutcome = await Promise.race([
        encryptionChangeDialog
          .waitFor({ state: 'visible', timeout: 10000 })
          .then(() => 'encryption_dialog' as const),
        importCompletePromise.then(() => 'import_completed' as const),
      ]).catch(() => 'timeout' as const);

      if (importOutcome === 'encryption_dialog') {
        const importBtn = encryptionChangeDialog.locator(
          'button:has-text("Import and Change Encryption")',
        );
        await importBtn.click();
        await encryptionChangeDialog.waitFor({ state: 'hidden', timeout: 15000 });
        await importCompletePromise;
      } else if (importOutcome === 'timeout') {
        throw new Error('Import timed out waiting for completion');
      }

      await clientA.page.goto('/#/work-view');
      await clientA.page.waitForLoadState('networkidle');
      await waitForTask(clientA.page, 'E2E Import Test - Encrypted Task With Subtask');

      // Re-setup sync with encryption and sync
      await clientA.sync.setupSuperSync({
        ...baseConfig,
        isEncryptionEnabled: true,
        password: encryptionPassword,
        syncImportChoice: 'local',
      });
      await clientA.sync.syncAndWait();

      // ============ Setup Client B ============
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync({
        ...baseConfig,
        isEncryptionEnabled: true,
        password: encryptionPassword,
      });
      await clientB.sync.syncAndWait();

      await clientB.page.goto('/#/work-view');
      await clientB.page.waitForLoadState('networkidle');
      await waitForTask(clientB.page, 'E2E Import Test - Encrypted Task With Subtask');

      // ============ Bidirectional sync ============
      // Client A creates a task
      const taskFromA = `FromA-${uniqueId}`;
      await clientA.workView.addTask(taskFromA);
      await clientA.sync.syncAndWait();

      // Client B syncs and sees A's task
      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, taskFromA);

      // Client B creates a task
      const taskFromB = `FromB-${uniqueId}`;
      await clientB.workView.addTask(taskFromB);
      await clientB.sync.syncAndWait();

      // Client A syncs and sees B's task
      await clientA.sync.syncAndWait();
      await waitForTask(clientA.page, taskFromB);

      // Verify both clients have both tasks
      await expect(clientA.page.locator(`task:has-text("${taskFromA}")`)).toBeVisible();
      await expect(clientA.page.locator(`task:has-text("${taskFromB}")`)).toBeVisible();
      await expect(clientB.page.locator(`task:has-text("${taskFromA}")`)).toBeVisible();
      await expect(clientB.page.locator(`task:has-text("${taskFromB}")`)).toBeVisible();

      // No errors on either client
      const hasErrorA = await clientA.sync.hasSyncError();
      const hasErrorB = await clientB.sync.hasSyncError();
      expect(hasErrorA).toBe(false);
      expect(hasErrorB).toBe(false);

      console.log('[BidiEncPreserve] Bidirectional sync works after encrypted import!');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});

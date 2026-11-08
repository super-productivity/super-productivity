import { readFileSync, writeFileSync } from 'node:fs';
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
import { DIALOG, watchDialogs } from '../../utils/audit-import-encryption-helpers';

/**
 * Imports the backup at `backupPath` through the file input and waits for the
 * import to finish. SuperSync encryption is already on, and an import can only
 * enable encryption, never disable it, so the "Encryption Settings Will Change"
 * warning (`dialog-import-encryption-warning`) must never appear here. The
 * import would wait on it, so this fails fast instead of timing out.
 */
const importWithoutEncryptionWarning = async (
  client: SimulatedE2EClient,
  backupPath: string,
): Promise<void> => {
  const importPage = new ImportPage(client.page);
  await importPage.navigateToImportPage();
  const watcher = await watchDialogs(client.page, [DIALOG.importEncryptionWarning]);
  const importCompletePromise = client.page.waitForEvent('console', {
    predicate: (msg) => msg.text().includes('Load(import) all data'),
    timeout: 60000,
  });
  await client.page.locator('file-imex input[type="file"]').setInputFiles(backupPath);

  const outcome = await Promise.race([
    client.page
      .locator(DIALOG.importEncryptionWarning)
      .waitFor({ state: 'visible', timeout: 60000 })
      .then(() => 'encryption_dialog' as const),
    importCompletePromise.then(() => 'import_completed' as const),
  ]);
  expect(outcome, 'import with matching encryption shows no warning').toBe(
    'import_completed',
  );
  await watcher.expectNeverSeen(
    [DIALOG.importEncryptionWarning],
    'importing an encrypted backup while encrypted sync is active',
  );
  await expect(
    client.page.locator(
      'mat-dialog-container:has-text("Encryption Settings Will Change")',
    ),
  ).toHaveCount(0);
};

/** Dialogs that would mean the import touched A's encryption setup. */
const ENCRYPTION_SETUP_DIALOGS = [
  DIALOG.enterPassword,
  DIALOG.enableEncryption,
  DIALOG.decryptError,
];

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

      // The checked-in backup has no `globalConfig.sync.superSync`, so the
      // import handler sees it as "encryption not enabled" (importedEnabled =
      // false) while A is encrypted. Test 2 covers both sides enabled.
      await importWithoutEncryptionWarning(
        clientA,
        ImportPage.getFixturePath('test-backup-encrypted.json'),
      );

      // Navigate to work view
      await clientA.page.goto('/#/work-view');
      await clientA.page.waitForLoadState('networkidle');

      // Verify imported tasks are visible
      await waitForTask(clientA.page, 'E2E Import Test - Encrypted Task With Subtask');
      console.log('[EncPreserve] Client A has imported tasks visible');

      // ============ PHASE 3: Sync without re-setup ============
      console.log('[EncPreserve] Phase 3: Syncing with the preserved setup');

      // The import keeps the local-only sync settings (provider, enabled,
      // encryption), so A syncs with its existing setup. Any password or
      // encryption prompt would mean the import changed that setup.
      const watcherA = await watchDialogs(clientA.page, ENCRYPTION_SETUP_DIALOGS);
      await clientA.sync.syncAndWait({ useLocal: true });
      await watcherA.expectNeverSeen(
        ENCRYPTION_SETUP_DIALOGS,
        'A syncing after an import with matching encryption',
      );
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

      // Imported tasks first: they anchor the absence checks below to a
      // rendered list (an empty or still-loading view hides every task).
      await waitForTask(clientA.page, 'E2E Import Test - Encrypted Task With Subtask');
      await waitForTask(clientB.page, 'E2E Import Test - Encrypted Task With Subtask');
      console.log('[EncPreserve] Both clients have imported tasks');

      // Pre-import task should be GONE (import replaces state)
      const preImportOnA = clientA.page.locator(`task:has-text("${preImportTask}")`);
      const preImportOnB = clientB.page.locator(`task:has-text("${preImportTask}")`);
      await expect(preImportOnA).toHaveCount(0, { timeout: 5000 });
      await expect(preImportOnB).toHaveCount(0, { timeout: 5000 });
      console.log('[EncPreserve] Pre-import task is GONE on both clients');

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
   * The checked-in fixture has no `globalConfig.sync.superSync`, so this test
   * imports a copy that carries one with encryption enabled and a DIFFERENT
   * key. Matching encryption state means the import must keep A's current
   * key: B joins with A's original password and must decrypt everything
   * without a decrypt-error prompt. After that, both clients
   * create and sync tasks in both directions without errors.
   */
  test('Bidirectional sync works after importing backup with matching encryption', async ({
    browser,
    baseURL,
    testRunId,
  }, testInfo) => {
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

      // Import a copy of the encrypted backup whose SuperSync config has
      // encryption enabled with another key (the key itself is not secret).
      const backup = JSON.parse(
        readFileSync(ImportPage.getFixturePath('test-backup-encrypted.json'), 'utf-8'),
      ) as { data: { globalConfig: { sync: Record<string, unknown> } } };
      backup.data.globalConfig.sync.superSync = {
        isEncryptionEnabled: true,
        encryptKey: `imported-other-key-${testRunId}`,
      };
      const matchingBackupPath = testInfo.outputPath('backup-matching-encryption.json');
      writeFileSync(matchingBackupPath, JSON.stringify(backup));
      await importWithoutEncryptionWarning(clientA, matchingBackupPath);

      await clientA.page.goto('/#/work-view');
      await clientA.page.waitForLoadState('networkidle');
      await waitForTask(clientA.page, 'E2E Import Test - Encrypted Task With Subtask');

      // Sync with the preserved setup (no re-setup, see test 1).
      const watcherA = await watchDialogs(clientA.page, ENCRYPTION_SETUP_DIALOGS);
      await clientA.sync.syncAndWait({ useLocal: true });
      await watcherA.expectNeverSeen(
        ENCRYPTION_SETUP_DIALOGS,
        'A syncing after an import with matching encryption',
      );

      // ============ Setup Client B with A's ORIGINAL password ============
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      // enter-password is the normal prompt of a device joining an encrypted
      // account; only a decrypt error tells a changed key apart.
      const watcherB = await watchDialogs(clientB.page, [DIALOG.decryptError]);
      await clientB.sync.setupSuperSync({
        ...baseConfig,
        isEncryptionEnabled: true,
        password: encryptionPassword,
      });
      await clientB.sync.syncAndWait();
      // A decrypt error here would mean A re-encrypted with the imported key.
      await watcherB.expectNeverSeen(
        [DIALOG.decryptError],
        "B decrypting A's post-import data with A's original password",
      );

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

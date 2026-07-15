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
 * SuperSync requires encryption. Importing an older backup whose global sync
 * config says encryption was disabled must not disable it or mix the old server
 * history with the imported state.
 */
test.describe('@supersync @encryption Import preserves mandatory encryption', () => {
  test('legacy unencrypted backup keeps SuperSync encrypted and replaces server state', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    const uniqueId = Date.now();
    const encryptionPassword = `pass-${testRunId}`;
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const baseConfig = getSuperSyncConfig(user);

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync({
        ...baseConfig,
        isEncryptionEnabled: true,
        password: encryptionPassword,
      });

      const taskBeforeImport = `BeforeImport-${uniqueId}`;
      await clientA.workView.addTask(taskBeforeImport);
      await clientA.sync.syncAndWait();

      const importPage = new ImportPage(clientA.page);
      await importPage.navigateToImportPage();
      const importCompletePromise = clientA.page.waitForEvent('console', {
        predicate: (msg) => msg.text().includes('Load(import) all data'),
        timeout: 60000,
      });

      await clientA.page
        .locator('file-imex input[type="file"]')
        .setInputFiles(ImportPage.getFixturePath('test-backup.json'));
      await importCompletePromise;

      await expect(
        clientA.page.locator(
          'mat-dialog-container:has-text("Encryption Settings Will Change")',
        ),
      ).toHaveCount(0);

      await clientA.sync.setupSuperSync({
        ...baseConfig,
        syncImportChoice: 'local',
      });
      await clientA.sync.syncAndWait();

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync({
        ...baseConfig,
        isEncryptionEnabled: true,
        password: encryptionPassword,
      });
      await clientB.sync.syncAndWait();

      await clientB.page.goto('/#/work-view');
      await clientB.page.waitForLoadState('networkidle');
      await waitForTask(clientB.page, 'E2E Import Test - Active Task With Subtask');

      await expect(
        clientB.page.locator(`task:has-text("${taskBeforeImport}")`),
      ).not.toBeVisible();
      await expect(
        clientB.page
          .locator('task:has-text("E2E Import Test - Active Task With Subtask")')
          .first(),
      ).toBeVisible();
      await expect(clientB.sync.hasSyncError()).resolves.toBe(false);
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});

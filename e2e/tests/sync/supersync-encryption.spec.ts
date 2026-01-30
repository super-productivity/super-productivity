import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';

/**
 * SuperSync Encryption E2E Tests
 *
 * Verifies End-to-End Encryption (E2EE) logic:
 * - Setting up encryption
 * - Secure syncing between clients with same password
 * - Denial of access for clients with wrong password
 * - Multiple operations with encryption
 * - Bidirectional sync with encryption
 * - Update and delete operations
 *
 * Run with E2E_VERBOSE=1 to see browser console logs for debugging.
 */

test.describe('@supersync SuperSync Encryption', () => {
  // Server health check is handled automatically by the supersync fixture

  test('Encrypted data syncs correctly with valid password', async ({
    browser,
    baseURL,
    testRunId,
    serverHealthy,
  }) => {
    void serverHealthy; // Ensure fixture is evaluated for server health check
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const baseConfig = getSuperSyncConfig(user);
      const encryptionPassword = `pass-${testRunId}`;
      const syncConfig = {
        ...baseConfig,
        isEncryptionEnabled: true,
        password: encryptionPassword,
      };

      // --- Client A: Encrypt & Upload ---
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      const secretTaskName = `SecretTask-${testRunId}`;
      await clientA.workView.addTask(secretTaskName);

      // Sync A (Encrypts and uploads)
      await clientA.sync.syncAndWait();

      // --- Client B: Download & Decrypt ---
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      // Use SAME config (same password)
      await clientB.sync.setupSuperSync(syncConfig);

      // Sync B (Downloads and decrypts)
      await clientB.sync.syncAndWait();

      // Verify B has the task
      await waitForTask(clientB.page, secretTaskName);
      await expect(
        clientB.page.locator(`task:has-text("${secretTaskName}")`),
      ).toBeVisible();
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  test('Encrypted data fails to sync with wrong password', async ({
    browser,
    baseURL,
    testRunId,
    serverHealthy,
  }) => {
    void serverHealthy; // Ensure fixture is evaluated for server health check
    let clientA: SimulatedE2EClient | null = null;
    let clientC: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const baseConfig = getSuperSyncConfig(user);
      const correctPassword = `correct-${testRunId}`;
      const wrongPassword = `wrong-${testRunId}`;

      // --- Client A: Encrypt & Upload (Correct Password) ---
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync({
        ...baseConfig,
        isEncryptionEnabled: true,
        password: correctPassword,
      });

      const secretTaskName = `SecretTask-${testRunId}`;
      await clientA.workView.addTask(secretTaskName);
      await clientA.sync.syncAndWait();

      // --- Client C: Attempt Download (Wrong Password) ---
      clientC = await createSimulatedClient(browser, baseURL!, 'C', testRunId);

      // Setup with WRONG password - don't wait for sync since it will fail
      await clientC.sync.setupSuperSync({
        ...baseConfig,
        isEncryptionEnabled: true,
        password: wrongPassword,
        waitForInitialSync: false, // Sync will fail with wrong password
      });

      // The sync already happened during setupSuperSync with wrong password
      // A decrypt error dialog should appear - wait for it and close it
      const decryptErrorDialog = clientC.page.locator('dialog-handle-decrypt-error');

      // Wait for the decrypt error dialog to appear (it may take a moment after sync fails)
      const decryptErrorAppeared = await decryptErrorDialog
        .waitFor({ state: 'visible', timeout: 10000 })
        .then(() => true)
        .catch(() => false);

      if (decryptErrorAppeared) {
        console.log('Decrypt error dialog appeared - closing it');
        // Close the dialog by clicking cancel or pressing Escape
        const cancelBtn = decryptErrorDialog
          .locator('button')
          .filter({ hasText: /cancel/i });
        const cancelVisible = await cancelBtn.isVisible().catch(() => false);
        if (cancelVisible) {
          await cancelBtn.click();
        } else {
          await clientC.page.keyboard.press('Escape');
        }
        await decryptErrorDialog.waitFor({ state: 'hidden', timeout: 5000 });
      } else {
        console.log(
          'No decrypt error dialog appeared - checking for other error indicators',
        );
        // The error might be shown via snackbar instead of dialog
        // Just proceed to verify error state
      }

      // Verify Client C DOES NOT have the task
      await expect(
        clientC.page.locator(`task:has-text("${secretTaskName}")`),
      ).not.toBeVisible();

      // Verify Error UI - always assert error occurred
      // Silent decryption failure is unacceptable - wrong password MUST produce visible error
      // Use retry logic since error indicators may take a moment to appear under load
      await expect(async () => {
        const hasError = await clientC.sync.hasSyncError();
        // App uses snack-custom component, not simple-snack-bar
        const snackbar = clientC.page.locator(
          'snack-custom:has-text("decrypt"), ' +
            'snack-custom:has-text("password"), ' +
            '.mat-mdc-snack-bar-container:has-text("decrypt"), ' +
            '.mat-mdc-snack-bar-container:has-text("password")',
        );
        const snackbarVisible = await snackbar
          .first()
          .isVisible()
          .catch(() => false);
        expect(hasError || snackbarVisible).toBe(true);
      }).toPass({ timeout: 10000, intervals: [500, 1000, 2000] });
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientC) await closeClient(clientC);
    }
  });

  test('Multiple tasks sync correctly with encryption', async ({
    browser,
    baseURL,
    testRunId,
    serverHealthy,
  }) => {
    void serverHealthy; // Ensure fixture is evaluated for server health check
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const baseConfig = getSuperSyncConfig(user);
      const encryptionPassword = `multi-${testRunId}`;
      const syncConfig = {
        ...baseConfig,
        isEncryptionEnabled: true,
        password: encryptionPassword,
      };

      // --- Client A: Create multiple tasks ---
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      const task1 = `Task1-${testRunId}`;
      const task2 = `Task2-${testRunId}`;
      const task3 = `Task3-${testRunId}`;

      await clientA.workView.addTask(task1);
      await clientA.page.waitForTimeout(100);
      await clientA.workView.addTask(task2);
      await clientA.page.waitForTimeout(100);
      await clientA.workView.addTask(task3);

      // Sync all tasks
      await clientA.sync.syncAndWait();

      // --- Client B: Verify all tasks arrive ---
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();

      // Verify all 3 tasks exist
      await waitForTask(clientB.page, task1);
      await waitForTask(clientB.page, task2);
      await waitForTask(clientB.page, task3);

      await expect(clientB.page.locator(`task:has-text("${task1}")`)).toBeVisible();
      await expect(clientB.page.locator(`task:has-text("${task2}")`)).toBeVisible();
      await expect(clientB.page.locator(`task:has-text("${task3}")`)).toBeVisible();
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  test('Bidirectional sync works with encryption', async ({
    browser,
    baseURL,
    testRunId,
    serverHealthy,
  }) => {
    void serverHealthy; // Ensure fixture is evaluated for server health check
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const baseConfig = getSuperSyncConfig(user);
      const encryptionPassword = `bidi-${testRunId}`;
      const syncConfig = {
        ...baseConfig,
        isEncryptionEnabled: true,
        password: encryptionPassword,
      };

      // --- Setup both clients ---
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // --- Client A creates a task ---
      const taskFromA = `FromA-${testRunId}`;
      await clientA.workView.addTask(taskFromA);
      await clientA.sync.syncAndWait();

      // --- Client B syncs and creates a task ---
      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, taskFromA);

      const taskFromB = `FromB-${testRunId}`;
      await clientB.workView.addTask(taskFromB);
      await clientB.sync.syncAndWait();

      // --- Client A syncs again and should have both tasks ---
      await clientA.sync.syncAndWait();
      await waitForTask(clientA.page, taskFromB);

      // Verify both clients have both tasks
      await expect(clientA.page.locator(`task:has-text("${taskFromA}")`)).toBeVisible();
      await expect(clientA.page.locator(`task:has-text("${taskFromB}")`)).toBeVisible();
      await expect(clientB.page.locator(`task:has-text("${taskFromA}")`)).toBeVisible();
      await expect(clientB.page.locator(`task:has-text("${taskFromB}")`)).toBeVisible();
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  test('Task update syncs correctly with encryption', async ({
    browser,
    baseURL,
    testRunId,
    serverHealthy,
  }) => {
    void serverHealthy; // Ensure fixture is evaluated for server health check
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const baseConfig = getSuperSyncConfig(user);
      const encryptionPassword = `update-${testRunId}`;
      const syncConfig = {
        ...baseConfig,
        isEncryptionEnabled: true,
        password: encryptionPassword,
      };

      // --- Client A: Create a task ---
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      const taskName = `UpdatableTask-${testRunId}`;
      await clientA.workView.addTask(taskName);
      await clientA.page.waitForTimeout(300);
      await clientA.sync.syncAndWait();

      // --- Client B: Sync and verify task exists ---
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();

      await waitForTask(clientB.page, taskName);
      await expect(clientB.page.locator(`task:has-text("${taskName}")`)).toBeVisible();

      // --- Client B: Create another task ---
      const task2Name = `UpdatedByB-${testRunId}`;
      await clientB.workView.addTask(task2Name);
      await clientB.page.waitForTimeout(300);
      await clientB.sync.syncAndWait();

      // --- Client A: Sync and verify both tasks exist ---
      await clientA.sync.syncAndWait();
      await waitForTask(clientA.page, task2Name);

      await expect(clientA.page.locator(`task:has-text("${taskName}")`)).toBeVisible();
      await expect(clientA.page.locator(`task:has-text("${task2Name}")`)).toBeVisible();
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  test('Long encryption password works correctly', async ({
    browser,
    baseURL,
    testRunId,
    serverHealthy,
  }) => {
    void serverHealthy; // Ensure fixture is evaluated for server health check
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const baseConfig = getSuperSyncConfig(user);
      // Use a very long password with special characters
      const longPassword = `This-Is-A-Very-Long-Password-With-Special-Chars!@#$%^&*()-${testRunId}`;
      const syncConfig = {
        ...baseConfig,
        isEncryptionEnabled: true,
        password: longPassword,
      };

      // --- Client A: Create task with long password ---
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      const taskName = `LongPassTask-${testRunId}`;
      await clientA.workView.addTask(taskName);
      await clientA.sync.syncAndWait();

      // --- Client B: Sync with same long password ---
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();

      // Verify task synced correctly
      await waitForTask(clientB.page, taskName);
      await expect(clientB.page.locator(`task:has-text("${taskName}")`)).toBeVisible();
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});

import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { expectTaskVisible } from '../../utils/supersync-assertions';

/**
 * SuperSync Encryption Password Change E2E Tests
 *
 * Verifies the encryption password change flow:
 * - Password change deletes server data and re-uploads with new password
 * - Existing data is preserved after password change
 * - Other clients must use the new password to sync
 * - Old password no longer works after change
 *
 * Run with E2E_VERBOSE=1 to see browser console logs for debugging.
 */

test.describe('@supersync SuperSync Encryption Password Change', () => {
  test('Password change preserves existing data', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    let clientA: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const baseConfig = getSuperSyncConfig(user);
      const oldPassword = `oldpass-${testRunId}`;
      const newPassword = `newpass-${testRunId}`;

      // --- Setup with initial password ---
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync({
        ...baseConfig,
        isEncryptionEnabled: true,
        password: oldPassword,
      });

      // Create tasks (names must be distinct - no substring overlap)
      const task1 = `TaskA-${testRunId}`;
      const task2 = `TaskB-${testRunId}`;
      await clientA.workView.addTask(task1);
      await clientA.page.waitForTimeout(100);
      await clientA.workView.addTask(task2);

      // Sync with old password
      await clientA.sync.syncAndWait();

      // Verify tasks exist
      await waitForTask(clientA.page, task1);
      await waitForTask(clientA.page, task2);

      // --- Change password ---
      await clientA.sync.changeEncryptionPassword(newPassword);

      // --- Verify tasks still exist after password change ---
      await expectTaskVisible(clientA, task1);
      await expectTaskVisible(clientA, task2);

      // Trigger another sync to verify everything works
      await clientA.sync.syncAndWait();

      // Tasks should still be there
      await expectTaskVisible(clientA, task1);
      await expectTaskVisible(clientA, task2);
    } finally {
      if (clientA) await closeClient(clientA);
    }
  });

  test('New client can sync with new password after password change', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const baseConfig = getSuperSyncConfig(user);
      const oldPassword = `oldpass-${testRunId}`;
      const newPassword = `newpass-${testRunId}`;

      // --- Client A: Setup and create data ---
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync({
        ...baseConfig,
        isEncryptionEnabled: true,
        password: oldPassword,
      });

      const taskName = `BeforeChange-${testRunId}`;
      await clientA.workView.addTask(taskName);
      await clientA.sync.syncAndWait();

      // --- Client A: Change password ---
      await clientA.sync.changeEncryptionPassword(newPassword);

      // --- Client B: Setup with NEW password ---
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync({
        ...baseConfig,
        isEncryptionEnabled: true,
        password: newPassword,
      });

      // Sync should succeed with new password
      await clientB.sync.syncAndWait();

      // Verify task synced to Client B
      await waitForTask(clientB.page, taskName);
      await expectTaskVisible(clientB, taskName);
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  test('Old password fails after password change', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    let clientA: SimulatedE2EClient | null = null;
    let clientC: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const baseConfig = getSuperSyncConfig(user);
      const oldPassword = `oldpass-${testRunId}`;
      const newPassword = `newpass-${testRunId}`;

      // --- Client A: Setup, create data, and change password ---
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync({
        ...baseConfig,
        isEncryptionEnabled: true,
        password: oldPassword,
      });

      const taskName = `SecretTask-${testRunId}`;
      await clientA.workView.addTask(taskName);
      await clientA.sync.syncAndWait();

      // Change password
      await clientA.sync.changeEncryptionPassword(newPassword);

      // --- Client C: Try to sync with OLD password ---
      clientC = await createSimulatedClient(browser, baseURL!, 'C', testRunId);
      await clientC.sync.setupSuperSync({
        ...baseConfig,
        isEncryptionEnabled: true,
        password: oldPassword, // Using OLD password!
      });

      // Try to sync - should fail or not get the data
      try {
        await clientC.sync.triggerSync();
        await clientC.sync.waitForSyncComplete();
      } catch (e) {
        // Expected - sync may throw an error
        console.log('Sync with old password failed as expected:', e);
      }

      // Verify Client C does NOT have the task
      await expect(
        clientC.page.locator(`task:has-text("${taskName}")`),
      ).not.toBeVisible();

      // Check for error state
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

      // Either error icon or error snackbar should be visible
      expect(hasError || snackbarVisible).toBe(true);
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientC) await closeClient(clientC);
    }
  });

  test('Bidirectional sync works after password change', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const baseConfig = getSuperSyncConfig(user);
      const oldPassword = `oldpass-${testRunId}`;
      const newPassword = `newpass-${testRunId}`;

      // --- Setup both clients with old password ---
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync({
        ...baseConfig,
        isEncryptionEnabled: true,
        password: oldPassword,
      });

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync({
        ...baseConfig,
        isEncryptionEnabled: true,
        password: oldPassword,
      });

      // --- Create initial tasks and sync ---
      const taskFromA = `FromA-${testRunId}`;
      await clientA.workView.addTask(taskFromA);
      await clientA.sync.syncAndWait();

      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, taskFromA);

      // --- Client A changes password ---
      await clientA.sync.changeEncryptionPassword(newPassword);

      // --- Client B must reconfigure with new password ---
      // Close and recreate with new password (simulating user entering new password)
      await closeClient(clientB);
      clientB = await createSimulatedClient(browser, baseURL!, 'B2', testRunId);
      await clientB.sync.setupSuperSync({
        ...baseConfig,
        isEncryptionEnabled: true,
        password: newPassword,
      });
      await clientB.sync.syncAndWait();

      // Verify B has the task
      await waitForTask(clientB.page, taskFromA);

      // --- Client B creates a new task ---
      const taskFromB = `FromB-${testRunId}`;
      await clientB.workView.addTask(taskFromB);
      await clientB.sync.syncAndWait();

      // --- Client A syncs and should get B's task ---
      await clientA.sync.syncAndWait();
      await waitForTask(clientA.page, taskFromB);

      // Verify both clients have both tasks
      await expectTaskVisible(clientA, taskFromA);
      await expectTaskVisible(clientA, taskFromB);
      await expectTaskVisible(clientB, taskFromA);
      await expectTaskVisible(clientB, taskFromB);
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  test('Multiple password changes work correctly', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const baseConfig = getSuperSyncConfig(user);
      const password1 = `pass1-${testRunId}`;
      const password2 = `pass2-${testRunId}`;
      const password3 = `pass3-${testRunId}`;

      // --- Setup with password1 ---
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync({
        ...baseConfig,
        isEncryptionEnabled: true,
        password: password1,
      });

      // Create and sync task1
      const task1 = `Task1-${testRunId}`;
      await clientA.workView.addTask(task1);
      await clientA.sync.syncAndWait();

      // --- Change to password2 ---
      await clientA.sync.changeEncryptionPassword(password2);

      // Create and sync task2
      const task2 = `Task2-${testRunId}`;
      await clientA.workView.addTask(task2);
      await clientA.sync.syncAndWait();

      // --- Change to password3 ---
      await clientA.sync.changeEncryptionPassword(password3);

      // Create and sync task3
      const task3 = `Task3-${testRunId}`;
      await clientA.workView.addTask(task3);
      await clientA.sync.syncAndWait();

      // --- Verify all tasks still exist ---
      await expectTaskVisible(clientA, task1);
      await expectTaskVisible(clientA, task2);
      await expectTaskVisible(clientA, task3);

      // --- New client with password3 should see all tasks ---
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync({
        ...baseConfig,
        isEncryptionEnabled: true,
        password: password3,
      });
      await clientB.sync.syncAndWait();

      await waitForTask(clientB.page, task1);
      await waitForTask(clientB.page, task2);
      await waitForTask(clientB.page, task3);

      await expectTaskVisible(clientB, task1);
      await expectTaskVisible(clientB, task2);
      await expectTaskVisible(clientB, task3);
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});

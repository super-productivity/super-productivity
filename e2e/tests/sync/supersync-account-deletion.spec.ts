import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  deleteTestUser,
  waitForTask,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';

/**
 * SuperSync Account Deletion E2E Tests
 *
 * These tests verify client behavior when:
 * - User account is deleted on the server
 * - Client tries to sync after account deletion
 *
 * Prerequisites:
 * - super-sync-server running on localhost:1901 with TEST_MODE=true
 * - Frontend running on localhost:4242
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-account-deletion.spec.ts
 */

test.describe('@supersync SuperSync Account Deletion', () => {
  /**
   * Scenario: Client detects auth error after account deletion
   *
   * Tests that when a user's account is deleted on the server,
   * the client shows an appropriate error indicator.
   *
   * Actions:
   * 1. Create user and client, sync successfully
   * 2. Delete user account on server
   * 3. Client tries to sync again
   * 4. Verify client shows error (snackbar or error icon)
   */
  test('Client shows error after account deletion', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    const appUrl = baseURL || 'http://localhost:4242';
    let client: SimulatedE2EClient | null = null;

    try {
      // 1. Create user and set up client
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);
      console.log(`[Account-Deletion] Created user ${user.userId}`);

      client = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await client.sync.setupSuperSync(syncConfig);

      // Create a task and sync to verify everything works
      const taskName = `Pre-Delete-Task-${testRunId}`;
      await client.workView.addTask(taskName);
      await client.sync.syncAndWait();
      await waitForTask(client.page, taskName);
      console.log('[Account-Deletion] ✓ Initial sync successful');

      // 2. Delete the user account on the server
      await deleteTestUser(user.userId);
      console.log(`[Account-Deletion] ✓ Deleted user ${user.userId}`);

      // 3. Try to sync again - should fail with auth error
      await client.sync.syncBtn.click();

      // 4. Wait for error indicator to appear
      // The sync button should show error state (sync_problem icon),
      // or a snackbar with error message should appear
      // Note: App uses snack-custom component, not simple-snack-bar
      const errorIndicator = client.page.locator(
        // Error snackbar with any of these indicators (snack-custom or mat-mdc-snack-bar-container)
        'snack-custom:has-text("Configure"), ' +
          'snack-custom:has-text("Authentication"), ' +
          '.mat-mdc-snack-bar-container:has-text("Configure"), ' +
          '.mat-mdc-snack-bar-container:has-text("Authentication"), ' +
          // Or sync button showing error icon
          '.sync-btn mat-icon:has-text("sync_problem")',
      );

      await expect(errorIndicator.first()).toBeVisible({ timeout: 20000 });
      console.log('[Account-Deletion] ✓ Client detected auth failure');
    } finally {
      if (client) await closeClient(client);
    }
  });

  /**
   * Scenario: Client can reconfigure after account deletion and re-registration
   *
   * Tests that after account deletion, a client can be reconfigured
   * with new credentials and resume syncing.
   *
   * Actions:
   * 1. Create user A, set up client, sync successfully
   * 2. Delete user A account
   * 3. Create user B (new account)
   * 4. Reconfigure client with user B credentials
   * 5. Verify sync works with new account
   */
  test('Client can reconfigure with new account after deletion', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    const appUrl = baseURL || 'http://localhost:4242';
    let client: SimulatedE2EClient | null = null;

    try {
      // 1. Create first user and sync
      const userA = await createTestUser(`${testRunId}-A`);
      const configA = getSuperSyncConfig(userA);
      console.log(`[Reconfigure] Created user A: ${userA.userId}`);

      client = await createSimulatedClient(browser, appUrl, 'Client', testRunId);
      await client.sync.setupSuperSync(configA);

      const task1 = `UserA-Task-${testRunId}`;
      await client.workView.addTask(task1);
      await client.sync.syncAndWait();
      console.log('[Reconfigure] ✓ User A sync successful');

      // 2. Delete user A account
      await deleteTestUser(userA.userId);
      console.log('[Reconfigure] ✓ Deleted user A');

      // 3. Create user B (new account)
      const userB = await createTestUser(`${testRunId}-B`);
      const configB = getSuperSyncConfig(userB);
      console.log(`[Reconfigure] ✓ Created user B: ${userB.userId}`);

      // 4. Reconfigure client with user B credentials
      // Open sync settings via right-click
      await client.sync.syncBtn.click({ button: 'right' });
      await client.sync.providerSelect.waitFor({ state: 'visible', timeout: 10000 });

      // Update access token
      await client.sync.accessTokenInput.clear();
      await client.sync.accessTokenInput.fill(configB.accessToken);

      // Save configuration
      await expect(client.sync.saveBtn).toBeEnabled({ timeout: 5000 });
      await client.sync.saveBtn.click();
      await client.page
        .locator('mat-dialog-container')
        .waitFor({ state: 'detached', timeout: 5000 })
        .catch(() => {});

      // Wait for any dialogs to settle
      await client.page.waitForTimeout(1000);

      // 5. Sync and verify it works with user B
      await client.sync.syncAndWait();

      // Create a new task with user B
      const task2 = `UserB-Task-${testRunId}`;
      await client.workView.addTask(task2);
      await client.sync.syncAndWait();

      // Verify task exists
      await waitForTask(client.page, task2);
      console.log('[Reconfigure] ✓ User B sync successful - reconfiguration complete');
    } finally {
      if (client) await closeClient(client);
    }
  });
});

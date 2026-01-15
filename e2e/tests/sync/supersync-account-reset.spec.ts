import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  hasTask,
  SUPERSYNC_BASE_URL,
  type SimulatedE2EClient,
  type TestUser,
} from '../../utils/supersync-helpers';

/**
 * Reset user's sync data on the server (keeps account active).
 * This simulates what happens when clicking "Reset Account (Clear Data)" button.
 *
 * @param token - JWT token for authentication
 */
const resetUserData = async (token: string): Promise<void> => {
  const headers = new Headers();
  headers.set('Content-Type', 'application/json');
  headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(`${SUPERSYNC_BASE_URL}/api/sync/data`, {
    method: 'DELETE',
    headers,
    body: '{}',
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to reset user data: ${response.status} - ${text}`);
  }
};

/**
 * SuperSync Account Reset E2E Tests
 *
 * These tests verify the "Reset Account (Clear Data)" feature:
 * - Clears all synced data from the server
 * - Keeps the account active (unlike delete which removes the account)
 * - Allows user to sync fresh data after reset
 *
 * Prerequisites:
 * - super-sync-server running on localhost:1901 with TEST_MODE=true
 * - Frontend running on localhost:4242
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-account-reset.spec.ts
 */

test.describe('@supersync SuperSync Account Reset', () => {
  /**
   * Scenario: Reset clears server data but keeps account active
   *
   * Tests that resetting account:
   * 1. Removes all synced data from the server
   * 2. Keeps the account active (can still authenticate)
   * 3. Allows syncing fresh data after reset
   */
  test('Reset clears server data but keeps account active', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    const appUrl = baseURL || 'http://localhost:4242';
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;
    let user: TestUser | null = null;

    try {
      // 1. Create user and set up first client
      user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);
      console.log(`[Reset] Created user ${user.userId}`);

      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      // Create tasks and sync
      const task1 = `Pre-Reset-Task-1-${testRunId}`;
      const task2 = `Pre-Reset-Task-2-${testRunId}`;
      await clientA.workView.addTask(task1);
      await clientA.workView.addTask(task2);
      await clientA.sync.syncAndWait();
      await waitForTask(clientA.page, task1);
      await waitForTask(clientA.page, task2);
      console.log('[Reset] Client A synced initial tasks');

      // 2. Create second client and verify it receives the tasks
      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, task1);
      await waitForTask(clientB.page, task2);
      console.log('[Reset] Client B received synced tasks');

      // 3. Reset account data on server
      await resetUserData(user.token);
      console.log('[Reset] Account data cleared on server');

      // 4. Create a new client (C) to verify server has no data
      // This simulates a fresh device connecting after reset
      const clientC = await createSimulatedClient(browser, appUrl, 'C', testRunId);
      await clientC.sync.setupSuperSync(syncConfig);
      await clientC.sync.syncAndWait();

      // Client C should NOT have the old tasks (server was reset)
      const hasOldTask1 = await hasTask(clientC.page, task1);
      const hasOldTask2 = await hasTask(clientC.page, task2);
      expect(hasOldTask1).toBe(false);
      expect(hasOldTask2).toBe(false);
      console.log('[Reset] Verified new client has no old data');

      // 5. Verify account is still active - can sync new data
      const newTask = `Post-Reset-Task-${testRunId}`;
      await clientC.workView.addTask(newTask);
      await clientC.sync.syncAndWait();
      await waitForTask(clientC.page, newTask);
      console.log('[Reset] New task created and synced after reset');

      // Close client C
      await closeClient(clientC);
      console.log('[Reset] Test passed - account reset successful');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario: Existing clients can continue after reset
   *
   * Tests that after reset:
   * 1. Existing clients can still sync (account is active)
   * 2. Old local data can be re-uploaded to server
   */
  test('Existing client can re-sync after reset', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    const appUrl = baseURL || 'http://localhost:4242';
    let client: SimulatedE2EClient | null = null;
    let user: TestUser | null = null;

    try {
      // 1. Create user and sync some data
      user = await createTestUser(`${testRunId}-resync`);
      const syncConfig = getSuperSyncConfig(user);

      client = await createSimulatedClient(browser, appUrl, 'Resync', testRunId);
      await client.sync.setupSuperSync(syncConfig);

      const taskName = `Resync-Task-${testRunId}`;
      await client.workView.addTask(taskName);
      await client.sync.syncAndWait();
      await waitForTask(client.page, taskName);
      console.log('[Resync] Initial sync complete');

      // 2. Reset account on server
      await resetUserData(user.token);
      console.log('[Resync] Account data cleared');

      // 3. Sync again - client should re-upload its data
      // The sync will detect server has no data and push local state
      await client.sync.syncAndWait();

      // 4. Verify task still exists locally
      const taskExists = await hasTask(client.page, taskName);
      expect(taskExists).toBe(true);
      console.log('[Resync] Client retained local data after reset');

      // 5. Create another client to verify data was re-synced to server
      const clientVerify = await createSimulatedClient(
        browser,
        appUrl,
        'Verify',
        testRunId,
      );
      await clientVerify.sync.setupSuperSync(syncConfig);
      await clientVerify.sync.syncAndWait();

      // New client should receive the re-synced task
      await waitForTask(clientVerify.page, taskName, 30000);
      console.log('[Resync] Verified data was re-synced to server');

      await closeClient(clientVerify);
    } finally {
      if (client) await closeClient(client);
    }
  });
});

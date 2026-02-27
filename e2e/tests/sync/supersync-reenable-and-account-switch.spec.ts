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
 * SuperSync Re-enable and Account Switch E2E Tests
 *
 * Scenarios covered:
 * - I.5: Re-enabling sync after disable resumes from stored lastServerSeq
 * - I.6: Switching SuperSync accounts syncs to new server
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-reenable-and-account-switch.spec.ts
 */

test.describe('@supersync Re-enable and Account Switch', () => {
  /**
   * Scenario I.5: Re-enabling sync after disable resumes from stored lastServerSeq
   *
   * Actions:
   * 1. Client A sets up SuperSync, creates tasks, syncs
   * 2. Client A disables sync
   * 3. Client A creates more tasks while offline
   * 4. Client A re-enables SuperSync with same config
   *
   * Verify:
   * - New tasks upload successfully
   * - Existing tasks preserved
   * - Status is IN_SYNC
   */
  test('Re-enabling sync after disable resumes from stored lastServerSeq', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(120000);
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // ============ PHASE 1: Setup and initial sync ============
      console.log('[I.5] Phase 1: Setup and initial sync');

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      const taskBefore = `ReEnable-Before-${testRunId}`;
      await clientA.workView.addTask(taskBefore);
      await clientA.sync.syncAndWait();
      console.log(`[I.5] Created and synced: ${taskBefore}`);

      // ============ PHASE 2: Disable sync ============
      console.log('[I.5] Phase 2: Disabling sync');

      await clientA.sync.disableSync();
      console.log('[I.5] Sync disabled');

      // ============ PHASE 3: Create tasks while "offline" ============
      console.log('[I.5] Phase 3: Creating tasks while sync is disabled');

      const taskOffline = `ReEnable-Offline-${testRunId}`;
      await clientA.workView.addTask(taskOffline);
      await waitForTask(clientA.page, taskOffline);
      console.log(`[I.5] Created while disabled: ${taskOffline}`);

      // ============ PHASE 4: Re-enable sync ============
      console.log('[I.5] Phase 4: Re-enabling sync');

      await clientA.sync.setupSuperSync(syncConfig);

      // Sync to upload offline tasks
      await clientA.sync.syncAndWait();
      console.log('[I.5] Re-enabled and synced');

      // ============ PHASE 5: Verify ============
      console.log('[I.5] Phase 5: Verifying');

      // Both tasks should still exist
      await expectTaskVisible(clientA, taskBefore);
      await expectTaskVisible(clientA, taskOffline);

      // No error
      const hasError = await clientA.sync.hasSyncError();
      expect(hasError).toBe(false);

      // Verify with Client B that offline tasks uploaded
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();

      await waitForTask(clientB.page, taskBefore);
      await waitForTask(clientB.page, taskOffline);

      console.log('[I.5] ✓ Re-enabling sync resumed correctly');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario I.6: Switching SuperSync accounts syncs to new server
   *
   * Actions:
   * 1. Client A sets up SuperSync with user1, creates tasks, syncs
   * 2. Client A switches to user2 (different token/account)
   * 3. Client A syncs to new account — server migration creates SYNC_IMPORT
   *
   * Verify:
   * - Tasks are available on the new account (via SYNC_IMPORT)
   * - Client B joining new account receives the tasks
   */
  test('Switching SuperSync accounts syncs to new server', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(120000);
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      // Create two separate user accounts
      const user1 = await createTestUser(`${testRunId}-user1`);
      const user2 = await createTestUser(`${testRunId}-user2`);
      const syncConfig1 = getSuperSyncConfig(user1);
      const syncConfig2 = getSuperSyncConfig(user2);

      // ============ PHASE 1: Setup with user1 ============
      console.log('[I.6] Phase 1: Setup with user1');

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig1);

      const taskName = `AcctSwitch-${testRunId}`;
      await clientA.workView.addTask(taskName);
      await clientA.sync.syncAndWait();
      console.log(`[I.6] Created and synced to user1: ${taskName}`);

      // ============ PHASE 2: Switch to user2 ============
      console.log('[I.6] Phase 2: Switching to user2');

      // Reconfigure sync with user2 credentials
      await clientA.sync.setupSuperSync(syncConfig2);
      console.log('[I.6] Reconfigured with user2');

      // Sync to new account — server migration should create SYNC_IMPORT
      // because the new server is empty but client has synced ops
      await clientA.sync.syncAndWait();
      console.log('[I.6] Synced to user2');

      // ============ PHASE 3: Verify task is on new account ============
      console.log('[I.6] Phase 3: Verifying task on new account');

      // Task should still be visible on Client A
      await expectTaskVisible(clientA, taskName);

      // No error
      const hasError = await clientA.sync.hasSyncError();
      expect(hasError).toBe(false);

      // Verify with Client B joining user2's account
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig2);
      await clientB.sync.syncAndWait();

      await waitForTask(clientB.page, taskName);
      console.log('[I.6] ✓ Client B on user2 received the task');

      console.log('[I.6] ✓ Account switch completed successfully');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});

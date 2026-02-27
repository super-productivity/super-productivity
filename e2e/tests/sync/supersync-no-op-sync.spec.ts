import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  getTaskCount,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';

/**
 * SuperSync No-Op Sync E2E Tests
 *
 * Scenario A.3: No changes on either side.
 * When sync fires but there are no new ops anywhere, the client should
 * update lastServerSeq and remain in IN_SYNC status without errors.
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-no-op-sync.spec.ts
 */

test.describe('@supersync No-Op Sync', () => {
  /**
   * Scenario A.3: No-op sync round-trip updates seq without errors
   *
   * Actions:
   * 1. Client A sets up SuperSync
   * 2. Client A creates a task and syncs (initial data)
   * 3. Client A syncs again with no changes on either side
   *
   * Verify:
   * - No error after the no-op sync
   * - Sync status is IN_SYNC (check icon visible)
   * - Task count is unchanged
   */
  test('No-op sync round-trip updates seq without errors', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    let clientA: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      // Create a task so there's some data on the server
      const taskName = `NoOp-Task-${testRunId}`;
      await clientA.workView.addTask(taskName);
      await clientA.sync.syncAndWait();

      // Record task count before no-op sync
      const countBefore = await getTaskCount(clientA);

      // No-op sync: no changes on either side
      await clientA.sync.syncAndWait();

      // Verify no error
      const hasError = await clientA.sync.hasSyncError();
      expect(hasError).toBe(false);

      // Verify sync shows success (check icon)
      await expect(clientA.sync.syncCheckIcon).toBeVisible({ timeout: 5000 });

      // Verify task count unchanged
      const countAfter = await getTaskCount(clientA);
      expect(countAfter).toBe(countBefore);

      // Do one more no-op sync to be thorough
      await clientA.sync.syncAndWait();
      const hasErrorAfterSecond = await clientA.sync.hasSyncError();
      expect(hasErrorAfterSecond).toBe(false);

      console.log('[NoOpSync] No-op sync completed without errors');
    } finally {
      if (clientA) await closeClient(clientA);
    }
  });
});

import { test, expect } from '../../fixtures/supersync.fixture';
import {
  closeClient,
  createSimulatedClient,
  createTestUser,
  getSuperSyncConfig,
  waitForTask,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';

/**
 * SuperSync realtime push E2E tests.
 *
 * Verifies the new WebSocket notification flow end-to-end:
 * 1. Both clients complete an initial successful SuperSync sync
 * 2. Client A uploads a change
 * 3. Client B receives the change without clicking sync again
 *
 * This specifically guards the PR's new "upload -> WS notify -> download" path.
 */
test.describe('@supersync Realtime Push', () => {
  test('propagates changes to another client without manual sync', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(180000);

    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const appUrl = baseURL || 'http://localhost:4242';
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync({ ...syncConfig, enableWebSocket: true });

      const baselineTask = `Realtime-Baseline-${testRunId}`;
      await clientA.workView.addTask(baselineTask);
      await clientA.sync.syncAndWait();
      await waitForTask(clientA.page, baselineTask);

      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.sync.setupSuperSync({ ...syncConfig, enableWebSocket: true });
      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, baselineTask);

      // Allow the post-sync WebSocket connection to establish on both clients.
      // A second syncAndWait round-trip ensures the WS-triggered download pipeline is active.
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();

      const pushedTask = `Realtime-Pushed-${testRunId}`;
      await clientA.workView.addTask(pushedTask);

      const pushStart = Date.now();
      await clientA.sync.syncAndWait();

      // No manual sync on client B here: it should update via WS-triggered download.
      await waitForTask(clientB.page, pushedTask, 10000);

      const propagationMs = Date.now() - pushStart;
      expect(propagationMs).toBeLessThan(10000);
      expect(await clientB.sync.hasSyncError()).toBe(false);
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});

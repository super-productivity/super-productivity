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
 * SuperSync tracking-presence E2E.
 *
 * Guards the ephemeral presence relay end-to-end:
 * 1. Client A starts tracking a task -> B's header shows the remote pill,
 *    naming A by its configured device name
 * 2. B presses the pill's Stop -> A stops tracking, B's pill goes away
 *
 * Presence travels over the WS as opaque envelopes and never touches the
 * op-log — so no sync round-trips are involved after the initial setup.
 */
test.describe('@supersync Tracking Presence', () => {
  test('mirrors tracking to another client and stops it remotely', async ({
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

      const deviceNameA = `Laptop-A-${testRunId}`;
      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync({
        ...syncConfig,
        enableWebSocket: true,
        enableTrackingPresence: true,
        presenceDeviceName: deviceNameA,
      });

      const taskName = `Presence-Task-${testRunId}`;
      await clientA.workView.addTask(taskName);
      await clientA.sync.syncAndWait();
      await waitForTask(clientA.page, taskName);

      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.sync.setupSuperSync({
        ...syncConfig,
        enableWebSocket: true,
        enableTrackingPresence: true,
      });
      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, taskName);

      // Ensure both WS connections are established.
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();

      // A starts tracking -> B shows the remote pill with the task title
      const taskA = clientA.page.locator(`task:has-text("${taskName}")`).first();
      await taskA.hover();
      // The in-task start button is `.start-task-btn` in the hover controls
      // (`.play-btn` only exists on the header FAB, outside <task>).
      await taskA.locator('.start-task-btn').first().click();

      const remotePillB = clientB.page.locator('remote-tracking-pill');
      await expect(remotePillB).toBeVisible({ timeout: 10000 });
      await expect(remotePillB).toContainText(taskName);
      // Both clients are browsers: without the per-device name they would
      // both announce the same platform label and be indistinguishable.
      await expect(remotePillB).toContainText(deviceNameA);

      // B stops the session remotely -> A's tracking ends (its own header
      // pill for the tracked task disappears), and B's remote pill clears
      // after the producer's `stopped` ack.
      await remotePillB.locator('.stop-btn').click();

      const trackedPillA = clientA.page.locator('tracked-task-pill .current-task-title');
      await expect(trackedPillA).toHaveCount(0, { timeout: 10000 });
      await expect(remotePillB.locator('.remote-pill')).toHaveCount(0, {
        timeout: 15000,
      });

      expect(await clientA.sync.hasSyncError()).toBe(false);
      expect(await clientB.sync.hasSyncError()).toBe(false);
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});

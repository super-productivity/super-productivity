import { test, expect } from '../../fixtures/supersync.fixture';
import {
  closeClient,
  createSimulatedClient,
  createTestUser,
  getSuperSyncConfig,
  waitForTask,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { installAndroidTimerBridge } from '../focus-mode/android-timer-bridge';

/**
 * Step 0 of docs/plans/2026-10-30-narrow-mobile-background-sync.md: a task
 * added right before the phone app goes to the background must reach other
 * devices, although Android freezes the WebView seconds later.
 *
 * Before the fix, pause only requested a background sync, which the
 * scheduler's 5s duty-cycle floor deferred (the last sync had just settled);
 * the E2E setup blocks immediate upload. Freezing the page before that
 * deferred run, as the OS does, stranded the op on the phone. The margin: the pause must
 * come within 3.5s of settle, and the fixed push must finish before the freeze
 * at 4.7s after settle.
 */

type BridgeWindow = Window & { SUPAndroid: { onPause$: { next: () => void } } };

// Leaves the push >=1.2s before the freeze; a slower runner fails the
// precondition, not the sync assertion.
const PAUSE_DEADLINE_MS = 3500;
// The scheduler's duty-cycle floor. `settledAt` is the last ops response the
// test sees, which precedes the real settle, so the margin only needs to cover
// the response-event lag.
const DEFERRED_RUN_MS = 5000;
const FREEZE_MARGIN_MS = 300;

test.describe('@supersync Android pause pushes pending ops', () => {
  test('a task added just before backgrounding reaches the other device', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;
    let unfreezeA: (() => Promise<void>) | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // A plays the Android app: the native bridge must exist before boot.
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.page.addInitScript({
        content: `(${installAndroidTimerBridge.toString()})();`,
      });
      await clientA.page.reload();
      await clientA.workView.waitForTaskList();
      await clientA.sync.setupSuperSync(syncConfig);

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // Lifecycle syncs are what is under test, so let them run on A.
      await clientA.page.evaluate(() => {
        delete (globalThis as Record<string, unknown>).__SP_E2E_BLOCK_AUTO_SYNC;
      });
      // A sync that just settled arms the scheduler's duty-cycle floor. Anchor on
      // its last ops response, which precedes the settle. triggerSync(), not
      // syncAndWait(): that one idles 1.5s after completion, eating the window.
      // CDP session set up before the arming sync, so its cost can't land while
      // the push is in flight.
      const cdp = await clientA.context.newCDPSession(clientA.page);
      await cdp.send('Debugger.enable');
      let settledAt = 0;
      const onResponse = (response: { url: () => string }): void => {
        if (response.url().includes('/api/sync/ops')) settledAt = Date.now();
      };
      clientA.page.on('response', onResponse);
      await clientA.sync.triggerSync();
      clientA.page.off('response', onResponse);
      expect(settledAt, 'arming sync made no ops request').toBeGreaterThan(0);

      const taskName = `PausePush-${testRunId}`;
      await clientA.workView.addTask(taskName);
      await waitForTask(clientA.page, taskName);
      let pushLanded = false;
      const pushed = clientA.page
        .waitForResponse(
          (r) =>
            r.url().includes('/api/sync/ops') &&
            r.request().method() === 'POST' &&
            r.ok(),
          { timeout: settledAt + DEFERRED_RUN_MS - FREEZE_MARGIN_MS - Date.now() },
        )
        // Rejection handled here: a timeout means "not landed", and an early
        // failure (precondition) must not surface as an unhandled rejection.
        .then(
          () => {
            pushLanded = true;
          },
          () => undefined,
        );
      await clientA.page.evaluate(() =>
        (window as unknown as BridgeWindow).SUPAndroid.onPause$.next(),
      );
      const pauseAfterSettleMs = Date.now() - settledAt;
      // Logged so CI runs show how much of the deadline is left.
      console.log(`[pause-push] pause ${pauseAfterSettleMs}ms after settle`);
      expect(
        pauseAfterSettleMs,
        'runner too slow: pause came too late to leave the push time before the freeze',
      ).toBeLessThan(PAUSE_DEADLINE_MS);

      // Freeze A like Android does after backgrounding: no timer or deferred
      // request runs from here on. Without the fix, the deferred request runs
      // 5s after settle; freezing later would let it push, and this test would
      // pass without the fix.
      // Debugger.pause, not Page.setWebLifecycleState('frozen'): on a visible
      // page that one lets timers run (measured 2026-10, local Chromium).
      // Freeze once the push landed, or at the margin before the deferred run:
      // a push that lands later is the bug, not a slow runner.
      await pushed;
      await cdp.send('Debugger.pause');
      unfreezeA = async () => {
        // disable, not resume: resume throws if no script ran since the pause.
        await cdp.send('Debugger.disable');
      };
      expect(pushLanded, 'pause push did not reach the server before the freeze').toBe(
        true,
      );

      await clientB.sync.syncAndWait();
      await expect(
        clientB.page.locator(`task:has-text("${taskName}")`).first(),
      ).toBeVisible({ timeout: 10000 });
    } finally {
      if (unfreezeA) await unfreezeA();
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});

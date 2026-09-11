import { test } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  renameTask,
  recordTaskTimeDelta,
  expectExactTaskTime,
  navigateToWorkView,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { expectTaskVisible } from '../../utils/supersync-assertions';

/**
 * SuperSync Round-Time-Spent Conflict E2E Test (#9601)
 *
 * Device A's "Finish day" rounds time spent across all of today's tasks in ONE
 * atomic multi-task `roundTimeSpentForDay` op. When device B holds a concurrent
 * pending edit on any of those tasks, downloading the rounding op used to stop
 * B's sync forever with
 * `SYNC_MULTI_ENTITY_UNSUPPORTED side=remote actionType=[Task] RoundTimeSpentForDay`.
 *
 * This test pins the resolved behavior: the rounding op replays atomically on B
 * (uncontested siblings converge to the rounded value), B's newer edit wins its
 * task via a compensation snapshot that re-uploads B's state, and both clients
 * converge on the mixed result.
 *
 * Prerequisites:
 * - super-sync-server running on localhost:1901 with TEST_MODE=true
 * - Frontend running on localhost:4242
 */

/** Local YYYY-MM-DD — must match the browser's `todayStr` (same machine TZ). */
const localDateStr = (): string => {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
};

test.describe('@supersync Round Time Spent Conflict Resolution', () => {
  test.describe.configure({ mode: 'serial' });

  /**
   * Scenario (mirrors the #9601 report):
   * 1. Client A creates T1–T3 with odd tracked times, syncs
   * 2. Client B syncs (receives tasks + times), then gets WS-blocked
   * 3. Client A rounds UP to 5m via the daily-summary UI (ONE multi-task op), syncs
   * 4. Client B renames T1 — a NEWER concurrent edit on a rounded task
   * 5. Client B syncs: downloads the multi-task rounding op → conflict on T1.
   *    Pre-fix this wedged sync forever; post-fix it resolves as mixed winners.
   *
   * Expected convergence on BOTH clients:
   * - T2/T3 (uncontested): exactly the rounded 5m (300000ms)
   * - T1 (B's edit won): renamed AND unrounded (130000ms) — B's compensation
   *   snapshot re-uploaded its full state over A's rounding
   */
  test('remote multi-task rounding resolves against a concurrent edit @supersync', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    const uniqueId = Date.now();
    const taskDate = localDateStr();
    const time1 = 130_000; // 2m10s — stays unrounded on the conflicted task
    const time2 = 70_000; // 1m10s → rounds UP to 5m
    const time3 = 110_000; // 1m50s → rounds UP to 5m
    const roundedTime = 300_000; // 5m
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // ============ PHASE 1: Client A creates tasks with tracked time ========
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      const task1Name = `RoundConflict-T1-${uniqueId}`;
      const task2Name = `RoundConflict-T2-${uniqueId}`;
      const task3Name = `RoundConflict-T3-${uniqueId}`;

      await clientA.workView.addTask(task1Name);
      await clientA.workView.addTask(task2Name);
      await clientA.workView.addTask(task3Name);
      await recordTaskTimeDelta(clientA, task1Name, taskDate, time1);
      await recordTaskTimeDelta(clientA, task2Name, taskDate, time2);
      await recordTaskTimeDelta(clientA, task3Name, taskDate, time3);
      await expectExactTaskTime(clientA, task1Name, time1);
      console.log('[RoundConflict] Client A created T1–T3 with tracked time');

      await clientA.sync.syncAndWait();
      console.log('[RoundConflict] Client A synced (uploaded tasks + time)');

      // ============ PHASE 2: Client B downloads tasks ========================
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();

      await waitForTask(clientB.page, task1Name);
      await waitForTask(clientB.page, task2Name);
      await waitForTask(clientB.page, task3Name);
      await expectExactTaskTime(clientB, task1Name, time1);
      console.log('[RoundConflict] Client B received all tasks with time');

      // Block WS-triggered downloads on Client B so it does not auto-receive
      // A's rounding op before making its own concurrent edit (true race).
      await clientB.page.evaluate(
        () => ((globalThis as any).__SP_E2E_BLOCK_WS_DOWNLOAD = true),
      );

      // ============ PHASE 3: Client A rounds time via the daily summary ======
      // Drives the real finish-day UI: ONE atomic roundTimeSpentForDay op
      // covering all three tasks.
      await clientA.page.goto('/#/tag/TODAY/daily-summary');
      const roundMenuBtn = clientA.page
        .locator('task-summary-tables button', { hasText: 'Round Time Spent' })
        .first();
      await roundMenuBtn.click();
      await clientA.page
        .getByRole('menuitem', { name: 'Round UP all tasks to 5 minutes' })
        .click();
      // T1 rounding on A is the PREMISE of the conflict below: without it, B's
      // rename would not race a rounded task and every later assertion would
      // pass in a conflict-free run too.
      await expectExactTaskTime(clientA, task1Name, roundedTime);
      await expectExactTaskTime(clientA, task2Name, roundedTime);
      await expectExactTaskTime(clientA, task3Name, roundedTime);
      console.log('[RoundConflict] Client A rounded all tasks UP to 5m');

      await navigateToWorkView(clientA);
      await clientA.sync.syncAndWait();
      console.log('[RoundConflict] Client A synced (uploaded multi-task rounding op)');

      // ============ PHASE 4: Client B makes a NEWER concurrent edit ==========
      // The rename's timestamp is newer than A's rounding, so T1 must resolve
      // as a LOCAL win on B while T2/T3 stay uncontested remote rounding.
      const task1Renamed = `RoundConflict-T1-edited-${uniqueId}`;
      await renameTask(clientB, task1Name, task1Renamed);
      console.log(`[RoundConflict] Client B renamed ${task1Name} → ${task1Renamed}`);

      // ============ PHASE 5: Client B syncs (the #9601 moment) ===============
      // Pre-fix: conflict resolution throws SYNC_MULTI_ENTITY_UNSUPPORTED
      // side=remote and the sync spinner never completes — syncAndWait fails.
      await clientB.page.evaluate(
        () => ((globalThis as any).__SP_E2E_BLOCK_WS_DOWNLOAD = false),
      );
      await clientB.sync.syncAndWait();
      console.log('[RoundConflict] Client B synced (conflict resolved, no wedge)');

      // Convergence rounds: B uploads its compensation, A downloads it.
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await clientA.sync.syncAndWait();
      console.log('[RoundConflict] Extra sync rounds for convergence');

      // ============ PHASE 6: Verify the mixed result on BOTH clients =========
      await navigateToWorkView(clientA);
      await navigateToWorkView(clientB);

      // Uncontested siblings: rounded everywhere.
      await expectExactTaskTime(clientA, task2Name, roundedTime);
      await expectExactTaskTime(clientA, task3Name, roundedTime);
      await expectExactTaskTime(clientB, task2Name, roundedTime);
      await expectExactTaskTime(clientB, task3Name, roundedTime);
      console.log('[RoundConflict] T2/T3 rounded to 5m on both clients');

      // Conflicted task: B's newer edit won — renamed and unrounded on BOTH
      // clients. The rename reaching A proves the compensation op uploaded;
      // the unrounded time on A proves it replaced A's rounded state.
      await waitForTask(clientB.page, task1Renamed);
      await expectTaskVisible(clientA, task1Renamed);
      await expectExactTaskTime(clientA, task1Renamed, time1);
      await expectExactTaskTime(clientB, task1Renamed, time1);
      console.log('[RoundConflict] T1 kept rename + unrounded time on both clients');

      console.log(
        '[RoundConflict] ✓ Test passed: remote multi-task rounding conflict converged',
      );
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});

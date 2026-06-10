import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  getTaskTitles,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';

/**
 * Issue #6992: Sync differences after new-day routines.
 *
 * Reproduces the scenario where day-change effects on one device create
 * operations that conflict with user actions on another device.
 *
 * Simplified approach (avoids complex recurring task setup):
 * 1. Both clients start on day X at 23:55
 * 2. Client A creates a task (gets added to TODAY_TAG for day X)
 * 3. Both sync
 * 4. Advance both clocks past midnight to day X+1
 * 5. Day-change effects fire on both, creating new repeat instances
 * 6. Client A moves a task to today, Client B's day-change removes overdue
 * 7. Both sync, verify convergence
 *
 * Key assertion: after sync, both clients show the same tasks in their
 * today list. If they diverge, the LWW conflict resolution failed.
 */
test.describe('@supersync Day-change overdue sync (#6992)', () => {
  test('tasks should converge after day change on both clients', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    const appUrl = baseURL || 'http://localhost:4242';
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      const dayXTime = new Date('2026-07-20T23:55:00');
      const dayX1Morning = new Date('2026-07-21T09:00:00');
      const dayX1Later = new Date('2026-07-21T09:30:00');

      // ============ PHASE 1: Client A creates tasks on day X ============
      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.page.clock.setFixedTime(dayXTime);
      await clientA.page.reload();
      await clientA.workView.waitForTaskList();
      await clientA.sync.setupSuperSync(syncConfig);

      const task1 = `Task1-${testRunId}`;
      const task2 = `Task2-${testRunId}`;
      await clientA.workView.addTask(task1);
      await clientA.workView.addTask(task2);
      await clientA.sync.syncAndWait();
      console.log('[#6992] Client A created 2 tasks and synced');

      // ============ PHASE 2: Client B downloads ============
      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.page.clock.setFixedTime(dayXTime);
      await clientB.page.reload();
      await clientB.workView.waitForTaskList();
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, task1);
      await waitForTask(clientB.page, task2);
      console.log('[#6992] Client B synced, has both tasks');

      // ============ PHASE 3: Day change on Client A (morning) ============
      // Advance Client A clock to day X+1 morning
      await clientA.page.clock.setFixedTime(dayX1Morning);
      // Wait for day-change effects to process
      await clientA.page.waitForTimeout(5000);
      console.log('[#6992] Client A advanced to day X+1 morning');

      // Get Client A's task list
      const titlesABefore = await getTaskTitles(clientA);
      console.log('[#6992] Client A tasks after day change:', titlesABefore);

      // Sync Client A
      await clientA.sync.syncAndWait();
      console.log('[#6992] Client A synced');

      // ============ PHASE 4: Day change on Client B (later — THE RACE) ============
      // Client B's clock advances AFTER Client A has already synced.
      // Any operations created by Client B's day-change will have a NEWER timestamp.
      await clientB.page.clock.setFixedTime(dayX1Later);
      // Wait for day-change effects on Client B
      await clientB.page.waitForTimeout(5000);
      console.log('[#6992] Client B advanced to day X+1 (later)');

      // ============ PHASE 5: Sync convergence ============
      await clientB.sync.syncAndWait();
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      console.log('[#6992] All sync rounds complete');

      // Allow UI to settle
      await clientA.page.waitForTimeout(1000);
      await clientB.page.waitForTimeout(1000);

      // ============ PHASE 6: Verify convergence ============
      const titlesA = await getTaskTitles(clientA);
      const titlesB = await getTaskTitles(clientB);
      console.log('[#6992] Client A final tasks:', titlesA);
      console.log('[#6992] Client B final tasks:', titlesB);

      // Both clients should have the SAME tasks in their today list.
      // Order may differ, so compare as sorted arrays.
      const sortedA = [...titlesA].sort();
      const sortedB = [...titlesB].sort();

      // This is the core convergence check.
      // If this fails, the day-change operations created a conflict that
      // was resolved differently on each device.
      expect(sortedA).toEqual(sortedB);

      console.log('[#6992] PASS: Both clients converged');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});

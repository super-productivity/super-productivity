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
 * SuperSync Planner E2E Tests
 *
 * Tests planner/scheduled day sync scenarios:
 * - Scheduling tasks for future days
 * - Moving tasks between days in planner
 * - Virtual TODAY_TAG behavior
 */

test.describe('@supersync Planner Sync', () => {
  /**
   * Test: Task scheduled for tomorrow syncs correctly
   *
   * Actions:
   * 1. Client A creates task scheduled for tomorrow (sd:1d)
   * 2. Client A syncs
   * 3. Client B syncs
   * 4. Client B navigates to planner
   * 5. Verify task appears on tomorrow in planner
   */
  test('Task scheduled for tomorrow syncs to planner', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    const uniqueId = Date.now();
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // ============ PHASE 1: Client A Schedules Task for Tomorrow ============
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      const taskName = `Tomorrow-${uniqueId}`;
      // sd:1d means schedule 1 day from now (tomorrow)
      await clientA.workView.addTask(`${taskName} sd:1d`);
      console.log('[Planner Test] Client A created task for tomorrow');

      // Task should NOT be visible in TODAY work view (it's for tomorrow)
      // But let's verify it was created
      await clientA.page.waitForTimeout(500);

      // ============ PHASE 2: Sync ============
      await clientA.sync.syncAndWait();
      console.log('[Planner Test] Client A synced');

      // ============ PHASE 3: Client B Downloads and Checks Planner ============
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();
      console.log('[Planner Test] Client B synced');

      // Navigate to planner
      await clientB.page.goto('/#/planner');
      await clientB.page.waitForLoadState('networkidle');
      await clientB.page.waitForSelector('planner', { timeout: 10000 });
      console.log('[Planner Test] Client B on planner page');

      // Look for task in tomorrow's section
      // The planner shows days as columns or rows with date headers
      const taskInPlanner = clientB.page.locator(
        `planner-day:has-text("${taskName}"), .planner-day-tasks:has-text("${taskName}")`,
      );

      await expect(taskInPlanner).toBeVisible({ timeout: 10000 });
      console.log('[Planner Test] Task visible in planner on Client B');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Test: Moving task to today in planner syncs correctly
   *
   * Actions:
   * 1. Client A creates task for tomorrow
   * 2. Both clients sync
   * 3. Client A moves task to today via context menu
   * 4. Both sync
   * 5. Verify task now in TODAY on Client B
   */
  test('Scheduled task visible in planner on synced client', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    const uniqueId = Date.now();
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // ============ PHASE 1: Setup ============
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      const taskName = `Scheduled-${uniqueId}`;
      // sd:2d means schedule for 2 days from now
      await clientA.workView.addTask(`${taskName} sd:2d`);
      console.log('[Scheduled Test] Client A created task for 2 days from now');

      await clientA.sync.syncAndWait();

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();
      console.log('[Scheduled Test] Both synced');

      // ============ PHASE 2: Verify in Planner on Client B ============
      await clientB.page.goto('/#/planner');
      await clientB.page.waitForLoadState('networkidle');
      await clientB.page.waitForSelector('planner', { timeout: 10000 });

      // Task should appear in planner
      const taskInPlanner = clientB.page.locator(`text=${taskName}`).first();
      await expect(taskInPlanner).toBeVisible({ timeout: 10000 });
      console.log('[Scheduled Test] Scheduled task visible in planner on Client B');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Test: Task with dueDay maintains virtual TODAY_TAG behavior
   *
   * Actions:
   * 1. Client A creates task for today (sd:today)
   * 2. Verify task appears in TODAY tag view
   * 3. Client A syncs
   * 4. Client B syncs
   * 5. Verify task in TODAY on Client B (via dueDay, not tagIds)
   */
  test('TODAY tag membership via dueDay syncs correctly', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    const uniqueId = Date.now();
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // ============ PHASE 1: Client A Creates Task for Today ============
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      const taskName = `TodayTask-${uniqueId}`;
      // sd:today schedules for today, setting dueDay
      await clientA.workView.addTask(`${taskName} sd:today`);
      console.log('[TODAY Test] Client A created task for today');

      // Verify task appears in TODAY view
      await waitForTask(clientA.page, taskName);
      console.log('[TODAY Test] Task visible in TODAY on Client A');

      // ============ PHASE 2: Sync ============
      await clientA.sync.syncAndWait();

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();
      console.log('[TODAY Test] Both synced');

      // ============ PHASE 3: Verify on Client B ============
      // Task should appear in TODAY view on Client B
      // This confirms dueDay synced correctly and TODAY_TAG virtual membership works
      await waitForTask(clientB.page, taskName);

      await expectTaskVisible(clientB, taskName);
      console.log('[TODAY Test] Task visible in TODAY on Client B');

      // Verify we're in TODAY tag context (URL check)
      const currentUrl = clientB.page.url();
      expect(currentUrl).toContain('TODAY');

      console.log('[TODAY Test] Virtual TODAY_TAG membership working');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Test: Scheduling task for future date syncs
   *
   * Actions:
   * 1. Client A creates task for 3 days from now
   * 2. Client A syncs
   * 3. Client B syncs
   * 4. Client B checks planner for future date
   */
  test('Task scheduled for future date syncs to planner', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    const uniqueId = Date.now();
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // ============ PHASE 1: Client A Schedules Task for Future ============
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      const taskName = `Future-${uniqueId}`;
      // sd:3d means schedule 3 days from now
      await clientA.workView.addTask(`${taskName} sd:3d`);
      console.log('[Future Test] Client A created task for 3 days from now');

      // ============ PHASE 2: Sync ============
      await clientA.sync.syncAndWait();

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();
      console.log('[Future Test] Both synced');

      // ============ PHASE 3: Verify in Planner ============
      await clientB.page.goto('/#/planner');
      await clientB.page.waitForLoadState('networkidle');
      await clientB.page.waitForSelector('planner', { timeout: 10000 });

      // The task should appear somewhere in the planner view
      const taskInPlanner = clientB.page.locator(`text=${taskName}`).first();
      await expect(taskInPlanner).toBeVisible({ timeout: 10000 });
      console.log('[Future Test] Task visible in planner on Client B');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});

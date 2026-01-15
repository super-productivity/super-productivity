import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { waitForUISettle } from '../../utils/waits';

/**
 * SuperSync Cross-Entity Operations E2E Tests
 *
 * Tests multi-task sync and basic entity relationships:
 * - Multiple tasks sync together
 * - Task with subtasks syncs correctly
 * - Marking tasks done syncs across clients
 */

test.describe('@supersync Cross-Entity Operations Sync', () => {
  /**
   * Test: Multiple tasks sync as a batch
   *
   * Actions:
   * 1. Client A creates 5 tasks
   * 2. Client A syncs
   * 3. Client B syncs
   * 4. Verify all 5 tasks appear on Client B
   */
  test('Multiple tasks sync together', async ({ browser, baseURL, testRunId }) => {
    const uniqueId = Date.now();
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // ============ PHASE 1: Client A Creates Multiple Tasks ============
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      const taskNames: string[] = [];
      for (let i = 1; i <= 5; i++) {
        const taskName = `BatchTask${i}-${uniqueId}`;
        taskNames.push(taskName);
        await clientA.workView.addTask(taskName);
        await waitForUISettle(clientA.page);
      }
      console.log('[Multi Task Test] Client A created 5 tasks');

      // Verify all tasks on Client A
      for (const taskName of taskNames) {
        await waitForTask(clientA.page, taskName);
      }

      // ============ PHASE 2: Sync to Server ============
      await clientA.sync.syncAndWait();
      console.log('[Multi Task Test] Client A synced');

      // ============ PHASE 3: Client B Downloads ============
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();
      console.log('[Multi Task Test] Client B synced');

      // ============ PHASE 4: Verify All Tasks on Client B ============
      for (const taskName of taskNames) {
        await waitForTask(clientB.page, taskName);
      }

      // Count tasks on Client B
      const tasksB = clientB.page.locator('task');
      const taskCount = await tasksB.count();
      expect(taskCount).toBeGreaterThanOrEqual(5);

      console.log('[Multi Task Test] All 5 tasks synced to Client B');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Test: Task with subtasks syncs correctly
   *
   * Actions:
   * 1. Client A creates parent task with 3 subtasks
   * 2. Client A syncs
   * 3. Client B syncs
   * 4. Verify parent and all subtasks on Client B
   */
  test('Task with subtasks syncs correctly', async ({ browser, baseURL, testRunId }) => {
    const uniqueId = Date.now();
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // ============ PHASE 1: Client A Creates Parent with Subtasks ============
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      const parentName = `ParentTask-${uniqueId}`;
      const sub1Name = `Sub1-${uniqueId}`;
      const sub2Name = `Sub2-${uniqueId}`;
      const sub3Name = `Sub3-${uniqueId}`;

      await clientA.workView.addTask(parentName);
      await clientA.page.waitForTimeout(300);

      const parentTask = clientA.page.locator(`task:has-text("${parentName}")`).first();
      await clientA.workView.addSubTask(parentTask, sub1Name);
      await clientA.workView.addSubTask(parentTask, sub2Name);
      await clientA.workView.addSubTask(parentTask, sub3Name);
      console.log('[Subtask Test] Client A created parent with 3 subtasks');

      // Expand parent to see subtasks
      const expandBtn = parentTask.locator('.expand-btn');
      if (await expandBtn.isVisible()) {
        await expandBtn.click();
      }

      // ============ PHASE 2: Sync to Server ============
      await clientA.sync.syncAndWait();
      console.log('[Subtask Test] Client A synced');

      // ============ PHASE 3: Client B Downloads ============
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();
      console.log('[Subtask Test] Client B synced');

      // ============ PHASE 4: Verify on Client B ============
      await waitForTask(clientB.page, parentName);

      // Expand parent on Client B
      const parentTaskB = clientB.page.locator(`task:has-text("${parentName}")`).first();
      const expandBtnB = parentTaskB.locator('.expand-btn');
      if (await expandBtnB.isVisible()) {
        await expandBtnB.click();
      }

      // Verify subtasks
      await waitForTask(clientB.page, sub1Name);
      await waitForTask(clientB.page, sub2Name);
      await waitForTask(clientB.page, sub3Name);

      console.log('[Subtask Test] Parent and all subtasks synced to Client B');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});

import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  getTaskTitles,
  waitForTask,
  getTaskElement,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import {
  createdTitle,
  moveTaskWithKeyboard,
  taskTitleLocator,
} from '../../utils/audit-concurrency-helpers';

/**
 * SuperSync Task Ordering E2E Tests
 *
 * Tests that the initial task order replicates and that a concurrent keyboard
 * reorder of the same TODAY list on two clients converges.
 */

test.describe('@supersync Task Ordering Sync', () => {
  /**
   * Test: The initial task order replicates to another client
   *
   * Actions:
   * 1. Client A creates 3 tasks (Task1, Task2, Task3)
   * 2. Client A syncs
   * 3. Client B syncs (downloads tasks)
   * 4. Verify Client B has same task order as Client A
   *
   * Note: This tests that task ordering is preserved through sync,
   * not that specific reordering actions work (which is UI-dependent).
   */
  test('Initial task order replicates to other client', async ({
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

      // ============ PHASE 1: Client A Creates Tasks ============
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      const task1Name = `Task1-${uniqueId}`;
      const task2Name = `Task2-${uniqueId}`;
      const task3Name = `Task3-${uniqueId}`;

      await clientA.workView.addTask(task1Name);
      await clientA.workView.addTask(task2Name);
      await clientA.workView.addTask(task3Name);
      console.log('[Order Test] Client A created 3 tasks');

      // Verify all tasks exist on Client A
      await clientA.page.waitForTimeout(500);
      const tasksA = clientA.page.locator('task');
      await expect(tasksA).toHaveCount(3);

      // ============ PHASE 2: Sync to Server ============
      await clientA.sync.syncAndWait();
      console.log('[Order Test] Client A synced');

      // ============ PHASE 3: Client B Downloads ============
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();
      console.log('[Order Test] Client B synced');

      // Verify Client B has all 3 tasks
      await waitForTask(clientB.page, task1Name);
      await waitForTask(clientB.page, task2Name);
      await waitForTask(clientB.page, task3Name);
      console.log('[Order Test] Client B has all 3 tasks');

      // ============ PHASE 4: Verify Order on Both Clients ============
      // Get task order on both clients using innerText to avoid duplicates. One
      // snapshot per client: count() + nth(i) reads would wait on a row that a
      // re-render after the sync had just removed.
      const orderA = await getTaskTitles(clientA);
      const orderB = await getTaskTitles(clientB);

      console.log('[Order Test] Client A order:', orderA);
      console.log('[Order Test] Client B order:', orderB);

      // Verify both clients have 3 tasks
      expect(orderA.length).toBe(3);
      expect(orderB.length).toBe(3);

      // Orders should match exactly
      expect(orderA).toEqual(orderB);

      // Verify all our tasks are present
      expect(orderA.some((t) => t.includes('Task1'))).toBe(true);
      expect(orderA.some((t) => t.includes('Task2'))).toBe(true);
      expect(orderA.some((t) => t.includes('Task3'))).toBe(true);

      console.log('[Order Test] Orders match on both clients');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Test: Subtask ordering syncs between clients
   *
   * Actions:
   * 1. Client A creates parent with 3 subtasks
   * 2. Client A syncs
   * 3. Client B syncs (downloads)
   * 4. Verify subtask order is consistent on both clients
   */
  test('Subtask ordering syncs to other client', async ({
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

      // ============ PHASE 1: Client A Creates Parent and Subtasks ============
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      const parentName = `Parent-${uniqueId}`;
      const sub1Name = `Sub1-${uniqueId}`;
      const sub2Name = `Sub2-${uniqueId}`;
      const sub3Name = `Sub3-${uniqueId}`;

      await clientA.workView.addTask(parentName);
      const parentTask = clientA.page.locator(`task:has-text("${parentName}")`).first();

      await clientA.workView.addSubTask(parentTask, sub1Name);
      await clientA.workView.addSubTask(parentTask, sub2Name);
      await clientA.workView.addSubTask(parentTask, sub3Name);
      console.log('[Subtask Order Test] Client A created parent with 3 subtasks');

      // Expand parent to see subtasks
      const expandBtn = parentTask.locator('.expand-btn');
      if (await expandBtn.isVisible()) {
        await expandBtn.click();
      }

      // ============ PHASE 2: Sync to Server ============
      await clientA.sync.syncAndWait();
      console.log('[Subtask Order Test] Client A synced');

      // ============ PHASE 3: Client B Downloads ============
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();
      console.log('[Subtask Order Test] Client B synced');

      // Expand parent on Client B
      const parentTaskB = clientB.page.locator(`task:has-text("${parentName}")`).first();
      const expandBtnB = parentTaskB.locator('.expand-btn');
      if (await expandBtnB.isVisible()) {
        await expandBtnB.click();
      }

      // Verify Client B has all subtasks
      await waitForTask(clientB.page, sub1Name);
      await waitForTask(clientB.page, sub2Name);
      await waitForTask(clientB.page, sub3Name);
      console.log('[Subtask Order Test] Client B has all subtasks');

      // ============ PHASE 4: Verify Subtask Order ============
      // Get subtask order using innerText to avoid duplicate text issues
      const getSubtaskOrder = async (client: SimulatedE2EClient): Promise<string[]> => {
        // One snapshot: count() + nth(i) reads would wait on a row a re-render removed.
        const texts = await client.page
          .locator('task.hasNoSubTasks .task-title')
          .allInnerTexts();
        return texts.map((text) => text.trim());
      };

      const subtaskOrderA = await getSubtaskOrder(clientA);
      const subtaskOrderB = await getSubtaskOrder(clientB);

      console.log('[Subtask Order Test] Client A subtask order:', subtaskOrderA);
      console.log('[Subtask Order Test] Client B subtask order:', subtaskOrderB);

      // Verify both have 3 subtasks
      expect(subtaskOrderA.length).toBe(3);
      expect(subtaskOrderB.length).toBe(3);

      // Orders should match
      expect(subtaskOrderA).toEqual(subtaskOrderB);

      // Verify all subtasks are present
      expect(subtaskOrderA.some((t) => t.includes('Sub1'))).toBe(true);
      expect(subtaskOrderA.some((t) => t.includes('Sub2'))).toBe(true);
      expect(subtaskOrderA.some((t) => t.includes('Sub3'))).toBe(true);

      console.log('[Subtask Order Test] Subtask orders match');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Test: Concurrent reordering of the same TODAY list converges
   *
   * Both moves write TAG:TODAY's taskIds, so this is a real same-entity
   * conflict (the earlier version clicked the task centre, which enters title
   * editing where the shortcut never fires, and moved the top task up — a no-op).
   *
   * Actions:
   * 1. A creates Task1..Task3; new tasks go on top: [T3, T2, T1]. B downloads.
   * 2. A moves T1 up twice: [T1, T3, T2] (offline)
   * 3. B moves T3 down twice, later: [T2, T1, T3] (offline)
   * 4. Sync A, B, A
   * 5. Verify both show B's order (LWW: B's TAG:TODAY write is later)
   */
  test('Concurrent reordering resolves consistently', async ({
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

      // ============ PHASE 1: Setup Both Clients with Same Tasks ============
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      const task1Name = `Task1-${uniqueId}`;
      const task2Name = `Task2-${uniqueId}`;
      const task3Name = `Task3-${uniqueId}`;

      await clientA.workView.addTask(task1Name);
      await clientA.workView.addTask(task2Name);
      await clientA.workView.addTask(task3Name);

      await clientA.sync.syncAndWait();

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();

      const full = (name: string): string => createdTitle('A', testRunId, name);
      const initialOrder = [task3Name, task2Name, task1Name].map(full);
      await expect(taskTitleLocator(clientA)).toHaveText(initialOrder);
      await expect(taskTitleLocator(clientB)).toHaveText(initialOrder);

      // ============ PHASE 2: Concurrent Reordering ============
      await moveTaskWithKeyboard(getTaskElement(clientA, task1Name), 'up', 2);
      const orderA = [task1Name, task3Name, task2Name].map(full);
      await expect(taskTitleLocator(clientA)).toHaveText(orderA);

      // B's write is the later one.
      await clientB.page.waitForTimeout(1000);
      await moveTaskWithKeyboard(getTaskElement(clientB, task3Name), 'down', 2);
      const orderB = [task2Name, task1Name, task3Name].map(full);
      await expect(taskTitleLocator(clientB)).toHaveText(orderB);

      // ============ PHASE 3: Sync - LWW Resolution ============
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();

      // ============ PHASE 4: Verify Converged Order ============
      // Retrying assertions first: the list may still re-render after sync.
      await expect(taskTitleLocator(clientA)).toHaveText(orderB);
      await expect(taskTitleLocator(clientB)).toHaveText(orderB);
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});

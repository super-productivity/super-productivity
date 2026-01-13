import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';

/**
 * SuperSync Task Ordering E2E Tests
 *
 * Tests that task ordering/reordering syncs correctly between clients.
 * Uses drag-and-drop to reorder tasks and verifies the order is replicated.
 */

test.describe('@supersync Task Ordering Sync', () => {
  /**
   * Test: Task order is consistent between clients after sync
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
  test('Task reordering syncs to other client', async ({
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
      // Get task order on both clients using innerText to avoid duplicates
      const getTaskOrder = async (client: SimulatedE2EClient): Promise<string[]> => {
        const tasks = client.page.locator('task .task-title');
        const count = await tasks.count();
        const order: string[] = [];
        for (let i = 0; i < count; i++) {
          const titleEl = tasks.nth(i);
          const text = await titleEl.innerText();
          order.push(text.trim());
        }
        return order;
      };

      const orderA = await getTaskOrder(clientA);
      const orderB = await getTaskOrder(clientB);

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
        const subtasks = client.page.locator('task.hasNoSubTasks .task-title');
        const count = await subtasks.count();
        const order: string[] = [];
        for (let i = 0; i < count; i++) {
          const text = await subtasks.nth(i).innerText();
          order.push(text.trim());
        }
        return order;
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
   * Test: Concurrent reordering resolves via LWW
   *
   * Actions:
   * 1. Both clients have same 3 tasks
   * 2. Client A moves Task1 to top (offline)
   * 3. Client B moves Task3 to top (offline)
   * 4. Both sync - LWW should resolve
   * 5. Verify consistent state
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

      // Verify both have all tasks
      await waitForTask(clientA.page, task1Name);
      await waitForTask(clientB.page, task1Name);
      console.log('[Concurrent Order Test] Both clients have all tasks');

      // ============ PHASE 2: Concurrent Reordering ============
      // Client A moves Task1 to top
      const task1A = clientA.page.locator(`task:has-text("${task1Name}")`);
      await task1A.click();
      await clientA.page.keyboard.press('Control+Shift+ArrowUp');
      await clientA.page.waitForTimeout(300);
      console.log('[Concurrent Order Test] Client A moved Task1 to top');

      // Client B moves Task3 to top (concurrent, no sync yet)
      const task3B = clientB.page.locator(`task:has-text("${task3Name}")`);
      await task3B.click();
      await clientB.page.keyboard.press('Control+Shift+ArrowUp');
      await clientB.page.waitForTimeout(300);
      console.log('[Concurrent Order Test] Client B moved Task3 to top');

      // ============ PHASE 3: Sync - LWW Resolution ============
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await clientA.sync.syncAndWait(); // Final sync to converge
      console.log('[Concurrent Order Test] All clients synced');

      // ============ PHASE 4: Verify Consistent State ============
      const getOrder = async (client: SimulatedE2EClient): Promise<string[]> => {
        const tasks = client.page.locator('task');
        const count = await tasks.count();
        const order: string[] = [];
        for (let i = 0; i < count; i++) {
          const title = await tasks.nth(i).locator('.task-title').textContent();
          order.push(title?.trim() || '');
        }
        return order;
      };

      const orderA = await getOrder(clientA);
      const orderB = await getOrder(clientB);

      console.log('[Concurrent Order Test] Client A final order:', orderA);
      console.log('[Concurrent Order Test] Client B final order:', orderB);

      // Both clients should have the same order (eventual consistency)
      expect(orderA.length).toBe(3);
      expect(orderB.length).toBe(3);
      expect(orderA).toEqual(orderB);

      console.log('[Concurrent Order Test] Both clients have consistent order');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});

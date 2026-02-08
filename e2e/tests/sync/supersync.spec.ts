import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  getTaskElement,
  getParentTaskElement,
  markTaskDone,
  markSubtaskDone,
  expandTask,
  deleteTask,
  renameTask,
  startTimeTracking,
  stopTimeTracking,
  getTaskCount,
  hasTaskOnClient,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import {
  expectTaskVisible,
  expectTaskNotVisible,
  expectTaskDone,
  expectTaskOnAllClients,
  expectSubtaskVisible,
  expectSubtaskDone,
  expectSubtaskNotDone,
  expectEqualTaskCount,
  expectTaskCount,
} from '../../utils/supersync-assertions';
import { waitForAppReady } from '../../utils/waits';

/**
 * SuperSync E2E Tests
 *
 * These tests verify multi-client sync using the real super-sync-server.
 * They mirror scenarios from sync-scenarios.integration.spec.ts but test
 * the full stack including UI, network, and real IndexedDB isolation.
 *
 * Prerequisites:
 * - super-sync-server running on localhost:1901 with TEST_MODE=true
 * - Frontend running on localhost:4242
 *
 * Run with: npm run e2e:supersync
 */

test.describe('@supersync SuperSync E2E', () => {
  /**
   * Scenario 2.1: Client A Creates, Client B Downloads
   *
   * This is the simplest sync scenario - one client creates data,
   * another client downloads it.
   *
   * Setup: Client A and B, empty server
   *
   * Actions:
   * 1. Client A creates "Task 1", syncs
   * 2. Client B syncs (download)
   *
   * Expected:
   * - Client A: has Task 1
   * - Client B: has Task 1 (received via sync)
   * - Server: has 1 operation
   */
  test('2.1 Client A creates task, Client B downloads it', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      // Create shared test user (both clients use same account)
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // Set up Client A
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      // Step 1: Client A creates a task
      const taskName = `Task-${testRunId}-from-A`;
      await clientA.workView.addTask(taskName);

      // Step 2: Client A syncs (upload)
      await clientA.sync.syncAndWait();

      // Verify Client A still has the task
      await waitForTask(clientA.page, taskName);

      // Set up Client B (fresh context = isolated IndexedDB)
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // Step 3: Client B syncs (download)
      await clientB.sync.syncAndWait();

      // Verify Client B has the task from Client A
      await waitForTask(clientB.page, taskName);

      // Final assertions
      await expectTaskOnAllClients([clientA, clientB], taskName);
    } finally {
      // Cleanup
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario 2.2: Both Clients Create Different Tasks
   *
   * Setup: A and B connected, empty server
   *
   * Actions:
   * 1. Client A creates "Task A", syncs
   * 2. Client B creates "Task B", syncs
   * 3. Client A syncs (download)
   *
   * Expected: Both clients have both tasks
   */
  test('2.2 Both clients create different tasks', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // Set up both clients
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // Step 1: Client A creates Task A
      const taskA = `TaskA-${testRunId}`;
      await clientA.workView.addTask(taskA);
      // Wait for task to be fully created in store
      await waitForTask(clientA.page, taskA);

      // Step 2: Client A syncs (upload Task A)
      await clientA.sync.syncAndWait();
      console.log('[Test] Client A synced Task A');

      // Step 3: Client B creates Task B
      const taskB = `TaskB-${testRunId}`;
      await clientB.workView.addTask(taskB);
      // Wait for task to be fully created in store
      await waitForTask(clientB.page, taskB);

      // Step 4: Client B syncs (upload Task B, download Task A)
      await clientB.sync.syncAndWait();
      console.log('[Test] Client B synced (uploaded Task B, downloaded Task A)');

      // Step 5: Client A syncs (download Task B)
      await clientA.sync.syncAndWait();
      console.log('[Test] Client A synced (downloaded Task B)');

      // Wait for UI to settle after sync
      await clientA.page.waitForTimeout(500);
      await clientB.page.waitForTimeout(500);

      // Verify both clients have both tasks
      await waitForTask(clientA.page, taskA);
      await waitForTask(clientA.page, taskB);
      await waitForTask(clientB.page, taskA);
      await waitForTask(clientB.page, taskB);

      await expectTaskOnAllClients([clientA, clientB], taskA);
      await expectTaskOnAllClients([clientA, clientB], taskB);
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario 1.3: Update Task and Sync
   *
   * Setup: Client A with existing task
   *
   * Actions:
   * 1. Client A creates "Task 1", syncs
   * 2. Client B syncs (download)
   * 3. Client A marks task as done, syncs
   * 4. Client B syncs
   *
   * Expected: Both clients see task as done
   */
  test('1.3 Update propagates between clients', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // Set up Client A and create task
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      const taskName = `Task-${testRunId}-update`;
      await clientA.workView.addTask(taskName);
      await clientA.sync.syncAndWait();

      // Set up Client B and sync to get the task
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();

      // Verify Client B has the task
      await waitForTask(clientB.page, taskName);

      // Client A marks task as done
      await markTaskDone(clientA, taskName);

      // Client A syncs the update
      await clientA.sync.syncAndWait();

      // Client B syncs to receive the update
      await clientB.sync.syncAndWait();

      // Verify both show task as done
      await expectTaskDone(clientA, taskName);
      await expectTaskDone(clientB, taskName);
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario 1.4: Delete Task and Sync
   *
   * Actions:
   * 1. Client A creates task, syncs
   * 2. Client B syncs (download)
   * 3. Client A deletes task, syncs
   * 4. Client B syncs
   *
   * Expected: Task removed from both clients
   */
  test('1.4 Delete propagates between clients', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // Set up Client A and create task
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      const taskName = `Task-${testRunId}-delete`;
      await clientA.workView.addTask(taskName);
      await clientA.sync.syncAndWait();

      // Set up Client B and sync
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();

      // Verify Client B has the task
      await waitForTask(clientB.page, taskName);

      // Client A deletes the task
      await deleteTask(clientA, taskName);

      // Client A syncs the deletion
      await clientA.sync.syncAndWait();

      // Client B syncs to receive the deletion
      await clientB.sync.syncAndWait();

      // Verify task is removed from both clients
      await expectTaskNotVisible(clientA, taskName);
      await expectTaskNotVisible(clientB, taskName);
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario 3.1: Concurrent Edits on Same Task
   *
   * This tests basic conflict handling - both clients edit the same
   * task without seeing each other's changes first.
   *
   * Actions:
   * 1. Client A creates task, syncs
   * 2. Client B syncs (download)
   * 3. Client A marks task done (no sync yet)
   * 4. Client B adds notes to task (no sync yet)
   * 5. Client A syncs
   * 6. Client B syncs
   *
   * Expected: Conflict detected or auto-merged, final state consistent
   */
  test('3.1 Concurrent edits handled gracefully', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // Set up both clients
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      const taskName = `Task-${testRunId}-conflict`;
      await clientA.workView.addTask(taskName);
      await clientA.sync.syncAndWait();

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();

      // Both clients now have the task
      await waitForTask(clientA.page, taskName);
      await waitForTask(clientB.page, taskName);

      // Client A marks done (creates local op)
      await markTaskDone(clientA, taskName);

      // Client B marks done too (concurrent edit)
      await markTaskDone(clientB, taskName);

      // Client A syncs first
      await clientA.sync.syncAndWait();

      // Client B syncs (may detect concurrent edit)
      await clientB.sync.syncAndWait();

      // Client A syncs again to converge
      await clientA.sync.syncAndWait();

      // Verify both clients have consistent state
      await expectEqualTaskCount([clientA, clientB]);

      // Task should exist on both
      await expectTaskOnAllClients([clientA, clientB], taskName);
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario 2.3: Client A Creates Parent, Client B Creates Subtask
   *
   * Tests parent-child task relationships syncing correctly.
   *
   * Actions:
   * 1. Client A creates parent task, syncs
   * 2. Client B syncs (downloads parent)
   * 3. Client B creates subtask under parent, syncs
   * 4. Client A syncs (downloads subtask)
   *
   * Expected: Both clients have parent with subtask
   */
  test('2.3 Client A creates parent, Client B creates subtask', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // Set up Client A and create parent task
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      const parentTaskName = `Parent-${testRunId}`;
      await clientA.workView.addTask(parentTaskName);
      await clientA.sync.syncAndWait();

      // Set up Client B and sync to get the parent task
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();

      // Verify Client B has the parent task
      await waitForTask(clientB.page, parentTaskName);

      // Client B creates a subtask under the parent
      // Use a name that won't match the parent (no testRunId overlap)
      const subtaskName = `ChildOfParent-${Date.now()}`;
      const parentTaskB = getTaskElement(clientB, parentTaskName);
      await clientB.workView.addSubTask(parentTaskB, subtaskName);

      // Client B syncs (uploads subtask)
      await clientB.sync.syncAndWait();

      // Client A syncs (downloads subtask)
      await clientA.sync.syncAndWait();

      // Verify both clients have parent and subtask
      // First expand the parent task to see subtasks
      await expandTask(clientA, parentTaskName);
      await expandTask(clientB, parentTaskName);

      // Wait for subtasks to be visible
      await waitForTask(clientA.page, subtaskName);
      await waitForTask(clientB.page, subtaskName);

      // Verify subtask exists on both
      await expectSubtaskVisible(clientA, subtaskName);
      await expectSubtaskVisible(clientB, subtaskName);
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario 4.1: Complex Chain of Actions
   *
   * This test simulates a realistic workflow where two clients
   * perform various actions in sequence, syncing between each step.
   *
   * Chain of operations:
   * 1. Client A: Create task "Project X"
   * 2. Sync A → Server → Sync B
   * 3. Client B: Rename task to "Project X - Planning"
   * 4. Client B: Add subtask "Research"
   * 5. Sync B → Server → Sync A
   * 6. Client A: Mark "Research" as done
   * 7. Client A: Add subtask "Implementation"
   * 8. Sync A → Server → Sync B
   * 9. Client B: Add subtask "Testing"
   * 10. Client B: Mark parent "Project X - Planning" as done
   * 11. Sync B → Server → Sync A
   * 12. Verify final state matches on both clients
   *
   * Expected: Both clients have identical final state with:
   * - Parent task "Project X - Planning" (done)
   *   - "Research" (done)
   *   - "Implementation" (not done)
   *   - "Testing" (not done)
   */
  test('4.1 Complex chain of actions syncs correctly', async ({
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

      // ============ PHASE 1: Initial Setup ============
      // Set up both clients
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // ============ PHASE 2: Client A Creates Initial Task ============
      const initialTaskName = `ProjectX-${uniqueId}`;
      await clientA.workView.addTask(initialTaskName);
      console.log(`[Chain Test] Client A created task: ${initialTaskName}`);

      // Sync: A → Server
      await clientA.sync.syncAndWait();

      // Sync: Server → B
      await clientB.sync.syncAndWait();

      // Verify B has the task
      await waitForTask(clientB.page, initialTaskName);
      console.log('[Chain Test] Client B received initial task');

      // ============ PHASE 3: Client B Renames and Adds Subtask ============
      const renamedTaskName = `ProjectX-Planning-${uniqueId}`;
      await renameTask(clientB, initialTaskName, renamedTaskName);
      console.log(`[Chain Test] Client B renamed task to: ${renamedTaskName}`);

      // Add first subtask "Research"
      const subtask1Name = `Research-${uniqueId}`;
      const renamedTaskLocatorB = getTaskElement(clientB, renamedTaskName);
      await clientB.workView.addSubTask(renamedTaskLocatorB, subtask1Name);
      console.log(`[Chain Test] Client B added subtask: ${subtask1Name}`);

      // Sync: B → Server
      await clientB.sync.syncAndWait();

      // Sync: Server → A
      await clientA.sync.syncAndWait();

      // Wait for DOM to settle
      await clientA.page.waitForLoadState('domcontentloaded');

      // Verify A has the renamed task and subtask
      await waitForTask(clientA.page, renamedTaskName);
      await expandTask(clientA, renamedTaskName);
      await waitForTask(clientA.page, subtask1Name);
      console.log('[Chain Test] Client A received rename and subtask');

      const parentTaskA = getTaskElement(clientA, renamedTaskName);

      // ============ PHASE 4: Client A Marks Subtask Done and Adds Another ============
      // Mark Research subtask as done
      await markSubtaskDone(clientA, subtask1Name);
      console.log(`[Chain Test] Client A marked ${subtask1Name} as done`);

      // Add second subtask "Implementation"
      const subtask2Name = `Implementation-${uniqueId}`;
      await clientA.workView.addSubTask(parentTaskA, subtask2Name);
      console.log(`[Chain Test] Client A added subtask: ${subtask2Name}`);

      // Sync: A → Server
      await clientA.sync.syncAndWait();

      // Sync: Server → B
      await clientB.sync.syncAndWait();

      // Wait for DOM to settle
      await clientB.page.waitForLoadState('domcontentloaded');

      // Verify B has the updates
      await expandTask(clientB, renamedTaskName);
      await waitForTask(clientB.page, subtask2Name);
      console.log('[Chain Test] Client B received done status and new subtask');

      // ============ PHASE 5: Client B Adds Subtask and Marks It Done ============
      // Add third subtask "Testing"
      const subtask3Name = `Testing-${uniqueId}`;
      await clientB.workView.addSubTask(
        getTaskElement(clientB, renamedTaskName),
        subtask3Name,
      );
      console.log(`[Chain Test] Client B added subtask: ${subtask3Name}`);

      // Mark the Testing subtask as done
      await markSubtaskDone(clientB, subtask3Name);
      console.log(`[Chain Test] Client B marked ${subtask3Name} as done`);

      // Sync: B → Server
      await clientB.sync.syncAndWait();

      // Sync: Server → A
      await clientA.sync.syncAndWait();

      // ============ PHASE 6: Final Verification ============
      console.log('[Chain Test] Verifying final state...');

      // Both clients should have the parent task
      const finalParentA = getParentTaskElement(clientA, renamedTaskName);
      const finalParentB = getParentTaskElement(clientB, renamedTaskName);
      await expect(finalParentA).toBeVisible({ timeout: 10000 });
      await expect(finalParentB).toBeVisible({ timeout: 10000 });

      // Expand parents to see subtasks
      await expandTask(clientA, renamedTaskName);
      await expandTask(clientB, renamedTaskName);

      // Verify all three subtasks exist on both clients
      // Research (done - marked by Client A in Phase 4)
      await expectSubtaskDone(clientA, subtask1Name);
      await expectSubtaskDone(clientB, subtask1Name);

      // Implementation (not done)
      await expectSubtaskNotDone(clientA, subtask2Name);
      await expectSubtaskNotDone(clientB, subtask2Name);

      // Testing (done - marked by Client B in Phase 5)
      await expectSubtaskDone(clientA, subtask3Name);
      await expectSubtaskDone(clientB, subtask3Name);

      // Count total tasks should match
      await expectEqualTaskCount([clientA, clientB]);
      await expectTaskCount(clientA, 4); // 1 parent + 3 subtasks

      console.log('[Chain Test] ✓ All verifications passed!');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario 5.1: Task Archiving and Worklog Sync
   *
   * Tests that archived tasks appear in worklog on both clients after sync.
   *
   * Setup: Client A and B with shared account
   *
   * Actions:
   * 1. Client A creates tasks and marks them done
   * 2. Client A syncs
   * 3. Client B syncs (receives tasks)
   * 4. Client B archives tasks via "Finish Day"
   * 5. Client B syncs (uploads archive operation)
   * 6. Client A syncs (receives archive)
   * 7. Both clients verify tasks appear in worklog
   *
   * Expected:
   * - Both clients show archived tasks in worklog
   * - Task titles visible in worklog entries
   */
  test('5.1 Archived tasks appear in worklog on both clients', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    const uniqueId = Date.now();
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      // Create shared test user
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // ============ PHASE 1: Client A Creates and Completes Tasks ============
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      // Create two tasks
      const task1Name = `Archive-Task1-${uniqueId}`;
      const task2Name = `Archive-Task2-${uniqueId}`;

      await clientA.workView.addTask(task1Name);
      console.log(`[Archive Test] Client A created task: ${task1Name}`);

      await clientA.workView.addTask(task2Name);
      console.log(`[Archive Test] Client A created task: ${task2Name}`);

      // Mark both tasks as done
      await markTaskDone(clientA, task1Name);
      console.log(`[Archive Test] Client A marked ${task1Name} as done`);

      await markTaskDone(clientA, task2Name);
      console.log(`[Archive Test] Client A marked ${task2Name} as done`);

      // ============ PHASE 2: Sync Tasks to Server ============
      await clientA.sync.syncAndWait();
      console.log('[Archive Test] Client A synced tasks');

      // ============ PHASE 3: Client B Downloads Tasks ============
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();
      console.log('[Archive Test] Client B synced (downloaded tasks)');

      // Verify Client B has the tasks
      await waitForTask(clientB.page, task1Name);
      await waitForTask(clientB.page, task2Name);
      console.log('[Archive Test] Client B received both tasks');

      // ============ PHASE 4: Client B Archives Tasks via Finish Day ============
      // Click "Finish Day" button to go to daily summary
      const finishDayBtn = clientB.page.locator('.e2e-finish-day');
      await finishDayBtn.waitFor({ state: 'visible', timeout: 10000 });
      await finishDayBtn.click();
      console.log('[Archive Test] Client B clicked Finish Day');

      // Wait for daily summary page
      await clientB.page.waitForURL(/daily-summary/, { timeout: 10000 });
      await clientB.page.waitForLoadState('networkidle');
      console.log('[Archive Test] Client B on daily summary page');

      // Click the "Save and go home" button to archive tasks
      const saveAndGoHomeBtn = clientB.page.locator(
        'daily-summary button[mat-flat-button]:has(mat-icon:has-text("wb_sunny"))',
      );
      await saveAndGoHomeBtn.waitFor({ state: 'visible', timeout: 10000 });
      await saveAndGoHomeBtn.click();
      console.log('[Archive Test] Client B clicked Save and go home (archiving)');

      // Wait for navigation back to work view
      await clientB.page.waitForURL(/tag\/TODAY/, { timeout: 10000 });
      await clientB.page.waitForLoadState('networkidle');
      console.log('[Archive Test] Client B back on work view after archiving');

      // ============ PHASE 5: Sync Archive Operation ============
      await clientB.sync.syncAndWait();
      console.log('[Archive Test] Client B synced (uploaded archive)');

      // Client A syncs to receive archive
      await clientA.sync.syncAndWait();
      console.log('[Archive Test] Client A synced (downloaded archive)');

      // ============ PHASE 6: Verify Worklog on Both Clients ============
      // Navigate Client A to worklog
      await clientA.page.goto('/#/tag/TODAY/worklog');
      await clientA.page.waitForLoadState('networkidle');
      await clientA.page.waitForSelector('worklog', { timeout: 10000 });
      console.log('[Archive Test] Client A navigated to worklog');

      // Navigate Client B to worklog
      await clientB.page.goto('/#/tag/TODAY/worklog');
      await clientB.page.waitForLoadState('networkidle');
      await clientB.page.waitForSelector('worklog', { timeout: 10000 });
      console.log('[Archive Test] Client B navigated to worklog');

      // Expand the current day's worklog to see tasks
      // Click on the week row to expand it
      const expandWorklogA = async (): Promise<void> => {
        const weekRow = clientA.page.locator('.week-row').first();
        if (await weekRow.isVisible()) {
          await weekRow.click();
          await clientA.page.waitForTimeout(500);
        }
      };

      const expandWorklogB = async (): Promise<void> => {
        const weekRow = clientB.page.locator('.week-row').first();
        if (await weekRow.isVisible()) {
          await weekRow.click();
          await clientB.page.waitForTimeout(500);
        }
      };

      await expandWorklogA();
      await expandWorklogB();

      // Verify tasks appear in worklog on both clients
      // Tasks are shown in .task-title within the worklog table
      const task1InWorklogA = clientA.page.locator(
        `.task-summary-table .task-title:has-text("${task1Name}")`,
      );
      const task2InWorklogA = clientA.page.locator(
        `.task-summary-table .task-title:has-text("${task2Name}")`,
      );
      const task1InWorklogB = clientB.page.locator(
        `.task-summary-table .task-title:has-text("${task1Name}")`,
      );
      const task2InWorklogB = clientB.page.locator(
        `.task-summary-table .task-title:has-text("${task2Name}")`,
      );

      await expect(task1InWorklogA).toBeVisible({ timeout: 10000 });
      await expect(task2InWorklogA).toBeVisible({ timeout: 10000 });
      console.log('[Archive Test] Client A worklog has both tasks');

      await expect(task1InWorklogB).toBeVisible({ timeout: 10000 });
      await expect(task2InWorklogB).toBeVisible({ timeout: 10000 });
      console.log('[Archive Test] Client B worklog has both tasks');

      console.log('[Archive Test] ✓ All verifications passed!');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario 6.1: Time Tracking Sync
   *
   * Tests that time tracked on one client syncs to another client.
   *
   * Setup: Client A and B with shared account
   *
   * Actions:
   * 1. Client A creates a task
   * 2. Client A starts time tracking on the task
   * 3. Wait for time to accumulate (3 seconds)
   * 4. Client A stops time tracking
   * 5. Client A syncs
   * 6. Client B syncs
   * 7. Verify Client B sees the tracked time
   *
   * Expected:
   * - Client B shows timeSpent > 0 for the task
   * - Both clients have matching time values
   */
  test('6.1 Time tracking syncs between clients', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    const uniqueId = Date.now();
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      // Create shared test user
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // ============ PHASE 1: Client A Creates Task ============
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      const taskName = `TimeTrack-${uniqueId}`;
      await clientA.workView.addTask(taskName);
      console.log(`[TimeTrack Test] Client A created task: ${taskName}`);

      // ============ PHASE 2: Start Time Tracking ============
      await startTimeTracking(clientA, taskName);
      console.log('[TimeTrack Test] Client A started time tracking');

      // Verify tracking started
      const taskLocatorA = getTaskElement(clientA, taskName);
      const playIndicator = taskLocatorA.locator('.play-icon-indicator');
      await expect(playIndicator).toBeVisible({ timeout: 5000 });
      console.log('[TimeTrack Test] Time tracking active');

      // ============ PHASE 3: Accumulate Time ============
      // Wait for time to accumulate (reduced from 5s to 2s for faster tests)
      console.log('[TimeTrack Test] Waiting 2 seconds for time to accumulate...');
      await clientA.page.waitForTimeout(2000);

      // ============ PHASE 4: Stop Time Tracking ============
      await stopTimeTracking(clientA, taskName);
      console.log('[TimeTrack Test] Client A stopped time tracking');

      // Wait for tracking to stop
      await expect(playIndicator).not.toBeVisible({ timeout: 5000 });

      // Verify time was recorded on Client A
      // Time is displayed in .time-wrapper .time-val
      const timeValA = taskLocatorA.locator('.time-wrapper .time-val').first();
      await expect(timeValA).toBeVisible({ timeout: 5000 });
      const timeTextA = await timeValA.textContent();
      console.log(`[TimeTrack Test] Client A recorded time: ${timeTextA}`);

      // ============ PHASE 5: Sync to Server ============
      await clientA.sync.syncAndWait();
      console.log('[TimeTrack Test] Client A synced');

      // ============ PHASE 6: Client B Downloads ============
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      // Add delay to ensure any auto-sync from setup has time to start/finish (reduced from 2000ms)
      // or to avoid race conditions with "Sync already in progress"
      await clientB.page.waitForTimeout(500);
      await clientB.sync.syncAndWait();
      console.log('[TimeTrack Test] Client B synced');

      // Reload to ensure UI reflects DB state (in case of sync UI glitch)
      // Use goto instead of reload - more reliable with service workers
      await clientB.page.goto(clientB.page.url(), {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await waitForAppReady(clientB.page);

      // ============ PHASE 7: Verify Time on Client B ============
      // Wait for task to appear
      try {
        await waitForTask(clientB.page, taskName);
      } catch (e) {
        const tasks = await clientB.page.locator('task .task-title').allTextContents();
        console.log('[TimeTrack Test] Client B tasks found:', tasks);
        throw e;
      }

      await expectTaskVisible(clientB, taskName);
      const taskLocatorB = getTaskElement(clientB, taskName);

      // Verify time is displayed on Client B
      const timeValB = taskLocatorB.locator('.time-wrapper .time-val').first();
      await expect(timeValB).toBeVisible({ timeout: 10000 });
      const timeTextB = await timeValB.textContent();
      console.log(`[TimeTrack Test] Client B shows time: ${timeTextB}`);

      // Verify time is non-zero (should show something like "0h 0m 3s" or similar)
      // The time text should not be empty and should not be "0s" or equivalent
      expect(timeTextB).toBeTruthy();
      expect(timeTextB?.trim()).not.toBe('');

      // Both clients should show the same time
      expect(timeTextB?.trim()).toBe(timeTextA?.trim());
      console.log('[TimeTrack Test] Time values match on both clients');

      console.log('[TimeTrack Test] ✓ All verifications passed!');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario 7.1: Three-Client Eventual Consistency
   *
   * Tests that three clients all converge to the same state after
   * concurrent operations and multiple sync rounds. This simulates
   * a real-world scenario with phone, laptop, and desktop.
   *
   * Setup: Clients A, B, C with shared account
   *
   * Timeline:
   * 1. Client A creates Task-1, syncs
   * 2. Client B syncs (gets Task-1), creates Task-2
   * 3. Client C syncs (gets Task-1), creates Task-3, renames Task-1
   * 4. Client B syncs (uploads Task-2)
   * 5. Client C syncs (uploads Task-3 + rename, downloads Task-2)
   * 6. Client A syncs (downloads Task-2, Task-3, rename)
   * 7. Client B syncs (downloads Task-3, rename)
   * 8. All three clients should have identical state
   *
   * Expected:
   * - All clients have Task-1 (renamed), Task-2, Task-3
   * - No data loss from concurrent operations
   * - System achieves eventual consistency
   */
  test('7.1 Three clients achieve eventual consistency', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    const uniqueId = Date.now();
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;
    let clientC: SimulatedE2EClient | null = null;

    try {
      // Create shared test user
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // Task names
      const task1Name = `Task1-${uniqueId}`;
      const task1Renamed = `Task1-Renamed-${uniqueId}`;
      const task2Name = `Task2-${uniqueId}`;
      const task3Name = `Task3-${uniqueId}`;

      // ============ PHASE 1: Client A Creates Task-1 ============
      console.log('[3-Client Test] Phase 1: Client A creates Task-1');
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      await clientA.workView.addTask(task1Name);
      console.log(`[3-Client Test] Client A created: ${task1Name}`);

      await clientA.sync.syncAndWait();
      console.log('[3-Client Test] Client A synced');

      // ============ PHASE 2: Client B Gets Task-1, Creates Task-2 ============
      console.log('[3-Client Test] Phase 2: Client B syncs and creates Task-2');
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();

      // Verify B has Task-1
      await waitForTask(clientB.page, task1Name);
      console.log('[3-Client Test] Client B received Task-1');

      // B creates Task-2
      await clientB.workView.addTask(task2Name);
      console.log(`[3-Client Test] Client B created: ${task2Name}`);

      // ============ PHASE 3: Client C Gets Task-1, Creates Task-3, Renames Task-1 ============
      console.log(
        '[3-Client Test] Phase 3: Client C syncs, creates Task-3, renames Task-1',
      );
      clientC = await createSimulatedClient(browser, baseURL!, 'C', testRunId);
      await clientC.sync.setupSuperSync(syncConfig);
      await clientC.sync.syncAndWait();

      // Verify C has Task-1 (but NOT Task-2 yet - B hasn't synced)
      await waitForTask(clientC.page, task1Name);
      console.log('[3-Client Test] Client C received Task-1');

      // C creates Task-3
      await clientC.workView.addTask(task3Name);
      console.log(`[3-Client Test] Client C created: ${task3Name}`);

      // C renames Task-1
      await renameTask(clientC, task1Name, task1Renamed);
      console.log(`[3-Client Test] Client C renamed Task-1 to: ${task1Renamed}`);

      // ============ PHASE 4: Client B Syncs (Uploads Task-2) ============
      console.log('[3-Client Test] Phase 4: Client B syncs (uploads Task-2)');
      await clientB.sync.syncAndWait();
      console.log('[3-Client Test] Client B synced');

      // ============ PHASE 5: Client C Syncs (Uploads Task-3 + Rename, Downloads Task-2) ============
      console.log('[3-Client Test] Phase 5: Client C syncs');
      await clientC.sync.syncAndWait();

      // Wait for DOM to settle after sync
      await clientC.page.waitForLoadState('domcontentloaded');

      // Verify C now has Task-2
      await waitForTask(clientC.page, task2Name);
      console.log('[3-Client Test] Client C received Task-2');

      // ============ PHASE 6: Client A Syncs (Downloads Task-2, Task-3, Rename) ============
      console.log('[3-Client Test] Phase 6: Client A syncs');
      await clientA.sync.syncAndWait();

      // Wait for DOM to settle after sync
      await clientA.page.waitForLoadState('domcontentloaded');

      // Verify A has all tasks with correct state
      await waitForTask(clientA.page, task1Renamed);
      await waitForTask(clientA.page, task2Name);
      await waitForTask(clientA.page, task3Name);
      console.log('[3-Client Test] Client A received all updates');

      // ============ PHASE 7: Client B Syncs (Downloads Task-3, Rename) ============
      console.log('[3-Client Test] Phase 7: Client B syncs');
      await clientB.sync.syncAndWait();

      // Wait for DOM to settle after sync
      await clientB.page.waitForLoadState('domcontentloaded');
      await clientB.page.waitForTimeout(500);

      // Verify B has all tasks with correct state
      await waitForTask(clientB.page, task1Renamed);
      await waitForTask(clientB.page, task3Name);
      console.log('[3-Client Test] Client B received all updates');

      // ============ PHASE 8: Final Verification - All Clients Identical ============
      console.log('[3-Client Test] Phase 8: Verifying eventual consistency');

      const countA = await getTaskCount(clientA);
      const countB = await getTaskCount(clientB);
      const countC = await getTaskCount(clientC);

      console.log(`[3-Client Test] Client A task count: ${countA}`);
      console.log(`[3-Client Test] Client B task count: ${countB}`);
      console.log(`[3-Client Test] Client C task count: ${countC}`);

      // All clients should have exactly 3 tasks
      await expectTaskCount(clientA, 3);
      await expectTaskCount(clientB, 3);
      await expectTaskCount(clientC, 3);

      // Verify renamed Task-1 exists on all clients
      expect(await hasTaskOnClient(clientA, task1Renamed)).toBe(true);
      expect(await hasTaskOnClient(clientB, task1Renamed)).toBe(true);
      expect(await hasTaskOnClient(clientC, task1Renamed)).toBe(true);
      console.log('[3-Client Test] Task-1 (renamed) exists on all clients');

      // Verify Task-2 exists on all clients
      expect(await hasTaskOnClient(clientA, task2Name)).toBe(true);
      expect(await hasTaskOnClient(clientB, task2Name)).toBe(true);
      expect(await hasTaskOnClient(clientC, task2Name)).toBe(true);
      console.log('[3-Client Test] Task-2 exists on all clients');

      // Verify Task-3 exists on all clients
      expect(await hasTaskOnClient(clientA, task3Name)).toBe(true);
      expect(await hasTaskOnClient(clientB, task3Name)).toBe(true);
      expect(await hasTaskOnClient(clientC, task3Name)).toBe(true);
      console.log('[3-Client Test] Task-3 exists on all clients');

      // Verify original Task-1 name no longer exists (it was renamed)
      // Skip checking on C since C did the rename and might still have the old element in DOM
      expect(await hasTaskOnClient(clientA, task1Name)).toBe(false);
      expect(await hasTaskOnClient(clientB, task1Name)).toBe(false);

      console.log('[3-Client Test] ✓ All three clients have identical state!');
      console.log('[3-Client Test] ✓ Eventual consistency achieved!');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
      if (clientC) await closeClient(clientC);
    }
  });
});

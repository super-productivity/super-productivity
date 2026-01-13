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
 * SuperSync Archive with Subtasks E2E Tests
 *
 * These tests verify that archiving parent tasks with subtasks works correctly
 * across sync. They also document a defensive fix for a race condition:
 *
 * Race condition scenario:
 * 1. Client A has parent task with subTaskIds: []
 * 2. Client A adds subtask -> parent.subTaskIds: ['sub-1'], subtask.parentId: 'parent-1'
 * 3. Client B does SYNC_IMPORT before parent.subTaskIds is synced
 * 4. Client A archives parent (operation has subTaskIds: ['sub-1'] from Client A's state)
 * 5. Client B syncs and receives archive operation
 *
 * The bug: If the archive operation somehow has stale subTaskIds (e.g., empty),
 * Client B would remove the parent but NOT the subtask, leaving an "orphan"
 * that causes "Lonely Sub Task in Today" error.
 *
 * The fix: deleteTaskHelper now also checks state for subtasks with matching
 * parentId, not just the subTaskIds from the operation payload.
 */

/**
 * Helper to add a subtask to a task using keyboard shortcut
 * This is more reliable than using the context menu
 */
const addSubtask = async (
  page: SimulatedE2EClient['page'],
  parentTaskName: string,
  subtaskTitle: string,
): Promise<void> => {
  // Find the parent task
  const parentTask = page.locator(`task:has-text("${parentTaskName}")`).first();
  await parentTask.waitFor({ state: 'visible', timeout: 10000 });

  // Focus the task and use keyboard shortcut 'a' to add subtask
  await parentTask.focus();
  await page.waitForTimeout(100); // Let focus settle
  await parentTask.press('a');

  // Wait for the textarea to appear and be focused
  const textarea = page.locator('task-title textarea');
  await textarea.waitFor({ state: 'visible', timeout: 5000 });
  await textarea.fill(subtaskTitle);
  await page.keyboard.press('Enter');

  // Wait for subtask to be visible and textarea to close
  await waitForTask(page, subtaskTitle);
  await page.waitForTimeout(200); // Let UI settle
};

/**
 * Helper to mark a task as done using keyboard shortcut (more reliable)
 * @param isSubtask - if true, uses .hasNoSubTasks selector to target only subtasks
 */
const markTaskDone = async (
  page: SimulatedE2EClient['page'],
  taskName: string,
  isSubtask = false,
): Promise<void> => {
  // Use .hasNoSubTasks for subtasks to avoid matching parent tasks
  const selector = isSubtask
    ? `task.hasNoSubTasks:not(.ng-animating):has-text("${taskName}")`
    : `task:not(.hasNoSubTasks):not(.ng-animating):has-text("${taskName}")`;
  const task = page.locator(selector).first();
  await task.waitFor({ state: 'visible', timeout: 10000 });

  // Focus the task and use keyboard shortcut 'd' to toggle done
  await task.focus();
  await page.waitForTimeout(100);
  await task.press('d');

  // Handle confirmation dialog if it appears (when marking parent with undone subtasks)
  await page.waitForTimeout(200);
  const confirmBtn = page.locator('dialog-confirm button[mat-stroked-button]');
  if (await confirmBtn.isVisible().catch(() => false)) {
    await confirmBtn.click();
  }

  // Wait for the done state to be applied
  await expect(task).toHaveClass(/isDone/, { timeout: 10000 });
};

/**
 * Helper to archive done tasks via Daily Summary
 */
const archiveDoneTasks = async (page: SimulatedE2EClient['page']): Promise<void> => {
  // Click finish day button
  const finishDayBtn = page.locator('.e2e-finish-day');
  await finishDayBtn.waitFor({ state: 'visible', timeout: 10000 });
  await finishDayBtn.click();

  // Wait for Daily Summary
  await page.waitForURL(/daily-summary/);

  // Click "Save and go home" to archive
  const saveAndGoHomeBtn = page.locator(
    'daily-summary button[mat-flat-button]:has(mat-icon:has-text("wb_sunny"))',
  );
  await saveAndGoHomeBtn.waitFor({ state: 'visible', timeout: 10000 });
  await saveAndGoHomeBtn.click();

  // Wait for Work View
  await page.waitForURL(/(active\/tasks|tag\/TODAY\/tasks)/);
};

/**
 * Check for console errors indicating orphan subtasks
 */
const checkForOrphanSubtaskError = (consoleMessages: string[]): boolean => {
  return consoleMessages.some(
    (msg) =>
      msg.includes('Lonely Sub Task') ||
      msg.includes('Inconsistent Task State') ||
      msg.includes('orphan subtask'),
  );
};

test.describe('@supersync Archive Subtasks Sync', () => {
  /**
   * Scenario: Archive parent with subtasks syncs correctly
   *
   * This verifies the normal archive flow works across sync.
   *
   * Actions:
   * 1. Client A creates parent task
   * 2. Client A adds subtask to parent
   * 3. Client A marks parent as done (subtasks are auto-done)
   * 4. Client A archives tasks
   * 5. Client A syncs
   * 6. Client B syncs
   * 7. Verify Client B has no tasks in Today view (all archived)
   * 8. Verify no orphan subtask errors in console
   */
  test('Archive parent task with subtasks syncs without leaving orphans', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;
    const consoleErrors: string[] = [];

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // Setup Client A
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      // Setup Client B with console monitoring
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      clientB.page.on('console', (msg) => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text());
        }
      });
      await clientB.sync.setupSuperSync(syncConfig);

      // 1. Client A creates parent task
      const parentName = `Parent-${testRunId}`;
      await clientA.workView.addTask(parentName);
      await waitForTask(clientA.page, parentName);
      console.log('[ArchiveSubtasks] Created parent task');

      // 2. Client A adds subtasks
      const subtask1Name = `Sub1-${testRunId}`;
      const subtask2Name = `Sub2-${testRunId}`;
      await addSubtask(clientA.page, parentName, subtask1Name);
      console.log('[ArchiveSubtasks] Added subtask 1');
      await addSubtask(clientA.page, parentName, subtask2Name);
      console.log('[ArchiveSubtasks] Added subtask 2');

      // 3. Mark subtasks as done first (parent requires all subtasks done)
      await markTaskDone(clientA.page, subtask1Name, true);
      console.log('[ArchiveSubtasks] Marked subtask 1 as done');
      await markTaskDone(clientA.page, subtask2Name, true);
      console.log('[ArchiveSubtasks] Marked subtask 2 as done');

      // 4. Now mark parent as done
      await markTaskDone(clientA.page, parentName, false);
      console.log('[ArchiveSubtasks] Marked parent as done');

      // 4. Archive via Daily Summary
      await archiveDoneTasks(clientA.page);
      console.log('[ArchiveSubtasks] Archived tasks');

      // 5. Client A syncs
      await clientA.sync.syncAndWait();
      console.log('[ArchiveSubtasks] Client A synced');

      // 6. Client B syncs
      await clientB.sync.syncAndWait();
      console.log('[ArchiveSubtasks] Client B synced');

      // Wait for UI to settle
      await clientB.page.waitForTimeout(1000);

      // 7. Verify Client B has no tasks with testRunId in Today view
      // (they should all be archived)
      const tasksOnB = clientB.page.locator(`task:has-text("${testRunId}")`);
      const taskCount = await tasksOnB.count();

      expect(taskCount).toBe(0);
      console.log('[ArchiveSubtasks] Verified no tasks on Client B (all archived)');

      // 8. Verify no orphan subtask errors
      const hasOrphanError = checkForOrphanSubtaskError(consoleErrors);
      expect(hasOrphanError).toBe(false);

      console.log('[ArchiveSubtasks] ✓ Archive with subtasks synced successfully');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario: Multiple subtask levels archive correctly
   *
   * Tests archiving a parent task that has subtasks with deeply nested work.
   *
   * Actions:
   * 1. Client A creates parent task
   * 2. Client A adds multiple subtasks
   * 3. Client A syncs
   * 4. Client B syncs and verifies tasks
   * 5. Client A marks all done and archives
   * 6. Both clients sync
   * 7. Verify both clients have no orphan tasks
   */
  test('Multiple subtasks archive and sync without orphans', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;
    const consoleErrorsA: string[] = [];
    const consoleErrorsB: string[] = [];

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // Setup clients with console monitoring
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      clientA.page.on('console', (msg) => {
        if (msg.type() === 'error') {
          consoleErrorsA.push(msg.text());
        }
      });
      await clientA.sync.setupSuperSync(syncConfig);

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      clientB.page.on('console', (msg) => {
        if (msg.type() === 'error') {
          consoleErrorsB.push(msg.text());
        }
      });
      await clientB.sync.setupSuperSync(syncConfig);

      // 1. Create parent task
      const parentName = `MultiSub-${testRunId}`;
      await clientA.workView.addTask(parentName);
      await waitForTask(clientA.page, parentName);

      // 2. Add multiple subtasks
      for (let i = 1; i <= 3; i++) {
        await addSubtask(clientA.page, parentName, `Sub${i}-${testRunId}`);
      }
      console.log('[MultiSubtask] Created parent with 3 subtasks');

      // 3. Sync A
      await clientA.sync.syncAndWait();

      // 4. Sync B and verify
      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, parentName);
      console.log('[MultiSubtask] Client B received tasks');

      // 5. Client A marks all subtasks and parent done
      for (let i = 1; i <= 3; i++) {
        await markTaskDone(clientA.page, `Sub${i}-${testRunId}`, true);
      }
      await markTaskDone(clientA.page, parentName, false);
      await archiveDoneTasks(clientA.page);
      console.log('[MultiSubtask] Client A archived all');

      // 6. Both clients sync
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await clientB.page.waitForTimeout(1000);

      // 7. Verify no orphan tasks
      const tasksOnA = await clientA.page
        .locator(`task:has-text("${testRunId}")`)
        .count();
      const tasksOnB = await clientB.page
        .locator(`task:has-text("${testRunId}")`)
        .count();

      expect(tasksOnA).toBe(0);
      expect(tasksOnB).toBe(0);

      expect(checkForOrphanSubtaskError(consoleErrorsA)).toBe(false);
      expect(checkForOrphanSubtaskError(consoleErrorsB)).toBe(false);

      console.log('[MultiSubtask] ✓ Multiple subtasks archived without orphans');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario: Add subtask then immediately archive syncs correctly
   *
   * This tests a potential race condition: adding a subtask and immediately
   * archiving before the subtask addition has fully synced.
   *
   * Actions:
   * 1. Client A and B start synced
   * 2. Client A adds subtask to existing parent
   * 3. Client A immediately marks done and archives (no sync between)
   * 4. Client A syncs
   * 5. Client B syncs
   * 6. Verify no orphan subtasks
   */
  test('Add subtask then immediately archive syncs correctly', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;
    const consoleErrorsB: string[] = [];

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // Setup clients
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      clientB.page.on('console', (msg) => {
        if (msg.type() === 'error') {
          consoleErrorsB.push(msg.text());
        }
      });
      await clientB.sync.setupSuperSync(syncConfig);

      // Create parent and sync both clients
      const parentName = `RaceTest-${testRunId}`;
      await clientA.workView.addTask(parentName);
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      console.log('[RaceTest] Both clients synced with parent task');

      // 2. Client A adds subtask
      const subtaskName = `NewSub-${testRunId}`;
      await addSubtask(clientA.page, parentName, subtaskName);
      console.log('[RaceTest] Added subtask (no sync yet)');

      // 3. Immediately mark subtask and parent done, then archive (NO SYNC BETWEEN)
      await markTaskDone(clientA.page, subtaskName, true);
      await markTaskDone(clientA.page, parentName, false);
      await archiveDoneTasks(clientA.page);
      console.log('[RaceTest] Archived (without intermediate sync)');

      // 4. Client A syncs (sends both add subtask + archive)
      await clientA.sync.syncAndWait();
      console.log('[RaceTest] Client A synced');

      // 5. Client B syncs
      await clientB.sync.syncAndWait();
      await clientB.page.waitForTimeout(1000);
      console.log('[RaceTest] Client B synced');

      // 6. Verify no orphan subtasks
      const tasksOnB = await clientB.page
        .locator(`task:has-text("${testRunId}")`)
        .count();
      expect(tasksOnB).toBe(0);

      expect(checkForOrphanSubtaskError(consoleErrorsB)).toBe(false);

      console.log('[RaceTest] ✓ Add subtask + immediate archive synced correctly');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});

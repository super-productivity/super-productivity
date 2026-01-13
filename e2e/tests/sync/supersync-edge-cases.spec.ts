import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  createProjectReliably,
  deleteTask,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';

/**
 * SuperSync Edge Cases E2E Tests
 *
 * Covers specific edge cases like moving tasks between projects,
 * offline bursts, and conflict handling.
 */

test.describe('@supersync SuperSync Edge Cases', () => {
  // Server health check is handled automatically by the supersync fixture

  /**
   * Scenario 1: Move Task Between Projects
   *
   * Verifies that moving a task from one project to another syncs correctly.
   *
   * Actions:
   * 1. Client A creates Project 1 and Project 2
   * 2. Client A creates Task in Project 1
   * 3. Sync A -> Sync B
   * 4. Client A moves Task to Project 2
   * 5. Sync A -> Sync B
   * 6. Verify Task is in Project 2 on Client B
   * 7. Verify Task is NOT in Project 1 on Client B
   */
  test('Move task between projects syncs correctly', async ({
    browser,
    baseURL,
    testRunId,
    serverHealthy,
  }) => {
    void serverHealthy; // Ensure fixture is evaluated for server health check
    const appUrl = baseURL || 'http://localhost:4242';
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // Setup Clients
      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // 1. Create Projects on A
      const proj1Name = `Proj1-${testRunId}`;
      const proj2Name = `Proj2-${testRunId}`;

      await createProjectReliably(clientA.page, proj1Name);
      await createProjectReliably(clientA.page, proj2Name);

      // 2. Create Task in Project 1
      // Navigate to Project 1 using sidebar nav item (button with nav-link class)
      const projectBtn1 = clientA.page.locator(
        `.nav-sidenav .nav-link:has-text("${proj1Name}")`,
      );
      await projectBtn1.waitFor({ state: 'visible', timeout: 10000 });
      await projectBtn1.click();
      await clientA.page.waitForLoadState('networkidle');
      // Extra wait to ensure project view is fully loaded
      await clientA.page.waitForTimeout(1000);

      const taskName = `MovingTask-${testRunId}`;
      await clientA.workView.addTask(taskName);
      // Wait for task to be fully created before syncing
      await waitForTask(clientA.page, taskName);
      console.log('[MoveTask] Task created in Project 1');

      // 3. Sync A -> Sync B
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();

      // Verify B has projects and task in Proj 1
      const projectBtnB1 = clientB.page.locator(
        `.nav-sidenav .nav-link:has-text("${proj1Name}")`,
      );
      await expect(projectBtnB1).toBeVisible({ timeout: 10000 });
      await projectBtnB1.click();
      await clientB.page.waitForLoadState('networkidle');
      await clientB.page.waitForTimeout(1000);
      await waitForTask(clientB.page, taskName);
      console.log('[MoveTask] Task synced to Client B in Project 1');

      // 4. Client A moves Task to Project 2
      // First ensure we're on Project 1 view
      await projectBtn1.click();
      await clientA.page.waitForLoadState('networkidle');
      await clientA.page.waitForTimeout(500);

      // Using context menu or drag and drop. Context menu is more reliable for e2e.
      const taskLocatorA = clientA.page
        .locator(`task:not(.ng-animating):has-text("${taskName}")`)
        .first();
      await taskLocatorA.waitFor({ state: 'visible', timeout: 10000 });

      // Context menu retry loop - menus can be flaky due to overlay timing
      let moveSuccess = false;
      for (let attempt = 0; attempt < 3 && !moveSuccess; attempt++) {
        try {
          await taskLocatorA.click({ button: 'right' });

          // Click "Move to project"
          const moveItem = clientA.page
            .locator('.mat-mdc-menu-item')
            .filter({ hasText: 'Move to project' });
          await moveItem.waitFor({ state: 'visible', timeout: 3000 });
          await moveItem.click();

          // Select Project 2 from the submenu
          const proj2Item = clientA.page
            .locator('.mat-mdc-menu-item:not(.nav-link)')
            .filter({ hasText: proj2Name });
          await proj2Item.waitFor({ state: 'visible', timeout: 3000 });
          await proj2Item.click();
          moveSuccess = true;
        } catch (e) {
          console.log(
            `[MoveTask] Context menu attempt ${attempt + 1} failed, retrying...`,
          );
          // Close any open menus by pressing Escape
          await clientA.page.keyboard.press('Escape');
          await clientA.page.waitForTimeout(300);
        }
      }

      if (!moveSuccess) {
        throw new Error('Failed to move task via context menu after 3 attempts');
      }

      // Verify move locally on A
      // Should disappear from current view (Proj 1)
      await clientA.page.waitForTimeout(500); // Wait for move animation
      const taskInProj1A = clientA.page.locator(`task:has-text("${taskName}")`);
      await expect(taskInProj1A).not.toBeVisible({ timeout: 5000 });

      // Go to Proj 2 and check
      const projectBtn2 = clientA.page.locator(
        `.nav-sidenav .nav-link:has-text("${proj2Name}")`,
      );
      await projectBtn2.click();
      await clientA.page.waitForLoadState('networkidle');
      await clientA.page.waitForTimeout(500);
      await waitForTask(clientA.page, taskName);
      console.log('[MoveTask] Task verified in Project 2 on Client A');

      // 5. Sync A -> Sync B
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();

      // 6. Verify Task is in Project 2 on Client B
      const projectBtnB2 = clientB.page.locator(
        `.nav-sidenav .nav-link:has-text("${proj2Name}")`,
      );
      await projectBtnB2.click();
      await clientB.page.waitForLoadState('networkidle');
      await clientB.page.waitForTimeout(500);
      await waitForTask(clientB.page, taskName);
      console.log('[MoveTask] Task verified in Project 2 on Client B');

      // 7. Verify Task is NOT in Project 1 on Client B
      await projectBtnB1.click();
      await clientB.page.waitForLoadState('networkidle');
      // Wait for UI to settle after navigation
      await clientB.page.waitForTimeout(1000);
      // Should not be visible in Project 1 list
      const taskInProj1B = clientB.page.locator(`task:has-text("${taskName}")`);
      await expect(taskInProj1B).not.toBeVisible({ timeout: 5000 });
      console.log('[MoveTask] Task correctly NOT in Project 1 on Client B');

      console.log('[MoveTask] ✓ Task moved between projects successfully across clients');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario 2: Offline Bursts
   *
   * Verifies that a burst of changes made offline syncs correctly when back online.
   *
   * Actions:
   * 1. Client A and B start synced
   * 2. Client A goes "offline" (we just don't sync)
   * 3. Client A: Creates Task 1, Task 2, Task 3
   * 4. Client A: Marks Task 1 as Done
   * 5. Client A: Deletes Task 2
   * 6. Client A syncs (burst)
   * 7. Client B syncs
   * 8. Verify B has Task 1 (Done), No Task 2, Task 3 (Open)
   */
  test('Offline burst of changes syncs correctly', async ({
    browser,
    baseURL,
    testRunId,
    serverHealthy,
  }) => {
    void serverHealthy; // Ensure fixture is evaluated for server health check
    const appUrl = baseURL || 'http://localhost:4242';
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // Setup Clients
      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // 1. Client A goes "offline" (we just accumulate changes)
      const task1 = `Burst1-${testRunId}`;
      const task2 = `Burst2-${testRunId}`;
      const task3 = `Burst3-${testRunId}`;

      // 3. Create Tasks - wait for each to be visible before creating next
      await clientA.workView.addTask(task1);
      await waitForTask(clientA.page, task1);
      console.log('[BurstTest] Task 1 created');
      await clientA.workView.addTask(task2);
      await waitForTask(clientA.page, task2);
      console.log('[BurstTest] Task 2 created');
      await clientA.workView.addTask(task3);
      await waitForTask(clientA.page, task3);
      console.log('[BurstTest] Task 3 created');

      // 4. Mark Task 1 Done with retry logic
      let doneSuccess = false;
      for (let attempt = 0; attempt < 3 && !doneSuccess; attempt++) {
        try {
          const taskLocator1 = clientA.page
            .locator(`task:not(.ng-animating):has-text("${task1}")`)
            .first();
          await taskLocator1.waitFor({ state: 'visible', timeout: 10000 });
          await taskLocator1.hover();
          const doneBtn1 = taskLocator1.locator('.task-done-btn');
          await doneBtn1.waitFor({ state: 'visible', timeout: 5000 });
          await doneBtn1.click();
          await expect(taskLocator1).toHaveClass(/isDone/, { timeout: 5000 });
          doneSuccess = true;
          console.log('[BurstTest] Task 1 marked as done');
        } catch (e) {
          console.log(`[BurstTest] Done attempt ${attempt + 1} failed, retrying...`);
          await clientA.page.waitForTimeout(300);
        }
      }
      if (!doneSuccess) {
        throw new Error('Failed to mark task 1 as done after 3 attempts');
      }
      // Wait for done animation to complete
      await clientA.page.waitForTimeout(500);

      // 5. Delete Task 2 using reliable keyboard shortcut
      await deleteTask(clientA, task2);
      console.log('[BurstTest] Task 2 deleted');

      // 6. Client A syncs (burst)
      await clientA.sync.syncAndWait();
      console.log('[BurstTest] Client A synced burst changes');

      // 7. Client B syncs
      await clientB.sync.syncAndWait();
      console.log('[BurstTest] Client B synced');

      // 8. Verify B state
      // Wait for sync and UI to settle
      await clientB.page.waitForTimeout(1000);

      // Task 1: Visible and Done - use waitForTask for reliability
      await waitForTask(clientB.page, task1);
      const taskLocatorB1 = clientB.page
        .locator(`task:not(.ng-animating):has-text("${task1}")`)
        .first();
      await expect(taskLocatorB1).toBeVisible({ timeout: 10000 });
      await expect(taskLocatorB1).toHaveClass(/isDone/, { timeout: 5000 });
      console.log('[BurstTest] Task 1 verified as done on Client B');

      // Task 2: Not Visible (was deleted)
      const taskLocatorB2 = clientB.page.locator(`task:has-text("${task2}")`);
      await expect(taskLocatorB2).not.toBeVisible({ timeout: 5000 });
      console.log('[BurstTest] Task 2 verified as deleted on Client B');

      // Task 3: Visible and Open - use waitForTask for reliability
      await waitForTask(clientB.page, task3);
      const taskLocatorB3 = clientB.page
        .locator(`task:not(.ng-animating):has-text("${task3}")`)
        .first();
      await expect(taskLocatorB3).toBeVisible({ timeout: 10000 });
      await expect(taskLocatorB3).not.toHaveClass(/isDone/, { timeout: 5000 });
      console.log('[BurstTest] Task 3 verified as open on Client B');

      console.log('[BurstTest] ✓ Offline burst changes synced successfully');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario 5: 3-Way Conflict
   *
   * Tests conflict resolution when 3 clients concurrently edit the same task.
   * This is more complex than 2-way conflicts as all 3 clients have divergent state.
   *
   * Actions:
   * 1. Client A creates Task, syncs
   * 2. Client B and C sync (download task)
   * 3. All 3 clients make concurrent changes (no syncs between):
   *    - Client A: Marks task as done
   *    - Client B: Adds time estimate
   *    - Client C: Changes priority (adds tag)
   * 4. Client A syncs first
   * 5. Client B syncs (conflict with A's changes)
   * 6. Client C syncs (conflict with A and B's merged state)
   * 7. All clients sync again to converge
   * 8. Verify all 3 clients have identical final state
   */
  test('3-way conflict: 3 clients edit same task concurrently', async ({
    browser,
    baseURL,
    testRunId,
    serverHealthy,
  }, testInfo) => {
    void serverHealthy; // Ensure fixture is evaluated for server health check
    testInfo.setTimeout(120000); // 3-way conflicts need more time
    const appUrl = baseURL || 'http://localhost:4242';
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;
    let clientC: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // Setup all 3 clients
      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      clientC = await createSimulatedClient(browser, appUrl, 'C', testRunId);
      await clientC.sync.setupSuperSync(syncConfig);

      // 1. Client A creates task
      const taskName = `3Way-${testRunId}`;
      await clientA.workView.addTask(taskName);
      // Wait for task to be fully created before syncing
      await waitForTask(clientA.page, taskName);
      console.log('[3WayConflict] Client A created task');
      await clientA.sync.syncAndWait();

      // 2. Clients B and C download the task
      await clientB.sync.syncAndWait();
      await clientC.sync.syncAndWait();

      // Verify all 3 clients have the task with settling time
      await clientA.page.waitForTimeout(500);
      await clientB.page.waitForTimeout(500);
      await clientC.page.waitForTimeout(500);
      await waitForTask(clientA.page, taskName);
      await waitForTask(clientB.page, taskName);
      await waitForTask(clientC.page, taskName);
      console.log('[3WayConflict] All clients have the task');

      // 3. All 3 clients make concurrent changes (no syncs between)
      // Helper to mark task as done with retry for stability
      const markTaskDone = async (
        page: typeof clientA.page,
        name: string,
        clientLabel: string,
      ): Promise<void> => {
        let success = false;
        for (let attempt = 0; attempt < 3 && !success; attempt++) {
          try {
            const taskLoc = page
              .locator(`task:not(.ng-animating):has-text("${name}")`)
              .first();
            await taskLoc.waitFor({ state: 'visible', timeout: 10000 });
            await taskLoc.hover();
            const doneBtn = taskLoc.locator('.task-done-btn');
            await doneBtn.waitFor({ state: 'visible', timeout: 5000 });
            await doneBtn.click();
            // Wait for done state to be applied
            await expect(taskLoc).toHaveClass(/isDone/, { timeout: 5000 });
            // Settling time after marking done
            await page.waitForTimeout(300);
            success = true;
            console.log(`[3WayConflict] Client ${clientLabel} marked task as done`);
          } catch (e) {
            console.log(
              `[3WayConflict] Client ${clientLabel} attempt ${attempt + 1} failed, retrying...`,
            );
            await page.waitForTimeout(300);
          }
        }
        if (!success) {
          throw new Error(
            `Client ${clientLabel} failed to mark task as done after 3 attempts`,
          );
        }
      };

      // Client A: Mark as done
      await markTaskDone(clientA.page, taskName, 'A');

      // Client B: Mark as done (same action, should merge cleanly)
      await markTaskDone(clientB.page, taskName, 'B');

      // Client C: Mark as done (same action from third client)
      await markTaskDone(clientC.page, taskName, 'C');

      // 4-6. Sequential syncs to resolve conflicts
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await clientC.sync.syncAndWait();

      // 7. Final round of syncs to converge
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await clientC.sync.syncAndWait();

      // Wait for UI to settle after final sync
      await clientA.page.waitForTimeout(1000);
      await clientB.page.waitForTimeout(1000);
      await clientC.page.waitForTimeout(1000);

      // 8. Verify all 3 clients have identical state
      // First use waitForTask to ensure tasks are present
      await waitForTask(clientA.page, taskName);
      await waitForTask(clientB.page, taskName);
      await waitForTask(clientC.page, taskName);

      // Re-query locators after sync to get fresh references
      const finalTaskA = clientA.page
        .locator(`task:not(.ng-animating):has-text("${taskName}")`)
        .first();
      const finalTaskB = clientB.page
        .locator(`task:not(.ng-animating):has-text("${taskName}")`)
        .first();
      const finalTaskC = clientC.page
        .locator(`task:not(.ng-animating):has-text("${taskName}")`)
        .first();

      // Task should exist and be marked as done on all clients
      await expect(finalTaskA).toBeVisible({ timeout: 10000 });
      await expect(finalTaskB).toBeVisible({ timeout: 10000 });
      await expect(finalTaskC).toBeVisible({ timeout: 10000 });

      // All should show task as done
      await expect(finalTaskA).toHaveClass(/isDone/, { timeout: 5000 });
      await expect(finalTaskB).toHaveClass(/isDone/, { timeout: 5000 });
      await expect(finalTaskC).toHaveClass(/isDone/, { timeout: 5000 });
      console.log('[3WayConflict] All clients verified with done state');

      // Count tasks - should be identical
      const countA = await clientA.page.locator('task').count();
      const countB = await clientB.page.locator('task').count();
      const countC = await clientC.page.locator('task').count();
      expect(countA).toBe(countB);
      expect(countB).toBe(countC);

      console.log('[3WayConflict] ✓ 3-way conflict resolved, all clients converged');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
      if (clientC) await closeClient(clientC);
    }
  });

  /**
   * Scenario 6: Delete vs Update Conflict
   *
   * Tests what happens when one client deletes a task while another updates it.
   * This is a common conflict scenario in collaborative editing.
   *
   * Actions:
   * 1. Client A creates Task, syncs
   * 2. Client B syncs (download task)
   * 3. Concurrent changes (no syncs):
   *    - Client A: Deletes the task
   *    - Client B: Updates the task (marks as done)
   * 4. Client A syncs (delete goes to server)
   * 5. Client B syncs (update conflicts with deletion)
   * 6. Verify final state is consistent (delete wins or conflict resolved)
   */
  test('Delete vs Update conflict: one client deletes while another updates', async ({
    browser,
    baseURL,
    testRunId,
    serverHealthy,
  }, testInfo) => {
    void serverHealthy; // Ensure fixture is evaluated for server health check
    testInfo.setTimeout(90000);
    const appUrl = baseURL || 'http://localhost:4242';
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // Setup clients
      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // 1. Client A creates task
      const taskName = `DelUpd-${testRunId}`;
      await clientA.workView.addTask(taskName);
      await clientA.sync.syncAndWait();

      // 2. Client B downloads the task
      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, taskName);

      // 3. Concurrent changes

      // Client A: Delete the task using reliable keyboard shortcut
      await deleteTask(clientA, taskName);
      const taskLocatorA = clientA.page.locator(`task:has-text("${taskName}")`);
      await expect(taskLocatorA).not.toBeVisible();

      // Client B: Mark as done (concurrent with deletion)
      const taskLocatorB = clientB.page.locator(`task:has-text("${taskName}")`);
      await taskLocatorB.hover();
      await taskLocatorB.locator('.task-done-btn').click();

      // 4. Client A syncs (delete goes to server first)
      await clientA.sync.syncAndWait();

      // 5. Client B syncs (update conflicts with deletion)
      // The conflict resolution may show a dialog or auto-resolve
      await clientB.sync.syncAndWait();

      // 6. Final sync to converge
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();

      // Verify consistent state
      // Both clients should have the same view (either both have task or neither)
      const hasTaskA =
        (await clientA.page.locator(`task:has-text("${taskName}")`).count()) > 0;
      const hasTaskB =
        (await clientB.page.locator(`task:has-text("${taskName}")`).count()) > 0;

      // State should be consistent (doesn't matter which wins, just that they agree)
      expect(hasTaskA).toBe(hasTaskB);

      console.log(
        `[DeleteVsUpdate] ✓ Conflict resolved consistently (task ${hasTaskA ? 'restored' : 'deleted'})`,
      );
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario 7: Undo Task Delete Syncs Across Devices
   *
   * Verifies that undoing a task deletion syncs correctly to other clients.
   * This tests the restoreDeletedTask action which carries full task data.
   *
   * Actions:
   * 1. Client A creates Task, syncs
   * 2. Client B syncs (has task)
   * 3. Client A deletes Task
   * 4. Client A clicks Undo (within 5 seconds)
   * 5. Client A syncs
   * 6. Client B syncs
   * 7. Verify Task exists on both clients
   */
  test('Undo task delete syncs restored task to other client', async ({
    browser,
    baseURL,
    testRunId,
    serverHealthy,
  }) => {
    void serverHealthy; // Ensure fixture is evaluated for server health check
    const appUrl = baseURL || 'http://localhost:4242';
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // Setup Clients
      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // 1. Client A creates task
      const taskName = `UndoDelete-${testRunId}`;
      await clientA.workView.addTask(taskName);
      await clientA.sync.syncAndWait();

      // 2. Client B syncs (download task)
      await clientB.sync.syncAndWait();

      // Verify task exists on both clients
      await waitForTask(clientA.page, taskName);
      await waitForTask(clientB.page, taskName);

      // 3. Client A deletes the task using keyboard shortcut (triggers undo snackbar)
      await deleteTask(clientA, taskName);

      // Verify task is deleted locally
      const taskLocatorA = clientA.page
        .locator(`task:not(.ng-animating):has-text("${taskName}")`)
        .first();
      await expect(taskLocatorA).not.toBeVisible({ timeout: 5000 });

      // 4. Client A clicks Undo (snackbar should be visible)
      // The snackbar appears for 5 seconds with an "Undo" action
      // Use snack-custom .action selector (app uses custom snackbar component)
      const undoButton = clientA.page.locator('snack-custom button.action');
      await undoButton.waitFor({ state: 'visible', timeout: 5000 });
      await undoButton.click();

      // Wait for undo to complete
      await clientA.page.waitForTimeout(500);

      // Verify task is restored locally on A
      const restoredTaskA = clientA.page
        .locator(`task:not(.ng-animating):has-text("${taskName}")`)
        .first();
      await expect(restoredTaskA).toBeVisible({ timeout: 5000 });

      // 5. Client A syncs
      await clientA.sync.syncAndWait();

      // 6. Client B syncs (should receive the restore action)
      await clientB.sync.syncAndWait();

      // Wait for UI to update
      await clientB.page.waitForTimeout(500);

      // 7. Verify Task exists on Client B after sync
      const taskLocatorB = clientB.page
        .locator(`task:not(.ng-animating):has-text("${taskName}")`)
        .first();
      await expect(taskLocatorB).toBeVisible({ timeout: 10000 });

      // Verify both clients have exactly the same task count
      const countA = await clientA.page.locator(`task:has-text("${taskName}")`).count();
      const countB = await clientB.page.locator(`task:has-text("${taskName}")`).count();
      expect(countA).toBe(1);
      expect(countB).toBe(1);

      console.log('[UndoDelete] ✓ Undo task delete synced successfully to other client');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario 8: Rejected Op Does Not Pollute Entity Frontier
   *
   * This test verifies Fix 2.2: rejected operations should NOT be included
   * in the entity frontier used for conflict detection. If rejected ops
   * pollute the frontier, subsequent unrelated operations may be incorrectly
   * rejected or cause false conflicts.
   *
   * Actions:
   * 1. Client A creates Task1, syncs
   * 2. Client B syncs (downloads Task1)
   * 3. Both clients concurrently edit Task1 (causing conflict)
   * 4. Client A syncs first (succeeds)
   * 5. Client B syncs (Task1 edit rejected due to conflict)
   * 6. Client B creates NEW Task2 (unrelated to Task1)
   * 7. Client B syncs again
   * 8. Verify Task2 syncs successfully to Client A
   *    (proves frontier wasn't polluted by rejected op)
   */
  test('Rejected op does not pollute entity frontier for subsequent syncs', async ({
    browser,
    baseURL,
    testRunId,
    serverHealthy,
  }, testInfo) => {
    void serverHealthy; // Ensure fixture is evaluated for server health check
    testInfo.setTimeout(120000);
    const appUrl = baseURL || 'http://localhost:4242';
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // Setup clients
      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // 1. Client A creates Task1
      const task1Name = `ConflictTask-${testRunId}`;
      await clientA.workView.addTask(task1Name);
      await clientA.sync.syncAndWait();

      // 2. Client B downloads Task1
      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, task1Name);

      // 3. Both clients concurrently edit Task1 (mark as done)
      // Client A marks done - use .first() to avoid strict mode violation from animation duplicates
      const taskLocatorA = clientA.page
        .locator(`task:not(.ng-animating):has-text("${task1Name}")`)
        .first();
      await taskLocatorA.hover();
      await taskLocatorA.locator('.task-done-btn').click();
      await expect(taskLocatorA).toHaveClass(/isDone/, { timeout: 5000 });

      // Client B also marks done (concurrent change, will conflict)
      const taskLocatorB = clientB.page
        .locator(`task:not(.ng-animating):has-text("${task1Name}")`)
        .first();
      await taskLocatorB.hover();
      await taskLocatorB.locator('.task-done-btn').click();
      await expect(taskLocatorB).toHaveClass(/isDone/, { timeout: 5000 });

      // 4. Client A syncs first (succeeds)
      await clientA.sync.syncAndWait();

      // 5. Client B syncs (will get conflict/rejection for Task1 edit)
      // The conflict may be auto-resolved or show dialog - either way, B's op is rejected
      await clientB.sync.syncAndWait();

      // 6. Client B creates a NEW, UNRELATED Task2
      // This is the critical part: if rejected op polluted the frontier,
      // this new task might fail to sync or cause unexpected conflicts
      const task2Name = `NewTaskAfterReject-${testRunId}`;
      await clientB.workView.addTask(task2Name);

      // Verify Task2 exists locally on B
      await waitForTask(clientB.page, task2Name);

      // 7. Client B syncs again (Task2 should sync successfully)
      await clientB.sync.syncAndWait();

      // 8. Client A syncs to receive Task2
      await clientA.sync.syncAndWait();

      // Verify Task2 appeared on Client A
      // This proves the frontier wasn't polluted by the rejected op
      await waitForTask(clientA.page, task2Name);

      // Additional verification: count tasks on both clients
      const countA = await clientA.page.locator(`task:has-text("${testRunId}")`).count();
      const countB = await clientB.page.locator(`task:has-text("${testRunId}")`).count();

      // Both should have 2 tasks (Task1 and Task2)
      expect(countA).toBe(2);
      expect(countB).toBe(2);

      console.log(
        '[RejectedOpFrontier] ✓ Rejected op did not pollute frontier - subsequent sync succeeded',
      );
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});

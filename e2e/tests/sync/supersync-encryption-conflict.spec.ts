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
 * SuperSync Encryption + Conflict Resolution E2E Tests
 *
 * These tests verify that conflict resolution works correctly when encryption is enabled.
 *
 * BACKGROUND:
 * There was a bug where encryption + concurrent modifications caused an infinite conflict loop:
 * 1. Client uploads ops → server rejects with CONFLICT_CONCURRENT
 * 2. Client downloads → 0 new ops (already has them, can't read encrypted payloads)
 * 3. Client creates LWW update with merged clock
 * 4. Server STILL rejects (client didn't know server's existing entity clock)
 * 5. Loop repeats infinitely with "conflict was fixed" messages
 *
 * FIX:
 * Server now returns `existingClock` in conflict rejection responses, allowing
 * the client to create LWW ops that properly dominate the server's state.
 *
 * These tests verify the fix works end-to-end with real encryption.
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-encryption-conflict.spec.ts
 */

test.describe('@supersync @encryption Encryption + Conflict Resolution', () => {
  /**
   * Regression test: Concurrent modifications with encryption enabled resolve correctly
   *
   * This is the core test for the existingClock fix. It verifies that when two clients
   * make concurrent modifications with encryption enabled, conflicts resolve correctly
   * without an infinite loop.
   *
   * Scenario:
   * 1. Client A and B both set up with encryption (same password)
   * 2. Client A creates a task, syncs
   * 3. Client B syncs (downloads encrypted task)
   * 4. Both clients make concurrent changes to the same task
   * 5. Client A syncs first (uploads change)
   * 6. Client B syncs (triggers conflict, should resolve via existingClock)
   * 7. Final sync round to verify convergence
   * 8. Verify both clients have consistent state (no infinite loop)
   */
  test('Concurrent modifications with encryption resolve without infinite loop (regression)', async ({
    browser,
    baseURL,
    testRunId,
    serverHealthy,
  }) => {
    void serverHealthy; // Ensure fixture is evaluated for server health check
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const baseConfig = getSuperSyncConfig(user);
      const encryptionPassword = `conflict-test-${testRunId}`;
      const syncConfig = {
        ...baseConfig,
        isEncryptionEnabled: true,
        password: encryptionPassword,
      };

      // ============ PHASE 1: Setup Both Clients with Encryption ============
      console.log('[EncryptConflict] Phase 1: Setting up clients with encryption');

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // Initial sync to establish vector clocks
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      console.log('[EncryptConflict] Both clients synced initially with encryption');

      // ============ PHASE 2: Client A Creates Task ============
      console.log('[EncryptConflict] Phase 2: Client A creating task');

      const taskName = `EncryptedConflictTask-${testRunId}`;
      await clientA.workView.addTask(taskName);
      await waitForTask(clientA.page, taskName);

      await clientA.sync.syncAndWait();
      console.log(`[EncryptConflict] Client A created and synced: ${taskName}`);

      // ============ PHASE 3: Client B Downloads Task ============
      console.log('[EncryptConflict] Phase 3: Client B downloading task');

      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, taskName);
      console.log('[EncryptConflict] Client B received the encrypted task');

      // ============ PHASE 4: Both Clients Make Concurrent Changes ============
      console.log('[EncryptConflict] Phase 4: Making concurrent changes');

      // Client A marks task as done
      const taskLocatorA = clientA.page
        .locator(`task:not(.ng-animating):has-text("${taskName}")`)
        .first();
      await taskLocatorA.hover();
      await taskLocatorA.locator('.task-done-btn').click();
      await expect(taskLocatorA).toHaveClass(/isDone/);
      console.log('[EncryptConflict] Client A marked task done');

      // Wait for timestamp gap (ensures B's change has later timestamp)
      await clientB.page.waitForTimeout(500);

      // Client B also marks task as done (concurrent change, later timestamp)
      const taskLocatorB = clientB.page
        .locator(`task:not(.ng-animating):has-text("${taskName}")`)
        .first();
      await taskLocatorB.hover();
      await taskLocatorB.locator('.task-done-btn').click();
      await expect(taskLocatorB).toHaveClass(/isDone/);
      console.log('[EncryptConflict] Client B marked task done (later timestamp)');

      // ============ PHASE 5: Client A Syncs First ============
      console.log('[EncryptConflict] Phase 5: Client A syncing first');

      await clientA.sync.syncAndWait();
      console.log('[EncryptConflict] Client A synced');

      // ============ PHASE 6: Client B Syncs (Triggers Conflict Resolution) ============
      console.log('[EncryptConflict] Phase 6: Client B syncing (conflict resolution)');

      // This is where the bug would manifest - without the fix, B would enter
      // an infinite loop of "conflict was fixed" messages.
      // With the fix, B receives existingClock and creates a dominating LWW op.
      await clientB.sync.syncAndWait();
      console.log('[EncryptConflict] Client B synced');

      // ============ PHASE 7: Final Sync Round for Convergence ============
      console.log('[EncryptConflict] Phase 7: Final sync round');

      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();

      // Wait a moment for any lingering operations
      await clientA.page.waitForTimeout(1000);
      await clientB.page.waitForTimeout(1000);

      // ============ PHASE 8: Verify Consistent State ============
      console.log('[EncryptConflict] Phase 8: Verifying consistent state');

      // Both clients should have the task marked as done
      await expect(taskLocatorA).toHaveClass(/isDone/);
      await expect(taskLocatorB).toHaveClass(/isDone/);

      // Verify no sync errors
      const hasErrorA = await clientA.sync.hasSyncError();
      const hasErrorB = await clientB.sync.hasSyncError();
      expect(hasErrorA).toBe(false);
      expect(hasErrorB).toBe(false);

      // Verify task count is the same on both clients
      const countA = await clientA.page.locator(`task:has-text("${taskName}")`).count();
      const countB = await clientB.page.locator(`task:has-text("${taskName}")`).count();
      expect(countA).toBe(1);
      expect(countB).toBe(1);

      console.log(
        '[EncryptConflict] ✓ Concurrent encrypted modifications resolved correctly',
      );
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Test: Multiple tasks with concurrent edits and encryption converge
   *
   * A scenario with multiple tasks being edited concurrently to verify the
   * existingClock mechanism handles conflicts across different entities.
   */
  test('Multiple tasks with concurrent edits and encryption converge', async ({
    browser,
    baseURL,
    testRunId,
    serverHealthy,
  }) => {
    void serverHealthy;
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const baseConfig = getSuperSyncConfig(user);
      const encryptionPassword = `multi-task-${testRunId}`;
      const syncConfig = {
        ...baseConfig,
        isEncryptionEnabled: true,
        password: encryptionPassword,
      };

      // Setup clients with encryption
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      console.log('[MultiTask] Both clients set up with encryption');

      // Create 3 tasks on client A
      const task1 = `Task1-${testRunId}`;
      const task2 = `Task2-${testRunId}`;
      const task3 = `Task3-${testRunId}`;

      await clientA.workView.addTask(task1);
      await clientA.page.waitForTimeout(100);
      await clientA.workView.addTask(task2);
      await clientA.page.waitForTimeout(100);
      await clientA.workView.addTask(task3);

      await clientA.sync.syncAndWait();

      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, task1);
      await waitForTask(clientB.page, task2);
      await waitForTask(clientB.page, task3);
      console.log('[MultiTask] All 3 tasks synced');

      // Client A marks task1 as done
      const task1LocatorA = clientA.page
        .locator(`task:not(.ng-animating):has-text("${task1}")`)
        .first();
      await task1LocatorA.hover();
      await task1LocatorA.locator('.task-done-btn').click();
      console.log('[MultiTask] Client A marked task1 done');

      // Wait for timestamp gap
      await clientB.page.waitForTimeout(500);

      // Client B marks task1 AND task2 as done (concurrent, later timestamp)
      const task1LocatorB = clientB.page
        .locator(`task:not(.ng-animating):has-text("${task1}")`)
        .first();
      await task1LocatorB.hover();
      await task1LocatorB.locator('.task-done-btn').click();

      const task2LocatorB = clientB.page
        .locator(`task:not(.ng-animating):has-text("${task2}")`)
        .first();
      await task2LocatorB.hover();
      await task2LocatorB.locator('.task-done-btn').click();
      console.log('[MultiTask] Client B marked task1 and task2 done (later timestamp)');

      // Sync sequence
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();

      // Wait for convergence
      await clientA.page.waitForTimeout(1000);
      await clientB.page.waitForTimeout(1000);

      // Verify no errors
      const hasErrorA = await clientA.sync.hasSyncError();
      const hasErrorB = await clientB.sync.hasSyncError();
      expect(hasErrorA).toBe(false);
      expect(hasErrorB).toBe(false);

      // All 3 tasks should exist on both clients
      const countA = await clientA.page.locator('task').count();
      const countB = await clientB.page.locator('task').count();
      expect(countA).toBeGreaterThanOrEqual(3);
      expect(countB).toBeGreaterThanOrEqual(3);

      console.log('[MultiTask] ✓ Multiple tasks with concurrent edits resolved');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Test: Title edit conflict with encryption resolves correctly
   *
   * Tests that more complex entity changes (title edits) also resolve
   * correctly with encryption enabled.
   */
  test('Title edit conflict with encryption resolves correctly', async ({
    browser,
    baseURL,
    testRunId,
    serverHealthy,
  }) => {
    void serverHealthy;
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const baseConfig = getSuperSyncConfig(user);
      const encryptionPassword = `title-conflict-${testRunId}`;
      const syncConfig = {
        ...baseConfig,
        isEncryptionEnabled: true,
        password: encryptionPassword,
      };

      // Setup clients with encryption
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();

      // Create initial task
      const originalTitle = `TitleConflict-${testRunId}`;
      const titleA = `A-Edited-${testRunId}`;
      const titleB = `B-Edited-${testRunId}`;

      await clientA.workView.addTask(originalTitle);
      await clientA.sync.syncAndWait();

      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, originalTitle);
      console.log('[TitleConflict] Initial task synced');

      // Client A edits title
      const taskLocatorA = clientA.page
        .locator(`task:not(.ng-animating):has-text("${originalTitle}")`)
        .first();
      await taskLocatorA.dblclick();
      const editInputA = clientA.page.locator(
        'input.mat-mdc-input-element:focus, textarea:focus',
      );
      await editInputA.waitFor({ state: 'visible', timeout: 5000 });
      await editInputA.fill(titleA);
      await clientA.page.keyboard.press('Enter');
      await clientA.page.waitForTimeout(500);
      console.log('[TitleConflict] Client A edited title');

      // Wait for timestamp gap
      await clientB.page.waitForTimeout(1000);

      // Client B edits title (concurrent, later timestamp)
      const taskLocatorB = clientB.page
        .locator(`task:not(.ng-animating):has-text("${originalTitle}")`)
        .first();
      await taskLocatorB.dblclick();
      const editInputB = clientB.page.locator(
        'input.mat-mdc-input-element:focus, textarea:focus',
      );
      await editInputB.waitFor({ state: 'visible', timeout: 5000 });
      await editInputB.fill(titleB);
      await clientB.page.keyboard.press('Enter');
      await clientB.page.waitForTimeout(500);
      console.log('[TitleConflict] Client B edited title (later timestamp)');

      // Sync sequence
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();

      // Wait for convergence
      await clientA.page.waitForTimeout(1000);
      await clientB.page.waitForTimeout(1000);

      // Verify no errors
      const hasErrorA = await clientA.sync.hasSyncError();
      const hasErrorB = await clientB.sync.hasSyncError();
      expect(hasErrorA).toBe(false);
      expect(hasErrorB).toBe(false);

      // B's title should win (later timestamp) - both clients should have titleB
      const taskWithBTitleOnA = clientA.page.locator(
        `task:not(.ng-animating):has-text("${titleB}")`,
      );
      const taskWithBTitleOnB = clientB.page.locator(
        `task:not(.ng-animating):has-text("${titleB}")`,
      );

      await expect(taskWithBTitleOnA.first()).toBeVisible({ timeout: 10000 });
      await expect(taskWithBTitleOnB.first()).toBeVisible({ timeout: 10000 });

      console.log(
        '[TitleConflict] ✓ Title conflict resolved correctly - B won (later ts)',
      );
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Test: Three clients with encryption converge correctly
   *
   * Tests that the existingClock mechanism works when more than two clients
   * are involved in conflicts.
   */
  test('Three clients with encryption converge correctly', async ({
    browser,
    baseURL,
    testRunId,
    serverHealthy,
  }) => {
    void serverHealthy;
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;
    let clientC: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const baseConfig = getSuperSyncConfig(user);
      const encryptionPassword = `three-way-${testRunId}`;
      const syncConfig = {
        ...baseConfig,
        isEncryptionEnabled: true,
        password: encryptionPassword,
      };

      // Setup all three clients with encryption
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      clientC = await createSimulatedClient(browser, baseURL!, 'C', testRunId);
      await clientC.sync.setupSuperSync(syncConfig);

      // Initial sync
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await clientC.sync.syncAndWait();
      console.log('[ThreeWay] All three clients set up with encryption');

      // Create task on A
      const taskName = `ThreeWayTask-${testRunId}`;
      await clientA.workView.addTask(taskName);
      await clientA.sync.syncAndWait();

      // B and C sync to get task
      await clientB.sync.syncAndWait();
      await clientC.sync.syncAndWait();
      await waitForTask(clientB.page, taskName);
      await waitForTask(clientC.page, taskName);
      console.log('[ThreeWay] All clients have the task');

      // All three clients make concurrent changes
      const taskLocatorA = clientA.page
        .locator(`task:not(.ng-animating):has-text("${taskName}")`)
        .first();
      await taskLocatorA.hover();
      await taskLocatorA.locator('.task-done-btn').click();

      const taskLocatorB = clientB.page
        .locator(`task:not(.ng-animating):has-text("${taskName}")`)
        .first();
      await taskLocatorB.hover();
      await taskLocatorB.locator('.task-done-btn').click();

      const taskLocatorC = clientC.page
        .locator(`task:not(.ng-animating):has-text("${taskName}")`)
        .first();
      await taskLocatorC.hover();
      await taskLocatorC.locator('.task-done-btn').click();

      console.log('[ThreeWay] All three clients made concurrent changes');

      // Sequential sync with conflict resolution
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await clientC.sync.syncAndWait();

      // Final sync round to ensure convergence
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await clientC.sync.syncAndWait();

      // Wait for state to settle
      await clientA.page.waitForTimeout(1000);

      // Verify no errors on any client
      const hasErrorA = await clientA.sync.hasSyncError();
      const hasErrorB = await clientB.sync.hasSyncError();
      const hasErrorC = await clientC.sync.hasSyncError();
      expect(hasErrorA).toBe(false);
      expect(hasErrorB).toBe(false);
      expect(hasErrorC).toBe(false);

      // All clients should have consistent state
      await expect(taskLocatorA).toHaveClass(/isDone/);
      await expect(taskLocatorB).toHaveClass(/isDone/);
      await expect(taskLocatorC).toHaveClass(/isDone/);

      // Task counts should match
      const countA = await clientA.page.locator(`task:has-text("${taskName}")`).count();
      const countB = await clientB.page.locator(`task:has-text("${taskName}")`).count();
      const countC = await clientC.page.locator(`task:has-text("${taskName}")`).count();
      expect(countA).toBe(1);
      expect(countB).toBe(1);
      expect(countC).toBe(1);

      console.log('[ThreeWay] ✓ Three clients with encryption converged correctly');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
      if (clientC) await closeClient(clientC);
    }
  });
});

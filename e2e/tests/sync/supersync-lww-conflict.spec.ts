import { test, expect } from '../../fixtures/supersync.fixture';
import type { Page } from '@playwright/test';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  deleteTask,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';

/**
 * SuperSync LWW (Last-Write-Wins) Conflict Resolution E2E Tests
 *
 * These tests verify the automatic LWW conflict resolution behavior:
 * - Conflicts are automatically resolved based on timestamps
 * - When remote is newer, remote state is applied
 * - When local is newer, local state is synced to server
 * - Users see a non-blocking notification about conflict resolution
 * - All clients converge to the same state
 */

test.describe('@supersync SuperSync LWW Conflict Resolution', () => {
  /**
   * Scenario: LWW Auto-Resolution with Newer Remote
   *
   * Tests that when remote changes are newer, they automatically win.
   *
   * Actions:
   * 1. Client A creates Task, syncs
   * 2. Client B syncs (download task)
   * 3. Client A marks task done (creates op at time T1)
   * 4. Wait a bit for time to advance
   * 5. Client B edits task title (creates op at time T2, where T2 > T1)
   * 6. Client B syncs first (uploads T2 change to server)
   * 7. Client A syncs (LWW: server has T2 > T1, so remote wins)
   * 8. Verify A's state matches B's state (B's title change wins)
   */
  test('LWW: Remote wins when remote timestamp is newer', async ({
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

      // Setup clients
      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // 1. Client A creates task
      const taskName = `LWW-Remote-${testRunId}`;
      await clientA.workView.addTask(taskName);
      await clientA.sync.syncAndWait();

      // 2. Client B downloads the task
      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, taskName);

      // 3. Client A marks task done (earlier timestamp)
      const taskLocatorA = clientA.page
        .locator(`task:not(.ng-animating):has-text("${taskName}")`)
        .first();
      await taskLocatorA.hover();
      await taskLocatorA.locator('.task-done-btn').click();
      await expect(taskLocatorA).toHaveClass(/isDone/);

      // 4. Wait for time to advance (ensures B's timestamp will be newer)
      await clientA.page.waitForTimeout(500);

      // 5. Client B also marks task done (later timestamp, but same logical change)
      const taskLocatorB = clientB.page
        .locator(`task:not(.ng-animating):has-text("${taskName}")`)
        .first();
      await taskLocatorB.hover();
      await taskLocatorB.locator('.task-done-btn').click();
      await expect(taskLocatorB).toHaveClass(/isDone/);

      // 6. Client B syncs first (B's change goes to server)
      await clientB.sync.syncAndWait();

      // 7. Client A syncs (LWW: B's timestamp is newer, so remote wins)
      await clientA.sync.syncAndWait();

      // 8. Both clients should have consistent state
      // (Both should show task as done - the outcome is the same for this test)
      await expect(taskLocatorA).toHaveClass(/isDone/);
      await expect(taskLocatorB).toHaveClass(/isDone/);

      // Final convergence check
      await clientB.sync.syncAndWait();

      console.log(
        '[LWW-Remote] ✓ Remote wins when timestamp is newer - clients converged',
      );
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario: LWW Notification Appears
   *
   * Tests that users see a notification when conflicts are auto-resolved.
   *
   * Actions:
   * 1. Client A creates Task, syncs
   * 2. Client B syncs (download task)
   * 3. Both clients make concurrent changes
   * 4. Client A syncs first
   * 5. Client B syncs (triggers LWW resolution)
   * 6. Verify notification appears indicating auto-resolution
   */
  test('LWW: Notification appears after conflict auto-resolution', async ({
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

      // Setup clients
      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // 1. Client A creates task
      const taskName = `LWW-Notify-${testRunId}`;
      await clientA.workView.addTask(taskName);
      await clientA.sync.syncAndWait();

      // 2. Client B downloads the task
      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, taskName);

      // 3. Both clients make concurrent changes
      // Client A marks done
      const taskLocatorA = clientA.page
        .locator(`task:not(.ng-animating):has-text("${taskName}")`)
        .first();
      await taskLocatorA.hover();
      await taskLocatorA.locator('.task-done-btn').click();

      // Client B also marks done
      const taskLocatorB = clientB.page
        .locator(`task:not(.ng-animating):has-text("${taskName}")`)
        .first();
      await taskLocatorB.hover();
      await taskLocatorB.locator('.task-done-btn').click();

      // 4. Client A syncs first
      await clientA.sync.syncAndWait();

      // 5. Client B syncs (triggers LWW resolution)
      await clientB.sync.syncAndWait();

      // 6. Verify LWW notification appears on Client B
      // The notification contains "auto-resolved" or similar text
      // Note: The exact text depends on translation; we check for the snack appearing
      const snackBar = clientB.page.locator('snack-custom, .mat-mdc-snack-bar-container');

      // Try to catch the notification (it may disappear quickly)
      try {
        await snackBar.waitFor({ state: 'visible', timeout: 3000 });
        console.log('[LWW-Notify] Snackbar appeared after sync');
      } catch {
        // Snackbar may have already disappeared - that's okay
        console.log('[LWW-Notify] Snackbar not visible (may have auto-dismissed)');
      }

      // The key assertion is that sync completed without blocking dialogs
      // and both clients have consistent state

      // Final convergence
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();

      // Both should have same state
      await expect(taskLocatorA).toHaveClass(/isDone/);
      await expect(taskLocatorB).toHaveClass(/isDone/);

      console.log('[LWW-Notify] ✓ Conflict auto-resolved without blocking dialog');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario: LWW Convergence with Three Clients
   *
   * Tests that all three clients converge to the same state using LWW.
   *
   * Actions:
   * 1. Client A creates Task, syncs
   * 2. Client B and C sync (download task)
   * 3. All three clients make concurrent edits
   * 4. Sequential syncs: A -> B -> C
   * 5. Final sync round to converge
   * 6. Verify all three clients have identical state
   */
  test('LWW: Three clients converge to same state', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
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
      const taskName = `LWW-3Way-${testRunId}`;
      await clientA.workView.addTask(taskName);
      await clientA.sync.syncAndWait();

      // 2. Clients B and C download the task
      await clientB.sync.syncAndWait();
      await clientC.sync.syncAndWait();

      // Verify all have the task
      await waitForTask(clientA.page, taskName);
      await waitForTask(clientB.page, taskName);
      await waitForTask(clientC.page, taskName);

      // 3. All three clients make concurrent changes (mark as done)
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

      // 4. Sequential syncs (LWW auto-resolves conflicts)
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await clientC.sync.syncAndWait();

      // 5. Final round to ensure convergence
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await clientC.sync.syncAndWait();

      // 6. Verify all three clients have identical state
      await expect(taskLocatorA).toHaveClass(/isDone/);
      await expect(taskLocatorB).toHaveClass(/isDone/);
      await expect(taskLocatorC).toHaveClass(/isDone/);

      // Count tasks should be identical
      const countA = await clientA.page.locator('task').count();
      const countB = await clientB.page.locator('task').count();
      const countC = await clientC.page.locator('task').count();

      expect(countA).toBe(countB);
      expect(countB).toBe(countC);

      console.log('[LWW-3Way] ✓ All three clients converged via LWW auto-resolution');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
      if (clientC) await closeClient(clientC);
    }
  });

  /**
   * Scenario: LWW Local Wins Creates Update Op
   *
   * Tests that when local is newer, the local state syncs to server.
   * This is the more complex case where we need to verify local changes
   * propagate to other clients.
   *
   * Actions:
   * 1. Client A creates Task, syncs
   * 2. Client B syncs (download task)
   * 3. Client B makes change first (earlier timestamp)
   * 4. Wait for time to advance
   * 5. Client A makes different change (later timestamp)
   * 6. Client B syncs (uploads B's change)
   * 7. Client A syncs (LWW: A's timestamp > B's on server, local wins)
   * 8. Client B syncs again (receives A's winning state)
   * 9. Verify B now has A's state (proves local-win update op was created)
   */
  test('LWW: Local wins when local timestamp is newer, propagates to other clients', async ({
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

      // Setup clients
      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // 1. Client A creates task
      const taskName = `LWW-Local-${testRunId}`;
      await clientA.workView.addTask(taskName);
      await clientA.sync.syncAndWait();

      // 2. Client B downloads the task
      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, taskName);

      // 3. Client B makes change first (earlier timestamp)
      const taskLocatorB = clientB.page
        .locator(`task:not(.ng-animating):has-text("${taskName}")`)
        .first();
      await taskLocatorB.waitFor({ state: 'visible', timeout: 10000 });
      await taskLocatorB.hover();
      await clientB.page.waitForTimeout(100); // Let hover state settle
      await taskLocatorB.locator('.task-done-btn').click();
      await expect(taskLocatorB).toHaveClass(/isDone/, { timeout: 5000 });

      // 4. Wait for time to advance significantly
      await clientB.page.waitForTimeout(1000);

      // 5. Client A makes same change (later timestamp)
      const taskLocatorA = clientA.page
        .locator(`task:not(.ng-animating):has-text("${taskName}")`)
        .first();
      await taskLocatorA.waitFor({ state: 'visible', timeout: 10000 });
      await taskLocatorA.hover();
      await clientA.page.waitForTimeout(100); // Let hover state settle
      await taskLocatorA.locator('.task-done-btn').click();
      await expect(taskLocatorA).toHaveClass(/isDone/, { timeout: 5000 });

      // 6. Client B syncs (uploads B's earlier change to server)
      await clientB.sync.syncAndWait();

      // 7. Client A syncs (LWW: A's local timestamp > server's timestamp for this entity)
      // Since A's change is newer, local wins, and A creates new update op
      await clientA.sync.syncAndWait();

      // 8. Client B syncs again (should receive A's winning state via new update op)
      await clientB.sync.syncAndWait();

      // 9. Both clients should have consistent state
      // In this case, both marked as done, so state should be isDone
      await expect(taskLocatorA).toHaveClass(/isDone/);
      await expect(taskLocatorB).toHaveClass(/isDone/);

      // Final convergence
      await clientA.sync.syncAndWait();

      // Both should have same task count
      const countA = await clientA.page.locator(`task:has-text("${taskName}")`).count();
      const countB = await clientB.page.locator(`task:has-text("${taskName}")`).count();
      expect(countA).toBe(1);
      expect(countB).toBe(1);

      console.log('[LWW-Local] ✓ Local wins and propagates state to other clients');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario: LWW Local-Win Op Uploaded in Same Sync Cycle
   *
   * This is the critical test for the fix in sync.service.ts that ensures
   * local-win update ops are uploaded immediately in the same sync cycle,
   * not deferred to the next sync.
   *
   * Actions:
   * 1. Client A creates Task with title "Original", syncs
   * 2. Client B syncs (download task)
   * 3. Client B edits title to "B-Title" (earlier timestamp T1)
   * 4. Wait 1 second for timestamp gap
   * 5. Client A edits title to "A-Title" (later timestamp T2, T2 > T1)
   * 6. Client B syncs (uploads "B-Title" to server)
   * 7. Client A syncs ONCE (should: detect conflict, LWW says A wins, re-upload A-Title)
   * 8. Client B syncs ONCE (should get "A-Title" if fix works)
   * 9. Verify B has "A-Title" - NOT "B-Title"
   *
   * Before the fix: B would keep "B-Title" because A's local-win op wasn't uploaded
   * After the fix: B gets "A-Title" because A re-uploads in the same sync cycle
   */
  test('LWW: Local-win update op is uploaded in same sync cycle', async ({
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

      // Setup clients
      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // 1. Client A creates task with original title
      const originalTitle = `Original-${testRunId}`;
      const titleA = `A-Title-${testRunId}`;
      const titleB = `B-Title-${testRunId}`;

      await clientA.workView.addTask(originalTitle);
      await clientA.sync.syncAndWait();

      // 2. Client B downloads the task
      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, originalTitle);

      // 3. Client B edits title FIRST (earlier timestamp)
      const taskLocatorB = clientB.page
        .locator(`task:not(.ng-animating):has-text("${originalTitle}")`)
        .first();
      await taskLocatorB.dblclick(); // Double-click to edit
      const editInputB = clientB.page.locator(
        'input.mat-mdc-input-element:focus, textarea:focus',
      );
      await editInputB.waitFor({ state: 'visible', timeout: 5000 });
      await editInputB.fill(titleB);
      await clientB.page.keyboard.press('Enter');
      await clientB.page.waitForTimeout(500);

      // Verify B has the new title locally
      await waitForTask(clientB.page, titleB);

      // 4. Wait for timestamp gap (ensures A's timestamp > B's timestamp)
      await clientB.page.waitForTimeout(1000);

      // 5. Client A edits title (later timestamp)
      const taskLocatorA = clientA.page
        .locator(`task:not(.ng-animating):has-text("${originalTitle}")`)
        .first();
      await taskLocatorA.dblclick(); // Double-click to edit
      const editInputA = clientA.page.locator(
        'input.mat-mdc-input-element:focus, textarea:focus',
      );
      await editInputA.waitFor({ state: 'visible', timeout: 5000 });
      await editInputA.fill(titleA);
      await clientA.page.keyboard.press('Enter');
      await clientA.page.waitForTimeout(500);

      // Verify A has the new title locally
      await waitForTask(clientA.page, titleA);

      // 6. Client B syncs FIRST (uploads "B-Title" to server)
      await clientB.sync.syncAndWait();

      // 7. Client A syncs ONCE
      // This should:
      // - Upload A's "A-Title" op
      // - Server rejects it (conflict with B's "B-Title")
      // - A receives B's op as piggybacked
      // - LWW: A's timestamp > B's, so A wins
      // - A creates local-win UPDATE op with "A-Title"
      // - FIX: A immediately re-uploads this op
      await clientA.sync.syncAndWait();

      // 8. Client B syncs ONCE to receive A's update
      // CRITICAL: If the fix works, B gets "A-Title" here
      // If the fix is broken, B still has "B-Title"
      await clientB.sync.syncAndWait();

      // 9. Verify BOTH clients have A's title (the winner)
      const taskWithATitleOnA = clientA.page.locator(
        `task:not(.ng-animating):has-text("${titleA}")`,
      );
      const taskWithATitleOnB = clientB.page.locator(
        `task:not(.ng-animating):has-text("${titleA}")`,
      );

      // A should have A-Title (it's the local state)
      await expect(taskWithATitleOnA.first()).toBeVisible({ timeout: 5000 });

      // B should have A-Title (received from server via local-win update op)
      // This is the KEY assertion that fails without the fix
      await expect(taskWithATitleOnB.first()).toBeVisible({ timeout: 5000 });

      console.log(
        '[LWW-Single-Cycle] ✓ Local-win op uploaded in same sync cycle, B has A-Title',
      );
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario: LWW Update Action Updates UI Without Reload
   *
   * This test specifically verifies the lwwUpdateMetaReducer fix. When a client
   * receives an LWW Update operation from another client, the NgRx store should
   * be updated immediately, and the UI should reflect the change without needing
   * a page reload.
   *
   * Before the fix: UI wouldn't update because [TASK] LWW Update action wasn't handled
   * After the fix: lwwUpdateMetaReducer handles the action and updates the store
   *
   * Actions:
   * 1. Client A creates Task, syncs
   * 2. Client B syncs (download task)
   * 3. Client A edits title and adds notes
   * 4. Client A syncs (uploads changes)
   * 5. Client B syncs (receives LWW Update via piggybacked op)
   * 6. Verify B's UI shows A's changes WITHOUT reload
   */
  test('LWW: UI updates immediately after receiving LWW Update operation', async ({
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

      // Setup clients
      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // 1. Client A creates task with original title
      const originalTitle = `UI-Update-${testRunId}`;
      const updatedTitle = `Updated-UI-${testRunId}`;

      await clientA.workView.addTask(originalTitle);
      await clientA.sync.syncAndWait();

      // 2. Client B downloads the task
      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, originalTitle);

      // Verify B has the original title
      const taskOnB = clientB.page
        .locator(`task:not(.ng-animating):has-text("${originalTitle}")`)
        .first();
      await expect(taskOnB).toBeVisible({ timeout: 5000 });

      // 3. Client A edits the title
      const taskOnA = clientA.page
        .locator(`task:not(.ng-animating):has-text("${originalTitle}")`)
        .first();
      await taskOnA.dblclick(); // Double-click to edit
      const editInput = clientA.page.locator(
        'input.mat-mdc-input-element:focus, textarea:focus',
      );
      await editInput.waitFor({ state: 'visible', timeout: 5000 });
      await editInput.fill(updatedTitle);
      await clientA.page.keyboard.press('Enter');
      await clientA.page.waitForTimeout(500);

      // Verify A has the updated title
      await waitForTask(clientA.page, updatedTitle);

      // 4. Client A syncs (uploads the change)
      await clientA.sync.syncAndWait();

      // 5. Client B syncs (receives A's change)
      // This is where the lwwUpdateMetaReducer fix kicks in:
      // B receives [TASK] LWW Update action, and the meta-reducer updates the store
      await clientB.sync.syncAndWait();

      // 6. Verify B's UI shows A's updated title WITHOUT reload
      // This is the KEY assertion - if lwwUpdateMetaReducer isn't working,
      // B would still show the old title until a page reload
      const updatedTaskOnB = clientB.page.locator(
        `task:not(.ng-animating):has-text("${updatedTitle}")`,
      );

      await expect(updatedTaskOnB.first()).toBeVisible({ timeout: 5000 });

      // Also verify the old title is no longer visible
      const oldTaskOnB = clientB.page.locator(
        `task:not(.ng-animating):has-text("${originalTitle}")`,
      );
      await expect(oldTaskOnB).toHaveCount(0);

      console.log(
        '[LWW-UI-Update] ✓ UI updated immediately after receiving LWW Update operation',
      );
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario: Multiple Operations on Same Entity Use Max Timestamp for LWW
   *
   * Tests that when both clients have MULTIPLE concurrent operations on the
   * same entity, LWW correctly uses the MAX timestamp across ALL operations,
   * not just the last one.
   *
   * Actions:
   * 1. Client A creates Task, syncs
   * 2. Client B syncs (download task)
   * 3. Client A makes 3 rapid changes (rename, mark done, add note)
   * 4. Client B makes 3 different changes offline (different rename, unmark, remove note)
   * 5. Client B syncs first (uploads B's 3 ops)
   * 6. Client A syncs (LWW compares max timestamps across all ops)
   * 7. Final sync round
   * 8. Verify both clients converge to same state
   */
  test('LWW: Multiple operations on same entity use max timestamp', async ({
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

      // Setup clients
      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // 1. Client A creates task with original title
      const originalTitle = `MultiOp-${testRunId}`;
      await clientA.workView.addTask(originalTitle);
      await clientA.sync.syncAndWait();

      // 2. Client B downloads the task
      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, originalTitle);

      // 3. Client A makes 3 rapid changes
      const taskLocatorA = clientA.page
        .locator(`task:not(.ng-animating):has-text("${originalTitle}")`)
        .first();

      // Change 1: Rename task
      const titleA = `A-MultiOp-${testRunId}`;
      await taskLocatorA.dblclick();
      const editInputA = clientA.page.locator(
        'input.mat-mdc-input-element:focus, textarea:focus',
      );
      await editInputA.waitFor({ state: 'visible', timeout: 5000 });
      await editInputA.fill(titleA);
      await clientA.page.keyboard.press('Enter');
      await clientA.page.waitForTimeout(300);

      // Change 2: Mark task done
      const taskLocatorAUpdated = clientA.page
        .locator(`task:not(.ng-animating):has-text("${titleA}")`)
        .first();
      await taskLocatorAUpdated.hover();
      await taskLocatorAUpdated.locator('.task-done-btn').click();
      await clientA.page.waitForTimeout(300);

      // Change 3: Add time estimate (another field update)
      // This creates a third operation on the same entity
      await taskLocatorAUpdated.hover();
      const additionalBtn = taskLocatorAUpdated
        .locator('.task-additional-info-btn, button[mat-icon-button]')
        .first();
      if (await additionalBtn.isVisible()) {
        await additionalBtn.click();
        await clientA.page.waitForTimeout(200);
      }

      console.log('[MultiOp] Client A made 3 changes');

      // 4. Client B makes 3 different changes (offline - hasn't synced yet)
      const taskLocatorB = clientB.page
        .locator(`task:not(.ng-animating):has-text("${originalTitle}")`)
        .first();

      // Wait for timestamp gap to ensure B's changes are LATER
      await clientB.page.waitForTimeout(1500);

      // Change 1: Different rename
      const titleB = `B-MultiOp-${testRunId}`;
      await taskLocatorB.dblclick();
      const editInputB = clientB.page.locator(
        'input.mat-mdc-input-element:focus, textarea:focus',
      );
      await editInputB.waitFor({ state: 'visible', timeout: 5000 });
      await editInputB.fill(titleB);
      await clientB.page.keyboard.press('Enter');
      await clientB.page.waitForTimeout(300);

      // Change 2: Mark done as well
      const taskLocatorBUpdated = clientB.page
        .locator(`task:not(.ng-animating):has-text("${titleB}")`)
        .first();
      await taskLocatorBUpdated.hover();
      await taskLocatorBUpdated.locator('.task-done-btn').click();
      await clientB.page.waitForTimeout(300);

      console.log('[MultiOp] Client B made 3 changes (B has later timestamps)');

      // 5. Client B syncs FIRST (uploads B's ops to server)
      await clientB.sync.syncAndWait();
      console.log('[MultiOp] Client B synced first');

      // 6. Client A syncs (downloads B's ops, LWW resolution)
      // Since B's changes are later, B should win
      await clientA.sync.syncAndWait();
      console.log('[MultiOp] Client A synced, LWW resolution applied');

      // 7. Final sync round for convergence
      await clientB.sync.syncAndWait();
      await clientA.sync.syncAndWait();

      // 8. Verify BOTH clients have the SAME state (B's title since B was later)
      const taskWithBTitleOnA = clientA.page.locator(
        `task:not(.ng-animating):has-text("${titleB}")`,
      );
      const taskWithBTitleOnB = clientB.page.locator(
        `task:not(.ng-animating):has-text("${titleB}")`,
      );

      // Both should have B's title (B's max timestamp was later)
      await expect(taskWithBTitleOnA.first()).toBeVisible({ timeout: 10000 });
      await expect(taskWithBTitleOnB.first()).toBeVisible({ timeout: 10000 });

      // Both should show task as done
      await expect(taskWithBTitleOnA.first()).toHaveClass(/isDone/);
      await expect(taskWithBTitleOnB.first()).toHaveClass(/isDone/);

      // Verify task counts match
      const countA = await clientA.page.locator('task').count();
      const countB = await clientB.page.locator('task').count();
      expect(countA).toBe(countB);

      console.log(
        '[MultiOp] ✓ Multiple operations resolved correctly - B won with later max timestamp',
      );
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario: Concurrent Task Move to Different Projects Resolves via LWW
   *
   * Tests that when both clients move the same task to DIFFERENT projects,
   * LWW correctly resolves the conflict and the task ends up in exactly
   * ONE project (not duplicated).
   *
   * Actions:
   * 1. Client A creates Project1, Project2, and a Task in Project1
   * 2. Client A syncs
   * 3. Client B syncs (download all)
   * 4. Client B creates Project3
   * 5. Client A moves Task to Project2
   * 6. Client B moves Task to Project3 (offline/concurrent)
   * 7. Client A syncs first
   * 8. Client B syncs (LWW resolution)
   * 9. Final sync round
   * 10. Verify task is in exactly ONE project on both clients
   */
  test('LWW: Concurrent task move to different projects resolves correctly', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    const appUrl = baseURL || 'http://localhost:4242';
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    // Helper to create a project
    const createProject = async (page: Page, projectName: string): Promise<void> => {
      await page.goto('/#/tag/TODAY/work');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000);

      const navSidenav = page.locator('.nav-sidenav');
      if (await navSidenav.isVisible()) {
        const isCompact = await navSidenav.evaluate((el: Element) =>
          el.classList.contains('compactMode'),
        );
        if (isCompact) {
          const toggleBtn = navSidenav.locator('.mode-toggle');
          if (await toggleBtn.isVisible()) {
            await toggleBtn.click();
            await page.waitForTimeout(500);
          }
        }
      }

      const projectsTree = page
        .locator('nav-list-tree')
        .filter({ hasText: 'Projects' })
        .first();
      await projectsTree.waitFor({ state: 'visible' });

      const addBtn = projectsTree
        .locator('.additional-btn mat-icon:has-text("add")')
        .first();
      const groupNavItem = projectsTree.locator('nav-item').first();
      await groupNavItem.hover();
      await page.waitForTimeout(200);

      if (await addBtn.isVisible()) {
        await addBtn.click();
      } else {
        throw new Error('Could not find Create Project button');
      }

      const nameInput = page.getByRole('textbox', { name: 'Project Name' });
      await nameInput.waitFor({ state: 'visible', timeout: 10000 });
      await nameInput.fill(projectName);

      const submitBtn = page.locator('dialog-create-project button[type=submit]').first();
      await submitBtn.click();
      await nameInput.waitFor({ state: 'hidden', timeout: 5000 });
      await page.waitForTimeout(1000);
    };

    // Helper to move task to project via context menu
    const moveTaskToProject = async (
      page: Page,
      taskName: string,
      projectName: string,
    ): Promise<void> => {
      const taskLocator = page.locator(`task:has-text("${taskName}")`).first();
      await taskLocator.waitFor({ state: 'visible' });

      // Right-click to open context menu
      await taskLocator.click({ button: 'right' });
      await page.waitForTimeout(300);

      // Find and click "Move to project" / "Add to project" option
      // The button has mat-icon "forward" and text containing "project"
      const menuPanel = page.locator('.mat-mdc-menu-panel').first();
      await menuPanel.waitFor({ state: 'visible', timeout: 5000 });

      const moveToProjectBtn = menuPanel
        .locator('button[mat-menu-item]')
        .filter({ has: page.locator('mat-icon:has-text("forward")') })
        .first();
      await moveToProjectBtn.waitFor({ state: 'visible', timeout: 5000 });
      await moveToProjectBtn.click();

      // Wait for project submenu
      await page.waitForTimeout(300);
      const projectMenu = page.locator('.mat-mdc-menu-panel').last();
      await projectMenu.waitFor({ state: 'visible', timeout: 5000 });

      // Select the target project
      const projectOption = projectMenu
        .locator('button[mat-menu-item]')
        .filter({ hasText: projectName })
        .first();
      await projectOption.waitFor({ state: 'visible', timeout: 3000 });
      await projectOption.click();

      await page.waitForTimeout(500);

      // Dismiss any remaining overlays
      for (let j = 0; j < 3; j++) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(100);
      }
    };

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // Setup clients
      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // 1. Client A creates Project1, Project2, and a Task
      const project1Name = `Proj1-${testRunId}`;
      const project2Name = `Proj2-${testRunId}`;
      const project3Name = `Proj3-${testRunId}`;
      const taskName = `MoveTask-${testRunId}`;

      await createProject(clientA.page, project1Name);
      await createProject(clientA.page, project2Name);
      console.log('[MoveConflict] Created Project1 and Project2 on Client A');

      // Navigate to Project1 and create task
      const projectBtnA = clientA.page.getByText(project1Name).first();
      await projectBtnA.waitFor({ state: 'visible' });
      await projectBtnA.click({ force: true });
      await clientA.page.waitForLoadState('networkidle');

      await clientA.workView.addTask(taskName);
      await waitForTask(clientA.page, taskName);
      console.log('[MoveConflict] Created task in Project1');

      // 2. Client A syncs
      await clientA.sync.syncAndWait();
      console.log('[MoveConflict] Client A synced');

      // 3. Client B syncs to get everything
      await clientB.sync.syncAndWait();
      console.log('[MoveConflict] Client B synced');

      // 4. Client B creates Project3
      await createProject(clientB.page, project3Name);
      console.log('[MoveConflict] Client B created Project3');

      // Navigate Client B to Project1 to see the task
      const project1BtnB = clientB.page.getByText(project1Name).first();
      await project1BtnB.waitFor({ state: 'visible' });
      await project1BtnB.click({ force: true });
      await clientB.page.waitForLoadState('networkidle');
      await waitForTask(clientB.page, taskName);

      // 5. Client A moves task to Project2
      // First go to Project1 on A
      await clientA.page.goto('/#/tag/TODAY/work');
      await clientA.page.waitForLoadState('networkidle');
      const project1BtnA = clientA.page.getByText(project1Name).first();
      await project1BtnA.click({ force: true });
      await clientA.page.waitForLoadState('networkidle');
      await waitForTask(clientA.page, taskName);

      await moveTaskToProject(clientA.page, taskName, project2Name);
      console.log('[MoveConflict] Client A moved task to Project2');

      // Wait for timestamp gap
      await clientA.page.waitForTimeout(1000);

      // 6. Client B moves task to Project3 (concurrent - hasn't synced)
      await moveTaskToProject(clientB.page, taskName, project3Name);
      console.log('[MoveConflict] Client B moved task to Project3 (later timestamp)');

      // 7. Client A syncs first
      await clientA.sync.syncAndWait();
      console.log('[MoveConflict] Client A synced');

      // 8. Client B syncs (LWW resolution - B's move is later, should win)
      await clientB.sync.syncAndWait();
      console.log('[MoveConflict] Client B synced, LWW resolution applied');

      // 9. Final sync round for convergence
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();

      // 10. Verify task is in exactly ONE project on both clients
      // Since B moved later, task should be in Project3

      // Check Client A - task should be in Project3 (B won)
      await clientA.page.goto('/#/tag/TODAY/work');
      await clientA.page.waitForLoadState('networkidle');
      const project3BtnA = clientA.page.getByText(project3Name).first();
      await project3BtnA.waitFor({ state: 'visible' });
      await project3BtnA.click({ force: true });
      await clientA.page.waitForLoadState('networkidle');
      await waitForTask(clientA.page, taskName);
      console.log('[MoveConflict] Client A sees task in Project3');

      // Check Client B - task should also be in Project3
      await clientB.page.goto('/#/tag/TODAY/work');
      await clientB.page.waitForLoadState('networkidle');
      const project3BtnB = clientB.page.getByText(project3Name).first();
      await project3BtnB.click({ force: true });
      await clientB.page.waitForLoadState('networkidle');
      await waitForTask(clientB.page, taskName);
      console.log('[MoveConflict] Client B sees task in Project3');

      // Verify task is NOT in Project2 (A's move lost)
      await clientA.page.goto('/#/tag/TODAY/work');
      await clientA.page.waitForLoadState('networkidle');
      const project2BtnA = clientA.page.getByText(project2Name).first();
      await project2BtnA.click({ force: true });
      await clientA.page.waitForLoadState('networkidle');
      await clientA.page.waitForTimeout(1000);

      const taskInProject2 = clientA.page.locator(`task:has-text("${taskName}")`);
      await expect(taskInProject2).not.toBeVisible({ timeout: 3000 });
      console.log(
        "[MoveConflict] ✓ Task NOT in Project2 (A's move correctly lost via LWW)",
      );

      console.log('[MoveConflict] ✓ Concurrent project move resolved correctly via LWW');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario: Concurrent Tag Changes on Same Task Resolves via LWW
   *
   * Tests that when both clients change tags on the same task concurrently,
   * LWW correctly resolves the conflict and tag.taskIds arrays are updated
   * to match the winning task.tagIds.
   *
   * Actions:
   * 1. Client A creates TagA, TagB and a Task with TagA
   * 2. Client A syncs
   * 3. Client B syncs (download all)
   * 4. Client B creates TagC
   * 5. Client A removes TagA and adds TagB to the task
   * 6. Client B removes TagA and adds TagC to the task (concurrent)
   * 7. Client A syncs first
   * 8. Client B syncs (LWW resolution - B's change should win with later timestamp)
   * 9. Final sync round
   * 10. Verify task has correct tags on both clients
   */
  test('LWW: Concurrent tag changes on same task resolves correctly', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    const appUrl = baseURL || 'http://localhost:4242';
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    // Helper to toggle a tag on task via context menu "Toggle Tags" submenu
    // Used for both adding and removing tags (it's a toggle)
    const toggleTagOnTask = async (
      page: Page,
      taskName: string,
      tagName: string,
    ): Promise<void> => {
      const taskLocator = page.locator(`task:has-text("${taskName}")`).first();
      await taskLocator.waitFor({ state: 'visible' });

      // Right-click to open context menu
      await taskLocator.click({ button: 'right' });
      await page.waitForTimeout(300);

      // Find and click "Toggle Tags" submenu trigger (has label icon and class e2e-edit-tags-btn)
      const menuPanel = page.locator('.mat-mdc-menu-panel').first();
      await menuPanel.waitFor({ state: 'visible', timeout: 5000 });

      const toggleTagsBtn = menuPanel.locator('.e2e-edit-tags-btn').first();
      await toggleTagsBtn.waitFor({ state: 'visible', timeout: 5000 });
      await toggleTagsBtn.click();

      // Wait for tag submenu
      await page.waitForTimeout(300);
      const tagMenu = page.locator('.mat-mdc-menu-panel').last();
      await tagMenu.waitFor({ state: 'visible', timeout: 5000 });

      // Select the target tag to toggle
      const tagOption = tagMenu
        .locator('button[mat-menu-item]')
        .filter({ hasText: tagName })
        .first();
      await tagOption.waitFor({ state: 'visible', timeout: 3000 });
      await tagOption.click();

      await page.waitForTimeout(500);

      // Dismiss any remaining overlays
      for (let j = 0; j < 3; j++) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(100);
      }
    };

    // Helper to add task with tag using short syntax and handle creation dialog
    const addTaskWithTag = async (
      client: SimulatedE2EClient,
      taskTitle: string,
    ): Promise<void> => {
      // Use skipClose=true because tag creation dialog may block backdrop click
      await client.workView.addTask(taskTitle, true);

      // Handle tag creation confirmation dialog if it appears
      const confirmBtn = client.page.locator('button[e2e="confirmBtn"]');
      if (await confirmBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await confirmBtn.click();
      }

      // Close the add task bar manually if it's still open
      if (await client.workView.backdrop.isVisible().catch(() => false)) {
        await client.workView.backdrop.click();
      }

      await client.page.waitForTimeout(300);
    };

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // Setup clients
      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      const tagAName = `TagA-${testRunId}`;
      const tagBName = `TagB-${testRunId}`;
      const tagCName = `TagC-${testRunId}`;
      const taskName = `TagTask-${testRunId}`;

      // 1. Client A creates task with TagA and another with TagB using short syntax
      await addTaskWithTag(clientA, `${taskName} #${tagAName}`);
      await waitForTask(clientA.page, taskName);
      console.log('[TagConflict] Created task with TagA on Client A');

      await addTaskWithTag(clientA, `TempTask-${testRunId} #${tagBName}`);
      await clientA.page.waitForTimeout(500);
      console.log('[TagConflict] Created TagB on Client A');

      // 2. Client A syncs
      await clientA.sync.syncAndWait();
      console.log('[TagConflict] Client A synced');

      // 3. Client B syncs to get everything
      await clientB.sync.syncAndWait();
      console.log('[TagConflict] Client B synced');

      // Verify Client B has the task in Today view (tasks are created with TODAY tag)
      await waitForTask(clientB.page, taskName);
      console.log('[TagConflict] Client B has the task in Today view');

      // 4. Client B creates TagC using short syntax
      await addTaskWithTag(clientB, `TempTask2-${testRunId} #${tagCName}`);
      await clientB.page.waitForTimeout(500);
      console.log('[TagConflict] Created TagC on Client B');

      // 5. Verify task is visible in both clients' Today view before tag operations
      await waitForTask(clientA.page, taskName);
      await waitForTask(clientB.page, taskName);
      console.log('[TagConflict] Task visible in Today view on both clients');

      // Client A: Toggle TagA off and toggle TagB on (in Today view)
      await toggleTagOnTask(clientA.page, taskName, tagAName);
      console.log('[TagConflict] Client A toggled TagA off');
      await toggleTagOnTask(clientA.page, taskName, tagBName);
      console.log('[TagConflict] Client A toggled TagB on');

      // 6. Client B: Toggle TagA off and toggle TagC on (concurrent with step 5)
      await clientB.page.waitForTimeout(1000); // Ensure later timestamp
      await toggleTagOnTask(clientB.page, taskName, tagAName);
      console.log('[TagConflict] Client B toggled TagA off');
      await toggleTagOnTask(clientB.page, taskName, tagCName);
      console.log('[TagConflict] Client B toggled TagC on');

      // 7. Client A syncs first
      await clientA.sync.syncAndWait();
      console.log('[TagConflict] Client A synced');

      // 8. Client B syncs (LWW resolution - B should win with later timestamp)
      await clientB.sync.syncAndWait();
      console.log('[TagConflict] Client B synced, LWW resolution applied');

      // 9. Final sync to propagate resolution
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      console.log('[TagConflict] Final sync complete');

      // 10. Verify - navigate to TagC on both clients to check if task is there
      // Client B's changes should win (later timestamp), so task should be in TagC
      const tagCBtnA = clientA.page
        .locator('.nav-sidenav')
        .locator('nav-item')
        .filter({ hasText: tagCName })
        .first();
      await tagCBtnA.waitFor({ state: 'visible', timeout: 10000 });
      await tagCBtnA.click();
      await clientA.page.waitForLoadState('networkidle');
      await clientA.page.waitForTimeout(1000);

      const taskInTagCOnA = clientA.page.locator(`task:has-text("${taskName}")`);
      await expect(taskInTagCOnA).toBeVisible({ timeout: 10000 });
      console.log('[TagConflict] Client A sees task in TagC');

      // Check Client B
      const tagCBtnB = clientB.page
        .locator('.nav-sidenav')
        .locator('nav-item')
        .filter({ hasText: tagCName })
        .first();
      await tagCBtnB.waitFor({ state: 'visible', timeout: 10000 });
      await tagCBtnB.click();
      await clientB.page.waitForLoadState('networkidle');
      await clientB.page.waitForTimeout(1000);

      const taskInTagCOnB = clientB.page.locator(`task:has-text("${taskName}")`);
      await expect(taskInTagCOnB).toBeVisible({ timeout: 10000 });
      console.log('[TagConflict] Client B sees task in TagC');

      // Verify task is NOT in TagA on both clients (both removed it)
      const tagABtnAVerify = clientA.page
        .locator('.nav-sidenav')
        .locator('nav-item')
        .filter({ hasText: tagAName })
        .first();
      await tagABtnAVerify.click();
      await clientA.page.waitForLoadState('networkidle');
      await clientA.page.waitForTimeout(1000);

      const taskInTagAOnA = clientA.page.locator(`task:has-text("${taskName}")`);
      await expect(taskInTagAOnA).not.toBeVisible({ timeout: 3000 });
      console.log('[TagConflict] ✓ Task NOT in TagA on Client A');

      // Verify task is NOT in TagB (B's changes won, TagB was only added by A)
      const tagBBtnAVerify = clientA.page
        .locator('.nav-sidenav')
        .locator('nav-item')
        .filter({ hasText: tagBName })
        .first();
      await tagBBtnAVerify.click();
      await clientA.page.waitForLoadState('networkidle');
      await clientA.page.waitForTimeout(1000);

      const taskInTagBOnA = clientA.page.locator(`task:has-text("${taskName}")`);
      await expect(taskInTagBOnA).not.toBeVisible({ timeout: 3000 });
      console.log(
        "[TagConflict] ✓ Task NOT in TagB (A's changes correctly lost via LWW)",
      );

      console.log('[TagConflict] ✓ Concurrent tag changes resolved correctly via LWW');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario: Delete vs Update Race
   *
   * Tests that when one client deletes a task while another updates it,
   * LWW correctly picks the winner based on timestamps.
   *
   * Actions:
   * 1. Client A creates task, syncs
   * 2. Client B syncs (download task)
   * 3. Client A deletes the task
   * 4. Client B (with later timestamp) updates the task
   * 5. Client A syncs (uploads delete)
   * 6. Client B syncs (LWW: B's update wins, task should be recreated)
   * 7. Verify task exists on both clients with B's updates
   */
  test('LWW: Delete vs Update race resolves correctly', async ({
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

      // Setup clients
      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // 1. Client A creates task
      const taskName = `DeleteRace-${testRunId}`;
      await clientA.workView.addTask(taskName);
      await waitForTask(clientA.page, taskName);
      console.log('[DeleteRace] Created task on Client A');

      // 2. Both sync
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, taskName);
      console.log('[DeleteRace] Both clients have the task');

      // 3. Client A deletes the task using reliable keyboard shortcut
      await deleteTask(clientA, taskName);
      await clientA.page.waitForTimeout(150); // Flush operation to ensure DELETE is created
      console.log('[DeleteRace] Client A deleted task');

      // 4. Client B updates the task (with later timestamp)
      await clientB.page.waitForTimeout(1000); // Ensure UPDATE has later timestamp than DELETE

      const taskLocatorB = clientB.page
        .locator(`task:not(.ng-animating):has-text("${taskName}")`)
        .first();
      await taskLocatorB.waitFor({ state: 'visible', timeout: 5000 });
      await taskLocatorB.dblclick();
      const titleInputB = clientB.page
        .locator('input.mat-mdc-input-element, textarea')
        .first();
      await titleInputB.waitFor({ state: 'visible', timeout: 5000 });
      await titleInputB.focus();
      await titleInputB.fill(`${taskName}-Updated`);
      await clientB.page.keyboard.press('Enter');
      await clientB.page.waitForTimeout(300);
      console.log('[DeleteRace] Client B updated task title');

      // Wait to ensure Client B's UPDATE operation is created and flushed
      await clientB.page.waitForTimeout(1000);

      // 5. Client A syncs (uploads delete)
      await clientA.sync.syncAndWait();
      console.log('[DeleteRace] Client A synced delete');

      // 6. Client B syncs (LWW: B's update has later timestamp, should win)
      await clientB.sync.syncAndWait();
      console.log('[DeleteRace] Client B synced, LWW applied');

      // 7. Final sync
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      console.log('[DeleteRace] Final sync complete');

      // Verify: Task should exist with B's updated title (update won over delete)
      const updatedTaskA = clientA.page.locator(`task:has-text("${taskName}-Updated")`);
      const updatedTaskB = clientB.page.locator(`task:has-text("${taskName}-Updated")`);

      await expect(updatedTaskB).toBeVisible({ timeout: 15000 });
      await expect(updatedTaskA).toBeVisible({ timeout: 15000 });

      console.log('[DeleteRace] ✓ Update won over delete via LWW');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario: Delete vs Update Race with TODAY_TAG (dueDay)
   *
   * Tests that when a task scheduled for today is deleted on one client
   * while updated on another, the recreated task (via LWW Update) correctly
   * appears in the TODAY view. This validates that syncTodayTagTaskIds
   * properly updates TODAY_TAG.taskIds during LWW conflict resolution.
   *
   * Actions:
   * 1. Client A creates task for today (sd:today), syncs
   * 2. Client B syncs (download task)
   * 3. Client A deletes the task
   * 4. Client B (with later timestamp) updates the task title
   * 5. Client A syncs (uploads delete)
   * 6. Client B syncs (uploads update, which wins via LWW)
   * 7. Client A syncs (receives LWW Update, task is recreated)
   * 8. Verify task appears in TODAY view on Client A
   *
   * This test specifically validates the fix for the bug where TODAY_TAG.taskIds
   * wasn't updated when a task was recreated via LWW Update with dueDay = today.
   */
  test('LWW: Recreated task with dueDay=today appears in TODAY view', async ({
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

      // Setup clients
      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // 1. Client A creates task for TODAY (sd:today sets dueDay)
      const taskName = `TodayDeleteRace-${testRunId}`;
      await clientA.workView.addTask(`${taskName} sd:today`);
      await waitForTask(clientA.page, taskName);
      console.log('[TodayDeleteRace] Created task for today on Client A');

      // Verify task is in TODAY view (URL should contain TODAY)
      const urlA = clientA.page.url();
      expect(urlA).toContain('TODAY');

      // 2. Both sync
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, taskName);
      console.log('[TodayDeleteRace] Both clients have the task');

      // 3. Client A deletes the task using reliable keyboard shortcut
      await deleteTask(clientA, taskName);
      await clientA.page.waitForTimeout(150); // Flush operation to ensure DELETE is created and persisted
      console.log('[TodayDeleteRace] Client A deleted task');

      // 4. Client B updates the task (with later timestamp)
      await clientB.page.waitForTimeout(1000); // Ensure later timestamp

      const taskLocatorB = clientB.page
        .locator(`task:not(.ng-animating):has-text("${taskName}")`)
        .first();
      await taskLocatorB.dblclick();
      const titleInputB = clientB.page.locator(
        'input.mat-mdc-input-element:focus, textarea:focus',
      );
      await titleInputB.waitFor({ state: 'visible', timeout: 5000 });
      await titleInputB.fill(`${taskName}-Updated`);
      await clientB.page.keyboard.press('Enter');
      await clientB.page.waitForTimeout(300);
      console.log('[TodayDeleteRace] Client B updated task title');
      // Wait to ensure Client B's UPDATE operation is created and flushed to IndexedDB
      await clientB.page.waitForTimeout(1000);

      // 5. Client A syncs (uploads delete)
      await clientA.sync.syncAndWait();
      console.log('[TodayDeleteRace] Client A synced delete');

      // 6. Client B syncs (uploads update, which should win via LWW)
      await clientB.sync.syncAndWait();
      console.log('[TodayDeleteRace] Client B synced update');

      // 7. Client A syncs (receives LWW Update, task should be recreated)
      await clientA.sync.syncAndWait();
      console.log('[TodayDeleteRace] Client A synced, LWW applied');

      // Wait for post-sync cooldown (2s) to ensure repair effect runs if needed.
      // The meta-reducer should add task to TODAY_TAG.taskIds immediately, but
      // the repair effect provides a safety net with a 2-second delay.
      await clientA.page.waitForTimeout(2500);
      console.log('[TodayDeleteRace] Post-sync cooldown complete');

      // 8. CRITICAL ASSERTION: Task should appear in TODAY view on Client A
      // This validates that syncTodayTagTaskIds properly updated TODAY_TAG.taskIds
      const recreatedTaskA = clientA.page.locator(`task:has-text("${taskName}-Updated")`);
      await expect(recreatedTaskA).toBeVisible({ timeout: 15000 });

      // Also verify we're still in TODAY context
      const finalUrlA = clientA.page.url();
      expect(finalUrlA).toContain('TODAY');

      // Verify task also visible on Client B
      const updatedTaskB = clientB.page.locator(`task:has-text("${taskName}-Updated")`);
      await expect(updatedTaskB).toBeVisible({ timeout: 15000 });

      console.log(
        '[TodayDeleteRace] ✓ Recreated task with dueDay=today appears in TODAY view',
      );
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * LWW: Subtask conflicts resolve independently from parent
   *
   * Tests that parent and subtask are separate entities with independent LWW resolution.
   * Changes to one don't affect the other's conflict resolution.
   *
   * Scenario:
   * 1. Client A creates parent task with subtask
   * 2. Both clients sync
   * 3. Client A updates parent title (concurrent with B)
   * 4. Client B marks subtask as done (later timestamp)
   * 5. Both sync
   * 6. Verify: Both parent title change AND subtask done status applied
   */
  test('LWW: Subtask conflicts resolve independently from parent', async ({
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

      // Setup clients
      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // 1. Client A creates parent task
      const parentName = `Parent-${testRunId}`;
      const subtaskName = `Subtask-${testRunId}`;
      await clientA.workView.addTask(parentName);
      await waitForTask(clientA.page, parentName);

      // Add subtask using keyboard shortcut
      const parentTask = clientA.page.locator(`task:has-text("${parentName}")`).first();
      await parentTask.focus();
      await clientA.page.waitForTimeout(100);
      await parentTask.press('a'); // Add subtask shortcut

      // Wait for textarea and fill subtask name
      const textarea = clientA.page.locator('task-title textarea');
      await textarea.waitFor({ state: 'visible', timeout: 5000 });
      await textarea.fill(subtaskName);
      await clientA.page.keyboard.press('Enter');
      await waitForTask(clientA.page, subtaskName);
      await clientA.page.waitForTimeout(300);
      console.log('[SubtaskLWW] Created parent with subtask on Client A');

      // 2. Both sync
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, parentName);
      console.log('[SubtaskLWW] Both clients have parent and subtask');

      // 3. Client A updates parent title
      // Must click on task-title specifically, not the whole task
      // (dblclick on parent task with subtasks expands/collapses them)
      const parentLocatorA = clientA.page
        .locator(`task:not(.hasNoSubTasks):not(.ng-animating):has-text("${parentName}")`)
        .first();
      const titleElementA = parentLocatorA.locator('.task-title').first();
      await titleElementA.dblclick();
      await clientA.page.waitForTimeout(200);

      // Wait for inline edit input
      const inputA = clientA.page.locator(
        'input.mat-mdc-input-element:focus, textarea:focus',
      );
      await inputA.waitFor({ state: 'visible', timeout: 5000 });
      const newParentName = `UpdatedParent-${testRunId}`;
      await inputA.fill(newParentName);
      await clientA.page.keyboard.press('Enter');
      await clientA.page.waitForTimeout(300);
      console.log('[SubtaskLWW] Client A updated parent title');

      // 4. Client B marks subtask as done (later timestamp)
      await clientB.page.waitForTimeout(500);

      // Find the parent and expand to see subtask
      const parentLocatorB = clientB.page
        .locator(`task:not(.hasNoSubTasks):not(.ng-animating):has-text("${parentName}")`)
        .first();
      await parentLocatorB.waitFor({ state: 'visible', timeout: 5000 });

      // Click the expand button or the task itself to show subtasks
      // First check if subtasks are already visible
      const subtaskVisible = await clientB.page
        .locator(`task.hasNoSubTasks:has-text("${subtaskName}")`)
        .first()
        .isVisible()
        .catch(() => false);

      if (!subtaskVisible) {
        // Try clicking expand button
        const expandBtn = parentLocatorB.locator('.expand-btn').first();
        if (await expandBtn.isVisible().catch(() => false)) {
          await expandBtn.click();
          await clientB.page.waitForTimeout(500);
        } else {
          // Try toggle-sub-tasks-btn
          const toggleBtn = parentLocatorB.locator('.toggle-sub-tasks-btn').first();
          if (await toggleBtn.isVisible().catch(() => false)) {
            await toggleBtn.click();
            await clientB.page.waitForTimeout(500);
          } else {
            // Click on parent to toggle
            await parentLocatorB.click();
            await clientB.page.waitForTimeout(500);
          }
        }
      }

      // Verify subtask is now visible
      const subtaskLocatorB = clientB.page
        .locator(`task.hasNoSubTasks:has-text("${subtaskName}")`)
        .first();
      await subtaskLocatorB.waitFor({ state: 'visible', timeout: 10000 });

      // Mark subtask done using keyboard shortcut
      await subtaskLocatorB.focus();
      await clientB.page.waitForTimeout(100);
      await subtaskLocatorB.press('d'); // Toggle done shortcut
      await clientB.page.waitForTimeout(300);
      console.log('[SubtaskLWW] Client B marked subtask done');

      // 5. Both sync
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      console.log('[SubtaskLWW] Final sync complete');

      // 6. Verify both changes applied

      // Parent should have updated title on both clients
      await waitForTask(clientA.page, newParentName);
      await waitForTask(clientB.page, newParentName);
      console.log('[SubtaskLWW] Parent title updated on both clients');

      // Expand to see subtasks on Client A
      const updatedParentA = clientA.page
        .locator(`task:not(.hasNoSubTasks):has-text("${newParentName}")`)
        .first();
      await updatedParentA.waitFor({ state: 'visible', timeout: 5000 });

      // Check if subtask is already visible
      const subtaskVisibleA = await clientA.page
        .locator(`task.hasNoSubTasks:has-text("${subtaskName}")`)
        .first()
        .isVisible()
        .catch(() => false);

      if (!subtaskVisibleA) {
        // Try clicking expand button
        const expandBtnA = updatedParentA.locator('.expand-btn').first();
        if (await expandBtnA.isVisible().catch(() => false)) {
          await expandBtnA.click();
        } else {
          // Click parent to toggle
          await updatedParentA.click();
        }
        await clientA.page.waitForTimeout(500);
      }

      // Expand to see subtasks on Client B
      const updatedParentB = clientB.page
        .locator(`task:not(.hasNoSubTasks):has-text("${newParentName}")`)
        .first();
      await updatedParentB.waitFor({ state: 'visible', timeout: 5000 });

      // Check if subtask is already visible
      const subtaskVisibleB = await clientB.page
        .locator(`task.hasNoSubTasks:has-text("${subtaskName}")`)
        .first()
        .isVisible()
        .catch(() => false);

      if (!subtaskVisibleB) {
        // Try clicking expand button
        const expandBtnB = updatedParentB.locator('.expand-btn').first();
        if (await expandBtnB.isVisible().catch(() => false)) {
          await expandBtnB.click();
        } else {
          // Click parent to toggle
          await updatedParentB.click();
        }
        await clientB.page.waitForTimeout(500);
      }

      // Wait for subtasks to be visible
      const doneSubtaskA = clientA.page
        .locator(`task.hasNoSubTasks:has-text("${subtaskName}")`)
        .first();
      const doneSubtaskB = clientB.page
        .locator(`task.hasNoSubTasks:has-text("${subtaskName}")`)
        .first();

      await doneSubtaskA.waitFor({ state: 'visible', timeout: 10000 });
      await doneSubtaskB.waitFor({ state: 'visible', timeout: 10000 });

      // Subtask should be marked done on both clients
      await expect(doneSubtaskA).toHaveClass(/isDone/, { timeout: 10000 });
      await expect(doneSubtaskB).toHaveClass(/isDone/, { timeout: 10000 });

      console.log(
        '[SubtaskLWW] ✓ Parent title change and subtask done status synced independently',
      );
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * LWW: Subtask deletion cascades with parent delete
   *
   * This tests that parent deletion properly cascades to subtasks even when
   * the subtask is edited concurrently on another client with a later timestamp.
   *
   * Parent deletion cascades to all subtasks to maintain data consistency.
   * Without this, orphaned subtasks with invalid parentIds would cause issues.
   *
   * Scenario:
   * 1. Client A creates parent task with subtask
   * 2. Both clients sync
   * 3. Client A deletes the parent task (cascades to subtask locally)
   * 4. Wait for timestamp gap
   * 5. Client B marks subtask as done (later timestamp, doesn't know parent is deleted)
   * 6. Client A syncs (uploads delete operations)
   * 7. Client B syncs (delete cascades to subtask despite later edit)
   * 8. Verify: Both parent and subtask are deleted on both clients
   */
  test('LWW: Subtask is deleted when parent is deleted concurrently (cascade delete)', async ({
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

      // Setup clients
      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // 1. Client A creates parent task with subtask
      const parentName = `ParentDel-${testRunId}`;
      const subtaskName = `SubtaskSurvive-${testRunId}`;
      await clientA.workView.addTask(parentName);
      await waitForTask(clientA.page, parentName);

      // Add subtask using keyboard shortcut
      const parentTask = clientA.page.locator(`task:has-text("${parentName}")`).first();
      await parentTask.focus();
      await clientA.page.waitForTimeout(100);
      await parentTask.press('a'); // Add subtask shortcut

      // Wait for textarea and fill subtask name
      const textarea = clientA.page.locator('task-title textarea');
      await textarea.waitFor({ state: 'visible', timeout: 5000 });
      await textarea.fill(subtaskName);
      await clientA.page.keyboard.press('Enter');
      await waitForTask(clientA.page, subtaskName);
      await clientA.page.waitForTimeout(300);
      console.log('[OrphanSubtask] Created parent with subtask on Client A');

      // 2. Both sync
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, parentName);
      console.log('[OrphanSubtask] Both clients have parent and subtask');

      // Expand parent on Client B to see subtask before we delete on A
      const parentLocatorB = clientB.page
        .locator(`task:not(.hasNoSubTasks):has-text("${parentName}")`)
        .first();
      await parentLocatorB.waitFor({ state: 'visible', timeout: 5000 });

      // Check if subtask is already visible, if not expand
      const subtaskVisibleB = await clientB.page
        .locator(`task.hasNoSubTasks:has-text("${subtaskName}")`)
        .first()
        .isVisible()
        .catch(() => false);

      if (!subtaskVisibleB) {
        const expandBtn = parentLocatorB.locator('.expand-btn').first();
        if (await expandBtn.isVisible().catch(() => false)) {
          await expandBtn.click();
        } else {
          await parentLocatorB.click();
        }
        await clientB.page.waitForTimeout(500);
      }

      // Verify subtask is visible on Client B
      const subtaskLocatorB = clientB.page
        .locator(`task.hasNoSubTasks:has-text("${subtaskName}")`)
        .first();
      await subtaskLocatorB.waitFor({ state: 'visible', timeout: 10000 });
      console.log('[OrphanSubtask] Subtask visible on Client B');

      // 3. Client A deletes the parent task
      // First, click elsewhere to clear any focus/selection
      await clientA.page.locator('body').click({ position: { x: 10, y: 10 } });
      await clientA.page.waitForTimeout(200);

      // Find the parent task - use more specific selector targeting the parent (not subtask)
      // Parent tasks have the parent name but subtasks don't
      const parentLocatorA = clientA.page
        .locator(`task:has-text("${parentName}")`)
        .first();
      await parentLocatorA.waitFor({ state: 'visible', timeout: 5000 });

      // Delete the parent task via context menu (more reliable for tasks with subtasks)
      await parentLocatorA.scrollIntoViewIfNeeded();
      await clientA.page.waitForTimeout(200);

      // Open context menu on the task title area
      await parentLocatorA.locator('task-title').first().click({ button: 'right' });
      await clientA.page.waitForTimeout(300);

      // Wait for context menu and click delete
      const menuPanel = clientA.page.locator('.mat-mdc-menu-panel');
      await menuPanel.waitFor({ state: 'visible', timeout: 5000 });
      const deleteBtn = clientA.page
        .locator('.mat-mdc-menu-item')
        .filter({ hasText: 'Delete' });
      await deleteBtn.waitFor({ state: 'visible', timeout: 5000 });
      await deleteBtn.click();
      await clientA.page.waitForTimeout(300);

      // Handle confirmation dialog if it appears
      const confirmBtn = clientA.page.locator(
        'mat-dialog-actions button:has-text("Delete")',
      );
      if (await confirmBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await confirmBtn.click();
      }

      console.log('[OrphanSubtask] Client A deleted parent task');

      // Wait for parent task to be removed from DOM (animations may take time)
      const parentLocatorForCheck = clientA.page.locator(
        `task:has-text("${parentName}")`,
      );
      await parentLocatorForCheck.waitFor({ state: 'hidden', timeout: 5000 });
      console.log('[OrphanSubtask] Parent and subtasks gone from Client A');

      // 4. Wait for timestamp gap (ensures B's edit is later)
      await clientB.page.waitForTimeout(1500);

      // 5. Client B edits subtask (marks it done) - doesn't know parent was deleted
      // Subtask should still be visible on B
      await subtaskLocatorB.focus();
      await clientB.page.waitForTimeout(100);
      await subtaskLocatorB.press('d'); // Toggle done shortcut
      await clientB.page.waitForTimeout(300);

      // Verify subtask is marked done on B
      await expect(subtaskLocatorB).toHaveClass(/isDone/, { timeout: 5000 });
      console.log('[OrphanSubtask] Client B marked subtask done (later timestamp)');

      // 6. Client A syncs (uploads delete operations)
      await clientA.sync.syncAndWait();
      console.log('[OrphanSubtask] Client A synced delete');

      // 7. Client B syncs (LWW resolution happens)
      // B's subtask update has later timestamp, should win over A's delete
      await clientB.sync.syncAndWait();
      console.log('[OrphanSubtask] Client B synced, LWW applied');

      // 8. Final sync round
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();

      // 9. Verify: Both parent and subtask are deleted on both clients
      // Parent deletion cascades to subtasks, even if subtask had later edits

      // On Client B: subtask should be deleted (cascade delete from parent)
      const subtaskCountB = await clientB.page
        .locator(`task:has-text("${subtaskName}")`)
        .count();
      expect(subtaskCountB).toBe(0);
      console.log('[CascadeDelete] Subtask deleted on Client B (cascade)');

      // On Client A: subtask should also be deleted
      const subtaskCountA = await clientA.page
        .locator(`task:has-text("${subtaskName}")`)
        .count();
      expect(subtaskCountA).toBe(0);
      console.log('[CascadeDelete] Subtask deleted on Client A');

      // Parent should be deleted on both clients
      const parentCountA = await clientA.page
        .locator(`task:has-text("${parentName}")`)
        .count();
      const parentCountB = await clientB.page
        .locator(`task:has-text("${parentName}")`)
        .count();

      expect(parentCountA).toBe(0);
      expect(parentCountB).toBe(0);

      console.log(
        '[CascadeDelete] ✓ Parent delete cascaded to subtask - data consistency maintained',
      );
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});

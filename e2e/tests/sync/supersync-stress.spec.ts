import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';

/**
 * SuperSync Stress Tests
 *
 * High-volume tests that verify bulk sync operations.
 * These tests are separated from edge-cases due to:
 * - Longer timeouts (up to 5 minutes)
 * - Higher operation counts
 * - Need for quieter logging
 */

/**
 * Create a simulated client with quiet console logging.
 * Only errors are logged, other console output is suppressed.
 */
const createQuietClient = async (
  browser: Parameters<typeof createSimulatedClient>[0],
  appUrl: string,
  clientName: string,
  testPrefix: string,
): Promise<SimulatedE2EClient> => {
  const client = await createSimulatedClient(browser, appUrl, clientName, testPrefix);

  // Remove default listeners and add quiet one (only errors)
  client.page.removeAllListeners('console');
  client.page.on('console', (msg) => {
    if (msg.type() === 'error') {
      console.error(`[Client ${clientName}] Error:`, msg.text());
    }
  });

  return client;
};

test.describe('@supersync SuperSync Stress Tests', () => {
  // Server health check is handled automatically by the supersync fixture

  /**
   * Scenario: Bulk Sync (Slow Device Recovery)
   *
   * Tests that many operations sync correctly without causing cascade conflicts.
   * This verifies the fix for the "slow device cascade" problem where user
   * interactions during sync would create operations with stale vector clocks.
   *
   * Actions:
   * 1. Client A creates many tasks (simulating a day's work)
   * 2. Client B syncs (downloads all operations at once)
   * 3. Verify B has all tasks from A
   * 4. Verify no spurious conflicts or errors
   */
  test('Bulk sync: Many operations sync without cascade conflicts', async ({
    browser,
    baseURL,
    testRunId,
    serverHealthy,
  }, testInfo) => {
    void serverHealthy; // Ensure fixture is evaluated for server health check
    testInfo.setTimeout(120000); // Bulk operations need more time
    const appUrl = baseURL || 'http://localhost:4242';
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // Setup Client A (quiet mode)
      clientA = await createQuietClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      // 1. Client A creates many tasks (simulating a day's work)
      const taskCount = 10;
      const taskNames: string[] = [];

      console.log(`[BulkSync] Creating ${taskCount} tasks...`);

      for (let i = 1; i <= taskCount; i++) {
        const taskName = `BulkTask-${i}-${testRunId}`;
        taskNames.push(taskName);
        // Use skipClose=true for faster creation
        await clientA.workView.addTask(taskName, i < taskCount);
      }

      // Verify tasks were created
      const createdCount = await clientA.page.locator('task').count();
      expect(createdCount).toBeGreaterThanOrEqual(taskCount);
      console.log(`[BulkSync] Created ${createdCount} tasks`);

      // Mark some tasks as done using correct selector (need hover to show button)
      for (let i = 0; i < 3; i++) {
        const taskLocator = clientA.page
          .locator(`task:has-text("${taskNames[i]}")`)
          .first();
        await taskLocator.hover();
        await taskLocator.locator('.task-done-btn').click();
        await clientA.page.waitForTimeout(100);
      }
      console.log('[BulkSync] Marked 3 tasks as done');

      // Sync all changes from A
      await clientA.sync.syncAndWait();
      console.log('[BulkSync] Client A synced');

      // 2. Setup Client B and sync (downloads all operations at once)
      clientB = await createQuietClient(browser, appUrl, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();
      console.log('[BulkSync] Client B synced (bulk download)');

      // Wait for UI to settle after bulk sync
      await clientB.page.waitForTimeout(2000);

      // 3. Verify B has all tasks from A
      const taskCountB = await clientB.page
        .locator(`task:has-text("${testRunId}")`)
        .count();
      expect(taskCountB).toBe(taskCount);
      console.log(`[BulkSync] Client B has all ${taskCount} tasks`);

      // Verify done status of first 3 tasks
      for (let i = 0; i < 3; i++) {
        const taskLocator = clientB.page
          .locator(`task:not(.ng-animating):has-text("${taskNames[i]}")`)
          .first();
        await expect(taskLocator).toHaveClass(/isDone/, { timeout: 5000 });
      }
      console.log('[BulkSync] Done status verified on Client B');

      // 4. Do another round of sync to verify no spurious conflicts
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();

      // Verify counts still match
      const finalCountA = await clientA.page
        .locator(`task:has-text("${testRunId}")`)
        .count();
      const finalCountB = await clientB.page
        .locator(`task:has-text("${testRunId}")`)
        .count();
      expect(finalCountA).toBe(taskCount);
      expect(finalCountB).toBe(taskCount);

      console.log('[BulkSync] Bulk sync completed without cascade conflicts');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario: High Volume Sync (197 Operations)
   *
   * Tests that the system can handle a high number of operations.
   * Creates 50 tasks and marks 49 as done = 197 operations.
   * (Each mark-as-done creates 3 ops: updateTask, planTasksForToday, Tag Update)
   * This verifies the operation log can handle bulk syncs without issues.
   *
   * The OperationApplierService uses batched dispatches with event loop yields
   * to prevent NgRx from being overwhelmed by rapid dispatches.
   *
   * This test also verifies the hasMorePiggyback fix: when the server's piggyback
   * limit (100 ops) is reached, the client correctly fetches remaining ops via download.
   *
   * Actions:
   * 1. Client A creates 50 tasks (50 operations)
   * 2. Client A marks 49 tasks as done (49 × 3 = 147 operations = 197 total)
   * 3. Client A syncs all 197 operations
   * 4. Client B syncs (piggybacks 100, downloads remaining 97)
   * 5. Verify B has all 50 tasks with correct done states
   */
  test('High volume sync: 197 operations sync correctly (tests piggyback limit)', async ({
    browser,
    baseURL,
    testRunId,
    serverHealthy,
  }, testInfo) => {
    void serverHealthy; // Ensure fixture is evaluated for server health check
    testInfo.setTimeout(300000); // 5 minutes
    const appUrl = baseURL || 'http://localhost:4242';
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // Setup Client A (regular mode to see logs)
      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      // Create 50 tasks (50 ops)
      const taskCount = 50;
      const taskNames: string[] = [];

      console.log(`[HighVolume] Creating ${taskCount} tasks...`);

      for (let i = 1; i <= taskCount; i++) {
        const taskName = `HighVol-${i}-${testRunId}`;
        taskNames.push(taskName);
        // Fast task creation - skipClose=true for all but last
        await clientA.workView.addTask(taskName, i < taskCount);

        // Progress logging every 5 tasks
        if (i % 5 === 0) {
          console.log(`[HighVolume] Created ${i}/${taskCount} tasks`);
        }
      }

      // Extra wait after all tasks created to ensure persistence
      await clientA.page.waitForTimeout(1000);

      // Verify tasks created
      const createdCount = await clientA.page.locator('task').count();
      expect(createdCount).toBeGreaterThanOrEqual(taskCount);
      console.log(`[HighVolume] Created ${createdCount} tasks total`);

      // Mark 49 tasks as done (49 × 3 = 147 more ops = 197 total)
      const doneCount = 49;
      // Each mark-as-done creates 3 ops: updateTask, planTasksForToday, Tag Update
      // eslint-disable-next-line no-mixed-operators
      const expectedOpsCount = taskCount + doneCount * 3;
      console.log(`[HighVolume] Marking ${doneCount} tasks as done...`);
      for (let i = 0; i < doneCount; i++) {
        const taskLocator = clientA.page
          .locator(`task:not(.ng-animating):has-text("${taskNames[i]}")`)
          .first();
        await taskLocator.waitFor({ state: 'visible', timeout: 10000 });
        await taskLocator.hover();
        await taskLocator.locator('.task-done-btn').click();
        // Wait for done state to be applied
        await expect(taskLocator).toHaveClass(/isDone/, { timeout: 5000 });

        // Progress logging every 5 tasks
        if ((i + 1) % 5 === 0) {
          console.log(`[HighVolume] Marked ${i + 1}/${doneCount} tasks as done`);
        }
      }

      // Extra wait after all done marking to ensure persistence
      await clientA.page.waitForTimeout(1000);
      console.log(`[HighVolume] All ${expectedOpsCount} operations created locally`);

      // Sync all changes from A
      await clientA.sync.syncAndWait();
      console.log('[HighVolume] Client A synced 99 operations');

      // VALIDATION: Check pending ops count on Client A after sync
      // Query IndexedDB directly for unsynced operations (SUP_OPS database)
      const pendingOpsInfoA = await clientA.page.evaluate(async () => {
        try {
          return new Promise((resolve) => {
            // Operation log uses SUP_OPS database, not SUP
            const request = indexedDB.open('SUP_OPS');
            request.onerror = () =>
              resolve({ error: 'Failed to open SUP_OPS IndexedDB' });
            request.onsuccess = () => {
              const db = request.result;
              const storeNames = Array.from(db.objectStoreNames);
              // Check if ops store exists
              if (!storeNames.includes('ops')) {
                resolve({
                  error: 'ops store not found in SUP_OPS',
                  stores: storeNames,
                });
                return;
              }
              const tx = db.transaction('ops', 'readonly');
              const store = tx.objectStore('ops');
              const getAllRequest = store.getAll();
              getAllRequest.onsuccess = () => {
                const allEntries = getAllRequest.result;
                // Unsynced = no syncedAt and no rejectedAt
                const unsynced = allEntries.filter(
                  (e: { syncedAt?: number; rejectedAt?: number }) =>
                    !e.syncedAt && !e.rejectedAt,
                );
                resolve({
                  totalEntries: allEntries.length,
                  unsyncedCount: unsynced.length,
                  unsyncedOpTypes: unsynced
                    .slice(0, 20)
                    .map(
                      (e: { op: { actionType: string; opType: string } }) =>
                        `${e.op.opType}:${e.op.actionType}`,
                    ),
                });
              };
              getAllRequest.onerror = () =>
                resolve({ error: 'Failed to read ops store' });
            };
          });
        } catch (e) {
          return { error: String(e) };
        }
      });
      console.log(
        '[HighVolume] VALIDATION - Client A pending ops after sync:',
        JSON.stringify(pendingOpsInfoA),
      );

      // Setup Client B and sync (bulk download) - NOT quiet to see debug logs
      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();
      console.log('[HighVolume] Client B synced (bulk download)');

      // Wait for UI to settle after bulk sync
      // The done states need time to reflect in Angular change detection
      await clientB.page.waitForTimeout(5000);

      // Trigger change detection by scrolling
      await clientB.page.evaluate(() => {
        window.scrollTo(0, 100);
        window.scrollTo(0, 0);
      });
      await clientB.page.waitForTimeout(1000);

      // Verify all tasks exist on B
      const taskCountB = await clientB.page
        .locator(`task:has-text("${testRunId}")`)
        .count();
      expect(taskCountB).toBe(taskCount);
      console.log(`[HighVolume] Client B has all ${taskCount} tasks`);

      // DEBUG: Check NgRx store state directly using window.__NGRX_STORE__
      const storeState = await clientB.page.evaluate((tid: string) => {
        try {
          // Access NgRx store via window if available
          // @ts-expect-error - accessing app internals
          const store = window.__NGRX_STORE__ || window.__store__;
          if (store) {
            const state = store.getState?.() || store.getValue?.();
            if (state?.task?.entities) {
              const allTasks = Object.values(state.task.entities) as Array<{
                id: string;
                title: string;
                isDone: boolean;
              }>;
              const testTasks = allTasks.filter((t) => t?.title?.includes(tid));
              const doneTasks = testTasks.filter((t) => t?.isDone);
              return {
                method: 'NgRx Store',
                totalTestTasks: testTasks.length,
                doneTestTasks: doneTasks.length,
                sampleTasks: testTasks.slice(0, 3).map((t) => ({
                  id: t.id,
                  isDone: t.isDone,
                })),
              };
            }
          }

          // Fallback to DOM check
          const allTaskEls = document.querySelectorAll('task');
          const testTasks = Array.from(allTaskEls).filter((el) =>
            el.textContent?.includes(tid),
          );
          const doneTasks = testTasks.filter((el) => el.classList.contains('isDone'));
          return {
            method: 'DOM Fallback',
            totalTestTasks: testTasks.length,
            doneTestTasks: doneTasks.length,
            sampleClasses: testTasks.slice(0, 3).map((el) => el.className),
          };
        } catch (e) {
          return { error: String(e) };
        }
      }, testRunId);
      console.log('[HighVolume] State check:', JSON.stringify(storeState));

      // Verify done status (49 should be done, 1 should be open)
      const doneCountB = await clientB.page
        .locator(`task.isDone:has-text("${testRunId}")`)
        .count();
      console.log(`[HighVolume] DOM shows ${doneCountB} done tasks`);
      expect(doneCountB).toBe(doneCount);
      console.log('[HighVolume] Done states verified on Client B');

      console.log(`[HighVolume] ${expectedOpsCount} operations applied successfully`);
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});

import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  getTaskCount,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';

/**
 * SuperSync ConstraintError Recovery E2E Tests
 *
 * These tests verify the bug fix for appliedOpIds cache not being invalidated
 * when appendBatch() fails with ConstraintError. The bug caused:
 *
 * 1. appendBatch() partially succeeds (some ops written to IndexedDB)
 * 2. ConstraintError is thrown (duplicate op ID)
 * 3. appliedOpIds cache was NOT invalidated
 * 4. Next sync: filterNewOps() returns the same ops (cache says they're new)
 * 5. appendBatch() fails again with ConstraintError
 * 6. Infinite loop
 *
 * The fix: Invalidate appliedOpIds cache when ConstraintError occurs, so
 * filterNewOps() re-reads from IndexedDB on next sync.
 *
 * Prerequisites:
 * - super-sync-server running on localhost:1901 with TEST_MODE=true
 * - Frontend running on localhost:4242
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-constraint-error-recovery.spec.ts
 */

test.describe('@supersync @recovery ConstraintError Recovery', () => {
  /**
   * Scenario: Sync recovers from partial batch failures without infinite loops
   *
   * This test exercises the sync cycle multiple times with two clients making
   * concurrent changes. The ConstraintError bug manifested when:
   * - Operations were partially written during one sync
   * - The cache wasn't invalidated
   * - Subsequent syncs kept trying to re-apply the same ops
   *
   * Setup:
   * - Client A and B share a SuperSync account
   *
   * Actions:
   * 1. Both clients create tasks
   * 2. Both clients sync multiple times (5+ cycles)
   *
   * Verify:
   * - All syncs complete within reasonable time (no infinite loops)
   * - Both clients converge to the same state
   * - No sync errors visible
   */
  test('Sync recovers from partial batch failures without infinite loops', async ({
    browser,
    baseURL,
    testRunId,
  }, testInfo) => {
    // Multiple sync cycles need extra time but should not be infinite
    testInfo.setTimeout(180000);
    const uniqueId = Date.now();
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // ============ PHASE 1: Setup both clients ============
      console.log('[ConstraintError] Phase 1: Setting up clients');

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      console.log('[ConstraintError] Both clients set up');

      // ============ PHASE 2: Initial tasks and sync ============
      console.log('[ConstraintError] Phase 2: Creating initial tasks');

      // Client A creates a task
      const taskA1 = `TaskA1-${uniqueId}`;
      await clientA.workView.addTask(taskA1);
      await clientA.sync.syncAndWait();
      console.log(`[ConstraintError] Client A created and synced: ${taskA1}`);

      // Client B syncs to get A's task
      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, taskA1);
      console.log('[ConstraintError] Client B received A task');

      // ============ PHASE 3: Concurrent changes and multiple sync cycles ============
      console.log('[ConstraintError] Phase 3: Multiple sync cycles');

      // Perform 5 sync cycles with interleaved changes
      // This pattern is most likely to trigger ConstraintError scenarios
      for (let cycle = 1; cycle <= 5; cycle++) {
        console.log(`[ConstraintError] Cycle ${cycle}/5`);

        // Client A makes a change
        const taskACycle = `TaskA-Cycle${cycle}-${uniqueId}`;
        await clientA.workView.addTask(taskACycle);
        await clientA.page.waitForTimeout(200);

        // Client B makes a change
        const taskBCycle = `TaskB-Cycle${cycle}-${uniqueId}`;
        await clientB.workView.addTask(taskBCycle);
        await clientB.page.waitForTimeout(200);

        // Both sync
        await clientA.sync.syncAndWait();
        await clientB.sync.syncAndWait();

        // Sync again to ensure both have all data
        await clientA.sync.syncAndWait();
        await clientB.sync.syncAndWait();

        console.log(`[ConstraintError] Cycle ${cycle} complete`);
      }

      // ============ PHASE 4: Verify convergence ============
      console.log('[ConstraintError] Phase 4: Verifying convergence');

      // Final sync to ensure complete convergence
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();

      // Count tasks on both clients
      const countA = await getTaskCount(clientA);
      const countB = await getTaskCount(clientB);

      console.log(`[ConstraintError] Task counts: A=${countA}, B=${countB}`);

      // Both clients should have the same number of tasks
      // Initial task (1) + 5 cycles * 2 tasks per cycle = 11 tasks
      expect(countA).toBe(countB);
      expect(countA).toBeGreaterThanOrEqual(11);

      // Verify no sync errors
      const hasErrorA = await clientA.sync.hasSyncError();
      const hasErrorB = await clientB.sync.hasSyncError();
      expect(hasErrorA).toBe(false);
      expect(hasErrorB).toBe(false);

      console.log('[ConstraintError] ✓ All syncs completed without infinite loops');
      console.log('[ConstraintError] ✓ Both clients converged to same state');
      console.log('[ConstraintError] ✓ ConstraintError recovery test PASSED!');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario: Multiple rapid syncs do not cause ConstraintError loops
   *
   * Tests that triggering sync multiple times in quick succession doesn't
   * cause the appliedOpIds cache issue.
   *
   * Setup:
   * - Client A creates multiple tasks quickly
   *
   * Actions:
   * 1. Client A creates 5 tasks rapidly
   * 2. Client A triggers sync 3 times in quick succession
   *
   * Verify:
   * - All syncs complete
   * - No infinite sync behavior
   * - Client B can join and receive all data
   */
  test('Multiple rapid syncs do not cause ConstraintError loops', async ({
    browser,
    baseURL,
    testRunId,
  }, testInfo) => {
    testInfo.setTimeout(120000);
    const uniqueId = Date.now();
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // ============ PHASE 1: Setup Client A ============
      console.log('[RapidSync] Phase 1: Setting up Client A');

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      // ============ PHASE 2: Create tasks quickly ============
      console.log('[RapidSync] Phase 2: Creating 5 tasks quickly');

      const taskNames: string[] = [];
      for (let i = 1; i <= 5; i++) {
        const taskName = `RapidTask${i}-${uniqueId}`;
        taskNames.push(taskName);
        await clientA.workView.addTask(taskName);
        // Small delay to ensure task is registered
        await clientA.page.waitForTimeout(100);
      }

      console.log('[RapidSync] Created 5 tasks');

      // ============ PHASE 3: Rapid sync triggers ============
      console.log('[RapidSync] Phase 3: Triggering 3 rapid syncs');

      // Trigger sync 3 times with only 500ms between them
      for (let i = 1; i <= 3; i++) {
        console.log(`[RapidSync] Sync trigger ${i}/3`);
        await clientA.sync.syncAndWait();
        await clientA.page.waitForTimeout(500);
      }

      console.log('[RapidSync] All rapid syncs completed');

      // ============ PHASE 4: Verify with Client B ============
      console.log('[RapidSync] Phase 4: Verifying with Client B');

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // Verify all tasks are present on Client B
      for (const taskName of taskNames) {
        await waitForTask(clientB.page, taskName);
      }

      const countA = await getTaskCount(clientA);
      const countB = await getTaskCount(clientB);

      expect(countA).toBe(5);
      expect(countB).toBe(5);

      // Verify no sync errors
      const hasErrorA = await clientA.sync.hasSyncError();
      const hasErrorB = await clientB.sync.hasSyncError();
      expect(hasErrorA).toBe(false);
      expect(hasErrorB).toBe(false);

      console.log('[RapidSync] ✓ Rapid sync test PASSED!');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario: Sync completes even after many concurrent operations
   *
   * Stress test to verify sync doesn't get stuck with many operations.
   *
   * Setup:
   * - Client A and B making many concurrent changes
   *
   * Actions:
   * 1. Both clients create 10 tasks each
   * 2. Both sync
   * 3. Both sync again
   *
   * Verify:
   * - All syncs complete
   * - Both clients have 20 tasks
   */
  test('Sync completes even after many concurrent operations', async ({
    browser,
    baseURL,
    testRunId,
  }, testInfo) => {
    testInfo.setTimeout(240000);
    const uniqueId = Date.now();
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // ============ PHASE 1: Setup both clients ============
      console.log('[StressSync] Phase 1: Setting up clients');

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // ============ PHASE 2: Create many tasks on both clients ============
      console.log('[StressSync] Phase 2: Creating 10 tasks on each client');

      // Client A creates 10 tasks
      for (let i = 1; i <= 10; i++) {
        await clientA.workView.addTask(`StressA${i}-${uniqueId}`);
      }

      // Client B creates 10 tasks
      for (let i = 1; i <= 10; i++) {
        await clientB.workView.addTask(`StressB${i}-${uniqueId}`);
      }

      console.log('[StressSync] 20 tasks created total');

      // ============ PHASE 3: Sync both clients ============
      console.log('[StressSync] Phase 3: Syncing both clients');

      // First sync round
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();

      // Second sync round to ensure full convergence
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();

      console.log('[StressSync] Both clients synced');

      // ============ PHASE 4: Verify convergence ============
      console.log('[StressSync] Phase 4: Verifying task counts');

      const countA = await getTaskCount(clientA);
      const countB = await getTaskCount(clientB);

      console.log(`[StressSync] Task counts: A=${countA}, B=${countB}`);

      expect(countA).toBe(20);
      expect(countB).toBe(20);

      // Verify no sync errors
      const hasErrorA = await clientA.sync.hasSyncError();
      const hasErrorB = await clientB.sync.hasSyncError();
      expect(hasErrorA).toBe(false);
      expect(hasErrorB).toBe(false);

      console.log('[StressSync] ✓ Stress sync test PASSED!');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});

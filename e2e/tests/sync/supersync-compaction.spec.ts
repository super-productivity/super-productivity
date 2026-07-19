import { test, expect } from '../../fixtures/supersync.fixture';
import type { Page } from '@playwright/test';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  markTaskDone,
  renameTask,
  type SimulatedE2EClient,
  SUPERSYNC_BASE_URL,
} from '../../utils/supersync-helpers';

/**
 * SuperSync Full-State Boundary Resilience E2E Tests
 *
 * Tests that a real full-state replacement doesn't break sync for existing or
 * new clients.
 *
 * Prerequisites:
 * - super-sync-server running on localhost:1901 with TEST_MODE=true
 * - Frontend running on localhost:4242
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-compaction.spec.ts
 */

interface ServerOperationSummary {
  id: string;
  opType: string;
  serverSeq: number;
}

const getServerOperations = async (userId: number): Promise<ServerOperationSummary[]> => {
  const response = await fetch(
    `${SUPERSYNC_BASE_URL}/api/test/user/${userId}/ops?limit=100`,
  );
  if (!response.ok) {
    throw new Error(
      `Failed to inspect server operations: ${response.status} ${await response.text()}`,
    );
  }
  const body = (await response.json()) as { ops: ServerOperationSummary[] };
  return body.ops;
};

const getTaskDoneStates = async (
  page: Page,
  taskNames: string[],
): Promise<Record<string, boolean>> =>
  page.evaluate((names) => {
    type TaskLike = { title?: string; isDone?: boolean };
    type StoreState = {
      task?: { entities?: Record<string, TaskLike | undefined> };
      tasks?: { entities?: Record<string, TaskLike | undefined> };
    };
    type StoreLike = {
      subscribe: (next: (state: StoreState) => void) => { unsubscribe: () => void };
    };
    const store = (window as unknown as { __e2eTestHelpers?: { store?: StoreLike } })
      .__e2eTestHelpers?.store;
    if (!store) {
      throw new Error('__e2eTestHelpers.store missing');
    }

    let latestState: StoreState | undefined;
    const subscription = store.subscribe((state) => {
      latestState = state;
    });
    subscription.unsubscribe();

    const taskEntities = [
      ...Object.values(latestState?.tasks?.entities ?? {}),
      ...Object.values(latestState?.task?.entities ?? {}),
    ];
    return names.reduce<Record<string, boolean>>((states, name) => {
      const task = taskEntities.find((candidate) => candidate?.title?.includes(name));
      if (task) {
        states[name] = task.isDone === true;
      }
      return states;
    }, {});
  }, taskNames);

test.describe('@supersync Full-State Boundary Resilience', () => {
  /**
   * Scenario: Heavy operations, full-state replacement, then new client joins
   *
   * This tests that after many operations and a full-state replacement, a new
   * client can still get complete state and bidirectional sync continues working.
   *
   * Flow:
   * 1. Client A creates 10+ tasks, marks some done, renames some
   * 2. Client A syncs
   * 3. Rotate encryption, which replaces the operation history with a real
   *    encrypted SYNC_IMPORT full-state boundary
   * 4. Client A creates more tasks after the boundary
   * 5. New Client B joins and syncs
   * 6. Verify B gets complete state (pre + post-boundary data)
   * 7. Bidirectional sync continues working
   */
  test('New client receives complete state after full-state replacement', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(180000);
    const appUrl = baseURL || 'http://localhost:4242';
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // ============ PHASE 1: Client A creates many tasks ============
      console.log('[Compaction] Phase 1: Client A creates many tasks');

      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      // Create 10 tasks
      const taskNames: string[] = [];
      for (let i = 1; i <= 10; i++) {
        const taskName = `CompTask-${i.toString().padStart(2, '0')}-${testRunId}`;
        taskNames.push(taskName);
        await clientA.workView.addTask(taskName);
      }
      console.log(`[Compaction] Created ${taskNames.length} tasks`);

      // Mark some tasks as done
      await markTaskDone(clientA, taskNames[0]);
      await markTaskDone(clientA, taskNames[1]);
      await markTaskDone(clientA, taskNames[2]);
      console.log('[Compaction] Marked 3 tasks as done');

      // Rename some tasks
      const renamedTask = `CompTask-Renamed-${testRunId}`;
      await renameTask(clientA, taskNames[4], renamedTask);
      taskNames[4] = renamedTask;
      console.log('[Compaction] Renamed 1 task');

      // Sync all operations
      await clientA.sync.syncAndWait();
      console.log('[Compaction] Client A synced all operations');

      // ============ PHASE 2: Create a real full-state boundary ============
      console.log('[Compaction] Phase 2: Creating full-state boundary');

      const operationsBeforeBoundary = await getServerOperations(user.userId);
      expect(operationsBeforeBoundary.length).toBeGreaterThan(1);
      const maxSeqBeforeBoundary = Math.max(
        ...operationsBeforeBoundary.map((op) => op.serverSeq),
      );

      const postBoundaryPassword = `post-boundary-${testRunId}`;
      await clientA.sync.changeEncryptionPassword(postBoundaryPassword);

      const operationsAtBoundary = await getServerOperations(user.userId);
      expect(operationsAtBoundary).toHaveLength(1);
      expect(operationsAtBoundary[0].opType).toBe('SYNC_IMPORT');
      expect(operationsAtBoundary[0].serverSeq).toBeGreaterThan(maxSeqBeforeBoundary);
      const boundarySeq = operationsAtBoundary[0].serverSeq;
      console.log(`[Compaction] Full-state boundary stored at serverSeq ${boundarySeq}`);

      // ============ PHASE 3: Client A creates more tasks after boundary ============
      console.log('[Compaction] Phase 3: Creating post-boundary tasks');

      const postSnapshotTask1 = `PostSnap-1-${testRunId}`;
      const postSnapshotTask2 = `PostSnap-2-${testRunId}`;
      await clientA.workView.addTask(postSnapshotTask1);
      await clientA.workView.addTask(postSnapshotTask2);

      await clientA.sync.syncAndWait();
      console.log('[Compaction] Client A synced post-boundary tasks');

      const operationsAfterBoundary = await getServerOperations(user.userId);
      expect(
        operationsAfterBoundary.some(
          (op) => op.opType === 'SYNC_IMPORT' && op.serverSeq === boundarySeq,
        ),
      ).toBe(true);
      expect(
        operationsAfterBoundary.filter((op) => op.serverSeq > boundarySeq).length,
      ).toBeGreaterThanOrEqual(2);
      expect(operationsAfterBoundary.every((op) => op.serverSeq >= boundarySeq)).toBe(
        true,
      );

      // ============ PHASE 4: New Client B joins ============
      console.log('[Compaction] Phase 4: New Client B joins');

      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.sync.setupSuperSync({
        ...syncConfig,
        password: postBoundaryPassword,
      });

      // Client B syncs to get all data
      await clientB.sync.syncAndWait();
      // Extra sync to ensure everything is received
      await clientB.sync.syncAndWait();
      console.log('[Compaction] Client B synced');

      // ============ PHASE 5: Verify B gets complete state ============
      console.log('[Compaction] Phase 5: Verifying Client B has complete state');

      const taskDoneStates = await getTaskDoneStates(clientB.page, taskNames);
      expect(Object.keys(taskDoneStates)).toHaveLength(taskNames.length);
      for (let i = 0; i < taskNames.length; i++) {
        expect(taskDoneStates[taskNames[i]]).toBe(i < 3);
      }

      // Check undone tasks are visible (first 3 were marked done)
      for (let i = 3; i < taskNames.length; i++) {
        await waitForTask(clientB.page, taskNames[i]);
      }

      // Check post-boundary tasks
      await waitForTask(clientB.page, postSnapshotTask1);
      await waitForTask(clientB.page, postSnapshotTask2);
      console.log('[Compaction] ✓ Client B received all expected tasks');

      // ============ PHASE 6: Verify bidirectional sync still works ============
      console.log('[Compaction] Phase 6: Verifying bidirectional sync');

      // Client B creates a task
      const taskFromB = `FromB-${testRunId}`;
      await clientB.workView.addTask(taskFromB);
      await clientB.sync.syncAndWait();
      console.log('[Compaction] Client B created and synced a task');

      // Client A syncs and should see B's task
      await clientA.sync.syncAndWait();
      await waitForTask(clientA.page, taskFromB);
      console.log("[Compaction] ✓ Client A received Client B's task");

      console.log('[Compaction] ✓ Full-state boundary resilience test PASSED!');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});

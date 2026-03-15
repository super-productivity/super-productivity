import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { expectTaskVisible } from '../../utils/supersync-assertions';

/**
 * SuperSync Late Join E2E Tests
 *
 * Scenarios where a client joins after the server already has data.
 *
 * NOTE: SYNC_IMPORT semantics mean that pre-existing local data on a late joiner
 * cannot be merged with server data. The late joiner must choose either
 * "Use Server Data" (loses local) or "Use My Data" (replaces server).
 * These tests verify the correct behavior after that choice, and that
 * subsequent operations sync normally.
 */

test.describe('@supersync SuperSync Late Join', () => {
  test('Late joiner adopts server data and then contributes new tasks', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // Client A: Syncs immediately, creates initial data
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      const taskA1 = `A1-${testRunId}`;
      const taskA2 = `A2-${testRunId}`;
      const taskA3 = `A3-${testRunId}`;
      await clientA.workView.addTask(taskA1);
      await clientA.workView.addTask(taskA2);
      await clientA.sync.syncAndWait();
      console.log('Client A synced initial tasks');

      // A creates more data (server moves ahead)
      await clientA.workView.addTask(taskA3);
      await clientA.sync.syncAndWait();
      console.log('Client A added more tasks and synced');

      // Client B: Late joiner - has pre-existing local data
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      const taskBLocal1 = `BLocal1-${testRunId}`;
      const taskBLocal2 = `BLocal2-${testRunId}`;
      await clientB.workView.addTask(taskBLocal1);
      await clientB.workView.addTask(taskBLocal2);
      console.log('Client B created local tasks before sync');

      // B enables sync - chooses "Use Server Data" (default).
      // B's pre-existing local tasks are lost (SYNC_IMPORT replaces state).
      console.log('Client B enabling sync (adopting server data)...');
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();
      console.log('Client B synced - adopted server data');

      // B should have A's tasks (server data)
      for (const task of [taskA1, taskA2, taskA3]) {
        await waitForTask(clientB.page, task);
        await expectTaskVisible(clientB, task);
      }
      console.log('Client B verified: has server tasks');

      // Now B creates NEW tasks after joining sync
      const taskBNew1 = `BNew1-${testRunId}`;
      const taskBNew2 = `BNew2-${testRunId}`;
      await clientB.workView.addTask(taskBNew1);
      await clientB.workView.addTask(taskBNew2);
      await clientB.sync.syncAndWait();
      console.log('Client B created new tasks and synced');

      // A syncs to get B's new tasks
      await clientA.sync.syncAndWait();
      await clientA.page.waitForTimeout(1000);

      // VERIFICATION: Both clients have A's tasks + B's new tasks
      const allTasks = [taskA1, taskA2, taskA3, taskBNew1, taskBNew2];

      console.log('Verifying all tasks on Client A');
      for (const task of allTasks) {
        await waitForTask(clientA.page, task);
        await expectTaskVisible(clientA, task);
      }

      console.log('Verifying all tasks on Client B');
      for (const task of allTasks) {
        await waitForTask(clientB.page, task);
        await expectTaskVisible(clientB, task);
      }
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Late joiner keeps local data (creates SYNC_IMPORT that replaces server).
   *
   * When a client with pre-existing data joins and chooses "Use My Data",
   * a new SYNC_IMPORT is created. The server state is replaced by the
   * late joiner's data. Other clients adopt this new state on next sync.
   */
  test('Late joiner keeps local data and replaces server data', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // Client A: Syncs first
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      const taskA1 = `A1-${testRunId}`;
      const taskA2 = `A2-${testRunId}`;
      await clientA.workView.addTask(taskA1);
      await clientA.workView.addTask(taskA2);
      await clientA.sync.syncAndWait();
      console.log('Client A synced initial tasks');

      // Client B: Has pre-existing local data
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      const taskB1 = `B1-${testRunId}`;
      const taskB2 = `B2-${testRunId}`;
      await clientB.workView.addTask(taskB1);
      await clientB.workView.addTask(taskB2);
      console.log('Client B created local tasks before sync');

      // B enables sync - chooses "Use My Data" (local).
      // B's SYNC_IMPORT replaces server data. A's tasks are lost.
      console.log('Client B enabling sync (keeping local data)...');
      await clientB.sync.setupSuperSync({ ...syncConfig, syncImportChoice: 'local' });
      await clientB.sync.syncAndWait({ useLocal: true });
      console.log('Client B synced - kept local data');

      // B should still have its own tasks
      for (const task of [taskB1, taskB2]) {
        await waitForTask(clientB.page, task);
        await expectTaskVisible(clientB, task);
      }

      // A syncs - adopts B's SYNC_IMPORT (A's tasks are lost)
      await clientA.sync.syncAndWait();
      await clientA.page.waitForTimeout(1000);

      // A should now have B's tasks
      console.log('Verifying Client A adopted B data');
      for (const task of [taskB1, taskB2]) {
        await waitForTask(clientA.page, task);
        await expectTaskVisible(clientA, task);
      }

      // Both clients should have the same task count
      const countA = await clientA.page.locator(`task:has-text("${testRunId}")`).count();
      const countB = await clientB.page.locator(`task:has-text("${testRunId}")`).count();
      expect(countA).toBe(countB);

      console.log('SUCCESS: Late joiner kept local data, other client adopted it');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});

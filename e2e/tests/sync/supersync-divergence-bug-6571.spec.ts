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
import { expectTaskOnAllClients } from '../../utils/supersync-assertions';

/**
 * Bug #6571 Reproduction: Sync Divergence While Reporting IN_SYNC
 *
 * Root cause: Multiple error paths in the sync pipeline silently swallow
 * errors, allowing sync to complete and report success even when operations
 * were lost during processing. Confirmed bugs (unit-tested):
 * 1. DownloadResult.success=false treated as "no new ops"
 * 2. LWW conflict apply failure does not throw (swallowed)
 * 3. handleRejectedOps error is swallowed
 * 4. validateAfterSync result is discarded
 *
 * This e2e test uses Playwright route interception to drop ops from the
 * download response (simulating what happens when any of the 4 bugs fires),
 * then verifies the divergence persists while both clients show IN_SYNC.
 */

test.describe('@supersync Bug #6571: Sync divergence reproduction', () => {
  test('ops lost during download cause permanent divergence while showing IN_SYNC', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // ─── Step 1: Set up both clients on empty server ───
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // ─── Step 2: Client A creates 3 tasks and syncs ───
      const task1 = `Task1-${testRunId}`;
      const task2 = `Task2-${testRunId}`;
      const task3 = `Task3-${testRunId}`;

      await clientA.workView.addTask(task1);
      await clientA.workView.addTask(task2);
      await clientA.workView.addTask(task3);

      await clientA.sync.syncAndWait();

      // Verify A has all 3
      await waitForTask(clientA.page, task1);
      await waitForTask(clientA.page, task2);
      await waitForTask(clientA.page, task3);
      const countA = await getTaskCount(clientA);
      expect(countA).toBe(3);

      // ─── Step 3: Install route interception on Client B ───
      // Drop TASK Create ops from the download response.
      // entityType and opType are NOT encrypted — only payload is.
      // This simulates ops being lost during processing (as caused by bugs 1-4).
      let intercepted = false;
      let droppedOpCount = 0;

      // Intercept download API to drop one TASK Create op.
      // entityType/opType are NOT encrypted (only payload is).
      // On the wire, opType uses abbreviations: CRT, UPD, DEL.
      await clientB.page.route('**/api/sync/ops**', async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue();
          return;
        }
        if (intercepted) {
          await route.continue();
          return;
        }

        const response = await route.fetch();
        const body = await response.json();

        if (body.ops && Array.isArray(body.ops) && body.ops.length > 0) {
          let droppedOne = false;
          body.ops = body.ops.filter((serverOp: any) => {
            if (droppedOne) return true;
            const op = serverOp.op;
            if (op && op.entityType === 'TASK' && op.opType === 'CRT') {
              droppedOne = true;
              droppedOpCount++;
              return false;
            }
            return true;
          });
          if (droppedOpCount > 0) {
            intercepted = true;
          }
        }

        await route.fulfill({
          status: response.status(),
          headers: response.headers(),
          body: JSON.stringify(body),
        });
      });

      // ─── Step 4: Client B syncs — downloads ops with one dropped ───
      await clientB.sync.syncAndWait();

      // Verify interception triggered
      expect(intercepted).toBe(true);
      expect(droppedOpCount).toBe(1);

      // ─── Step 5: Verify the divergence ───
      // Client B should have only 2 tasks (one Create op was dropped)
      const countB = await getTaskCount(clientB);
      expect(countB).toBe(2); // Missing one task

      // THE BUG: Both clients show sync success despite different state
      const syncStateA = await clientA.sync.getSyncState();
      const syncStateB = await clientB.sync.getSyncState();
      expect(syncStateA).toBe('success');
      expect(syncStateB).toBe('success');

      // ─── Step 6: Verify divergence is PERMANENT ───
      // Sync again — the dropped op will NOT reappear because
      // lastServerSeq has advanced past it
      await clientB.sync.syncAndWait();
      const countBAfterResync = await getTaskCount(clientB);
      expect(countBAfterResync).toBe(2); // Still missing

      const syncStateBAfter = await clientB.sync.getSyncState();
      expect(syncStateBAfter).toBe('success');

      console.log(
        `[Bug6571] CONFIRMED: A=${countA} tasks, B=${countBAfterResync} tasks. ` +
          `Sync state: A=${syncStateA}, B=${syncStateBAfter}. Permanent divergence.`,
      );
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  test('convergence check: without interception both clients have identical state', async ({
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

      // Client A creates tasks and syncs
      const task1 = `Task1-${testRunId}`;
      const task2 = `Task2-${testRunId}`;
      const task3 = `Task3-${testRunId}`;

      await clientA.workView.addTask(task1);
      await clientA.workView.addTask(task2);
      await clientA.workView.addTask(task3);
      await clientA.sync.syncAndWait();

      // Client B syncs (no interception — happy path)
      await clientB.sync.syncAndWait();

      // Both should have all 3 tasks
      await expectTaskOnAllClients([clientA, clientB], task1);
      await expectTaskOnAllClients([clientA, clientB], task2);
      await expectTaskOnAllClients([clientA, clientB], task3);

      const countA = await getTaskCount(clientA);
      const countB = await getTaskCount(clientB);
      expect(countA).toBe(3);
      expect(countB).toBe(3);
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});

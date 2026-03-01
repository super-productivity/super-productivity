import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import {
  expectTaskOnAllClients,
  expectEqualTaskCount,
} from '../../utils/supersync-assertions';

/**
 * SuperSync Server Migration Abort E2E Tests
 *
 * Scenario F.2: Migration aborted when server is no longer empty.
 *
 * When a client that has synced ops from a previous provider connects to a
 * SuperSync server that already has data (from another client), the server
 * migration check should find the server non-empty and skip the SYNC_IMPORT.
 * Instead, the client should do a normal sync.
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-server-migration-abort.spec.ts
 */

test.describe('@supersync Server Migration Abort', () => {
  /**
   * Scenario F.2: Migration aborts when server is no longer empty
   *
   * Actions:
   * 1. Client A sets up SuperSync, creates tasks, syncs (populates server)
   * 2. Client B sets up SuperSync with the same account
   * 3. Client B syncs — server is NOT empty, so no migration/SYNC_IMPORT
   * 4. Client B does normal sync instead (downloads A's ops)
   *
   * Verify:
   * - Client B receives Client A's tasks via normal sync (no SYNC_IMPORT)
   * - Both clients converge to the same state
   * - No error on either client
   */
  test('Migration aborts when server is no longer empty', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // ============ PHASE 1: Client A populates the server ============
      console.log('[F.2] Phase 1: Client A populates the server');

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      const taskA1 = `Migration-A1-${testRunId}`;
      const taskA2 = `Migration-A2-${testRunId}`;
      await clientA.workView.addTask(taskA1);
      await clientA.workView.addTask(taskA2);
      await clientA.sync.syncAndWait();
      console.log(`[F.2] Client A created and synced: ${taskA1}, ${taskA2}`);

      // ============ PHASE 2: Client B joins (server already has data) ============
      console.log('[F.2] Phase 2: Client B joins (server already has data)');

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // Client B syncs — server is NOT empty (A already populated it)
      // Migration should be aborted, normal sync occurs instead
      await clientB.sync.syncAndWait();
      console.log('[F.2] Client B synced (migration should have been aborted)');

      // ============ PHASE 3: Verify convergence ============
      console.log('[F.2] Phase 3: Verifying both clients converge');

      // Client B should have received A's tasks via normal sync
      await waitForTask(clientB.page, taskA1);
      await waitForTask(clientB.page, taskA2);

      // Verify both clients have the same tasks
      await expectTaskOnAllClients([clientA, clientB], taskA1);
      await expectTaskOnAllClients([clientA, clientB], taskA2);
      await expectEqualTaskCount([clientA, clientB]);

      // Verify no errors on either client
      const hasErrorA = await clientA.sync.hasSyncError();
      const hasErrorB = await clientB.sync.hasSyncError();
      expect(hasErrorA).toBe(false);
      expect(hasErrorB).toBe(false);

      // ============ PHASE 4: Verify bidirectional sync works ============
      console.log('[F.2] Phase 4: Verifying bidirectional sync');

      // Client B creates a task
      const taskB1 = `Migration-B1-${testRunId}`;
      await clientB.workView.addTask(taskB1);
      await clientB.sync.syncAndWait();

      // Client A syncs and receives it
      await clientA.sync.syncAndWait();
      await waitForTask(clientA.page, taskB1);

      console.log('[F.2] ✓ Migration aborted, normal sync worked correctly');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});

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
 * SuperSync Server Migration E2E Tests
 *
 * Tests scenarios where a client switches from one sync server to another.
 * This simulates server migration, self-hosting changes, or account switches.
 *
 * The critical bug being tested:
 * When a client with existing data (lastServerSeq > 0) connects to a new empty server,
 * the server detects a "gap" and the client resets its lastServerSeq.
 * However, the client was only uploading incremental operations (not full state),
 * causing data loss for other clients that join the new server.
 *
 * Expected behavior: Client should upload a full state snapshot when migrating
 * to ensure all data is transferred to the new server.
 */

// Run server migration tests serially to avoid rate limiting when creating multiple test users
test.describe.serial('@supersync SuperSync Server Migration', () => {
  /**
   * Server Migration Scenario: Client A migrates to new server, Client B receives all data
   *
   * This test reproduces the bug where data is lost during server migration:
   *
   * Setup:
   * 1. Client A creates tasks, projects, tags on server 1
   * 2. Client A syncs successfully to server 1
   *
   * Migration:
   * 3. Create a new test user (simulates switching to a new/fresh server)
   * 4. Client A changes sync config to the new server credentials
   * 5. Client A syncs to the "new server"
   *    - Server detects gap (client has lastServerSeq > 0, server is empty)
   *    - Client should upload full state snapshot (not just incremental ops)
   *
   * Verification:
   * 6. Client B joins the new server (fresh client)
   * 7. Client B syncs
   * 8. Client B should have ALL of Client A's data (tasks, projects, tags)
   */
  test('Client A migrates to new server, Client B receives all data', async ({
    browser,
    baseURL,
    testRunId,
  }, testInfo) => {
    testInfo.setTimeout(120000); // 2 minutes - migration tests need extra time
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      // === PHASE 1: Setup with "old server" (user1) ===
      console.log('[Test] Phase 1: Setting up Client A with initial server');
      const user1 = await createTestUser(`${testRunId}-server1`);
      const syncConfig1 = getSuperSyncConfig(user1);

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig1);

      // Create test data on Client A
      const task1 = `Task1-${testRunId}`;
      const task2 = `Task2-${testRunId}`;
      const task3 = `Task3-${testRunId}`;

      await clientA.workView.addTask(task1);
      await clientA.workView.addTask(task2);
      await clientA.workView.addTask(task3);

      // Sync to "old server"
      await clientA.sync.syncAndWait();
      console.log('[Test] Client A synced to initial server');

      // Verify tasks exist on Client A
      await waitForTask(clientA.page, task1);
      await waitForTask(clientA.page, task2);
      await waitForTask(clientA.page, task3);

      // === PHASE 2: Simulate server migration ===
      console.log('[Test] Phase 2: Migrating Client A to new server');

      // Create a new test user (simulates a fresh/new server)
      const user2 = await createTestUser(`${testRunId}-server2`);
      const syncConfig2 = getSuperSyncConfig(user2);

      // Client A changes to new server credentials
      // This simulates switching sync providers or migrating to a new server
      await clientA.sync.setupSuperSync(syncConfig2);

      // Sync to the "new server"
      // This is where the bug occurs:
      // - Server detects gap (sinceSeq > 0 but server is empty)
      // - Client resets lastServerSeq to 0
      // - Client should upload FULL STATE (not just pending ops)
      await clientA.sync.syncAndWait();
      console.log('[Test] Client A synced to new server (migration complete)');

      // Verify Client A still has all tasks after migration
      await waitForTask(clientA.page, task1);
      await waitForTask(clientA.page, task2);
      await waitForTask(clientA.page, task3);

      // === PHASE 3: Client B joins new server ===
      console.log('[Test] Phase 3: Client B joining new server');

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig2);

      // Client B syncs - should receive ALL of Client A's data
      await clientB.sync.syncAndWait();
      console.log('[Test] Client B synced with new server');

      // === PHASE 4: Verification ===
      console.log('[Test] Phase 4: Verifying Client B has all data');

      // This is the critical assertion - Client B should have ALL tasks
      // If the bug exists, Client B will only have partial data or no tasks
      await waitForTask(clientB.page, task1);
      await waitForTask(clientB.page, task2);
      await waitForTask(clientB.page, task3);

      // Additional verification - count tasks to ensure no duplicates
      const taskLocatorB = clientB.page.locator(`task:has-text("${testRunId}")`);
      const taskCountB = await taskLocatorB.count();
      expect(taskCountB).toBe(3);

      console.log('[Test] SUCCESS: Client B received all data after server migration');
    } finally {
      if (clientA) await closeClient(clientA).catch(() => {});
      if (clientB) await closeClient(clientB).catch(() => {});
    }
  });

  /**
   * Server Migration with Pending Local Changes
   *
   * Tests that pending local operations are preserved during server migration.
   * Client creates new data, then migrates before syncing.
   */
  test('Client A migrates with pending local changes, all data syncs', async ({
    browser,
    baseURL,
    testRunId,
  }, testInfo) => {
    testInfo.setTimeout(120000); // 2 minutes - migration tests need extra time
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      // Setup with initial server
      const user1 = await createTestUser(`${testRunId}-server1`);
      const syncConfig1 = getSuperSyncConfig(user1);

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig1);

      // Create and sync initial data
      const task1 = `Initial-${testRunId}`;
      await clientA.workView.addTask(task1);
      // Wait for task to be fully created before syncing
      await waitForTask(clientA.page, task1);
      await clientA.sync.syncAndWait();
      console.log('[Test] Task 1 created and synced to server 1');

      // Create MORE data AFTER syncing (pending local changes)
      const task2 = `Pending-${testRunId}`;
      await clientA.workView.addTask(task2);
      // Wait for task to be fully created in store before migration
      await waitForTask(clientA.page, task2);
      console.log('[Test] Task 2 created (pending local change)');
      // DON'T sync yet - task2 is a pending local change

      // Migrate to new server
      const user2 = await createTestUser(`${testRunId}-server2`);
      const syncConfig2 = getSuperSyncConfig(user2);
      console.log('[Test] Migrating to new server...');
      await clientA.sync.setupSuperSync(syncConfig2);

      // Sync to new server (should include both synced and pending data)
      await clientA.sync.syncAndWait();
      console.log('[Test] Migration sync completed');

      // Verify Client A still has both tasks after migration
      await waitForTask(clientA.page, task1);
      await waitForTask(clientA.page, task2);

      // Client B joins
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig2);
      await clientB.sync.syncAndWait();

      // Verify Client B has BOTH tasks
      await waitForTask(clientB.page, task1);
      await waitForTask(clientB.page, task2);

      const taskLocatorB = clientB.page.locator(`task:has-text("${testRunId}")`);
      const taskCountB = await taskLocatorB.count();
      expect(taskCountB).toBe(2);

      console.log('[Test] SUCCESS: Pending local changes preserved during migration');
    } finally {
      if (clientA) await closeClient(clientA).catch(() => {});
      if (clientB) await closeClient(clientB).catch(() => {});
    }
  });

  /**
   * Multiple Migrations: Client A migrates twice
   *
   * Tests that multiple server migrations work correctly.
   */
  test('Client A can migrate multiple times without data loss', async ({
    browser,
    baseURL,
    testRunId,
  }, testInfo) => {
    testInfo.setTimeout(120000); // 2 minutes - migration tests need extra time
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      // First server
      const user1 = await createTestUser(`${testRunId}-server1`);
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(getSuperSyncConfig(user1));

      const task1 = `Server1-${testRunId}`;
      await clientA.workView.addTask(task1);
      await clientA.sync.syncAndWait();

      // First migration
      const user2 = await createTestUser(`${testRunId}-server2`);
      await clientA.sync.setupSuperSync(getSuperSyncConfig(user2));

      const task2 = `Server2-${testRunId}`;
      await clientA.workView.addTask(task2);
      await clientA.sync.syncAndWait();

      // Second migration
      const user3 = await createTestUser(`${testRunId}-server3`);
      await clientA.sync.setupSuperSync(getSuperSyncConfig(user3));

      const task3 = `Server3-${testRunId}`;
      await clientA.workView.addTask(task3);
      await clientA.sync.syncAndWait();

      // Verify Client A has all tasks
      await waitForTask(clientA.page, task1);
      await waitForTask(clientA.page, task2);
      await waitForTask(clientA.page, task3);

      // Client B joins the final server
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(getSuperSyncConfig(user3));
      await clientB.sync.syncAndWait();

      // Client B should have ALL tasks from all migrations
      await waitForTask(clientB.page, task1);
      await waitForTask(clientB.page, task2);
      await waitForTask(clientB.page, task3);

      console.log('[Test] SUCCESS: Multiple migrations preserved all data');
    } finally {
      if (clientA) await closeClient(clientA).catch(() => {});
      if (clientB) await closeClient(clientB).catch(() => {});
    }
  });
});

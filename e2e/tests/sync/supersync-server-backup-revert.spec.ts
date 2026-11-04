import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  hasTask,
  renameTask,
  SUPERSYNC_BASE_URL,
  type SimulatedE2EClient,
  type TestUser,
} from '../../utils/supersync-helpers';
import { execSync } from 'child_process';
import { writeFileSync } from 'fs';

/** Default encryption password used by setupSuperSync's mandatory encryption dialog */
const ENCRYPTION_PASSWORD = 'e2e-default-encryption-pw';

/**
 * Get the current highest serverSeq for a user.
 */
const getLatestServerSeq = async (userId: number): Promise<number> => {
  const response = await fetch(
    `${SUPERSYNC_BASE_URL}/api/test/user/${userId}/ops?limit=1`,
  );
  if (!response.ok) {
    throw new Error(`Failed to get ops: ${response.status}`);
  }
  const data = await response.json();
  return data.ops.length > 0 ? data.ops[0].serverSeq : 0;
};

/**
 * Wipe all sync data for a user (keeps account active).
 * Simulates complete server data loss / fresh database restore.
 */
const wipeUserSyncData = async (token: string): Promise<void> => {
  const headers = new Headers();
  headers.set('Content-Type', 'application/json');
  headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(`${SUPERSYNC_BASE_URL}/api/sync/data`, {
    method: 'DELETE',
    headers,
    body: '{}',
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to wipe user data: ${response.status} - ${text}`);
  }
};

/**
 * Run a SQL command against the test database via docker compose exec.
 */
const runSql = (sql: string): string => {
  return execSync(
    'docker compose -f docker-compose.yaml exec -T db psql -U supersync supersync_db -t -A -c ' +
      JSON.stringify(sql),
    { encoding: 'utf-8', timeout: 10000 },
  ).trim();
};

/**
 * Wipe sync data for a user via direct SQL (simulates accounts-only restore).
 * Deletes operations, sync state, and devices — keeps the user account intact.
 */
const wipeSyncDataViaSql = (userId: number): void => {
  runSql(
    `BEGIN; ` +
      `DELETE FROM operations WHERE user_id = ${userId}; ` +
      `DELETE FROM user_sync_state WHERE user_id = ${userId}; ` +
      `DELETE FROM sync_devices WHERE user_id = ${userId}; ` +
      `COMMIT;`,
  );
};

/**
 * Tables that hold a user's sync data. All are keyed by `user_id`; the account
 * (`users`, `passkeys`) lives outside this set and is intentionally preserved.
 */
const USER_SYNC_TABLES = ['operations', 'user_sync_state', 'sync_devices'] as const;

/**
 * Snapshot a SINGLE user's sync data to a restorable SQL script and return its
 * host path.
 *
 * Replaces a previous full-database `pg_dump` + `DROP SCHEMA public CASCADE`
 * restore. That restore wiped EVERY user's rows on the shared test database;
 * under Playwright's `fullyParallel` execution other @supersync test files run
 * concurrently against the same Postgres, so the global restore reverted their
 * in-flight data mid-test — a cross-test data-loss flake (#7810).
 *
 * The generated script deletes the user's current rows and re-inserts the
 * snapshotted rows via COPY, all in one transaction scoped to this user. It
 * preserves exact values — including `user_sync_state.last_seq`, which the
 * `/ops-after` test route deletes and therefore cannot reproduce an exact
 * full-dump restore.
 */
const dumpUserData = (userId: number): string => {
  const dumpPath = `/tmp/supersync_e2e_userdump_${userId}_${Date.now()}.sql`;
  let script = 'BEGIN;\n';
  for (const table of USER_SYNC_TABLES) {
    script += `DELETE FROM ${table} WHERE user_id = ${userId};\n`;
  }
  for (const table of USER_SYNC_TABLES) {
    // COPY ... TO STDOUT emits the standard psql text format; piping it back
    // through COPY ... FROM STDIN below round-trips the rows exactly.
    const copyData = execSync(
      'docker compose -f docker-compose.yaml exec -T db psql -U supersync supersync_db -c ' +
        JSON.stringify(
          `COPY (SELECT * FROM ${table} WHERE user_id = ${userId}) TO STDOUT`,
        ),
      { encoding: 'utf-8', timeout: 30000 },
    );
    script += `COPY ${table} FROM STDIN;\n${copyData}\\.\n`;
  }
  script += 'COMMIT;\n';
  writeFileSync(dumpPath, script);
  return dumpPath;
};

/**
 * Restore a user's sync data from a snapshot created by dumpUserData().
 * Atomic (ON_ERROR_STOP aborts the transaction) and scoped to the snapshotted
 * user — it never touches other users' rows.
 *
 * The documented restore stops and restarts the server, which drops its
 * in-memory caches. The test server keeps running, so clear them explicitly:
 * otherwise the request-dedup cache answers a re-upload with the results of
 * the pre-restore upload and nothing is stored.
 */
const restoreUserData = async (dumpPath: string, userId: number): Promise<void> => {
  execSync(
    `cat ${dumpPath} | docker compose -f docker-compose.yaml exec -T db ` +
      `psql -U supersync supersync_db -v ON_ERROR_STOP=1`,
    {
      encoding: 'utf-8',
      timeout: 30000,
    },
  );
  const response = await fetch(
    `${SUPERSYNC_BASE_URL}/api/test/user/${userId}/clear-process-caches`,
    { method: 'POST' },
  );
  if (!response.ok) {
    throw new Error(`Failed to clear server caches: ${response.status}`);
  }
};

/**
 * Clean up a dump file.
 */
const cleanupDump = (dumpPath: string): void => {
  try {
    execSync(`rm -f ${dumpPath}`);
  } catch {
    // ignore cleanup errors
  }
};

/**
 * Simulate a partial server revert by deleting operations after a given serverSeq.
 */
const revertServerToSeq = async (userId: number, serverSeq: number): Promise<number> => {
  const response = await fetch(
    `${SUPERSYNC_BASE_URL}/api/test/user/${userId}/ops-after/${serverSeq}`,
    { method: 'DELETE' },
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to revert server: ${response.status} - ${text}`);
  }
  const data = await response.json();
  return data.deleted;
};

/**
 * SuperSync Server Backup Revert E2E Tests
 *
 * These tests verify client recovery when the server loses data,
 * simulating disaster recovery scenarios.
 *
 * Tested scenarios:
 * 1. Complete server data loss — client re-uploads full state via gap detection
 * 2. Partial server revert — client preserves local data, verifies server state
 * 3. Server restored from a backup — each device re-seeds the ops it lost
 *
 * Key mechanism: gap detection (sinceSeq > latestSeq) triggers client to
 * reset its sync position and re-download from seq 0. An empty server is
 * seeded with a full-state SYNC_IMPORT; a restored, non-empty one gets back
 * each device's own ops it no longer has (#11467).
 *
 * Prerequisites:
 * - super-sync-server running on localhost:1901 with TEST_MODE=true
 * - Frontend running on localhost:4242
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-server-backup-revert.spec.ts
 */

test.describe.serial('@supersync SuperSync Server Backup Revert', () => {
  /**
   * Scenario: Complete server data loss — single client recovers all data
   *
   * This simulates the most critical disaster scenario: the server database
   * is completely wiped (e.g., fresh pg_dump restore from before data existed).
   *
   * 1. Client A creates tasks and syncs
   * 2. Server data is completely wiped (account preserved)
   * 3. Client A syncs → gap detection fires, re-uploads full state
   * 4. New Client B joins → receives all data
   */
  test('Single client recovers data after complete server data loss', async ({
    browser,
    baseURL,
    testRunId,
  }, testInfo) => {
    testInfo.setTimeout(120000);
    const appUrl = baseURL || 'http://localhost:4242';
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;
    let user: TestUser | null = null;

    try {
      // 1. Setup: create user and client
      user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);
      console.log(`[DataLoss] Created user ${user.userId}`);

      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      // 2. Create tasks and sync
      const task1 = `Task1-${testRunId}`;
      const task2 = `Task2-${testRunId}`;
      await clientA.workView.addTask(task1);
      await clientA.workView.addTask(task2);
      await clientA.sync.syncAndWait();
      await waitForTask(clientA.page, task1);
      await waitForTask(clientA.page, task2);

      const seqBefore = await getLatestServerSeq(user.userId);
      console.log(`[DataLoss] Tasks synced, serverSeq=${seqBefore}`);
      expect(seqBefore).toBeGreaterThan(0);

      // 3. Simulate complete server data loss
      await wipeUserSyncData(user.token);
      const seqAfterWipe = await getLatestServerSeq(user.userId);
      console.log(`[DataLoss] Server wiped, serverSeq=${seqAfterWipe}`);
      expect(seqAfterWipe).toBe(0);

      // 4. Client A syncs → gap detection should fire and re-upload full state
      await clientA.sync.syncAndWait();
      console.log('[DataLoss] Client A re-synced after data loss');

      // Client A should still have both tasks locally
      expect(await hasTask(clientA.page, task1)).toBe(true);
      expect(await hasTask(clientA.page, task2)).toBe(true);

      // 5. New Client B joins → should receive all data from re-uploaded state
      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.sync.setupSuperSync({
        ...syncConfig,
        isEncryptionEnabled: true,
        password: ENCRYPTION_PASSWORD,
      });
      await clientB.sync.syncAndWait();

      await waitForTask(clientB.page, task1, 30000);
      await waitForTask(clientB.page, task2, 30000);
      console.log('[DataLoss] Client B received both tasks after data loss recovery');

      // Verify no duplicates
      const taskLocator = clientB.page.locator(`task:has-text("${testRunId}")`);
      const taskCount = await taskLocator.count();
      expect(taskCount).toBe(2);
      console.log(
        '[DataLoss] Test passed - single client recovery from complete data loss',
      );
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario: Partial server revert — client local data is preserved
   *
   * This simulates a partial backup restore where the server has older
   * but non-empty data (e.g., pg_dump from yesterday, missing today's ops).
   *
   * The `/ops-after` test route also deletes `user_sync_state`, including the
   * sequence counter, so the server reports itself empty while ops remain.
   * The client then tries a full-state re-upload that the server rejects with
   * 409 SYNC_IMPORT_EXISTS. A real restore keeps the counter consistent with
   * the ops and takes the re-seed path instead: see "Restored server" above
   * (#11467). This test only covers the client.
   *
   * What we verify:
   * - Client A preserves all local data after partial revert
   * - Client A can continue creating tasks locally
   */
  test('Client preserves local data after partial server revert', async ({
    browser,
    baseURL,
    testRunId,
  }, testInfo) => {
    testInfo.setTimeout(120000);
    const appUrl = baseURL || 'http://localhost:4242';
    let clientA: SimulatedE2EClient | null = null;
    let user: TestUser | null = null;

    try {
      // 1. Setup
      user = await createTestUser(`${testRunId}-partial`);
      const syncConfig = getSuperSyncConfig(user);
      console.log(`[Partial] Created user ${user.userId}`);

      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      // 2. Create first task and sync
      const task1 = `Before-${testRunId}`;
      await clientA.workView.addTask(task1);
      await clientA.sync.syncAndWait();
      await waitForTask(clientA.page, task1);
      console.log('[Partial] Task 1 synced');

      // 3. Record checkpoint
      const checkpoint = await getLatestServerSeq(user.userId);
      console.log(`[Partial] Checkpoint at serverSeq=${checkpoint}`);

      // 4. Create second task and sync
      const task2 = `After-${testRunId}`;
      await clientA.workView.addTask(task2);
      await clientA.sync.syncAndWait();
      await waitForTask(clientA.page, task2);

      const seqAfter = await getLatestServerSeq(user.userId);
      console.log(`[Partial] Task 2 synced, serverSeq=${seqAfter}`);
      expect(seqAfter).toBeGreaterThan(checkpoint);

      // 5. Simulate partial server revert
      const deleted = await revertServerToSeq(user.userId, checkpoint);
      console.log(
        `[Partial] Server reverted: deleted ${deleted} ops after seq ${checkpoint}`,
      );
      expect(deleted).toBeGreaterThan(0);

      // 6. Client A syncs — gap detection fires
      await clientA.sync.syncAndWait();
      console.log('[Partial] Client A re-synced after partial revert');

      // 7. Verify: Client A still has both tasks locally (no data loss on client)
      expect(await hasTask(clientA.page, task1)).toBe(true);
      expect(await hasTask(clientA.page, task2)).toBe(true);
      console.log('[Partial] Client A preserved both tasks locally');

      // 8. Verify: Client can continue working locally — create a new task
      const task3 = `NewAfterRevert-${testRunId}`;
      await clientA.workView.addTask(task3);
      await waitForTask(clientA.page, task3);
      console.log('[Partial] Client A can create new tasks after revert');

      // All 3 tasks should exist locally
      expect(await hasTask(clientA.page, task1)).toBe(true);
      expect(await hasTask(clientA.page, task2)).toBe(true);
      expect(await hasTask(clientA.page, task3)).toBe(true);

      const taskCount = await clientA.page
        .locator(`task:has-text("${testRunId}")`)
        .count();
      expect(taskCount).toBe(3);

      // NOTE: the route leaves ops without a sequence counter (see above), so
      // the client's full-state re-upload is rejected with SYNC_IMPORT_EXISTS
      // here. A real restore re-seeds instead ("Restored server" tests).
      console.log(
        '[Partial] Test passed - client preserved data and can continue working',
      );
    } finally {
      if (clientA) await closeClient(clientA);
    }
  });

  /**
   * Scenario: Server restored from a backup — every device re-seeds what it lost (#11467)
   *
   * Devices A and B each upload a task after the backup was taken. The server
   * is then restored from that backup, so both tasks are gone from it while
   * A and B still hold them as synced. On their next sync each device must
   * put its own lost ops back, so a fresh device C receives everything.
   * Before the fix the restored server never got them back and no error was
   * shown. Run in both sync orders: whichever device syncs first must not
   * keep the other from re-seeding.
   */
  for (const firstToSync of ['A', 'B'] as const) {
    test(`Restored server: both devices re-seed their lost ops (${firstToSync} syncs first)`, async ({
      browser,
      baseURL,
      testRunId,
    }, testInfo) => {
      testInfo.setTimeout(300000);
      const appUrl = baseURL || 'http://localhost:4242';
      let clientA: SimulatedE2EClient | null = null;
      let clientB: SimulatedE2EClient | null = null;
      let clientC: SimulatedE2EClient | null = null;
      let user: TestUser | null = null;
      let dumpPath: string | null = null;

      try {
        user = await createTestUser(`${testRunId}-reseed-${firstToSync}`);
        const syncConfig = getSuperSyncConfig(user);
        const joinConfig = {
          ...syncConfig,
          isEncryptionEnabled: true,
          password: ENCRYPTION_PASSWORD,
        };

        clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
        await clientA.sync.setupSuperSync(syncConfig);
        const taskBefore = `BeforeBackup-${testRunId}`;
        await clientA.workView.addTask(taskBefore);
        await clientA.sync.syncAndWait();

        clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
        await clientB.sync.setupSuperSync(joinConfig);
        await clientB.sync.syncAndWait();
        await waitForTask(clientB.page, taskBefore, 30000);

        // The operator's backup.
        dumpPath = dumpUserData(user.userId);
        const seqAtDump = await getLatestServerSeq(user.userId);

        // Both devices upload after the backup and see each other's task.
        const taskA = `LostFromA-${testRunId}`;
        const taskB = `LostFromB-${testRunId}`;
        await clientA.workView.addTask(taskA);
        await clientA.sync.syncAndWait();
        await clientB.sync.syncAndWait();
        await waitForTask(clientB.page, taskA, 30000);
        await clientB.workView.addTask(taskB);
        await clientB.sync.syncAndWait();
        await clientA.sync.syncAndWait();
        await waitForTask(clientA.page, taskB, 30000);

        // Both devices also edit the same pre-backup task, B after seeing A's
        // edit. With B syncing first after the restore, A's re-sent rename
        // meets B's newer one on the server and must lose to it.
        const renamedByA = `RenamedByA-${testRunId}`;
        const renamedByB = `RenamedByB-${testRunId}`;
        await renameTask(clientA, taskBefore, renamedByA);
        await clientA.sync.syncAndWait();
        await clientB.sync.syncAndWait();
        await waitForTask(clientB.page, renamedByA, 30000);
        await renameTask(clientB, renamedByA, renamedByB);
        await clientB.sync.syncAndWait();
        await clientA.sync.syncAndWait();
        await waitForTask(clientA.page, renamedByB, 30000);
        expect(await getLatestServerSeq(user.userId)).toBeGreaterThan(seqAtDump);

        // The operator restores the backup: both tasks are gone from the server.
        await restoreUserData(dumpPath, user.userId);
        expect(await getLatestServerSeq(user.userId)).toBe(seqAtDump);

        const [first, second] =
          firstToSync === 'A' ? [clientA, clientB] : [clientB, clientA];
        await first.sync.syncAndWait();
        const seqAfterFirst = await getLatestServerSeq(user.userId);
        expect(seqAfterFirst).toBeGreaterThan(seqAtDump);
        await second.sync.syncAndWait();
        const seqAfterSecond = await getLatestServerSeq(user.userId);
        expect(seqAfterSecond).toBeGreaterThan(seqAfterFirst);

        // Re-seeding happens once: further syncs upload nothing.
        await first.sync.syncAndWait();
        await second.sync.syncAndWait();
        expect(await getLatestServerSeq(user.userId)).toBe(seqAfterSecond);

        clientC = await createSimulatedClient(browser, appUrl, 'C', testRunId);
        await clientC.sync.setupSuperSync(joinConfig);
        await clientC.sync.syncAndWait();
        for (const title of [renamedByB, taskA, taskB]) {
          await waitForTask(clientC.page, title, 30000);
        }

        // Every device holds exactly the three tasks with B's later rename:
        // nothing lost, nothing doubled, all converged.
        for (const client of [clientA, clientB, clientC]) {
          await waitForTask(client.page, renamedByB, 30000);
          expect(await hasTask(client.page, renamedByA)).toBe(false);
          await expect(client.page.locator(`task:has-text("${testRunId}")`)).toHaveCount(
            3,
          );
        }
      } finally {
        if (dumpPath) cleanupDump(dumpPath);
        if (clientA) await closeClient(clientA);
        if (clientB) await closeClient(clientB);
        if (clientC) await closeClient(clientC);
      }
    });
  }

  /**
   * Scenario: Accounts-only restore — wipe sync data, clients re-upload
   *
   * This is the recommended disaster recovery approach:
   * 1. Restore only user accounts from backup (users + passkeys tables)
   * 2. Sync data (operations, snapshots) is empty
   * 3. Clients reconnect, detect empty server, re-upload full state
   * 4. New clients can join and receive all data
   *
   * Each device re-uploads its whole state, so nothing depends on which
   * devices come back after the restore. This produces a clean, consistent
   * server state.
   */
  test('Accounts-only restore: wipe sync data, two clients re-sync cleanly', async ({
    browser,
    baseURL,
    testRunId,
  }, testInfo) => {
    testInfo.setTimeout(180000);
    const appUrl = baseURL || 'http://localhost:4242';
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;
    let clientC: SimulatedE2EClient | null = null;
    let user: TestUser | null = null;

    try {
      // 1. Setup: two clients syncing data
      user = await createTestUser(`${testRunId}-acct`);
      const syncConfig = getSuperSyncConfig(user);
      console.log(`[AcctRestore] Created user ${user.userId}`);

      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      const task1 = `FromA-${testRunId}`;
      await clientA.workView.addTask(task1);
      await clientA.sync.syncAndWait();
      await waitForTask(clientA.page, task1);
      console.log('[AcctRestore] Client A synced Task 1');

      // Client B joins and adds its own task
      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.sync.setupSuperSync({
        ...syncConfig,
        isEncryptionEnabled: true,
        password: ENCRYPTION_PASSWORD,
      });
      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, task1, 30000);

      const task2 = `FromB-${testRunId}`;
      await clientB.workView.addTask(task2);
      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, task2);
      console.log('[AcctRestore] Client B synced Task 2');

      // Client A syncs to get Task 2
      await clientA.sync.syncAndWait();
      await waitForTask(clientA.page, task2, 30000);
      console.log('[AcctRestore] Both clients have both tasks');

      // 2. Simulate accounts-only restore: wipe all sync data
      await wipeUserSyncData(user.token);
      const seqAfterWipe = await getLatestServerSeq(user.userId);
      expect(seqAfterWipe).toBe(0);
      console.log('[AcctRestore] Server sync data wiped (account preserved)');

      // 3. Client A re-syncs — gap detection, re-uploads full state
      await clientA.sync.syncAndWait();
      console.log('[AcctRestore] Client A re-synced after wipe');

      // 4. Client B re-syncs — picks up Client A's re-uploaded data
      await clientB.sync.syncAndWait();
      console.log('[AcctRestore] Client B re-synced after wipe');

      // 5. Both clients should have both tasks
      expect(await hasTask(clientA.page, task1)).toBe(true);
      expect(await hasTask(clientA.page, task2)).toBe(true);
      expect(await hasTask(clientB.page, task1)).toBe(true);
      expect(await hasTask(clientB.page, task2)).toBe(true);
      console.log('[AcctRestore] Both clients preserved both tasks');

      // 6. New Client C joins — should receive everything
      clientC = await createSimulatedClient(browser, appUrl, 'C', testRunId);
      await clientC.sync.setupSuperSync({
        ...syncConfig,
        isEncryptionEnabled: true,
        password: ENCRYPTION_PASSWORD,
      });
      await clientC.sync.syncAndWait();

      await waitForTask(clientC.page, task1, 30000);
      await waitForTask(clientC.page, task2, 30000);
      console.log('[AcctRestore] Client C received all data');

      // Verify no duplicates on any client
      const countA = await clientA.page.locator(`task:has-text("${testRunId}")`).count();
      const countB = await clientB.page.locator(`task:has-text("${testRunId}")`).count();
      const countC = await clientC.page.locator(`task:has-text("${testRunId}")`).count();
      expect(countA).toBe(2);
      expect(countB).toBe(2);
      expect(countC).toBe(2);

      console.log(
        '[AcctRestore] Test passed - accounts-only restore with multi-client recovery',
      );
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
      if (clientC) await closeClient(clientC);
    }
  });

  /**
   * Scenario: Accounts-only restore via direct SQL
   *
   * Tests the actual documented recovery procedure: wipe sync tables via SQL
   * (as would happen with a pg_dump restore of only users + passkeys tables).
   * Verifies this produces the same clean recovery as the API-based wipe.
   */
  test('Accounts-only restore via SQL wipe: client re-uploads cleanly', async ({
    browser,
    baseURL,
    testRunId,
  }, testInfo) => {
    testInfo.setTimeout(120000);
    const appUrl = baseURL || 'http://localhost:4242';
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;
    let user: TestUser | null = null;

    try {
      // 1. Setup: create user and sync data
      user = await createTestUser(`${testRunId}-sql`);
      const syncConfig = getSuperSyncConfig(user);
      console.log(`[SQL-Restore] Created user ${user.userId}`);

      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      const task1 = `SqlTask1-${testRunId}`;
      const task2 = `SqlTask2-${testRunId}`;
      await clientA.workView.addTask(task1);
      await clientA.workView.addTask(task2);
      await clientA.sync.syncAndWait();
      await waitForTask(clientA.page, task1);
      await waitForTask(clientA.page, task2);

      // Verify data is on server
      const seqBefore = await getLatestServerSeq(user.userId);
      expect(seqBefore).toBeGreaterThan(0);
      console.log(`[SQL-Restore] Data synced, serverSeq=${seqBefore}`);

      // 2. Wipe sync tables via direct SQL (simulates accounts-only restore)
      wipeSyncDataViaSql(user.userId);
      const seqAfterWipe = await getLatestServerSeq(user.userId);
      expect(seqAfterWipe).toBe(0);
      console.log('[SQL-Restore] Sync tables wiped via SQL');

      // 3. Client A re-syncs — gap detection, re-upload
      await clientA.sync.syncAndWait();
      console.log('[SQL-Restore] Client A re-synced');

      // 4. Fresh client joins — should receive all data
      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.sync.setupSuperSync({
        ...syncConfig,
        isEncryptionEnabled: true,
        password: ENCRYPTION_PASSWORD,
      });
      await clientB.sync.syncAndWait();

      await waitForTask(clientB.page, task1, 30000);
      await waitForTask(clientB.page, task2, 30000);

      const countB = await clientB.page.locator(`task:has-text("${testRunId}")`).count();
      expect(countB).toBe(2);
      console.log('[SQL-Restore] Test passed - SQL wipe recovery works');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario: Full dump restore, then Reset Account
   *
   * 1. Restore full dump (server is reverted to the backup point)
   * 2. Client syncs: it re-seeds the ops the restore lost (#11467)
   * 3. Use "Reset Account" (DELETE /api/sync/data) to clear server sync data
   * 4. Client re-syncs cleanly and re-uploads its full state
   *
   * Reset Account is no longer needed after a restore; this keeps it working
   * as the clean-slate fallback.
   */
  test('Full dump restore: client re-seeds, Reset Account still recovers', async ({
    browser,
    baseURL,
    testRunId,
  }, testInfo) => {
    testInfo.setTimeout(180000);
    const appUrl = baseURL || 'http://localhost:4242';
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;
    let user: TestUser | null = null;
    let dumpPath: string | null = null;

    try {
      // 1. Setup
      user = await createTestUser(`${testRunId}-fullrestore`);
      const syncConfig = getSuperSyncConfig(user);
      console.log(`[FullRestore] Created user ${user.userId}`);

      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      const task1 = `Early-${testRunId}`;
      await clientA.workView.addTask(task1);
      await clientA.sync.syncAndWait();
      await waitForTask(clientA.page, task1);
      console.log('[FullRestore] Task 1 synced');

      // 2. Snapshot this user's sync data (this is our "backup")
      dumpPath = dumpUserData(user.userId);
      const seqAtDump = await getLatestServerSeq(user.userId);
      console.log(`[FullRestore] User data snapshot created at ${dumpPath}`);

      // 3. Add more data after the backup
      const task2 = `Late-${testRunId}`;
      await clientA.workView.addTask(task2);
      await clientA.sync.syncAndWait();
      await waitForTask(clientA.page, task2);
      const seqWithTask2 = await getLatestServerSeq(user.userId);
      expect(seqWithTask2).toBeGreaterThan(seqAtDump);
      console.log('[FullRestore] Task 2 synced (after backup)');

      // 4. Simulate disaster: restore this user's data from the snapshot
      await restoreUserData(dumpPath, user.userId);
      console.log('[FullRestore] User data restored from snapshot');

      // The restore must really have reverted the server: every op written
      // after the dump (task2's ops, which are encrypted so can't be read by
      // title) is gone. Without this the steps below prove nothing about
      // recovering from a restore.
      expect(await getLatestServerSeq(user.userId)).toBe(seqAtDump);

      // 5. Client A syncs against the restored server and re-seeds task2.
      await clientA.sync.syncAndWait();
      expect(await getLatestServerSeq(user.userId)).toBeGreaterThan(seqAtDump);
      console.log('[FullRestore] Client A synced against the restored server');

      // Client A still has both tasks locally
      expect(await hasTask(clientA.page, task1)).toBe(true);
      expect(await hasTask(clientA.page, task2)).toBe(true);

      // 6. Reset Account to clear stale sync state
      await wipeUserSyncData(user.token);
      console.log('[FullRestore] Account sync data reset');

      // 7. Client A re-syncs — should now work cleanly
      await clientA.sync.syncAndWait();
      console.log('[FullRestore] Client A re-synced after reset');

      // 8. Fresh client joins — should receive all data
      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.sync.setupSuperSync({
        ...syncConfig,
        isEncryptionEnabled: true,
        password: ENCRYPTION_PASSWORD,
      });
      await clientB.sync.syncAndWait();

      await waitForTask(clientB.page, task1, 30000);
      await waitForTask(clientB.page, task2, 30000);

      const countB = await clientB.page.locator(`task:has-text("${testRunId}")`).count();
      expect(countB).toBe(2);
      console.log('[FullRestore] Test passed - full restore + reset recovery works');
    } finally {
      if (dumpPath) cleanupDump(dumpPath);
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario: All clients lost — fresh client downloads from restored server
   *
   * Tests the last-resort scenario: all client devices are gone, and the
   * full database backup is the only copy of the data. A fresh client
   * connects and should receive everything from the server.
   */
  test('All clients lost: fresh client downloads from full dump restore', async ({
    browser,
    baseURL,
    testRunId,
  }, testInfo) => {
    testInfo.setTimeout(180000);
    const appUrl = baseURL || 'http://localhost:4242';
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;
    let user: TestUser | null = null;
    let dumpPath: string | null = null;

    try {
      // 1. Setup: create user, sync data
      user = await createTestUser(`${testRunId}-allgone`);
      const syncConfig = getSuperSyncConfig(user);
      console.log(`[AllLost] Created user ${user.userId}`);

      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      const task1 = `Important1-${testRunId}`;
      const task2 = `Important2-${testRunId}`;
      const task3 = `Important3-${testRunId}`;
      await clientA.workView.addTask(task1);
      await clientA.workView.addTask(task2);
      await clientA.workView.addTask(task3);
      await clientA.sync.syncAndWait();
      await waitForTask(clientA.page, task1);
      await waitForTask(clientA.page, task2);
      await waitForTask(clientA.page, task3);
      console.log('[AllLost] All tasks synced to server');

      // 2. Snapshot this user's sync data
      dumpPath = dumpUserData(user.userId);
      console.log(`[AllLost] User data snapshot created at ${dumpPath}`);

      // 3. Close client A — simulates losing all devices
      await closeClient(clientA);
      clientA = null;
      console.log('[AllLost] Client A closed (all devices lost)');

      // 4. Simulate disaster: restore this user's data from the snapshot
      await restoreUserData(dumpPath, user.userId);
      console.log('[AllLost] User data restored from snapshot');

      // 5. Fresh client B connects — should download everything
      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.sync.setupSuperSync({
        ...syncConfig,
        isEncryptionEnabled: true,
        password: ENCRYPTION_PASSWORD,
      });
      await clientB.sync.syncAndWait();

      await waitForTask(clientB.page, task1, 30000);
      await waitForTask(clientB.page, task2, 30000);
      await waitForTask(clientB.page, task3, 30000);

      const countB = await clientB.page.locator(`task:has-text("${testRunId}")`).count();
      expect(countB).toBe(3);
      console.log('[AllLost] Test passed - fresh client recovered all data from dump');
    } finally {
      if (dumpPath) cleanupDump(dumpPath);
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});

import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  renameTask,
  markTaskDone,
  getTaskTitleFromState,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import {
  createdTitle,
  getStoreTaskByTitle,
  getStoreTitlesContaining,
  holdFirstUpload,
  recordSyncTraffic,
  type SyncTraffic,
} from '../../utils/audit-concurrency-helpers';

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
 * A sync downloads before it uploads, so an ordinary "A syncs, then B syncs"
 * never reaches the server rejection: B learns A's op from the download and
 * resolves it locally. Every test here therefore holds the losing upload
 * (B's first POST) while the other client uploads its conflicting edit, then
 * releases it, and asserts that the server rejected it (CONFLICT_CONCURRENT),
 * that the client's re-uploads stay bounded, and the exact converged value.
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-encryption-conflict.spec.ts
 */

/** Ops uploads the rejected client may need: the rejected batch, a re-upload, slack. */
const MAX_POSTS_PER_CONFLICT_SYNC = 4;

/**
 * Syncs `loser` with its first upload held until every `winners` client has
 * synced, so the server rejects the held upload as CONFLICT_CONCURRENT.
 */
const syncWithServerConflict = async (
  loser: SimulatedE2EClient,
  winners: SimulatedE2EClient[],
  traffic: SyncTraffic,
): Promise<void> => {
  const postsBefore = traffic.posts[loser.clientName];
  const hold = await holdFirstUpload(loser, async () => {
    for (const winner of winners) await winner.sync.syncAndWait();
  });
  await loser.sync.syncAndWait();
  await hold.finish();
  await expect
    .poll(() => traffic.rejections)
    .toContain(`${loser.clientName}:CONFLICT_CONCURRENT`);
  expect(traffic.posts[loser.clientName] - postsBefore).toBeLessThanOrEqual(
    MAX_POSTS_PER_CONFLICT_SYNC,
  );
};

const setupEncryptedClients = async (
  browser: Parameters<typeof createSimulatedClient>[0],
  baseURL: string,
  testRunId: string,
  password: string,
  names: string[],
): Promise<SimulatedE2EClient[]> => {
  const user = await createTestUser(testRunId);
  const syncConfig = {
    ...getSuperSyncConfig(user),
    isEncryptionEnabled: true,
    password,
  };
  const clients: SimulatedE2EClient[] = [];
  for (const name of names) {
    const client = await createSimulatedClient(browser, baseURL, name, testRunId);
    clients.push(client);
    await client.sync.setupSuperSync(syncConfig);
  }
  for (const client of clients) await client.sync.syncAndWait();
  return clients;
};

test.describe('@supersync @encryption Encryption + Conflict Resolution', () => {
  /**
   * Regression test: a rejected encrypted upload whose edit wins LWW converges
   *
   * 1. A creates a task; B downloads it
   * 2. A renames it (earlier), B renames it (later)
   * 3. B syncs with its upload held until A uploaded: the server rejects B
   * 4. B's later title wins LWW: its local-win op must dominate the server's
   *    entity clock (existingClock) and be accepted within bounded uploads
   * 5. Both clients hold B's title; A's title is gone
   */
  test('Concurrent modifications with encryption resolve without infinite loop (regression)', async ({
    browser,
    baseURL,
    testRunId,
    serverHealthy,
  }) => {
    void serverHealthy;
    const clients: SimulatedE2EClient[] = [];

    try {
      clients.push(
        ...(await setupEncryptedClients(
          browser,
          baseURL!,
          testRunId,
          `conflict-test-${testRunId}`,
          ['A', 'B'],
        )),
      );
      const [clientA, clientB] = clients;
      const traffic = recordSyncTraffic(clients);

      const taskName = `EncryptedConflictTask-${testRunId}`;
      const titleA = `${taskName}-A`;
      const titleB = `${taskName}-B`;
      await clientA.workView.addTask(taskName);
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, taskName);

      await renameTask(clientA, taskName, titleA);
      await clientB.page.waitForTimeout(1000);
      await renameTask(clientB, taskName, titleB);

      await syncWithServerConflict(clientB, [clientA], traffic);
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();

      for (const client of clients) {
        await expect.poll(() => getTaskTitleFromState(client, titleB)).toBe(titleB);
        expect(await getTaskTitleFromState(client, titleA)).toBeNull();
        expect(await getStoreTitlesContaining(client, taskName)).toEqual([titleB]);
        expect(await client.sync.hasSyncError()).toBe(false);
      }
      test.info().annotations.push({
        type: 'server rejections',
        description: traffic.rejections.join(', '),
      });
    } finally {
      for (const client of clients) await closeClient(client);
    }
  });

  /**
   * Multiple tasks with concurrent edits and encryption converge
   *
   * A marks task1 done; B, later, marks task1 and task2 done. B's upload is
   * held until A uploaded, so the server rejects B's task1 op. Exactly task1
   * and task2 end done, task3 stays open, and no task is lost or duplicated.
   */
  test('Multiple tasks with concurrent edits and encryption converge', async ({
    browser,
    baseURL,
    testRunId,
    serverHealthy,
  }) => {
    void serverHealthy;
    const clients: SimulatedE2EClient[] = [];

    try {
      clients.push(
        ...(await setupEncryptedClients(
          browser,
          baseURL!,
          testRunId,
          `multi-task-${testRunId}`,
          ['A', 'B'],
        )),
      );
      const [clientA, clientB] = clients;
      const traffic = recordSyncTraffic(clients);

      const task1 = `Task1-${testRunId}`;
      const task2 = `Task2-${testRunId}`;
      const task3 = `Task3-${testRunId}`;
      for (const task of [task1, task2, task3]) {
        await clientA.workView.addTask(task);
        await waitForTask(clientA.page, task);
      }
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      for (const task of [task1, task2, task3]) await waitForTask(clientB.page, task);

      const [stored1, stored2, stored3] = [task1, task2, task3].map((name) =>
        createdTitle('A', testRunId, name),
      );
      await markTaskDone(clientA, task1);
      await clientB.page.waitForTimeout(500);
      await markTaskDone(clientB, task1);
      await markTaskDone(clientB, task2);

      await syncWithServerConflict(clientB, [clientA], traffic);
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();

      for (const client of clients) {
        expect(await getStoreTitlesContaining(client, testRunId)).toEqual(
          [stored1, stored2, stored3].sort(),
        );
        await expect
          .poll(async () => (await getStoreTaskByTitle(client, stored1))?.isDone)
          .toBe(true);
        expect((await getStoreTaskByTitle(client, stored2))?.isDone).toBe(true);
        expect((await getStoreTaskByTitle(client, stored3))?.isDone).toBe(false);
        expect(await client.sync.hasSyncError()).toBe(false);
      }
    } finally {
      for (const client of clients) await closeClient(client);
    }
  });

  /**
   * Title edit conflict with encryption: the earlier write is the rejected one
   *
   * A renames first, B later. A's upload is held until B uploaded, so the
   * server rejects A's op, and A's earlier title loses LWW to B's title.
   */
  test('Title edit conflict with encryption resolves correctly', async ({
    browser,
    baseURL,
    testRunId,
    serverHealthy,
  }) => {
    void serverHealthy;
    const clients: SimulatedE2EClient[] = [];

    try {
      clients.push(
        ...(await setupEncryptedClients(
          browser,
          baseURL!,
          testRunId,
          `title-conflict-${testRunId}`,
          ['A', 'B'],
        )),
      );
      const [clientA, clientB] = clients;
      const traffic = recordSyncTraffic(clients);

      const originalTitle = `TitleConflict-${testRunId}`;
      const titleA = `A-Edited-${testRunId}`;
      const titleB = `B-Edited-${testRunId}`;
      await clientA.workView.addTask(originalTitle);
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, originalTitle);

      await renameTask(clientA, originalTitle, titleA);
      await clientB.page.waitForTimeout(1000);
      await renameTask(clientB, originalTitle, titleB);

      // Positive control: each client holds its own title before syncing.
      expect(await getTaskTitleFromState(clientA, titleA)).toBe(titleA);
      expect(await getTaskTitleFromState(clientB, titleB)).toBe(titleB);

      await syncWithServerConflict(clientA, [clientB], traffic);
      await clientB.sync.syncAndWait();
      await clientA.sync.syncAndWait();

      // B's title wins (later timestamp); A's title is gone everywhere.
      for (const client of clients) {
        await expect.poll(() => getTaskTitleFromState(client, titleB)).toBe(titleB);
        expect(await getTaskTitleFromState(client, titleA)).toBeNull();
        // The original (prefixed) title is gone as well.
        expect(await getStoreTitlesContaining(client, originalTitle)).toEqual([]);
        expect(await client.sync.hasSyncError()).toBe(false);
      }
    } finally {
      for (const client of clients) await closeClient(client);
    }
  });

  /**
   * Three clients with encryption converge on the latest write
   *
   * A, B and C rename the same task about 1 s apart (C latest). C's upload is
   * held until A and B uploaded, so the server rejects C's op; C's title must
   * still win and reach every client.
   */
  test('Three clients with encryption converge correctly', async ({
    browser,
    baseURL,
    testRunId,
    serverHealthy,
  }) => {
    void serverHealthy;
    const clients: SimulatedE2EClient[] = [];

    try {
      clients.push(
        ...(await setupEncryptedClients(
          browser,
          baseURL!,
          testRunId,
          `three-way-${testRunId}`,
          ['A', 'B', 'C'],
        )),
      );
      const [clientA, clientB, clientC] = clients;
      const traffic = recordSyncTraffic(clients);

      const taskName = `ThreeWayTask-${testRunId}`;
      await clientA.workView.addTask(taskName);
      await clientA.sync.syncAndWait();
      for (const client of [clientB, clientC]) {
        await client.sync.syncAndWait();
        await waitForTask(client.page, taskName);
      }

      const titles = clients.map((client) => `${taskName}-${client.clientName}`);
      for (const [i, client] of clients.entries()) {
        if (i > 0) await client.page.waitForTimeout(1000);
        await renameTask(client, taskName, titles[i]);
      }

      await syncWithServerConflict(clientC, [clientA, clientB], traffic);
      for (const client of clients) await client.sync.syncAndWait();

      for (const client of clients) {
        await expect.poll(() => getTaskTitleFromState(client, titles[2])).toBe(titles[2]);
        expect(await getTaskTitleFromState(client, titles[0])).toBeNull();
        expect(await getTaskTitleFromState(client, titles[1])).toBeNull();
        expect(await getStoreTitlesContaining(client, taskName)).toEqual([titles[2]]);
        expect(await client.sync.hasSyncError()).toBe(false);
      }
    } finally {
      for (const client of clients) await closeClient(client);
    }
  });
});

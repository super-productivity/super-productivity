import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  deleteTask,
  renameTask,
  recordTaskTimeDelta,
  getTaskTitleFromState,
  getTaskTimeSpentFromState,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';

/**
 * #10381, mechanism 2: a device that gets a task's delete, its
 * recreate-after-delete and a later LWW snapshot of it in ONE batch must end
 * where the devices that got them over several syncs end.
 *
 * - A deletes the task. B renames it concurrently; B's rename wins and B
 *   uploads a snapshot that recreates the task (`recreatesEntityAfterDelete`).
 * - B renames again. A, without that rename, tracks time and renames too, and
 *   wins that conflict. A's snapshot has no recreate flag: the task existed on
 *   A when A built it.
 *
 * A and B apply the delete, the recreate and A's snapshot in separate syncs.
 * A fresh device downloads them in one batch. Before the fix,
 * `bulkOperationsMetaReducer` skipped A's snapshot there as the update of a
 * task deleted in the same batch, so the fresh device showed B's second title
 * and lost A's tracked time.
 *
 * A restart replays the op-log tail in one batch too, and failed the same way
 * in the sync fuzz harness (sync-fuzz-pinned-traces.json, class
 * restart-changes-state). Here both devices had already saved a snapshot past
 * the delete, so their restart checks guard the result but pass without the
 * fix as well.
 *
 * Not asserted: the task's list position. The device whose edit beats the
 * delete never applies it, so the task keeps its place there but is appended
 * everywhere the delete ran (#10381, mechanism 1).
 */

/** Only explicit syncs run, so every crossing happens in the stated order. */
const blockBackgroundSync = async (client: SimulatedE2EClient): Promise<void> => {
  await client.page.evaluate(() => {
    const flags = globalThis as typeof globalThis & Record<string, boolean>;
    flags['__SP_E2E_BLOCK_AUTO_SYNC'] = true;
    flags['__SP_E2E_BLOCK_WS_DOWNLOAD'] = true;
    flags['__SP_E2E_BLOCK_IMMEDIATE_UPLOAD'] = true;
  });
};

/** Fail on the dataset conflict dialog or an error instead of resolving it. */
const sync = async (client: SimulatedE2EClient): Promise<void> => {
  const downloaded = client.page.waitForResponse(
    (response) =>
      response.url().includes('/api/sync/ops') && response.request().method() === 'GET',
  );
  await client.sync.clickSyncBtn();
  expect((await downloaded).ok()).toBe(true);
  const outcome = async (): Promise<string> => {
    if (await client.sync.conflictDialog.isVisible()) return 'conflict-dialog';
    if (await client.sync.hasSyncError()) return 'error';
    const spinning = await client.sync.syncSpinner.isVisible();
    const checked = await client.sync.syncConfirmedIcon.isVisible();
    return !spinning && checked ? 'in-sync' : 'pending';
  };
  let observed = 'pending';
  await expect
    .poll(
      async () => {
        observed = await outcome();
        return observed;
      },
      { timeout: 30000 },
    )
    .not.toBe('pending');
  expect(observed).toBe('in-sync');
};

const readTask = async (
  client: SimulatedE2EClient,
  taskName: string,
): Promise<{ title: string | null; timeSpent: number | null }> => ({
  title: await getTaskTitleFromState(client, taskName),
  timeSpent: await getTaskTimeSpentFromState(client, taskName),
});

test.describe('@supersync recreated task and a later snapshot in one batch', () => {
  test('a fresh device and a restart keep the later snapshot of a recreated task', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(240000);
    const taskName = `RecreatedTask-${Date.now()}`;
    const titleB1 = `${taskName}-B1`;
    const titleB2 = `${taskName}-B2`;
    const titleA = `${taskName}-A`;
    const trackedOnA = 3000;
    const clients: SimulatedE2EClient[] = [];

    try {
      const syncConfig = getSuperSyncConfig(await createTestUser(testRunId));
      const clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      clients.push(clientA);
      await clientA.sync.setupSuperSync(syncConfig);
      await clientA.workView.addTask(taskName);
      await waitForTask(clientA.page, taskName);
      await clientA.sync.syncAndWait();

      const clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      clients.push(clientB);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, taskName);

      for (const client of clients) {
        await blockBackgroundSync(client);
      }

      // A deletes the task; B's concurrent, later rename wins and recreates it.
      await deleteTask(clientA, taskName);
      await expect.poll(() => getTaskTitleFromState(clientA, taskName)).toBeNull();
      await sync(clientA);
      await renameTask(clientB, taskName, titleB1);
      await sync(clientB);
      await sync(clientA);
      await expect.poll(() => getTaskTitleFromState(clientA, taskName)).toBe(titleB1);

      // B renames again; A tracks time and renames later, so A's snapshot wins.
      await renameTask(clientB, titleB1, titleB2);
      await sync(clientB);
      await recordTaskTimeDelta(clientA, titleB1, '2026-07-13', trackedOnA);
      await renameTask(clientA, titleB1, titleA);
      await sync(clientA);
      await sync(clientB);

      const expected = { title: titleA, timeSpent: trackedOnA };
      expect(await readTask(clientA, taskName)).toEqual(expected);
      await expect.poll(() => readTask(clientB, taskName)).toEqual(expected);

      // A fresh device gets the delete, the recreate and A's snapshot in one batch.
      const clientC = await createSimulatedClient(browser, baseURL!, 'C', testRunId);
      clients.push(clientC);
      await clientC.sync.setupSuperSync(syncConfig);
      await clientC.sync.syncAndWait();
      await waitForTask(clientC.page, taskName);
      // Soft, so one run reports the fresh device and both restarts.
      expect.soft(await readTask(clientC, taskName), 'fresh C').toEqual(expected);

      // A restart replays each device's op-log tail in one batch.
      for (const client of [clientA, clientB]) {
        await client.page.reload();
        await client.workView.waitForTaskList();
        await blockBackgroundSync(client);
        await waitForTask(client.page, taskName);
        expect
          .soft(await readTask(client, taskName), `${client.clientName} after restart`)
          .toEqual(expected);
      }
    } finally {
      for (const client of clients) {
        await closeClient(client);
      }
    }
  });
});

import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  deleteTask,
  markTaskDone,
  recordTaskTimeDelta,
  getTaskTitleFromState,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';

/**
 * A marks a task done, then deletes it. B tracks time on it later and syncs
 * after A: the newer tracked time wins, so B restores the task everywhere.
 *
 * Before the fix, B built the restored task from its own pre-sync copy (not
 * done). A's done toggle arrived in the same download and applied on B after
 * that copy, so B showed the task done, but the copy's clock dominated the
 * toggle, so every other device (and a fresh one) showed it not done: a
 * permanent divergence and a lost edit.
 */

const DAY = '2026-07-13';

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
  await client.sync.clickSyncBtn();
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

type TaskView = { isDone: unknown; timeSpent: unknown } | null;

/** The live task whose title contains `name`, or null when there is none. */
const readTask = async (client: SimulatedE2EClient, name: string): Promise<TaskView> =>
  client.page.evaluate(async (taskName) => {
    type Subscription = { unsubscribe: () => void };
    type StoreLike = { subscribe: (next: (state: unknown) => void) => Subscription };
    const isRecord = (value: unknown): value is Record<string, unknown> =>
      typeof value === 'object' && value !== null;
    const store = (window as unknown as { __e2eTestHelpers?: { store?: StoreLike } })
      .__e2eTestHelpers?.store;
    if (!store) throw new Error('E2E store helper is unavailable');
    const state = await new Promise<Record<string, unknown>>((resolve) => {
      const ref: { current?: Subscription } = {};
      ref.current = store.subscribe((value) => {
        if (!isRecord(value)) return;
        window.setTimeout(() => ref.current?.unsubscribe());
        resolve(value);
      });
    });
    const taskState = state['tasks'] ?? state['task'];
    if (!isRecord(taskState) || !isRecord(taskState['entities'])) return null;
    const task = Object.values(taskState['entities']).find(
      (value) =>
        isRecord(value) &&
        typeof value['title'] === 'string' &&
        value['title'].includes(taskName),
    );
    return isRecord(task)
      ? { isDone: task['isDone'], timeSpent: task['timeSpent'] }
      : null;
  }, name);

test.describe('@supersync a restored task keeps edits from the same sync', () => {
  test('a done toggle that arrives beside a losing delete stays done everywhere', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(240000);
    const taskName = `RestoreDone-${Date.now()}`;
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
      for (const client of clients) await blockBackgroundSync(client);

      await markTaskDone(clientA, taskName);
      // The done move animates the task out of the open list; until it leaves,
      // two elements match and the delete's locator is ambiguous.
      await expect(clientA.page.locator('task', { hasText: taskName })).toHaveCount(1);
      await deleteTask(clientA, taskName);
      await expect.poll(() => getTaskTitleFromState(clientA, taskName)).toBeNull();
      await sync(clientA);
      // Newer than the delete, so B's tracked time restores the task.
      await recordTaskTimeDelta(clientB, taskName, DAY, 2000);
      await sync(clientB);
      await sync(clientA);

      const want: TaskView = { isDone: true, timeSpent: 2000 };
      expect.soft(await readTask(clientB, taskName), 'B').toEqual(want);
      await expect
        .poll(() => readTask(clientA, taskName), { message: 'A' })
        .toEqual(want);

      const clientC = await createSimulatedClient(browser, baseURL!, 'C', testRunId);
      clients.push(clientC);
      await clientC.sync.setupSuperSync(syncConfig);
      await clientC.sync.syncAndWait();
      await waitForTask(clientC.page, taskName);
      expect(await readTask(clientC, taskName), 'fresh C').toEqual(want);
    } finally {
      for (const client of clients) await closeClient(client);
    }
  });
});

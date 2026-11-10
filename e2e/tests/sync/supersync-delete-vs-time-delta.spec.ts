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
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';

/**
 * #10380 (task half): one device deletes a task while another tracks time on
 * it. When the tracking is newer, it wins and the task comes back everywhere
 * with the tracked time. When the delete is newer, the task stays deleted.
 *
 * Before the fix, the device whose delete lost rebuilt the task from its
 * delete payload plus the delta's ARGUMENTS read as task fields: it got
 * `taskId`, `date`, `duration` (and the delete payload's `subTasks`) as task
 * keys and lost the tracked time. That rebuilt task stays local (it is stored
 * as a remote row and never uploaded), so the other devices kept the time:
 * a permanent divergence. With two winning deltas, each was rebuilt from the
 * same base and the last one replaced the others.
 */

/** Keys that are delta arguments or the delete payload's subtask list, not task fields. */
const STRAY_KEYS = ['taskId', 'date', 'duration', 'subTasks'];
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

type TaskView = {
  title: unknown;
  timeSpent: unknown;
  timeSpentOnDay: unknown;
  strayKeys: string[];
  content?: unknown;
} | null;

/** The live task whose title contains `name`, or null when there is none. */
const readTask = async (client: SimulatedE2EClient, name: string): Promise<TaskView> =>
  client.page.evaluate(
    async ({ taskName, stray }) => {
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
      if (!isRecord(task)) return null;
      // `modified` is the local apply time, not synced content.
      const content: Record<string, unknown> = { ...task };
      delete content['modified'];
      return {
        title: task['title'] as string,
        timeSpent: task['timeSpent'],
        timeSpentOnDay: task['timeSpentOnDay'],
        strayKeys: stray.filter((key) => key in task),
        content,
      };
    },
    { taskName: name, stray: STRAY_KEYS },
  );

/** `addTask` prefixes the client's name, so a title is matched by its end. */
const expected = (title: string, time: number): TaskView => ({
  title: expect.stringMatching(new RegExp(`${title}$`)),
  timeSpent: time,
  timeSpentOnDay: { [DAY]: time },
  strayKeys: [],
  content: expect.anything(),
});

/** A and B share a synced task; background sync is off on both. */
const setUp = async (
  browser: Parameters<typeof createSimulatedClient>[0],
  baseURL: string,
  testRunId: string,
  taskName: string,
  clients: SimulatedE2EClient[],
): Promise<{
  clientA: SimulatedE2EClient;
  clientB: SimulatedE2EClient;
  syncConfig: ReturnType<typeof getSuperSyncConfig>;
}> => {
  const syncConfig = getSuperSyncConfig(await createTestUser(testRunId));
  const clientA = await createSimulatedClient(browser, baseURL, 'A', testRunId);
  clients.push(clientA);
  await clientA.sync.setupSuperSync(syncConfig);
  await clientA.workView.addTask(taskName);
  await waitForTask(clientA.page, taskName);
  await clientA.sync.syncAndWait();

  const clientB = await createSimulatedClient(browser, baseURL, 'B', testRunId);
  clients.push(clientB);
  await clientB.sync.setupSuperSync(syncConfig);
  await clientB.sync.syncAndWait();
  await waitForTask(clientB.page, taskName);

  for (const client of clients) {
    await blockBackgroundSync(client);
  }
  return { clientA, clientB, syncConfig };
};

/** A fresh device and a restart of every existing device show `want`. */
const expectEverywhere = async (
  browser: Parameters<typeof createSimulatedClient>[0],
  baseURL: string,
  testRunId: string,
  syncConfig: ReturnType<typeof getSuperSyncConfig>,
  taskName: string,
  want: TaskView,
  clients: SimulatedE2EClient[],
): Promise<void> => {
  const existing = [...clients];
  const views = new Map<string, TaskView>();
  const check = async (client: SimulatedE2EClient, label: string): Promise<void> => {
    const view = await readTask(client, taskName);
    views.set(label, view);
    expect.soft(view, label).toEqual(want);
  };
  for (const client of existing) await check(client, client.clientName);

  const clientC = await createSimulatedClient(browser, baseURL, 'C', testRunId);
  clients.push(clientC);
  await clientC.sync.setupSuperSync(syncConfig);
  await clientC.sync.syncAndWait();
  if (want) await waitForTask(clientC.page, taskName);
  await check(clientC, 'fresh C');

  for (const client of existing) {
    await client.page.reload();
    await client.workView.waitForTaskList();
    await blockBackgroundSync(client);
    if (want) await waitForTask(client.page, taskName);
    await check(client, `${client.clientName} after restart`);
  }

  // Every other synced field matches too, not only title and time.
  const reference = views.get('fresh C')?.content;
  for (const [label, view] of views) {
    expect.soft(view?.content, `${label} vs fresh C`).toEqual(reference);
  }
};

test.describe('@supersync delete vs time delta (#10380)', () => {
  test('a newer delta beats a pending local delete: A recreates with the time', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(240000);
    const taskName = `DelDelta1-${Date.now()}`;
    const clients: SimulatedE2EClient[] = [];
    try {
      const { clientA, clientB, syncConfig } = await setUp(
        browser,
        baseURL!,
        testRunId,
        taskName,
        clients,
      );
      await deleteTask(clientA, taskName);
      await expect.poll(() => getTaskTitleFromState(clientA, taskName)).toBeNull();
      await recordTaskTimeDelta(clientB, taskName, DAY, 2000);
      await sync(clientB);
      await sync(clientA);
      await sync(clientB);

      await expectEverywhere(
        browser,
        baseURL!,
        testRunId,
        syncConfig,
        taskName,
        expected(taskName, 2000),
        clients,
      );
    } finally {
      for (const client of clients) await closeClient(client);
    }
  });

  test('two newer deltas and a rename beat a pending local delete: all of them survive', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(240000);
    const taskName = `DelDelta2-${Date.now()}`;
    const renamed = `${taskName}-B`;
    const clients: SimulatedE2EClient[] = [];
    try {
      const { clientA, clientB, syncConfig } = await setUp(
        browser,
        baseURL!,
        testRunId,
        taskName,
        clients,
      );
      await deleteTask(clientA, taskName);
      await expect.poll(() => getTaskTitleFromState(clientA, taskName)).toBeNull();
      await recordTaskTimeDelta(clientB, taskName, DAY, 2000);
      await renameTask(clientB, taskName, renamed);
      await recordTaskTimeDelta(clientB, renamed, DAY, 1500);
      await sync(clientB);
      await sync(clientA);
      await sync(clientB);

      await expectEverywhere(
        browser,
        baseURL!,
        testRunId,
        syncConfig,
        taskName,
        expected(renamed, 3500),
        clients,
      );
    } finally {
      for (const client of clients) await closeClient(client);
    }
  });

  test('reverse direction: a pending newer delta beats a remote delete', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(240000);
    const taskName = `DelDelta3-${Date.now()}`;
    const clients: SimulatedE2EClient[] = [];
    try {
      const { clientA, clientB, syncConfig } = await setUp(
        browser,
        baseURL!,
        testRunId,
        taskName,
        clients,
      );
      await deleteTask(clientA, taskName);
      await expect.poll(() => getTaskTitleFromState(clientA, taskName)).toBeNull();
      await recordTaskTimeDelta(clientB, taskName, DAY, 2000);
      // The delete reaches the server first; B resolves it against its delta.
      await sync(clientA);
      await sync(clientB);
      await sync(clientA);

      await expectEverywhere(
        browser,
        baseURL!,
        testRunId,
        syncConfig,
        taskName,
        expected(taskName, 2000),
        clients,
      );
    } finally {
      for (const client of clients) await closeClient(client);
    }
  });

  for (const deleteSyncsFirst of [false, true]) {
    test(`a newer delete wins over a delta (delete ${deleteSyncsFirst ? 'uploads first' : 'uploads second'})`, async ({
      browser,
      baseURL,
      testRunId,
    }) => {
      test.setTimeout(240000);
      const taskName = `DelDelta4${deleteSyncsFirst ? 'a' : 'b'}-${Date.now()}`;
      const clients: SimulatedE2EClient[] = [];
      try {
        const { clientA, clientB, syncConfig } = await setUp(
          browser,
          baseURL!,
          testRunId,
          taskName,
          clients,
        );
        await recordTaskTimeDelta(clientB, taskName, DAY, 2000);
        await deleteTask(clientA, taskName);
        await expect.poll(() => getTaskTitleFromState(clientA, taskName)).toBeNull();
        const [first, second] = deleteSyncsFirst
          ? [clientA, clientB]
          : [clientB, clientA];
        await sync(first);
        await sync(second);
        await sync(first);

        await expectEverywhere(
          browser,
          baseURL!,
          testRunId,
          syncConfig,
          taskName,
          null,
          clients,
        );
      } finally {
        for (const client of clients) await closeClient(client);
      }
    });
  }
});

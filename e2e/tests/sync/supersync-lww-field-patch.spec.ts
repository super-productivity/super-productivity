import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  markTaskDone,
  recordTaskTimeDelta,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { waitForAppReady } from '../../utils/waits';

/**
 * #10379 / #10260: two devices edit one task offline and both rename it, so
 * the titles collide and the conflict used to fall back to whole-entity LWW.
 * - When the device that resolves the conflict won, it uploaded a
 *   replace-mode snapshot of its own task, which erased the other device's
 *   done toggle (or tracked time) everywhere (#10379).
 * - When it lost, it rejected every pending op of the task and kept its done
 *   toggle (or tracked time) on its own device only (#10260).
 *
 * The resolution is now a field patch built from both sides' ops: the title
 * takes the LWW winner's value, and every field only one side wrote survives.
 * A tracked-time delta stays out of the patch and uploads once (checked after
 * a restart, since replay is status-blind).
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

interface TaskView {
  title: string;
  isDone: boolean;
  timeSpent: number;
}

/**
 * Renames the task through the store with the action the title editor
 * dispatches (`TaskService.update`), or only reads; returns what the device
 * holds afterwards. The task is found by the stable prefix of its title.
 */
const onTask = async (
  client: SimulatedE2EClient,
  prefix: string,
  newTitle?: string,
): Promise<TaskView> =>
  client.page.evaluate(
    async ({ name, title }) => {
      type Subscription = { unsubscribe: () => void };
      type StoreLike = {
        subscribe: (next: (state: unknown) => void) => Subscription;
        dispatch: (action: unknown) => void;
      };
      const store = (window as unknown as { __e2eTestHelpers?: { store?: StoreLike } })
        .__e2eTestHelpers?.store;
      if (!store) {
        throw new Error('E2E store helper is unavailable');
      }
      const readTask = (): Promise<Record<string, unknown>> =>
        new Promise((resolve, reject) => {
          const ref: { current?: Subscription } = {};
          ref.current = store.subscribe((state) => {
            window.setTimeout(() => ref.current?.unsubscribe());
            const root = state as Record<string, { entities?: Record<string, unknown> }>;
            const entities = (root.tasks ?? root.task)?.entities ?? {};
            const task = Object.values(entities).find(
              (value) =>
                typeof value === 'object' &&
                value !== null &&
                String((value as Record<string, unknown>).title).includes(name),
            );
            if (task) {
              resolve(task as Record<string, unknown>);
            } else {
              reject(new Error(`Task not found: ${name}`));
            }
          });
        });
      if (title !== undefined) {
        const task = await readTask();
        store.dispatch({
          type: '[Task Shared] updateTask',
          task: { id: task.id, changes: { title } },
          meta: {
            isPersistent: true,
            entityType: 'TASK',
            entityId: task.id,
            opType: 'UPD',
          },
        });
      }
      const current = await readTask();
      return {
        title: String(current.title),
        isDone: current.isDone === true,
        timeSpent: typeof current.timeSpent === 'number' ? current.timeSpent : 0,
      };
    },
    { name: prefix, title: newTitle },
  );

test.describe('@supersync field patch for a task both devices renamed', () => {
  /**
   * Both devices rename the task; the device whose rename is earlier also
   * marks it done or tracks time on it. A uploads first, so B resolves the
   * conflict. `bWins` decides whose rename is later:
   * - B's: B wins locally, and A's done toggle or time must survive B's
   *   resolution (#10379);
   * - A's: B loses, and its own done toggle or time must still reach A
   *   (#10260).
   */
  const runCrossing = async (
    {
      browser,
      baseURL,
      testRunId,
    }: {
      browser: Parameters<typeof createSimulatedClient>[0];
      baseURL?: string;
      testRunId: string;
    },
    field: 'done' | 'time',
    bWins: boolean,
  ): Promise<void> => {
    const prefix = `FieldPatch-${field}-${bWins ? 'b' : 'a'}-${Date.now()}`;
    const tracked = 60000;
    const clients: SimulatedE2EClient[] = [];

    try {
      const syncConfig = getSuperSyncConfig(await createTestUser(testRunId));
      const clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      clients.push(clientA);
      await clientA.sync.setupSuperSync(syncConfig);
      await clientA.workView.addTask(prefix);
      await waitForTask(clientA.page, prefix);
      await clientA.sync.syncAndWait();

      const clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      clients.push(clientB);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, prefix);

      for (const client of clients) {
        await blockBackgroundSync(client);
      }

      // The loser of the title edits the other field, then renames; the
      // winner renames afterwards.
      const [loser, winner] = bWins ? [clientA, clientB] : [clientB, clientA];
      if (field === 'done') {
        await markTaskDone(loser, prefix);
      } else {
        await recordTaskTimeDelta(loser, prefix, '2026-07-13', tracked);
      }
      await onTask(loser, prefix, `${prefix} renamed on ${loser.clientName}`);
      await onTask(winner, prefix, `${prefix} renamed on ${winner.clientName}`);
      expect(await onTask(loser, prefix)).toEqual({
        title: `${prefix} renamed on ${loser.clientName}`,
        isDone: field === 'done',
        timeSpent: field === 'time' ? tracked : 0,
      });

      await sync(clientA);
      await sync(clientB);
      await sync(clientA);
      await sync(clientB);

      const expected: TaskView = {
        title: `${prefix} renamed on ${winner.clientName}`,
        isDone: field === 'done',
        timeSpent: field === 'time' ? tracked : 0,
      };
      const expectConverged = async (): Promise<void> => {
        // Both devices in one assertion, so a failure shows the divergence.
        await expect
          .poll(
            async () => ({
              A: await onTask(clientA, prefix),
              B: await onTask(clientB, prefix),
            }),
            { timeout: 30000 },
          )
          .toEqual({ A: expected, B: expected });
      };
      await expectConverged();

      // Replay is status-blind: a rejected delta plus a re-sent copy would
      // count the tracked time twice after a restart.
      for (const client of clients) {
        await client.page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
        await waitForAppReady(client.page);
        await waitForTask(client.page, prefix);
      }
      await expectConverged();
    } finally {
      for (const client of clients) {
        await closeClient(client);
      }
    }
  };

  test('a done toggle on the other device survives a local win', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(240000);
    await runCrossing({ browser, baseURL, testRunId }, 'done', true);
  });

  test('a done toggle on the resolving device survives a remote win', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(240000);
    await runCrossing({ browser, baseURL, testRunId }, 'done', false);
  });

  test('time tracked on the other device survives a local win', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(240000);
    await runCrossing({ browser, baseURL, testRunId }, 'time', true);
  });

  test('time tracked on the resolving device survives a remote win', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(240000);
    await runCrossing({ browser, baseURL, testRunId }, 'time', false);
  });
});

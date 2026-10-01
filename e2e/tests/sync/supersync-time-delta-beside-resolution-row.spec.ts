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
 * #10421 / #10408: a device whose only pending change to a task is tracked
 * time downloads another device's LWW resolution row for that task (here the
 * field patch A uploads after resolving a notes conflict with C). The row
 * writes no time, so the two commute, but the row is opaque and the crossing
 * used to resolve by whole-entity LWW:
 * - When B's tracking was later, B won and uploaded a replace snapshot read
 *   before the batch. The time fold placed C's done toggle ahead of it, so the
 *   snapshot reverted the toggle (and the notes) on every other device and on
 *   B after a restart (#10421).
 * - When B's tracking was earlier, the row won and B's delta was rejected: B
 *   kept the time, every other device lost it (#10408, #10415 residual 1).
 *
 * Every device must converge on the done toggle, A's notes and both devices'
 * time, also after a restart (replay is status-blind).
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
    const checked = await client.sync.syncCheckIcon
      .filter({ hasText: /^done_all$/ })
      .isVisible();
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
  notes: string | null;
  isDone: boolean;
  hasDoneOn: boolean;
  timeSpent: number;
}

/**
 * Writes the task's notes through the store with the action the notes editor
 * dispatches (`TaskService.update`), or only reads; returns what the device
 * holds afterwards. The task is found by the unique name in its title.
 */
const onTask = async (
  client: SimulatedE2EClient,
  title: string,
  notes?: string,
): Promise<TaskView> =>
  client.page.evaluate(
    async ({ name, newNotes }) => {
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
      if (newNotes !== undefined) {
        const task = await readTask();
        store.dispatch({
          type: '[Task Shared] updateTask',
          task: { id: task.id, changes: { notes: newNotes } },
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
        notes: typeof current.notes === 'string' ? current.notes : null,
        isDone: current.isDone === true,
        hasDoneOn: typeof current.doneOn === 'number',
        timeSpent: typeof current.timeSpent === 'number' ? current.timeSpent : 0,
      };
    },
    { name: title, newNotes: notes },
  );

test.describe('@supersync tracked time beside another device resolution row', () => {
  /**
   * A and C edit the notes; A also tracks time, later than C's notes, so A
   * wins that conflict and uploads a field-patch row. C marks the task done.
   * B only tracks time: after everything else (`bTracksLast`, B's delta is
   * newer than the row) or before it (the row is newer).
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
    bTracksLast: boolean,
  ): Promise<void> => {
    const title = `DeltaBesideRow-${bTracksLast ? 'last' : 'first'}-${Date.now()}`;
    const day = '2026-07-13';
    const clients: SimulatedE2EClient[] = [];

    try {
      const syncConfig = getSuperSyncConfig(await createTestUser(testRunId));
      const clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      clients.push(clientA);
      await clientA.sync.setupSuperSync(syncConfig);
      await clientA.workView.addTask(title);
      await waitForTask(clientA.page, title);
      await clientA.sync.syncAndWait();

      const clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      clients.push(clientB);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, title);

      const clientC = await createSimulatedClient(browser, baseURL!, 'C', testRunId);
      clients.push(clientC);
      await clientC.sync.setupSuperSync(syncConfig);
      await clientC.sync.syncAndWait();
      await waitForTask(clientC.page, title);

      for (const client of clients) {
        await blockBackgroundSync(client);
      }

      if (!bTracksLast) {
        await recordTaskTimeDelta(clientB, title, day, 3000);
      }
      await onTask(clientA, title, 'Notes written on A');
      await onTask(clientC, title, 'Notes written on C');
      await recordTaskTimeDelta(clientA, title, day, 2000);
      await markTaskDone(clientC, title);
      await sync(clientC);
      if (bTracksLast) {
        await recordTaskTimeDelta(clientB, title, day, 3000);
      }

      // A resolves the notes conflict and uploads its row; B then downloads
      // the row beside C's done toggle and A's delta.
      for (const client of [clientA, clientB, clientC, clientA, clientB, clientC]) {
        await sync(client);
      }

      const expected: TaskView = {
        notes: 'Notes written on A',
        isDone: true,
        hasDoneOn: true,
        timeSpent: 5000,
      };
      const expectConverged = async (): Promise<void> => {
        // Every device in one assertion, so a failure shows the divergence.
        await expect
          .poll(
            async () => ({
              A: await onTask(clientA, title),
              B: await onTask(clientB, title),
              C: await onTask(clientC, title),
            }),
            { timeout: 30000 },
          )
          .toEqual({ A: expected, B: expected, C: expected });
      };
      await expectConverged();

      // Replay is status-blind: a snapshot placed after the done toggle in
      // B's log reverts it there on restart.
      for (const client of clients) {
        await client.page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
        await waitForAppReady(client.page);
        await waitForTask(client.page, title);
      }
      await expectConverged();
    } finally {
      for (const client of clients) {
        await closeClient(client);
      }
    }
  };

  test('a delta tracked after the row keeps the done toggle and notes everywhere', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(300000);
    await runCrossing({ browser, baseURL, testRunId }, true);
  });

  test('a delta tracked before the row reaches every device', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(300000);
    await runCrossing({ browser, baseURL, testRunId }, false);
  });
});

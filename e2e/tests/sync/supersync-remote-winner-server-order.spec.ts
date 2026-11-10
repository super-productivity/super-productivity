import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  recordTaskTimeDelta,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { waitForAppReady } from '../../utils/waits';
import { getSyncedLocalRowsOf } from '../../utils/audit-winners-helpers';

/**
 * #10423: one download brings a device several ops of a task it has pending
 * work on. Some of them win a conflict, others don't conflict at all. Remote
 * winners used to be persisted and applied before every nonconflicting op of
 * the batch, so an op that a winner causally dominates, which reached the
 * server first, was applied after it and restored the older value on that
 * device only. C must apply the dominated row first and end on the winner's
 * value like every other device, also after a restart.
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
  notes: string | null;
}

/**
 * Writes the task's title or notes through the store with the action the
 * task editors dispatch (`TaskService.update`), or only reads; returns what
 * the device holds afterwards. The task is found by its stable id.
 */
const onTask = async (
  client: SimulatedE2EClient,
  taskId: string,
  changes?: Partial<TaskView>,
): Promise<TaskView> =>
  client.page.evaluate(
    async ({ id, taskChanges }) => {
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
      if (taskChanges) {
        store.dispatch({
          type: '[Task Shared] updateTask',
          task: { id, changes: taskChanges },
          meta: { isPersistent: true, entityType: 'TASK', entityId: id, opType: 'UPD' },
        });
      }
      const task = await new Promise<Record<string, unknown>>((resolve, reject) => {
        const ref: { current?: Subscription } = {};
        ref.current = store.subscribe((state) => {
          window.setTimeout(() => ref.current?.unsubscribe());
          const root = state as Record<string, { entities?: Record<string, unknown> }>;
          const found = (root.tasks ?? root.task)?.entities?.[id];
          if (found) {
            resolve(found as Record<string, unknown>);
          } else {
            reject(new Error(`Task not found: ${id}`));
          }
        });
      });
      return {
        title: String(task.title),
        notes: typeof task.notes === 'string' ? task.notes : null,
      };
    },
    { id: taskId, taskChanges: changes },
  );

/** The id of the task whose title contains `name`. */
const taskIdOf = async (client: SimulatedE2EClient, name: string): Promise<string> =>
  client.page.evaluate((title) => {
    type StoreLike = {
      subscribe: (next: (state: unknown) => void) => { unsubscribe: () => void };
    };
    const store = (window as unknown as { __e2eTestHelpers?: { store?: StoreLike } })
      .__e2eTestHelpers?.store;
    return new Promise<string>((resolve, reject) => {
      const sub = store?.subscribe((state) => {
        window.setTimeout(() => sub?.unsubscribe());
        const root = state as Record<string, { entities?: Record<string, unknown> }>;
        const task = Object.values((root.tasks ?? root.task)?.entities ?? {}).find(
          (value) =>
            String((value as Record<string, unknown> | undefined)?.title).includes(title),
        ) as Record<string, unknown> | undefined;
        if (task) resolve(String(task.id));
        else reject(new Error(`Task not found: ${title}`));
      });
    });
  }, name);

test.describe('@supersync remote winners in server order (#10423)', () => {
  /**
   * Rebuilt in the sync E2E audit 2026-11-03 (Verify 2). The earlier shape
   * (B's second edit a plain rename) stayed green with `orderIncomingPrefix`
   * disabled: since per-field winners (#10422) B uploads a title-only patch
   * that commutes with C's delta, so C saw no remote winner at all. Here B's
   * second edit also writes time
   * (an absolute edit, as the time editor dispatches), so B's re-sent row
   * writes time, conflicts with C's pending delta and wins it (newer). That
   * winner causally dominates A's title row, which reached the server first
   * and is nonconflicting for C. C must apply A's row before B's winner and
   * end on B's title; applying the winner first restores A's title on C only.
   *
   * C's own delta loses to B's newer time-writing winner: a remote win whose
   * winner writes time is the documented open gap (lww-field-level-resolution
   * decision 7), so time is deliberately not asserted here.
   */
  test('a time-writing remote winner applies after the incoming row it dominates', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(300000);
    const name = `ServerOrderTime-${Date.now()}`;
    const day = '2026-07-13';
    const clients: SimulatedE2EClient[] = [];

    try {
      const syncConfig = getSuperSyncConfig(await createTestUser(testRunId));
      const clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      clients.push(clientA);
      await clientA.sync.setupSuperSync(syncConfig);
      await clientA.workView.addTask(name);
      await waitForTask(clientA.page, name);
      await clientA.sync.syncAndWait();
      const clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      clients.push(clientB);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();
      const clientC = await createSimulatedClient(browser, baseURL!, 'C', testRunId);
      clients.push(clientC);
      await clientC.sync.setupSuperSync(syncConfig);
      await clientC.sync.syncAndWait();
      await waitForTask(clientC.page, name);
      for (const client of clients) {
        await blockBackgroundSync(client);
      }
      const id = await taskIdOf(clientA, name);

      await onTask(clientB, id, { title: `${name} B first` });
      await sync(clientB);
      // A's later rename wins the crossing: A uploads a title-only row.
      await onTask(clientA, id, { title: `${name} A` });
      await sync(clientA);
      expect(
        (await getSyncedLocalRowsOf(clientA.page, id)).some(
          (row) => row.keys.includes('title') && !row.keys.includes('timeSpentOnDay'),
        ),
      ).toBe(true);
      await recordTaskTimeDelta(clientC, name, day, 3000);
      // B's second edit renames AND writes time; B has not seen A's row yet.
      await clientB.page.evaluate(
        ({ taskId, title, date }) => {
          (
            window as unknown as {
              __e2eTestHelpers: { store: { dispatch: (a: unknown) => void } };
            }
          ).__e2eTestHelpers.store.dispatch({
            type: '[Task Shared] updateTask',
            task: {
              id: taskId,
              changes: {
                title,
                timeSpent: 20 * 60_000,
                timeSpentOnDay: { [date]: 20 * 60_000 },
              },
            },
            meta: {
              isPersistent: true,
              entityType: 'TASK',
              entityId: taskId,
              opType: 'UPD',
            },
          });
        },
        { taskId: id, title: `${name} B last`, date: day },
      );
      await sync(clientB);
      // Setup proof: B's accepted row for the task writes time, so it is a
      // remote winner over C's pending delta, not a commuting title patch.
      expect(
        (await getSyncedLocalRowsOf(clientB.page, id)).some(
          (row) => row.keys.includes('title') && row.keys.includes('timeSpentOnDay'),
        ),
      ).toBe(true);
      await sync(clientA);
      await onTask(clientA, id, { notes: 'Notes written on A' });

      for (const client of [clientA, clientB, clientC, clientA, clientB, clientC]) {
        await sync(client);
      }

      const expected: TaskView = {
        title: `${name} B last`,
        notes: 'Notes written on A',
      };
      const expectConverged = async (): Promise<void> => {
        await expect
          .poll(
            async () => ({
              A: await onTask(clientA, id),
              B: await onTask(clientB, id),
              C: await onTask(clientC, id),
            }),
            { timeout: 30000 },
          )
          .toEqual({ A: expected, B: expected, C: expected });
      };
      await expectConverged();

      for (const client of clients) {
        await client.page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
        await waitForAppReady(client.page);
      }
      await expectConverged();
    } finally {
      for (const client of clients) {
        await closeClient(client);
      }
    }
  });
});

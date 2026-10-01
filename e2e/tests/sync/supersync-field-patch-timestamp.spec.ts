import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { waitForAppReady } from '../../utils/waits';

/**
 * #10422: a field patch carried both sides' fields at the newest timestamp of
 * either side. So the resolver re-sent the OTHER side's older fields at a time
 * they were never written, and they beat a third device's newer edit of the
 * same field on every device.
 *
 * A writes notes, then renames. C writes newer notes. B renames last. Correct
 * last-writer-wins per field: B's title and C's notes, on every device and
 * after a restart.
 * - remote win: A resolves its rename against B's newer one; its patch
 *   carried A's notes at B's time.
 * - local win: B resolves its newer rename against A's ops; its patch carried
 *   A's notes at B's time.
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

test.describe('@supersync field patch timestamps (#10422)', () => {
  for (const direction of ['remote win', 'local win'] as const) {
    test(`a third device's newer notes survive a ${direction} patch`, async ({
      browser,
      baseURL,
      testRunId,
    }) => {
      test.setTimeout(300000);
      const name = `PatchTime-${Date.now()}`;
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

        // Distinct wall-clock times keep the LWW order unambiguous.
        const later = (): Promise<void> => clientA.page.waitForTimeout(50);
        await onTask(clientA, id, { notes: 'Notes from A (oldest)' });
        await later();
        await onTask(clientA, id, { title: `${name} A` });
        if (direction === 'local win') {
          // A's ops reach the server first; B resolves against them and wins.
          await sync(clientA);
        }
        await later();
        await onTask(clientC, id, { notes: 'Notes from C (newest)' });
        await later();
        await onTask(clientB, id, { title: `${name} B` });
        await sync(clientB);
        if (direction === 'remote win') {
          // A resolves against B's newer rename and loses it.
          await sync(clientA);
        }
        await sync(clientC);

        for (const client of [clientA, clientB, clientC, clientA, clientB, clientC]) {
          await sync(client);
        }

        const expected: TaskView = {
          title: `${name} B`,
          notes: 'Notes from C (newest)',
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
  }
});

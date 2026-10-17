import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  markTaskDone,
  getTaskElement,
  getDoneTaskElement,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { waitForMenuSettled } from '../../utils/waits';

/**
 * A task finished as "won't do" on one client and un-done on the other has to
 * end up in the same state on both, whichever client syncs first. A won't-do
 * task is `isDone` plus `isWontDo`, so a field-level merge that took the newer
 * `isDone: false` but kept the older `isWontDo` would leave a stale flag.
 */

const markUndone = async (
  client: SimulatedE2EClient,
  taskName: string,
): Promise<void> => {
  const task = getDoneTaskElement(client, taskName).first();
  await task.hover();
  await task.locator('done-toggle').click();
  await expect(getDoneTaskElement(client, taskName)).toHaveCount(0);
};

const finishAsWontDo = async (
  client: SimulatedE2EClient,
  taskName: string,
): Promise<void> => {
  await getTaskElement(client, taskName).first().click({ button: 'right' });
  const menuItem = client.page.locator('.mat-mdc-menu-content button', {
    hasText: "Finish as won't do",
  });
  await menuItem.waitFor({ state: 'visible' });
  await waitForMenuSettled(client.page);
  await menuItem.click();
  await expect(
    getDoneTaskElement(client, taskName).locator('done-toggle .done-check--cross'),
  ).toHaveCount(1);
};

type StoredState = { isDone: boolean; isWontDo: boolean };

/** The task's `isDone` and `isWontDo` as stored in the client's NgRx state. */
const getStoredState = (
  client: SimulatedE2EClient,
  taskName: string,
): Promise<StoredState | null> =>
  client.page.evaluate(async (name) => {
    type StoreLike = {
      subscribe: (next: (state: unknown) => void) => { unsubscribe: () => void };
    };
    const store = (window as unknown as { __e2eTestHelpers?: { store?: StoreLike } })
      .__e2eTestHelpers?.store;
    if (!store) {
      return null;
    }
    const state = await new Promise<unknown>((resolve) => {
      const sub = store.subscribe((value) => {
        window.setTimeout(() => sub.unsubscribe());
        resolve(value);
      });
    });
    const entities = (state as { tasks?: { entities?: Record<string, unknown> } }).tasks
      ?.entities;
    const task = Object.values(entities ?? {}).find(
      (t) => !!(t as { title?: string }).title?.includes(name),
    ) as { isDone?: boolean; isWontDo?: boolean } | undefined;
    return task ? { isDone: !!task.isDone, isWontDo: !!task.isWontDo } : null;
  }, taskName);

test.describe("@supersync Won't do vs un-done convergence", () => {
  for (const firstToSync of ['wontDo', 'undone'] as const) {
    test(`converges when the ${firstToSync} client syncs first`, async ({
      browser,
      baseURL,
      testRunId,
    }) => {
      const appUrl = baseURL || 'http://localhost:4242';
      let clientA: SimulatedE2EClient | null = null;
      let clientB: SimulatedE2EClient | null = null;

      try {
        const user = await createTestUser(testRunId);
        const syncConfig = getSuperSyncConfig(user);

        clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
        await clientA.sync.setupSuperSync(syncConfig);
        clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
        await clientB.sync.setupSuperSync(syncConfig);

        // Both clients start with the task completed.
        const taskName = `WontDo-${firstToSync}-${testRunId}`;
        await clientA.workView.addTask(taskName);
        await markTaskDone(clientA, taskName);
        await clientA.sync.syncAndWait();
        await clientB.sync.syncAndWait();
        await waitForTask(clientB.page, taskName);
        await expect(getDoneTaskElement(clientB, taskName)).toHaveCount(1);

        // Concurrently: A turns it into won't do, B reopens it.
        await markUndone(clientA, taskName);
        await finishAsWontDo(clientA, taskName);
        await markUndone(clientB, taskName);

        const [first, second] =
          firstToSync === 'wontDo' ? [clientA, clientB] : [clientB, clientA];
        await first.sync.syncAndWait();
        await second.sync.syncAndWait();
        await first.sync.syncAndWait();
        await second.sync.syncAndWait();

        const stateA = await getStoredState(clientA, taskName);
        const stateB = await getStoredState(clientB, taskName);
        expect(stateA).not.toBeNull();
        expect(stateB).toEqual(stateA);
        // B's reopen is the later edit, so it wins on both clients, and un-doing
        // the task also clears A's older `isWontDo`.
        expect(stateA).toEqual({ isDone: false, isWontDo: false });
        for (const client of [clientA, clientB]) {
          await expect(
            getTaskElement(client, taskName).locator('done-toggle .done-check--cross'),
          ).toHaveCount(0);
        }

        // Completing it normally afterwards stays a plain completion.
        await markTaskDone(clientB, taskName);
        await clientB.sync.syncAndWait();
        await clientA.sync.syncAndWait();
        for (const client of [clientA, clientB]) {
          expect(await getStoredState(client, taskName)).toEqual({
            isDone: true,
            isWontDo: false,
          });
          await expect(
            getDoneTaskElement(client, taskName).locator(
              'done-toggle .done-check--cross',
            ),
          ).toHaveCount(0);
        }
      } finally {
        if (clientA) await closeClient(clientA);
        if (clientB) await closeClient(clientB);
      }
    });
  }
});

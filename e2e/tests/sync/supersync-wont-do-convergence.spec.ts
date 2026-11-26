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
 * A task finished as "won't do" on one client and un-done or completed on the
 * other has to end up in the same state on both, whichever client syncs first
 * and whichever edit is newer. A won't-do task is done with a `wontDoOn` equal
 * to its `doneOn`, so a field-level merge keeps the pair of the newer edit: a
 * newer reopen or completion leaves the older `wontDoOn` beside another
 * `doneOn`, which no longer counts.
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
    hasText: "Won't do",
  });
  await menuItem.waitFor({ state: 'visible' });
  await waitForMenuSettled(client.page);
  await menuItem.click();
  await expect(
    getDoneTaskElement(client, taskName).locator('done-toggle .done-check--cross'),
  ).toHaveCount(1);
};

type StoredState = { isDone: boolean; isWontDo: boolean };

/** The task's `isDone`, and whether its stored fields mark it won't do. */
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
    ) as { isDone?: boolean; doneOn?: number; wontDoOn?: number } | undefined;
    return task
      ? {
          isDone: !!task.isDone,
          isWontDo:
            !!task.isDone && task.wontDoOn != null && task.wontDoOn === task.doneOn,
        }
      : null;
  }, taskName);

const SCENARIOS = (['undone', 'wontDo'] as const).flatMap((newerEdit) =>
  (['wontDo', 'undone'] as const).map((firstToSync) => ({ newerEdit, firstToSync })),
);

test.describe("@supersync Won't do vs un-done convergence", () => {
  for (const { newerEdit, firstToSync } of SCENARIOS) {
    test(`converges when the ${newerEdit} edit is newer and the ${firstToSync} client syncs first`, async ({
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
        const taskName = `WontDo-${newerEdit}-${firstToSync}-${testRunId}`;
        await clientA.workView.addTask(taskName);
        await markTaskDone(clientA, taskName);
        await clientA.sync.syncAndWait();
        await clientB.sync.syncAndWait();
        await waitForTask(clientB.page, taskName);
        await expect(getDoneTaskElement(clientB, taskName)).toHaveCount(1);

        // Concurrently: A turns it into won't do, B reopens it. The edit made
        // last is the newer one.
        if (newerEdit === 'undone') {
          await markUndone(clientA, taskName);
          await finishAsWontDo(clientA, taskName);
          await markUndone(clientB, taskName);
        } else {
          await markUndone(clientB, taskName);
          await markUndone(clientA, taskName);
          await finishAsWontDo(clientA, taskName);
        }

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

        if (newerEdit === 'wontDo') {
          // A's won't-do is the later edit, so it wins on both clients with
          // its matching `doneOn` and `wontDoOn`.
          expect(stateA).toEqual({ isDone: true, isWontDo: true });
          for (const client of [clientA, clientB]) {
            await expect(
              getDoneTaskElement(client, taskName).locator(
                'done-toggle .done-check--cross',
              ),
            ).toHaveCount(1);
          }
          return;
        }

        // B's reopen is the later edit, so it wins on both clients; A's older
        // `wontDoOn` no longer counts.
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

  // Concurrently, A finishes an open task as won't do and B completes it
  // later. B's completion is the newer edit, so it wins on both clients: an
  // older won't do must not survive beside it.
  for (const firstToSync of ['wontDo', 'completed'] as const) {
    test(`converges on a newer completion when the ${firstToSync} client syncs first`, async ({
      browser,
      baseURL,
      testRunId,
    }) => {
      const appUrl = baseURL || 'http://localhost:4242';
      let clientA: SimulatedE2EClient | null = null;
      let clientB: SimulatedE2EClient | null = null;

      try {
        const syncConfig = getSuperSyncConfig(await createTestUser(testRunId));
        clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
        await clientA.sync.setupSuperSync(syncConfig);
        clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
        await clientB.sync.setupSuperSync(syncConfig);

        const taskName = `WontDo-completed-${firstToSync}-${testRunId}`;
        await clientA.workView.addTask(taskName);
        await clientA.sync.syncAndWait();
        await clientB.sync.syncAndWait();
        await waitForTask(clientB.page, taskName);

        await finishAsWontDo(clientA, taskName);
        await markTaskDone(clientB, taskName);

        const [first, second] =
          firstToSync === 'wontDo' ? [clientA, clientB] : [clientB, clientA];
        await first.sync.syncAndWait();
        await second.sync.syncAndWait();
        await first.sync.syncAndWait();
        await second.sync.syncAndWait();

        for (const client of [clientA, clientB]) {
          await expect(getDoneTaskElement(client, taskName)).toHaveCount(1);
          await expect(
            getDoneTaskElement(client, taskName).locator(
              'done-toggle .done-check--cross',
            ),
          ).toHaveCount(0);
          expect(await getStoredState(client, taskName)).toEqual({
            isDone: true,
            isWontDo: false,
          });
        }
      } finally {
        if (clientA) await closeClient(clientA);
        if (clientB) await closeClient(clientB);
      }
    });
  }
});

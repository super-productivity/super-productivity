import { test, expect } from '../../fixtures/supersync.fixture';
import {
  closeClient,
  createSimulatedClient,
  createTestUser,
  getSubtaskElement,
  getSuperSyncConfig,
  getTaskElement,
  startTimeTracking,
  waitForTask,
  waitForTaskTimeSpent,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import type { Page } from '@playwright/test';
import { waitForAppReady } from '../../utils/waits';
import { blockBackgroundSync } from '../../utils/time-preserving-resolution-helpers';

const readTimeSpent = (page: Page, taskId: string): Promise<number | undefined> =>
  page.evaluate(async (id) => {
    const { store } = (
      window as unknown as {
        __e2eTestHelpers: {
          store: {
            subscribe: (
              cb: (state: {
                tasks: { entities: Record<string, { timeSpent: number } | undefined> };
              }) => void,
            ) => { unsubscribe: () => void };
          };
        };
      }
    ).__e2eTestHelpers;
    return new Promise<number | undefined>((resolve) => {
      const subscription = store.subscribe((state) => {
        window.setTimeout(() => subscription.unsubscribe());
        resolve(state.tasks.entities[id]?.timeSpent);
      });
    });
  }, taskId);

// Adding the first subtask moves the parent's tracked time and the current-task
// pointer to that subtask. Time tracked since the last five-minute batch is not
// an op yet; it used to be sent for the parent, so the other device added it to
// the parent only and its subtask stayed short for good.
test.describe('@supersync First subtask added while the parent is tracked', () => {
  for (const adder of ['A', 'B'] as const) {
    test(`keeps the unsynced time on the subtask when ${adder === 'A' ? 'the tracking device' : 'another device'} adds it`, async ({
      browser,
      baseURL,
      testRunId,
    }) => {
      test.setTimeout(180000);
      const parentName = `Parent-${testRunId}`;
      const childName = `Child-${testRunId}`;
      const clients: SimulatedE2EClient[] = [];
      try {
        const config = getSuperSyncConfig(await createTestUser(testRunId));
        for (const name of ['A', 'B']) {
          const client = await createSimulatedClient(browser, baseURL!, name, testRunId);
          clients.push(client);
          await client.sync.setupSuperSync(config);
          // Only the explicit syncs below may run, so A's batch stays pending.
          await client.page.evaluate(blockBackgroundSync);
          await client.page.addInitScript(blockBackgroundSync);
          if (name === 'A') {
            await client.workView.addTask(parentName);
          }
          await client.sync.syncAndWait();
          await waitForTask(client.page, parentName);
        }
        const [a, b] = clients;
        const parentId = await getTaskElement(a, parentName)
          .first()
          .getAttribute('data-task-id');
        expect(parentId).toBeTruthy();

        // Well below the five-minute batch: the tracked time exists only on A.
        await startTimeTracking(a, parentName);
        await waitForTaskTimeSpent(a, parentName);

        const adderClient = adder === 'A' ? a : b;
        await adderClient.workView.addSubTask(
          getTaskElement(adderClient, parentName).first(),
          childName,
        );
        const childId = await getSubtaskElement(adderClient, childName)
          .first()
          .getAttribute('data-task-id');
        expect(childId).toBeTruthy();

        await b.sync.syncAndWait();
        await a.sync.syncAndWait();
        const trackedChild = getSubtaskElement(a, childName).first();
        await expect(trackedChild).toHaveClass(/isCurrent/);
        await trackedChild.focus();
        await trackedChild.press('y');
        await expect(trackedChild).not.toHaveClass(/isCurrent/);
        for (let round = 0; round < 2; round++) {
          for (const client of clients) await client.sync.syncAndWait();
        }

        const trackedTime = await readTimeSpent(a.page, childId!);
        expect(trackedTime).toBeGreaterThan(0);
        for (const client of clients) {
          for (const isReloaded of [false, true]) {
            if (isReloaded) {
              await client.page.reload();
              await waitForAppReady(client.page);
            }
            expect(await readTimeSpent(client.page, childId!)).toBe(trackedTime);
            expect(await readTimeSpent(client.page, parentId!)).toBe(trackedTime);
          }
        }
      } finally {
        for (const client of clients) await closeClient(client);
      }
    });
  }
});

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

type TrackedTime = { timeSpent: number; timeSpentOnDay: Record<string, number> };

const readTimeSpent = (page: Page, taskId: string): Promise<TrackedTime | undefined> =>
  page.evaluate(async (id) => {
    const { store } = (
      window as unknown as {
        __e2eTestHelpers: {
          store: {
            subscribe: (
              cb: (state: {
                tasks: { entities: Record<string, TrackedTime | undefined> };
              }) => void,
            ) => { unsubscribe: () => void };
          };
        };
      }
    ).__e2eTestHelpers;
    return new Promise<TrackedTime | undefined>((resolve) => {
      const subscription = store.subscribe((state) => {
        window.setTimeout(() => subscription.unsubscribe());
        const task = state.tasks.entities[id];
        resolve(
          task && { timeSpent: task.timeSpent, timeSpentOnDay: task.timeSpentOnDay },
        );
      });
    });
  }, taskId);

// Adding the first subtask moves the parent's tracked time and the current-task
// pointer to that subtask. Time tracked since the last five-minute batch is not
// an op yet; it used to be sent for the parent, so the other device added it to
// the parent only and its subtask stayed short for good.
test.describe('@supersync First subtask added while the parent is tracked', () => {
  for (const scenario of ['A', 'B', 'paste'] as const) {
    const adder = scenario === 'B' ? 'B' : 'A';
    const explicitTime = scenario === 'paste';
    const testName = explicitTime
      ? 'keeps explicit pasted child time separate from pending parent time'
      : `keeps the unsynced time on the subtask when ${adder === 'A' ? 'the tracking device' : 'another device'} adds it`;
    test(testName, async ({ browser, baseURL, testRunId }) => {
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
        const fixedNow = Date.now();
        if (explicitTime) {
          await a.page.clock.setFixedTime(fixedNow);
          // Let the real interval consume the baseline before tracking starts.
          await a.page.waitForTimeout(1100);
        }
        await startTimeTracking(a, parentName);
        if (explicitTime) await a.page.clock.setFixedTime(fixedNow + 5000);
        await waitForTaskTimeSpent(a, parentName);

        const adderClient = adder === 'A' ? a : b;
        if (explicitTime) {
          expect((await readTimeSpent(a.page, parentId!))!.timeSpent).toBe(5000);
          await getTaskElement(a, parentName)
            .first()
            .evaluate((element, text) => {
              const clipboardData = new DataTransfer();
              clipboardData.setData('text/plain', text);
              element.dispatchEvent(
                new ClipboardEvent('paste', { bubbles: true, clipboardData }),
              );
            }, `- ${childName} 10m/1h`);
          await a.page
            .getByRole('dialog')
            .getByRole('button', { name: 'Confirm', exact: true })
            .click();
        } else {
          await adderClient.workView.addSubTask(
            getTaskElement(adderClient, parentName).first(),
            childName,
          );
        }
        const childId = await getSubtaskElement(adderClient, childName)
          .first()
          .getAttribute('data-task-id');
        expect(childId).toBeTruthy();

        if (!explicitTime) {
          await b.sync.syncAndWait();
          await a.sync.syncAndWait();
        }
        const trackedChild = getSubtaskElement(a, childName).first();
        await expect(trackedChild).toHaveClass(/isCurrent/);
        await trackedChild.focus();
        await trackedChild.press('y');
        await expect(trackedChild).not.toHaveClass(/isCurrent/);
        if (explicitTime) await a.page.clock.setSystemTime(Date.now());
        for (let round = 0; round < 2; round++) {
          for (const client of clients) await client.sync.syncAndWait();
        }

        const trackedTime = await readTimeSpent(a.page, childId!);
        if (explicitTime) {
          expect(Object.values(trackedTime!.timeSpentOnDay)).toEqual([600000]);
        } else {
          expect(trackedTime!.timeSpent).toBeGreaterThan(0);
        }
        for (const client of clients) {
          for (const isReloaded of [false, true]) {
            if (isReloaded) {
              await client.page.reload();
              await waitForAppReady(client.page);
            }
            const childTime = await readTimeSpent(client.page, childId!);
            expect(childTime!.timeSpentOnDay).toEqual(trackedTime!.timeSpentOnDay);
            if (!explicitTime) {
              expect(childTime).toEqual(trackedTime);
              expect(await readTimeSpent(client.page, parentId!)).toEqual(trackedTime);
            }
          }
        }
      } finally {
        for (const client of clients) await closeClient(client);
      }
    });
  }
});

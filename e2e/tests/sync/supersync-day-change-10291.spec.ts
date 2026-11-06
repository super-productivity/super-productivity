import type { Page } from '@playwright/test';
import { expect, test } from '../../fixtures/supersync.fixture';
import {
  closeClient,
  createSimulatedClient,
  createTestUser,
  getSuperSyncConfig,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';

interface TestWindow extends Window {
  __e2eTestHelpers: {
    hydrationState: { isApplyingRemoteOps: () => boolean };
    store: {
      subscribe: (
        next: (state: {
          appState: { todayStr: string };
          tasks: { entities: Record<string, { title: string; dueDay?: string }> };
        }) => void,
      ) => { unsubscribe: () => void };
    };
  };
  __releaseReplayCheckpoint?: () => void;
}

const readDayState = (
  page: Page,
  title: string,
): Promise<{ todayStr?: string; dueDay?: string; isApplyingRemoteOps: boolean }> =>
  page.evaluate((taskTitle) => {
    const { store, hydrationState } = (window as unknown as TestWindow).__e2eTestHelpers;
    let result: { todayStr: string; dueDay?: string } | undefined;
    const subscription = store.subscribe((state) => {
      result = {
        todayStr: state.appState.todayStr,
        dueDay: Object.values(state.tasks.entities).find((task) =>
          task.title.includes(taskTitle),
        )?.dueDay,
      };
    });
    subscription.unsubscribe();
    return { ...result, isApplyingRemoteOps: hydrationState.isApplyingRemoteOps() };
  }, title);

test.describe('@supersync Day change during remote replay (#10291)', () => {
  test('shows the new day in Today after replay finishes without restarting', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    const clients: SimulatedE2EClient[] = [];
    try {
      const config = getSuperSyncConfig(await createTestUser(testRunId));
      for (const name of ['A', 'B']) {
        const client = await createSimulatedClient(browser, baseURL!, name, testRunId);
        clients.push(client);
        // Keep Date.now advancing: a frozen clock wedges RxJS debounceTime.
        await client.page.clock.setSystemTime(new Date('2026-06-15T15:00:00'));
        await client.page.reload();
        await client.workView.waitForTaskList();
        await client.sync.setupSuperSync(config);
        await client.sync.syncAndWait();
      }
      const [clientA, clientB] = clients;
      const title = `Tomorrow-${testRunId}`;

      await clientB.page.evaluate(() => {
        const testWindow = window as unknown as TestWindow;
        const originalTransaction = IDBDatabase.prototype.transaction;
        IDBDatabase.prototype.transaction = function (...args) {
          const transaction = originalTransaction.apply(this, args);
          const stores = transaction.objectStoreNames;
          if (
            this.name === 'SUP_OPS' &&
            transaction.mode === 'readwrite' &&
            stores.length === 3 &&
            ['ops', 'vector_clock', 'meta'].every((name) => stores.contains(name)) &&
            testWindow.__e2eTestHelpers.hydrationState.isApplyingRemoteOps()
          ) {
            IDBDatabase.prototype.transaction = originalTransaction;
            // Hold markReducersCommittedAndMergeClocks at its final await tx.done.
            // All native writes commit normally; only completion delivery is delayed.
            // Register before idb wraps the returned transaction and adds its listener.
            transaction.addEventListener(
              'complete',
              (event) => {
                event.stopImmediatePropagation();
                testWindow.__releaseReplayCheckpoint = () => {
                  delete testWindow.__releaseReplayCheckpoint;
                  transaction.dispatchEvent(new Event('complete'));
                };
              },
              { once: true },
            );
          }
          return transaction;
        };
      });

      await clientA.workView.addTask(`${title} @tomorrow`, false, null);
      await clientA.sync.syncAndWait();
      // Start the real download/replay without waiting for the held checkpoint.
      const syncResult = clientB.sync.syncAndWait().then(
        () => undefined,
        (error: unknown) => error,
      );
      await clientB.page.waitForFunction(
        () => !!(window as unknown as TestWindow).__releaseReplayCheckpoint,
      );
      expect(await readDayState(clientB.page, title)).toEqual({
        todayStr: '2026-06-15',
        dueDay: '2026-06-16',
        isApplyingRemoteOps: true,
      });
      const task = clientB.page.locator('task').filter({ hasText: title });
      await expect(task).toHaveCount(0);

      const dayChanged = clientB.page.waitForEvent('console', {
        predicate: (message) => message.text().includes('DAY_CHANGE 2026-06-16'),
      });
      await clientB.page.clock.setSystemTime(new Date('2026-06-16T00:05:00'));
      await clientB.page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await dayChanged;
      expect(await readDayState(clientB.page, title)).toEqual({
        todayStr: '2026-06-15',
        dueDay: '2026-06-16',
        isApplyingRemoteOps: true,
      });

      await clientB.page.evaluate(() =>
        (window as unknown as TestWindow).__releaseReplayCheckpoint!(),
      );
      expect(await syncResult).toBeUndefined();
      await expect(task).toBeVisible();
      expect(await readDayState(clientB.page, title)).toEqual({
        todayStr: '2026-06-16',
        dueDay: '2026-06-16',
        isApplyingRemoteOps: false,
      });
    } finally {
      for (const client of clients) await closeClient(client);
    }
  });
});

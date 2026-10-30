import { test, expect } from '../../fixtures/supersync.fixture';
import {
  closeClient,
  createSimulatedClient,
  createTestUser,
  getLocalOpLogSummary,
  getSuperSyncConfig,
  renameTask,
  waitForTask,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { waitForAppReady } from '../../utils/waits';

test.describe('@supersync local storage failure', () => {
  test('does not compact an unpersisted edit into durable state or sync it to a peer', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(180000);
    const clients: SimulatedE2EClient[] = [];
    try {
      const config = getSuperSyncConfig(await createTestUser(testRunId));
      const origin = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      clients.push(origin);
      await origin.sync.setupSuperSync(config);
      const savedTitle = `Saved-${testRunId}`;
      const failedTitle = `Unsaved-${testRunId}`;
      const siblingTitle = `Sibling-${testRunId}`;
      const finalTitle = `Surviving-${testRunId}`;
      await origin.workView.addTask(savedTitle);
      await origin.workView.addTask(siblingTitle);
      await origin.sync.syncAndWait();

      // Abort a native request and expose a quota error to its consumer. The
      // browser rolls back the transaction and delivers error/abort events;
      // the real store then translates the error before capture handles it.
      await origin.page.evaluate((title) => {
        const originalAdd = IDBObjectStore.prototype.add;
        IDBObjectStore.prototype.add = function (value: unknown, key?: IDBValidKey) {
          const request = originalAdd.call(this, value, key);
          const entry = value as {
            source?: string;
            op?: { p?: { actionPayload?: { task?: { changes?: { title?: string } } } } };
          };
          if (
            this.name === 'ops' &&
            entry.source === 'local' &&
            entry.op?.p?.actionPayload?.task?.changes?.title === title
          ) {
            IDBObjectStore.prototype.add = originalAdd;
            const quotaError = new DOMException(
              'Injected disk-full failure',
              'QuotaExceededError',
            );
            Object.defineProperty(request, 'error', { get: () => quotaError });
            this.transaction.abort();
            sessionStorage.setItem('quota-failure-injected', 'true');
          }
          return request;
        };
        // DOMException stacks can be empty in Playwright's pageerror event.
        // Preserve diagnostics without suppressing an unhandled rejection.
        window.addEventListener('unhandledrejection', (event) => {
          if (event.reason instanceof DOMException) {
            console.error('Unhandled IndexedDB rejection:', event.reason.name);
          }
        });
      }, failedTitle);
      await renameTask(origin, savedTitle, failedTitle);
      await expect
        .poll(() =>
          origin.page.evaluate(() => sessionStorage.getItem('quota-failure-injected')),
        )
        .toBe('true');
      await expect(
        origin.page.locator('snack-custom', { hasText: 'Failed to save changes' }),
      ).toBeVisible();

      const before = (await getLocalOpLogSummary(origin.page)).length;
      const siblingId = await origin.page
        .locator('task', { hasText: siblingTitle })
        .getAttribute('data-task-id');
      expect(siblingId).toBeTruthy();
      let compactionWasBlocked = false;
      origin.page.on('console', (message) => {
        if (
          message.text().includes('Skipping compaction') &&
          message.text().includes('unrecovered persist failure')
        ) {
          compactionWasBlocked = true;
        }
      });
      // Reach the real 500-operation compaction threshold with successful edits
      // to a DIFFERENT task, so they cannot also save the failed title by accident.
      await origin.page.evaluate(
        async ({ id, title }) => {
          const store = (
            window as unknown as {
              __e2eTestHelpers: { store: { dispatch: (action: unknown) => void } };
            }
          ).__e2eTestHelpers.store;
          for (let index = 0; index < 500; index++) {
            store.dispatch({
              type: '[Task Shared] updateTask',
              task: { id, changes: { title: index === 499 ? title : `Edit-${index}` } },
              meta: {
                isPersistent: true,
                entityType: 'TASK',
                entityId: id,
                opType: 'UPD',
              },
            });
            // Let NgRx commit each real action before capturing the next one.
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        },
        { id: siblingId!, title: finalTitle },
      );
      await expect
        .poll(async () => (await getLocalOpLogSummary(origin.page)).length, {
          timeout: 60000,
        })
        .toBeGreaterThanOrEqual(before + 500);
      await expect.poll(() => compactionWasBlocked).toBe(true);

      // An offline restart must replay only durable operations. The unsaved UI
      // edit must not have leaked into a snapshot during the compaction attempt.
      await origin.page.route('**/api/**', (route) => route.abort());
      await origin.page.reload();
      await waitForAppReady(origin.page);
      await waitForTask(origin.page, savedTitle);
      await waitForTask(origin.page, finalTitle);
      await expect(origin.page.locator('task', { hasText: failedTitle })).toHaveCount(0);
      await origin.page.unroute('**/api/**');
      await origin.sync.syncAndWait({ timeout: 60000 });

      const peer = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      clients.push(peer);
      await peer.sync.setupSuperSync(config);
      await waitForTask(peer.page, savedTitle);
      await waitForTask(peer.page, finalTitle);
      await expect(peer.page.locator('task', { hasText: failedTitle })).toHaveCount(0);
    } finally {
      const results = await Promise.allSettled(clients.map(closeClient));
      const failures = results.filter((result) => result.status === 'rejected');
      if (failures.length) {
        throw new AggregateError(
          failures.map((result) => result.reason),
          'Sync client cleanup failed',
        );
      }
    }
  });
});

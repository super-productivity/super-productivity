import type { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../fixtures/webdav.fixture';
import { SyncPage } from '../../pages/sync.page';
import { WorkViewPage } from '../../pages/work-view.page';
import {
  closeContextsSafely,
  createSyncFolder,
  generateSyncFolderName,
  setupSyncClient,
  waitForSyncComplete,
  WEBDAV_CONFIG_TEMPLATE,
} from '../../utils/sync-helpers';
import { waitForAppReady } from '../../utils/waits';
import type { TaskHistoryRecord } from '../../../src/app/features/tasks/task-history/task-history.model';
import type { PluginUserDataState } from '../../../src/app/plugins/plugin-persistence.model';
import { getBrowserLocalDateStr } from '../../utils/audit-webdav-helpers';

interface Client {
  context: BrowserContext;
  page: Page;
  sync: SyncPage;
  work: WorkViewPage;
}

const taskState = async (
  page: Page,
  taskId: string,
  changes?: {
    title?: string;
    dueDay?: string;
    deadlineDay?: string;
    isDone?: boolean;
    doneOn?: number;
    wontDoOn?: number;
  },
): Promise<{
  dueDay?: string;
  deadlineDay?: string;
  isDone?: boolean;
  doneOn?: number;
  wontDoOn?: number;
  history?: TaskHistoryRecord;
  deliveries: PluginUserDataState;
}> =>
  page.evaluate(
    async ({ id, update }) => {
      const helpers = (
        window as unknown as {
          __e2eTestHelpers: {
            store: {
              dispatch: (action: unknown) => void;
              subscribe: (read: (value: unknown) => void) => { unsubscribe: () => void };
            };
            flushPendingWrites: () => Promise<void>;
          };
        }
      ).__e2eTestHelpers;
      if (update) {
        helpers.store.dispatch({
          type: '[Task Shared] updateTask',
          task: { id, changes: update },
          meta: { isPersistent: true, entityType: 'TASK', entityId: id, opType: 'UPD' },
        });
      }
      await helpers.flushPendingWrites();
      return new Promise((resolve) => {
        const subscription = helpers.store.subscribe((value) => {
          const root = value as {
            pluginUserData: PluginUserDataState;
            tasks: {
              entities: Record<
                string,
                {
                  dueDay?: string;
                  deadlineDay?: string;
                  isDone?: boolean;
                  doneOn?: number;
                  wontDoOn?: number;
                }
              >;
              taskHistory?: Record<string, TaskHistoryRecord>;
            };
          };
          const task = root.tasks.entities[id];
          queueMicrotask(() => subscription.unsubscribe());
          resolve({
            dueDay: task?.dueDay,
            deadlineDay: task?.deadlineDay,
            isDone: task?.isDone,
            doneOn: task?.doneOn,
            wontDoOn: task?.wontDoOn,
            history: root.tasks.taskHistory?.[id],
            deliveries: root.pluginUserData,
          });
        });
      });
    },
    { id: taskId, update: changes },
  );

test.describe('@webdav task history survives concurrent offline edits', () => {
  for (const direction of ['local wins', 'remote wins'] as const) {
    test(`${direction}: both author histories survive sync, a new client, and restart`, async ({
      browser,
      baseURL,
      request,
      webdavServerUp,
    }, testInfo) => {
      void webdavServerUp;
      test.setTimeout(300000);
      const contexts: BrowserContext[] = [];
      const folder = generateSyncFolderName('task-history');
      await createSyncFolder(request, folder);
      const join = async (): Promise<Client> => {
        const { context, page } = await setupSyncClient(browser, baseURL);
        contexts.push(context);
        const client = {
          context,
          page,
          sync: new SyncPage(page),
          work: new WorkViewPage(page),
        };
        await client.work.waitForTaskList();
        await client.sync.setupWebdavSync({
          ...WEBDAV_CONFIG_TEMPLATE,
          syncFolderPath: `/${folder}`,
        });
        expect(await waitForSyncComplete(page, client.sync)).toBe('success');
        await page.addInitScript(() => {
          (window as unknown as Record<string, unknown>).__SP_E2E_BLOCK_AUTO_SYNC = true;
        });
        await page.evaluate(() => {
          (window as unknown as Record<string, unknown>).__SP_E2E_BLOCK_AUTO_SYNC = true;
        });
        return client;
      };
      const sync = async (client: Client): Promise<void> => {
        await client.sync.triggerSync();
        expect(await waitForSyncComplete(client.page, client.sync)).toBe('success');
      };
      try {
        const a = await join();
        const title = `History-${testInfo.testId}`;
        await a.work.addTask(title);
        const row = a.page.locator('task', { hasText: title });
        await expect(row).toBeVisible();
        const taskId = (await row.getAttribute('id'))!.replace(/^t-/, '');
        expect(taskId).toBeTruthy();
        await taskState(a.page, taskId, { isDone: true, doneOn: Date.now() });
        await sync(a);
        const b = await join();
        await sync(b);
        await a.context.setOffline(true);
        await b.context.setOffline(true);
        expect(await a.page.evaluate(() => navigator.onLine)).toBe(false);
        expect(await b.page.evaluate(() => navigator.onLine)).toBe(false);
        const changeA = {
          dueDay: await getBrowserLocalDateStr(a.page, 1),
          deadlineDay: await getBrowserLocalDateStr(a.page, 4),
          isDone: false,
        };
        const localA = await taskState(a.page, taskId, changeA);
        // Separate author timestamps establish an unambiguous LWW winner.
        await b.page.waitForTimeout(50);
        const doneOn = Date.now();
        const changeB = {
          dueDay: await getBrowserLocalDateStr(b.page, 2),
          deadlineDay: await getBrowserLocalDateStr(b.page, 5),
          isDone: true,
          doneOn,
          wontDoOn: doneOn,
        };
        const localB = await taskState(b.page, taskId, changeB);
        const expectedEvents = [
          ...new Map(
            [
              ...Object.values(localA.history?.events ?? {}),
              ...Object.values(localB.history?.events ?? {}),
            ].map((event) => [event.id, event] as const),
          ).values(),
        ];
        expect(expectedEvents).toHaveLength(7);
        expect(
          expectedEvents
            .filter((event) => event.field === 'status')
            .map((event) =>
              event.after.kind === 'status' ? event.after.value : 'unexpected',
            )
            .sort(),
        ).toEqual(['done', 'open', 'wontDo']);
        for (const status of ['open', 'wontDo']) {
          expect(
            expectedEvents.find(
              (event) =>
                event.field === 'status' &&
                event.after.kind === 'status' &&
                event.after.value === status,
            )?.before,
          ).toEqual({ kind: 'status', value: 'done' });
        }
        await a.context.setOffline(false);
        await b.context.setOffline(false);
        if (direction === 'local wins') {
          await sync(a);
          await sync(b);
        } else {
          await sync(b);
          await sync(a);
        }
        for (const client of [a, b, a, b]) await sync(client);

        const expectedIds = expectedEvents.map((event) => event.id).sort();
        const expectedDeliveries = (await taskState(a.page, taskId)).deliveries;
        expect(expectedDeliveries.length).toBeGreaterThan(1);
        const assertClient = async (client: Client): Promise<void> => {
          const result = await taskState(client.page, taskId);
          // Full rows must converge as well as the projected author events.
          // Comparing by ID separately distinguishes content loss from ordering.
          expect(
            Object.fromEntries(result.deliveries.map(({ id, data }) => [id, data])),
          ).toEqual(
            Object.fromEntries(expectedDeliveries.map(({ id, data }) => [id, data])),
          );
          expect(result.deliveries).toEqual(expectedDeliveries);
          expect({ dueDay: result.dueDay, deadlineDay: result.deadlineDay }).toEqual({
            dueDay: changeB.dueDay,
            deadlineDay: changeB.deadlineDay,
          });
          expect(result.isDone).toBe(true);
          expect(result.doneOn).toBe(doneOn);
          expect(result.wontDoOn).toBe(doneOn);
          expect(Object.keys(result.history?.events ?? {}).sort()).toEqual(expectedIds);
          for (const event of expectedEvents)
            expect(result.history!.events[event.id]).toEqual(event);
          expect(Object.values(result.history?.gaps ?? {})).toEqual([]);
        };
        await assertClient(a);
        await assertClient(b);
        const c = await join();
        await sync(c);
        await assertClient(c);
        for (const client of [a, b, c]) {
          await client.page.reload({ waitUntil: 'domcontentloaded' });
          await waitForAppReady(client.page);
          await assertClient(client);
          // Re-delivery does not append copies or generate a new author event.
          await sync(client);
          await assertClient(client);
        }
      } finally {
        await closeContextsSafely(...contexts);
      }
    });
  }
  test('three clients converge delivery order after crossing time edits and restart', async ({
    browser,
    baseURL,
    request,
    webdavServerUp,
  }, testInfo) => {
    void webdavServerUp;
    test.setTimeout(300000);
    const contexts: BrowserContext[] = [];
    const folder = generateSyncFolderName('task-history');
    await createSyncFolder(request, folder);
    const join = async (): Promise<Client> => {
      const { context, page } = await setupSyncClient(browser, baseURL);
      contexts.push(context);
      const client = {
        context,
        page,
        sync: new SyncPage(page),
        work: new WorkViewPage(page),
      };
      await client.work.waitForTaskList();
      await client.sync.setupWebdavSync({
        ...WEBDAV_CONFIG_TEMPLATE,
        syncFolderPath: `/${folder}`,
      });
      expect(await waitForSyncComplete(page, client.sync)).toBe('success');
      await page.addInitScript(() => {
        (window as unknown as Record<string, unknown>).__SP_E2E_BLOCK_AUTO_SYNC = true;
      });
      await page.evaluate(() => {
        (window as unknown as Record<string, unknown>).__SP_E2E_BLOCK_AUTO_SYNC = true;
      });
      return client;
    };
    const sync = async (client: Client): Promise<void> => {
      await client.sync.triggerSync();
      expect(await waitForSyncComplete(client.page, client.sync)).toBe('success');
    };

    const track = async (
      client: Client,
      taskId: string,
      duration: number,
    ): Promise<void> => {
      const state = await taskState(client.page, taskId);
      if (state.isDone) await taskState(client.page, taskId, { isDone: false });
      const date = await getBrowserLocalDateStr(client.page, 0);
      await client.page.evaluate(
        async ({ taskId: id, date: day, duration: elapsed }) => {
          const helpers = (
            window as unknown as {
              __e2eTestHelpers: {
                store: {
                  dispatch: (action: unknown) => void;
                  subscribe: (read: (value: unknown) => void) => {
                    unsubscribe: () => void;
                  };
                };
                flushPendingWrites: () => Promise<void>;
              };
            }
          ).__e2eTestHelpers;
          const task = await new Promise<unknown>((resolve) => {
            const subscription = helpers.store.subscribe((root) => {
              resolve(
                (root as { tasks: { entities: Record<string, unknown> } }).tasks.entities[
                  id
                ],
              );
              queueMicrotask(() => subscription.unsubscribe());
            });
          });
          helpers.store.dispatch({
            type: '[TimeTracking] Add time spent',
            task,
            date: day,
            duration: elapsed,
            isFromTrackingReminder: false,
          });
          helpers.store.dispatch({
            type: '[TimeTracking] Sync time spent',
            taskId: id,
            date: day,
            duration: elapsed,
            meta: {
              isPersistent: true,
              entityType: 'TASK',
              entityId: id,
              opType: 'UPD',
            },
          });
          await helpers.flushPendingWrites();
        },
        { taskId, date, duration },
      );
    };
    const expectedEvents: TaskHistoryRecord['events'] = {};
    const remember = async (client: Client, taskId: string): Promise<void> => {
      Object.assign(
        expectedEvents,
        (await taskState(client.page, taskId)).history?.events,
      );
    };
    try {
      const a = await join();
      const title = `Order-${testInfo.testId}`;
      await a.work.addTask(title);
      const row = a.page.locator('task', { hasText: title });
      await expect(row).toBeVisible();
      const taskId = (await row.getAttribute('id'))!.replace(/^t-/, '');
      await sync(a);
      const b = await join();
      const c = await join();
      await taskState(a.page, taskId, { isDone: true, doneOn: Date.now() });
      await remember(a, taskId);
      await sync(a);
      await a.page.reload({ waitUntil: 'domcontentloaded' });
      await waitForAppReady(a.page);
      await track(b, taskId, 2000);
      await remember(b, taskId);
      await sync(b);
      await taskState(c.page, taskId, { title: 'Renamed while other clients track' });
      await remember(c, taskId);
      await sync(c);
      await track(b, taskId, 4000);
      await remember(b, taskId);
      await track(a, taskId, 3000);
      await remember(a, taskId);
      for (let round = 0; round < 3; round++)
        for (const client of [a, b, c]) await sync(client);
      const fresh = await join();
      const expected = await taskState(fresh.page, taskId);
      expect(expected.deliveries.length).toBeGreaterThan(1);
      expect(Object.keys(expectedEvents).length).toBeGreaterThan(0);
      expect(expected.history?.events).toEqual(expectedEvents);
      for (const client of [a, b, c, fresh]) {
        for (let restart = 0; restart < 2; restart++) {
          const actual = await taskState(client.page, taskId);
          expect(
            Object.fromEntries(actual.deliveries.map(({ id, data }) => [id, data])),
          ).toEqual(
            Object.fromEntries(expected.deliveries.map(({ id, data }) => [id, data])),
          );
          expect(actual.history).toEqual(expected.history);
          expect(actual.deliveries).toEqual(expected.deliveries);
          if (!restart) {
            await client.page.reload({ waitUntil: 'domcontentloaded' });
            await waitForAppReady(client.page);
          }
        }
      }
    } finally {
      await closeContextsSafely(...contexts);
    }
  });
});

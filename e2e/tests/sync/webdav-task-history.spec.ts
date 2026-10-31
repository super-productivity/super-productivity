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
          dueDay: '2026-11-05',
          deadlineDay: '2026-11-08',
          isDone: false,
        };
        const localA = await taskState(a.page, taskId, changeA);
        // Separate author timestamps establish an unambiguous LWW winner.
        await b.page.waitForTimeout(50);
        const doneOn = Date.now();
        const changeB = {
          dueDay: '2026-11-06',
          deadlineDay: '2026-11-09',
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
        const assertClient = async (client: Client): Promise<void> => {
          const result = await taskState(client.page, taskId);
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
});

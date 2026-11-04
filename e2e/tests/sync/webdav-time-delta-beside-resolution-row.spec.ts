import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from '../../fixtures/webdav.fixture';
import { SyncPage } from '../../pages/sync.page';
import { TaskPage } from '../../pages/task.page';
import { WorkViewPage } from '../../pages/work-view.page';
import {
  closeContextsSafely,
  createSyncFolder,
  generateSyncFolderName,
  setupSyncClient,
  waitForSyncComplete,
  WEBDAV_CONFIG_TEMPLATE,
  type WebDavConfig,
} from '../../utils/sync-helpers';
import { waitForAppReady } from '../../utils/waits';

/**
 * #10421 / #10408 on a file-based provider: the same crossing as
 * supersync-time-delta-beside-resolution-row. B's only pending change to the
 * task is tracked time; A uploads a field-patch row for its notes conflict
 * with C. A file-based provider never rejects an upload, so B's delta reaches
 * the others with its original clock, concurrent with A's row: the devices
 * that hold the row must treat the delta as commuting too, whichever side of
 * the crossing they are on. C wrote its notes after A did, so they win per
 * field (#10422, #10437).
 */
interface Client {
  page: Page;
  sync: SyncPage;
  work: WorkViewPage;
}

interface TaskView {
  notes: string | null;
  isDone: boolean;
  hasDoneOn: boolean;
  timeSpent: number;
}

type StoreLike = {
  subscribe: (next: (state: unknown) => void) => { unsubscribe: () => void };
  dispatch: (action: unknown) => void;
};

/**
 * Optionally writes the notes or a time delta through the store, with the
 * actions the notes editor and the timer dispatch, then returns the task.
 */
const onTask = async (
  page: Page,
  title: string,
  write: { notes?: string; trackMs?: number } = {},
): Promise<TaskView> =>
  page.evaluate(
    async ({ name, notes, trackMs }) => {
      const store = (window as unknown as { __e2eTestHelpers?: { store?: StoreLike } })
        .__e2eTestHelpers?.store;
      if (!store) {
        throw new Error('E2E store helper is unavailable');
      }
      const readTask = (): Promise<Record<string, unknown>> =>
        new Promise((resolve, reject) => {
          const ref: { current?: { unsubscribe: () => void } } = {};
          ref.current = store.subscribe((state) => {
            window.setTimeout(() => ref.current?.unsubscribe());
            const root = state as Record<string, { entities?: Record<string, unknown> }>;
            const entities = (root.tasks ?? root.task)?.entities ?? {};
            const task = Object.values(entities).find(
              (value) =>
                typeof value === 'object' &&
                value !== null &&
                String((value as Record<string, unknown>).title).includes(name),
            );
            if (task) {
              resolve(task as Record<string, unknown>);
            } else {
              reject(new Error(`Task not found: ${name}`));
            }
          });
        });
      const task = await readTask();
      const meta = { isPersistent: true, entityType: 'TASK', entityId: task.id };
      if (notes !== undefined) {
        store.dispatch({
          type: '[Task Shared] updateTask',
          task: { id: task.id, changes: { notes } },
          meta: { ...meta, opType: 'UPD' },
        });
      }
      if (trackMs !== undefined) {
        const date = '2026-07-13';
        store.dispatch({
          type: '[TimeTracking] Add time spent',
          task,
          date,
          duration: trackMs,
          isFromTrackingReminder: false,
        });
        store.dispatch({
          type: '[TimeTracking] Sync time spent',
          taskId: task.id,
          date,
          duration: trackMs,
          meta: { ...meta, opType: 'UPD' },
        });
      }
      const current = await readTask();
      return {
        notes: typeof current.notes === 'string' ? current.notes : null,
        isDone: current.isDone === true,
        hasDoneOn: typeof current.doneOn === 'number',
        timeSpent: typeof current.timeSpent === 'number' ? current.timeSpent : 0,
      };
    },
    { name: title, notes: write.notes, trackMs: write.trackMs },
  );

test.describe('@webdav tracked time beside another device resolution row', () => {
  for (const bTracksLast of [true, false]) {
    const name = bTracksLast
      ? 'a delta tracked after the row keeps the done toggle and notes everywhere'
      : 'a delta tracked before the row reaches every device';
    test(name, async ({ browser, baseURL, request, webdavServerUp }, testInfo) => {
      void webdavServerUp;
      test.setTimeout(300000);
      const contexts: BrowserContext[] = [];
      const folder = generateSyncFolderName('e2e-delta-beside-row');
      await createSyncFolder(request, folder);
      const config: WebDavConfig = {
        ...WEBDAV_CONFIG_TEMPLATE,
        syncFolderPath: `/${folder}`,
      };
      const title = `DeltaBesideRow-${testInfo.testId}`;
      const join = async (): Promise<Client> => {
        const { context, page } = await setupSyncClient(browser, baseURL);
        contexts.push(context);
        const client = { page, sync: new SyncPage(page), work: new WorkViewPage(page) };
        await client.work.waitForTaskList();
        await client.sync.setupWebdavSync(config);
        expect(await waitForSyncComplete(page, client.sync)).toBe('success');
        // From here on every sync is an explicit click, also after a reload.
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
        await a.work.addTask(title);
        await expect(a.page.locator('task', { hasText: title })).toBeVisible();
        await sync(a);
        const b = await join();
        const c = await join();
        await sync(b);
        await sync(c);
        await expect(c.page.locator('task', { hasText: title })).toBeVisible();

        if (!bTracksLast) await onTask(b.page, title, { trackMs: 3000 });
        await onTask(a.page, title, { notes: 'Notes written on A' });
        await onTask(c.page, title, { notes: 'Notes written on C' });
        await onTask(a.page, title, { trackMs: 2000 });
        await new TaskPage(c.page).markTaskAsDone(
          c.page.locator('task', { hasText: title }),
        );
        await sync(c);
        if (bTracksLast) await onTask(b.page, title, { trackMs: 3000 });

        // A resolves its notes conflict with C; B then meets A's row.
        for (const client of [a, b, c, a, b, c]) {
          await sync(client);
        }

        const expected: TaskView = {
          notes: 'Notes written on C',
          isDone: true,
          hasDoneOn: true,
          timeSpent: 5000,
        };
        const expectConverged = async (): Promise<void> => {
          await expect
            .poll(
              async () => ({
                A: await onTask(a.page, title),
                B: await onTask(b.page, title),
                C: await onTask(c.page, title),
              }),
              { timeout: 30000 },
            )
            .toEqual({ A: expected, B: expected, C: expected });
        };
        await expectConverged();

        // Replay is status-blind: a restart must reproduce live state.
        for (const client of [a, b, c]) {
          await client.page.reload({ waitUntil: 'domcontentloaded' });
          await waitForAppReady(client.page);
        }
        await expectConverged();
      } finally {
        await closeContextsSafely(...contexts);
      }
    });
  }
});

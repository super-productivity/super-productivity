import type { APIRequestContext, Browser, BrowserContext, Page } from '@playwright/test';
import { FILE_BASED_SYNC_CONSTANTS } from '@sp/sync-providers/file-based';
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
import { waitForStatePersistence } from '../../utils/waits';
import { dispatchTaskUpdates, pendingOpCount } from '../../utils/file-sync-churn';

/**
 * #10972: a file-based client that comes back with a pending edit after the
 * other client pushed more ops than the file keeps (`MAX_RECENT_OPS`) got the
 * whole-dataset "Keep local / Keep remote" dialog, even for an edit nobody else
 * touched. The file only grew since B last synced, so B must adopt the
 * snapshot, keep its edit, and upload it; a crossing edit of the same task
 * converges on the later one.
 *
 * Real path end to end: A's churn is real task updates dispatched into A's
 * store and uploaded by A's normal sync, in two uploads so the batch right
 * after B's cursor is trimmed out of the file completely.
 */

const { MAX_RECENT_OPS } = FILE_BASED_SYNC_CONSTANTS;

type Client = { page: Page; sync: SyncPage; work: WorkViewPage };

/** Renames a task through a real, persistent store dispatch. */
const renameTask = async (page: Page, from: string, to: string): Promise<void> => {
  const taskId = await page
    .locator('task', { hasText: from })
    .first()
    .getAttribute('data-task-id');
  expect(taskId).toBeTruthy();
  await page.evaluate(
    ({ id, title }) => {
      (
        window as unknown as {
          __e2eTestHelpers: { store: { dispatch: (action: unknown) => void } };
        }
      ).__e2eTestHelpers.store.dispatch({
        type: '[Task Shared] updateTask',
        task: { id, changes: { title } },
        meta: { isPersistent: true, entityType: 'TASK', entityId: id, opType: 'UPD' },
      });
    },
    { id: taskId!, title: to },
  );
  await expect(page.locator('task', { hasText: to })).toBeVisible();
  await waitForStatePersistence(page);
};

test.describe('@webdav returning device after the file trimmed past its cursor #10972', () => {
  test.beforeEach(async ({ webdavServerUp }) => {
    expect(webdavServerUp).toBe(true);
  });

  for (const isUseSplitSyncFiles of [false, true]) {
    const setup = async (
      fx: { browser: Browser; baseURL?: string; request: APIRequestContext },
      contexts: BrowserContext[],
    ): Promise<{
      a: Client;
      b: Client;
      syncOnce: (c: Client) => Promise<void>;
      churnPastBuffer: (a: Client) => Promise<void>;
    }> => {
      const { browser, baseURL, request } = fx;
      const folder = generateSyncFolderName(`returning-trim-${isUseSplitSyncFiles}`);
      await createSyncFolder(request, folder);
      const config = {
        ...WEBDAV_CONFIG_TEMPLATE,
        syncFolderPath: `/${folder}`,
        isUseSplitSyncFiles,
      };
      const client = async (): Promise<Client> => {
        const { context, page } = await setupSyncClient(browser, baseURL);
        contexts.push(context);
        const work = new WorkViewPage(page);
        await work.waitForTaskList();
        // B stays "offline" simply by not syncing; A's uploads stay test-controlled.
        await page.evaluate(() => {
          (
            window as unknown as {
              __e2eTestHelpers: { store: { dispatch: (action: unknown) => void } };
            }
          ).__e2eTestHelpers.store.dispatch({
            type: '[Global Config] Update Global Config Section',
            sectionKey: 'sync',
            sectionCfg: { isManualSyncOnly: true },
          });
        });
        return { page, sync: new SyncPage(page), work };
      };
      const syncOnce = async (c: Client): Promise<void> => {
        await c.sync.triggerSync();
        // Before #10972 B's first sync here ended in 'conflict' (the dialog).
        expect(await waitForSyncComplete(c.page, c.sync, 60000)).toBe('success');
      };
      const churnPastBuffer = async (a: Client): Promise<void> => {
        // First upload lands right after B's cursor; the second, larger one
        // trims it out of the file completely (a real gap, not #10973's cut).
        await dispatchTaskUpdates(a.page, 'Churn task', 100, 0);
        await syncOnce(a);
        await dispatchTaskUpdates(a.page, 'Churn task', MAX_RECENT_OPS + 100, 1000);
        await syncOnce(a);
      };

      const a = await client();
      const b = await client();
      await a.work.addTask('Churn task');
      await a.work.addTask('Shared task');
      await waitForStatePersistence(a.page);
      await a.sync.setupWebdavSync(config);
      expect(await waitForSyncComplete(a.page, a.sync)).toBe('success');
      await b.sync.setupWebdavSync(config);
      expect(await waitForSyncComplete(b.page, b.sync)).toBe('success');
      await expect(b.page.locator('task', { hasText: 'Shared task' })).toBeVisible();
      expect(await pendingOpCount(b.page)).toBe(0);
      return { a, b, syncOnce, churnPastBuffer };
    };

    test(`keeps an offline task added while the file trimmed (split=${isUseSplitSyncFiles})`, async ({
      browser,
      baseURL,
      request,
    }) => {
      test.setTimeout(300000);
      const contexts: BrowserContext[] = [];
      try {
        const { a, b, syncOnce, churnPastBuffer } = await setup(
          { browser, baseURL, request },
          contexts,
        );
        await b.work.addTask('B offline task');
        await waitForStatePersistence(b.page);
        await churnPastBuffer(a);

        await syncOnce(b);
        await expect(b.page.locator('task', { hasText: 'B offline task' })).toBeVisible();
        await expect(b.page.locator('task')).toHaveCount(3);
        expect(await pendingOpCount(b.page)).toBe(0);

        await syncOnce(a);
        await expect(a.page.locator('task', { hasText: 'B offline task' })).toBeVisible();
        await expect(a.page.locator('task')).toHaveCount(3);
      } finally {
        await closeContextsSafely(...contexts);
      }
    });

    for (const winner of ['A', 'B'] as const) {
      test(`crossing rename converges on the later edit, ${winner} wins (split=${isUseSplitSyncFiles})`, async ({
        browser,
        baseURL,
        request,
      }) => {
        test.setTimeout(300000);
        const contexts: BrowserContext[] = [];
        try {
          const { a, b, syncOnce, churnPastBuffer } = await setup(
            { browser, baseURL, request },
            contexts,
          );
          // The later rename wins by LWW timestamp; the churn sits between them.
          if (winner === 'A') await renameTask(b.page, 'Shared task', 'Shared by B');
          await churnPastBuffer(a);
          await renameTask(a.page, 'Shared task', 'Shared by A');
          await syncOnce(a);
          if (winner === 'B') await renameTask(b.page, 'Shared task', 'Shared by B');

          await syncOnce(b);
          // A resolves the crossing; when its side wins it heals B.
          await syncOnce(a);
          await syncOnce(b);
          await syncOnce(a);

          const expected = `Shared by ${winner}`;
          const loser = winner === 'A' ? 'Shared by B' : 'Shared by A';
          for (const c of [a, b]) {
            await expect(c.page.locator('task', { hasText: expected })).toBeVisible();
            await expect(c.page.locator('task', { hasText: loser })).toHaveCount(0);
            await expect(c.page.locator('task')).toHaveCount(2);
          }
          expect(await pendingOpCount(a.page)).toBe(0);
          expect(await pendingOpCount(b.page)).toBe(0);
        } finally {
          await closeContextsSafely(...contexts);
        }
      });
    }
  }
});

import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from '../../fixtures/webdav.fixture';
import { SyncPage } from '../../pages/sync.page';
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
 * #10422 on a file-based provider: the same crossing as
 * supersync-field-patch-timestamp. A writes notes, then renames. C writes
 * newer notes. B renames last. A field patch used to re-send the other side's
 * older fields at the newest time of both sides, so A's notes beat C's newer
 * notes everywhere. A file-based provider never rejects an upload, so the
 * resolver's re-send and the other side's ops all reach every device. Every
 * device must end on B's title and C's notes, also after a restart.
 */
interface Client {
  page: Page;
  sync: SyncPage;
  work: WorkViewPage;
}

interface TaskView {
  title: string;
  notes: string | null;
}

type StoreLike = {
  subscribe: (next: (state: unknown) => void) => { unsubscribe: () => void };
  dispatch: (action: unknown) => void;
};

/**
 * Optionally writes the title or notes through the store with the action the
 * task editors dispatch, then returns the task. The task is found by its id.
 */
const onTask = async (
  page: Page,
  id: string,
  changes?: Partial<TaskView>,
): Promise<TaskView> =>
  page.evaluate(
    async ({ taskId, taskChanges }) => {
      const store = (window as unknown as { __e2eTestHelpers?: { store?: StoreLike } })
        .__e2eTestHelpers?.store;
      if (!store) {
        throw new Error('E2E store helper is unavailable');
      }
      if (taskChanges) {
        store.dispatch({
          type: '[Task Shared] updateTask',
          task: { id: taskId, changes: taskChanges },
          meta: {
            isPersistent: true,
            entityType: 'TASK',
            entityId: taskId,
            opType: 'UPD',
          },
        });
      }
      const task = await new Promise<Record<string, unknown>>((resolve, reject) => {
        const ref: { current?: { unsubscribe: () => void } } = {};
        ref.current = store.subscribe((state) => {
          window.setTimeout(() => ref.current?.unsubscribe());
          const root = state as Record<string, { entities?: Record<string, unknown> }>;
          const found = (root.tasks ?? root.task)?.entities?.[taskId];
          if (found) {
            resolve(found as Record<string, unknown>);
          } else {
            reject(new Error(`Task not found: ${taskId}`));
          }
        });
      });
      return {
        title: String(task.title),
        notes: typeof task.notes === 'string' ? task.notes : null,
      };
    },
    { taskId: id, taskChanges: changes },
  );

/** The id of the task whose title contains `name`. */
const taskIdOf = async (page: Page, name: string): Promise<string> =>
  page.evaluate((title) => {
    const store = (window as unknown as { __e2eTestHelpers?: { store?: StoreLike } })
      .__e2eTestHelpers?.store;
    return new Promise<string>((resolve, reject) => {
      const ref: { current?: { unsubscribe: () => void } } = {};
      ref.current = store?.subscribe((state) => {
        window.setTimeout(() => ref.current?.unsubscribe());
        const root = state as Record<string, { entities?: Record<string, unknown> }>;
        const task = Object.values((root.tasks ?? root.task)?.entities ?? {}).find(
          (value) =>
            String((value as Record<string, unknown> | undefined)?.title).includes(title),
        ) as Record<string, unknown> | undefined;
        if (task) resolve(String(task.id));
        else reject(new Error(`Task not found: ${title}`));
      });
    });
  }, name);

test.describe('@webdav field patch timestamps (#10422)', () => {
  for (const direction of ['remote win', 'local win'] as const) {
    test(`a third device's newer notes survive a ${direction} patch`, async ({
      browser,
      baseURL,
      request,
      webdavServerUp,
    }, testInfo) => {
      void webdavServerUp;
      test.setTimeout(300000);
      const contexts: BrowserContext[] = [];
      const folder = generateSyncFolderName('e2e-patch-time');
      await createSyncFolder(request, folder);
      const config: WebDavConfig = {
        ...WEBDAV_CONFIG_TEMPLATE,
        syncFolderPath: `/${folder}`,
      };
      const name = `PatchTime-${testInfo.testId}`;
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
        await a.work.addTask(name);
        await expect(a.page.locator('task', { hasText: name })).toBeVisible();
        await sync(a);
        const b = await join();
        const c = await join();
        await sync(b);
        await sync(c);
        await expect(c.page.locator('task', { hasText: name })).toBeVisible();
        const id = await taskIdOf(a.page, name);

        // Distinct wall-clock times keep the LWW order unambiguous.
        const later = (): Promise<void> => a.page.waitForTimeout(50);
        await onTask(a.page, id, { notes: 'Notes from A (oldest)' });
        await later();
        await onTask(a.page, id, { title: `${name} A` });
        if (direction === 'local win') {
          // A's ops reach the server first; B resolves against them and wins.
          await sync(a);
        }
        await later();
        await onTask(c.page, id, { notes: 'Notes from C (newest)' });
        await later();
        await onTask(b.page, id, { title: `${name} B` });
        await sync(b);
        if (direction === 'remote win') {
          // A resolves against B's newer rename and loses it.
          await sync(a);
        }
        await sync(c);
        for (const client of [a, b, c, a, b, c]) {
          await sync(client);
        }

        const expected: TaskView = { title: `${name} B`, notes: 'Notes from C (newest)' };
        const expectConverged = async (): Promise<void> => {
          await expect
            .poll(
              async () => ({
                A: await onTask(a.page, id),
                B: await onTask(b.page, id),
                C: await onTask(c.page, id),
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

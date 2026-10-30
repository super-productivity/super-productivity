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
import { waitForAppReady, waitForStatePersistence } from '../../utils/waits';
import { pendingOpCount } from '../../utils/file-sync-churn';

/**
 * 2026 user survey: "My tablet, which I only use occasionally in the evenings,
 * kept overwriting my phone/PC updates whenever I opened it" (WebDAV, sync on
 * manual). Manual mode syncs on a cold start and on the sync button only, so a
 * resumed tablet shows its old state and the user edits on top of it.
 *
 * Below the trim threshold (above it is #10972), the stale device's edits must
 * merge with the phone's: its own fields and tasks win, everything it did not
 * touch keeps the phone's newer values on both devices.
 */
type Client = { page: Page; sync: SyncPage; work: WorkViewPage };
type TaskView = { title: string; notes: string | null; isDone: boolean };
type StoreLike = {
  dispatch: (action: unknown) => void;
  subscribe: (next: (state: unknown) => void) => { unsubscribe: () => void };
};

const taskIdOf = async (page: Page, title: string): Promise<string> => {
  const id = await page
    .locator('task', { hasText: title })
    .first()
    .getAttribute('data-task-id');
  expect(id).toBeTruthy();
  return id!;
};

/** Writes changes with the action the task editors dispatch, then persists. */
const updateTask = async (
  page: Page,
  id: string,
  changes: Partial<TaskView>,
): Promise<void> => {
  await page.evaluate(
    ({ taskId, taskChanges }) => {
      (
        window as unknown as { __e2eTestHelpers: { store: StoreLike } }
      ).__e2eTestHelpers.store.dispatch({
        type: '[Task Shared] updateTask',
        task: { id: taskId, changes: taskChanges },
        meta: {
          isPersistent: true,
          entityType: 'TASK',
          entityId: taskId,
          opType: 'UPD',
        },
      });
    },
    { taskId: id, taskChanges: changes },
  );
  await waitForStatePersistence(page);
};

const readTask = (page: Page, id: string): Promise<TaskView | null> =>
  page.evaluate(
    (taskId) =>
      new Promise<TaskView | null>((resolve) => {
        const store = (window as unknown as { __e2eTestHelpers: { store: StoreLike } })
          .__e2eTestHelpers.store;
        const ref: { current?: { unsubscribe: () => void } } = {};
        // The store emits synchronously, before `subscribe` has returned.
        ref.current = store.subscribe((state) => {
          window.setTimeout(() => ref.current?.unsubscribe());
          const root = state as Record<
            string,
            { entities?: Record<string, TaskView | undefined> } | undefined
          >;
          const t = (root.tasks ?? root.task)?.entities?.[taskId];
          resolve(
            t ? { title: t.title, notes: t.notes ?? null, isDone: !!t.isDone } : null,
          );
        });
      }),
    id,
  );

test.describe('@webdav stale manual-sync device below the trim threshold', () => {
  test.beforeEach(async ({ webdavServerUp }) => {
    expect(webdavServerUp).toBe(true);
  });

  const setup = async (
    fx: { browser: Parameters<typeof setupSyncClient>[0]; baseURL?: string },
    request: Parameters<typeof createSyncFolder>[0],
    contexts: BrowserContext[],
  ): Promise<{
    phone: Client;
    tablet: Client;
    syncOnce: (c: Client) => Promise<void>;
  }> => {
    const folder = generateSyncFolderName('stale-manual');
    await createSyncFolder(request, folder);
    const config = { ...WEBDAV_CONFIG_TEMPLATE, syncFolderPath: `/${folder}` };
    const client = async (): Promise<Client> => {
      const { context, page } = await setupSyncClient(fx.browser, fx.baseURL);
      contexts.push(context);
      const work = new WorkViewPage(page);
      await work.waitForTaskList();
      // Both manual so the test controls every sync; the tablet's is the survey setting.
      await page.evaluate(() => {
        (
          window as unknown as { __e2eTestHelpers: { store: StoreLike } }
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
      expect(await waitForSyncComplete(c.page, c.sync, 60000)).toBe('success');
    };

    const phone = await client();
    const tablet = await client();
    for (const title of ['Rename me', 'Finish me', 'Tablet notes']) {
      await phone.work.addTask(title);
    }
    await waitForStatePersistence(phone.page);
    await phone.sync.setupWebdavSync(config);
    expect(await waitForSyncComplete(phone.page, phone.sync)).toBe('success');
    await tablet.sync.setupWebdavSync(config);
    expect(await waitForSyncComplete(tablet.page, tablet.sync)).toBe('success');
    await expect(tablet.page.locator('task', { hasText: 'Tablet notes' })).toBeVisible();
    expect(await pendingOpCount(tablet.page)).toBe(0);
    return { phone, tablet, syncOnce };
  };

  test('edits made on the stale view merge with the newer phone edits', async ({
    browser,
    baseURL,
    request,
  }) => {
    test.setTimeout(180000);
    const contexts: BrowserContext[] = [];
    try {
      const { phone, tablet, syncOnce } = await setup(
        { browser, baseURL },
        request,
        contexts,
      );
      const renameId = await taskIdOf(phone.page, 'Rename me');
      const finishId = await taskIdOf(phone.page, 'Finish me');
      const notesId = await taskIdOf(phone.page, 'Tablet notes');

      // Daytime on the phone.
      await updateTask(phone.page, renameId, { title: 'Renamed on phone' });
      await updateTask(phone.page, finishId, { isDone: true });
      await phone.work.addTask('Added on phone');
      await waitForStatePersistence(phone.page);
      await syncOnce(phone);

      // Evening on the tablet, which has not synced since and still shows the old state.
      await expect(tablet.page.locator('task', { hasText: 'Rename me' })).toBeVisible();
      await updateTask(tablet.page, renameId, { notes: 'note from tablet' });
      await updateTask(tablet.page, notesId, { notes: 'tablet only' });
      await syncOnce(tablet);
      await syncOnce(phone);
      await syncOnce(tablet);

      for (const c of [phone, tablet]) {
        expect(await readTask(c.page, renameId)).toEqual({
          title: 'Renamed on phone',
          notes: 'note from tablet',
          isDone: false,
        });
        expect((await readTask(c.page, finishId))?.isDone).toBe(true);
        expect(await readTask(c.page, notesId)).toEqual({
          title: 'Tablet notes',
          notes: 'tablet only',
          isDone: false,
        });
        await expect(c.page.locator('task', { hasText: 'Added on phone' })).toBeVisible();
        expect(await pendingOpCount(c.page)).toBe(0);
      }
    } finally {
      await closeContextsSafely(...contexts);
    }
  });

  test('a cold start in manual mode adopts the phone edits and uploads nothing stale', async ({
    browser,
    baseURL,
    request,
  }) => {
    test.setTimeout(180000);
    const contexts: BrowserContext[] = [];
    try {
      const { phone, tablet, syncOnce } = await setup(
        { browser, baseURL },
        request,
        contexts,
      );
      const renameId = await taskIdOf(phone.page, 'Rename me');
      await updateTask(phone.page, renameId, { title: 'Renamed on phone' });
      await phone.work.addTask('Added on phone');
      await waitForStatePersistence(phone.page);
      await syncOnce(phone);

      // Opening the app from scratch runs the initial sync even in manual mode.
      await tablet.page.reload();
      await waitForAppReady(tablet.page);
      await expect(
        tablet.page.locator('task', { hasText: 'Renamed on phone' }),
      ).toBeVisible({ timeout: 30000 });
      await expect(
        tablet.page.locator('task', { hasText: 'Added on phone' }),
      ).toBeVisible();
      expect(await pendingOpCount(tablet.page)).toBe(0);

      await syncOnce(phone);
      expect((await readTask(phone.page, renameId))?.title).toBe('Renamed on phone');
      await expect(phone.page.locator('task')).toHaveCount(4);
    } finally {
      await closeContextsSafely(...contexts);
    }
  });
});

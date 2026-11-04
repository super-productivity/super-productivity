import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test } from '../../fixtures/webdav.fixture';
import { SyncPage } from '../../pages/sync.page';
import { WorkViewPage } from '../../pages/work-view.page';
import {
  closeContextsSafely,
  createSyncFolder,
  generateSyncFolderName,
  readPrefixedFile,
  setupSyncClient,
  waitForSyncComplete,
  WEBDAV_CONFIG_TEMPLATE,
  WEBDAV_SYNC_FILE,
  WEBDAV_SYNC_FORMAT,
} from '../../utils/sync-helpers';
import { waitForStatePersistence } from '../../utils/waits';
import { allowDevErrorsInCurrentTest } from '../../utils/runtime-errors';

const task = (page: Page, title: string): ReturnType<Page['locator']> =>
  page.locator('task').filter({ hasText: title });

/**
 * Adds a tag id that exists nowhere to a task, as a real persistent update.
 * A client that applies this op repairs its state (invalid reference removed)
 * and so appends a local REPAIR full-state op.
 */
const addGhostTagReference = async (page: Page, title: string): Promise<void> => {
  const taskId = await task(page, title).first().getAttribute('data-task-id');
  expect(taskId).toBeTruthy();
  // The dangling tag reference is the corruption under test; the validator
  // reports it through devError().
  allowDevErrorsInCurrentTest(/tagId from task not existing/);
  await page.evaluate((id) => {
    const helpers = (
      window as unknown as {
        __e2eTestHelpers: {
          store: { dispatch: (action: unknown) => void };
          flushPendingWrites: () => Promise<void>;
        };
      }
    ).__e2eTestHelpers;
    helpers.store.dispatch({
      type: '[Task Shared] updateTask',
      task: { id, changes: { tagIds: ['ghost-tag-stale-repair'] } },
      isIgnoreShortSyntax: true,
      meta: { isPersistent: true, entityType: 'TASK', entityId: id, opType: 'UPD' },
    });
    return helpers.flushPendingWrites();
  }, taskId!);
};

/** The remote as a fresh client reads it (snapshot plus ops), as raw JSON. */
const readRemoteJson = async (
  request: APIRequestContext,
  folder: string,
): Promise<string> => {
  const folderUrl = `${WEBDAV_CONFIG_TEMPLATE.baseUrl}${folder}/`;
  const authorization = `Basic ${Buffer.from(
    `${WEBDAV_CONFIG_TEMPLATE.username}:${WEBDAV_CONFIG_TEMPLATE.password}`,
  ).toString('base64')}`;
  const main = await readPrefixedFile<{ snapshotRef?: { file?: string } }>(
    request,
    `${folderUrl}${WEBDAV_SYNC_FILE}`,
    authorization,
  );
  if (WEBDAV_SYNC_FORMAT !== 'v3') {
    return JSON.stringify(main);
  }
  const snapshot = await readPrefixedFile<unknown>(
    request,
    `${folderUrl}${main.snapshotRef?.file ?? 'sync-state.json'}`,
    authorization,
  );
  return JSON.stringify([main, snapshot]);
};

/**
 * Suspected data loss found while fixing #11470 (PR #11475): A builds a REPAIR
 * full-state op, but its upload fails (403; per #11344 it stays pending). B
 * then uploads task X. When A syncs again, its download applies X and moves
 * the rev the REPAIR is conditionally written on, so the old REPAIR payload
 * (built before X existed) uploads as the remote snapshot. A peer without
 * pending work (here a fresh client C) never sees X.
 */
test.describe('@webdav a pending REPAIR built before a download keeps the downloaded ops', () => {
  test.beforeEach(async ({ webdavServerUp }) => {
    void webdavServerUp;
  });

  test('a stale pending REPAIR snapshot does not drop a peer task its download applied', async ({
    browser,
    baseURL,
    request,
  }) => {
    test.setTimeout(240000);
    const folder = generateSyncFolderName('stale-repair');
    const shared = `Shared ${folder}`;
    const fromB = `X from B ${folder}`;
    const cfg = { ...WEBDAV_CONFIG_TEMPLATE, syncFolderPath: `/${folder}` };
    await createSyncFolder(request, folder);

    const a = await setupSyncClient(browser, baseURL);
    let b: Awaited<ReturnType<typeof setupSyncClient>> | undefined;
    let c: Awaited<ReturnType<typeof setupSyncClient>> | undefined;
    try {
      const syncA = new SyncPage(a.page);
      const workA = new WorkViewPage(a.page);
      await workA.waitForTaskList();
      await workA.addTask(shared);
      await waitForStatePersistence(a.page);
      await syncA.setupWebdavSync(cfg);
      expect(await waitForSyncComplete(a.page, syncA)).toBe('success');

      b = await setupSyncClient(browser, baseURL);
      const syncB = new SyncPage(b.page);
      const workB = new WorkViewPage(b.page);
      await workB.waitForTaskList();
      await syncB.setupWebdavSync(cfg);
      expect(await waitForSyncComplete(b.page, syncB)).toBe('success');
      await expect(task(b.page, shared)).toBeVisible();

      // B uploads an op whose application makes A repair its state.
      await addGhostTagReference(b.page, shared);
      await syncB.triggerSync();
      expect(await waitForSyncComplete(b.page, syncB)).toBe('success');

      // 1. A downloads the op and builds a REPAIR; its upload fails with 403,
      //    so the REPAIR stays pending (#11344), not rejected.
      let refusedWrites = 0;
      await a.page.route(`**/${folder}/**`, async (route) => {
        if (route.request().method() !== 'PUT') return route.continue();
        refusedWrites++;
        await route.fulfill({ status: 403, body: 'Forbidden' });
      });
      await syncA.triggerSync();
      await expect.poll(() => refusedWrites).toBeGreaterThan(0);
      await expect(syncA.syncSpinner).toBeHidden({ timeout: 30000 });

      // 2. B uploads task X.
      await workB.addTask(fromB);
      await waitForStatePersistence(b.page);
      await syncB.triggerSync();
      expect(await waitForSyncComplete(b.page, syncB)).toBe('success');

      // 3. A syncs again: its download applies X, then the pending REPAIR uploads.
      await a.page.unroute(`**/${folder}/**`);
      await syncA.triggerSync();
      expect(await waitForSyncComplete(a.page, syncA)).toBe('success');
      await expect(task(a.page, fromB)).toBeVisible();
      // A settling sync, in case the REPAIR uploads in a later round.
      await syncA.triggerSync();
      expect(await waitForSyncComplete(a.page, syncA)).toBe('success');

      // The remote still holds X, in its snapshot or its ops.
      expect(await readRemoteJson(request, folder)).toContain(fromB);

      // 4. A fresh client gets X.
      c = await setupSyncClient(browser, baseURL);
      const syncC = new SyncPage(c.page);
      const workC = new WorkViewPage(c.page);
      await workC.waitForTaskList();
      await syncC.setupWebdavSync(cfg);
      expect(await waitForSyncComplete(c.page, syncC)).toBe('success');
      await expect(task(c.page, shared)).toBeVisible();
      await expect(task(c.page, fromB)).toBeVisible();
    } finally {
      await closeContextsSafely(a.context, b?.context, c?.context);
    }
  });
});

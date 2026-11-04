import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test } from '../../fixtures/webdav.fixture';
import { ImportPage } from '../../pages/import.page';
import { SyncPage } from '../../pages/sync.page';
import { WorkViewPage } from '../../pages/work-view.page';
import { allowDevErrorsInCurrentTest } from '../../utils/runtime-errors';
import {
  closeContextsSafely,
  confirmSyncConflictOverwriteIfShown,
  createSyncFolder,
  generateSyncFolderName,
  setupSyncClient,
  waitForSyncComplete,
  WEBDAV_CONFIG_TEMPLATE,
} from '../../utils/sync-helpers';
import { waitForStatePersistence } from '../../utils/waits';

/**
 * #11470: a marked REPAIR must not wave a device past a replacement it never
 * loaded.
 *
 * R synced, then went offline with a pending task. A restored a backup; W, with
 * its own pending task, answered Keep local. W's SYNC_IMPORT merges every local
 * clock, so its base covers the clock R last saw. A then uploaded an op whose
 * application made W repair its state, and W wrote a REPAIR snapshot marked
 * with the clock it covers, which also covers R's. R returns.
 *
 * R never loaded W's Keep local. Keeping R's task on top would leave it on R
 * alone: A and W hold that SYNC_IMPORT and drop R's op as concurrent with it.
 * Expected: R gets the whole-dataset dialog, and the devices converge on the
 * answer. The marker records the base the REPAIR replaced (`from`), which R has
 * not loaded.
 *
 * Run: npm run quiet -- e2e:webdav:file e2e/tests/sync/webdav-repair-after-keep-local-11470.spec.ts --retries=0
 */
const INBOX_URL = '/#/project/INBOX_PROJECT/tasks';
const AUTHORIZATION =
  'Basic ' +
  Buffer.from(
    `${WEBDAV_CONFIG_TEMPLATE.username}:${WEBDAV_CONFIG_TEMPLATE.password}`,
  ).toString('base64');

const task = (page: Page, title: string): ReturnType<Page['locator']> =>
  page.locator('task').filter({ hasText: title });

/** Reads the envelope other devices read: sync-data.json, or sync-ops.json when split. */
const readEnvelope = async (
  request: APIRequestContext,
  folder: string,
  isSplit: boolean,
): Promise<{ snapshotBaseCovers?: unknown }> => {
  const file = isSplit ? 'sync-ops.json' : 'sync-data.json';
  const response = await request.get(
    `${WEBDAV_CONFIG_TEMPLATE.baseUrl}${folder}/DEV/${file}`,
    { headers: { Authorization: AUTHORIZATION } },
  );
  expect(response.ok()).toBe(true);
  const text = await response.text();
  return JSON.parse(text.slice(text.indexOf('__') + 2));
};

/** Stops background syncs, so a device only syncs when the test says so. */
const syncOnlyManually = (page: Page): Promise<void> =>
  page.evaluate(() => {
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

/**
 * Adds a tag id that exists nowhere to a task, as a real persistent update. A
 * client that applies it repairs its state and writes a REPAIR snapshot.
 */
const addGhostTagReference = async (page: Page, title: string): Promise<void> => {
  const taskId = await task(page, title).first().getAttribute('data-task-id');
  expect(taskId).toBeTruthy();
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
      task: { id, changes: { tagIds: ['ghost-tag-11470'] } },
      isIgnoreShortSyntax: true,
      meta: { isPersistent: true, entityType: 'TASK', entityId: id, opType: 'UPD' },
    });
    return helpers.flushPendingWrites();
  }, taskId!);
};

test.describe('@webdav a marked REPAIR still asks a device that missed a Keep local (#11470)', () => {
  test.beforeEach(async ({ webdavServerUp }) => {
    expect(webdavServerUp).toBe(true);
  });

  for (const isUseSplitSyncFiles of [false, true]) {
    test(`the returning device is asked and nothing diverges (split=${isUseSplitSyncFiles})`, async ({
      browser,
      baseURL,
      request,
    }) => {
      test.setTimeout(360000);
      // The ghost tag reference is the corruption that makes W repair.
      allowDevErrorsInCurrentTest(/tagId from task not existing/);
      const folder = generateSyncFolderName(`repair-keep-local-${isUseSplitSyncFiles}`);
      await createSyncFolder(request, folder);
      const cfg = {
        ...WEBDAV_CONFIG_TEMPLATE,
        syncFolderPath: `/${folder}`,
        isUseSplitSyncFiles,
      };
      const shared = `Shared ${folder}`;
      const wPending = `W pending ${folder}`;
      const rPending = `R pending ${folder}`;

      const clients: Awaited<ReturnType<typeof setupSyncClient>>[] = [];
      try {
        const join = async (
          title?: string,
        ): Promise<{ page: Page; sync: SyncPage; work: WorkViewPage }> => {
          const client = await setupSyncClient(browser, baseURL);
          clients.push(client);
          const sync = new SyncPage(client.page);
          const work = new WorkViewPage(client.page);
          await work.waitForTaskList();
          await syncOnlyManually(client.page);
          if (title) {
            await work.addTask(title);
            await waitForStatePersistence(client.page);
          }
          await sync.setupWebdavSync(cfg);
          expect(await waitForSyncComplete(client.page, sync)).toBe('success');
          return { page: client.page, sync, work };
        };
        const syncOk = async (c: { page: Page; sync: SyncPage }): Promise<void> => {
          await c.sync.triggerSync();
          expect(await waitForSyncComplete(c.page, c.sync)).toBe('success');
        };

        const a = await join(shared);
        const w = await join();
        const r = await join();
        await syncOk(w);
        await syncOk(r);
        await expect(task(r.page, shared).first()).toBeVisible();

        // R goes offline with pending work; W has pending work too.
        await r.work.addTask(rPending);
        await waitForStatePersistence(r.page);
        await w.work.addTask(wPending);
        await waitForStatePersistence(w.page);

        // A restores a backup; W answers it with Keep local (a SYNC_IMPORT).
        const importA = new ImportPage(a.page);
        await importA.navigateToImportPage();
        await importA.importBackupFile(ImportPage.getFixturePath('test-backup.json'));
        await a.page.goto(INBOX_URL);
        await a.sync.triggerSync();
        const importDecision = a.page.locator('dialog-sync-import-conflict');
        if (
          await importDecision
            .waitFor({ state: 'visible', timeout: 10000 })
            .then(() => true)
            .catch(() => false)
        ) {
          await importDecision
            .locator('button', {
              has: a.page.locator('mat-icon', { hasText: 'cloud_upload' }),
            })
            .click();
          await expect(importDecision).toBeHidden();
        }
        expect(await waitForSyncComplete(a.page, a.sync)).toBe('success');

        await w.sync.triggerSync();
        expect(
          await waitForSyncComplete(w.page, w.sync, 30000, { expectConflict: true }),
        ).toBe('conflict');
        const conflictW = w.page.locator('dialog-sync-conflict');
        w.sync.prepareForNextSyncCycle('write');
        await conflictW.locator('button', { hasText: /Keep local/i }).click();
        await confirmSyncConflictOverwriteIfShown(w.page, conflictW);
        await waitForSyncComplete(w.page, w.sync, 30000, {
          allowResponseOnlyCompletion: true,
        });

        // A loads W's Keep local, then uploads an op that makes W repair.
        await syncOk(a);
        await a.page.goto(INBOX_URL);
        await expect(task(a.page, wPending).first()).toBeVisible();
        await addGhostTagReference(a.page, wPending);
        await syncOk(a);
        await syncOk(w);
        // W wrote a REPAIR marked with the clock it covers.
        expect(
          (await readEnvelope(request, folder, isUseSplitSyncFiles)).snapshotBaseCovers,
        ).toBeDefined();

        // R returns: it never loaded W's Keep local, so it must be asked.
        await r.sync.triggerSync();
        expect(
          await waitForSyncComplete(r.page, r.sync, 30000, { expectConflict: true }),
        ).toBe('conflict');
        const conflictR = r.page.locator('dialog-sync-conflict');
        await conflictR.locator('button', { hasText: /Keep remote/i }).click();
        await confirmSyncConflictOverwriteIfShown(r.page, conflictR);
        await expect(
          r.page.locator('snack-custom', { hasText: /replaced with the server/i }),
        ).toBeVisible({ timeout: 30000 });

        // All three converge on the remote, as R chose.
        for (const c of [r, a, w, r]) await syncOk(c);
        for (const c of [a, w, r]) {
          await c.page.goto(INBOX_URL);
          await expect(task(c.page, shared).first()).toBeVisible();
          await expect(task(c.page, wPending).first()).toBeVisible();
          await expect(task(c.page, rPending)).toHaveCount(0);
        }
      } finally {
        await closeContextsSafely(...clients.map((c) => c.context));
      }
    });
  }
});

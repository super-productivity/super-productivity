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

const pendingIds = (page: Page): Promise<string[]> =>
  page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('SUP_OPS');
      request.onsuccess = (): void => resolve(request.result);
      request.onerror = (): void => reject(request.error);
    });
    try {
      return await new Promise<string[]>((resolve, reject) => {
        const request = db.transaction('ops').objectStore('ops').getAll();
        request.onsuccess = (): void => {
          const entries = request.result as Array<{
            op: { id: string };
            syncedAt?: number;
            rejectedAt?: number;
          }>;
          resolve(
            entries
              .filter(
                (entry) => entry.syncedAt === undefined && entry.rejectedAt === undefined,
              )
              .map((entry) => entry.op.id),
          );
        };
        request.onerror = (): void => reject(request.error);
      });
    } finally {
      db.close();
    }
  });

test.describe('@webdav stale monolith #10256', () => {
  test.beforeEach(async ({ webdavServerUp }) => {
    expect(webdavServerUp).toBe(true);
  });

  for (const { isUseSplitSyncFiles, firstSync } of [
    { isUseSplitSyncFiles: false, firstSync: false },
    { isUseSplitSyncFiles: true, firstSync: false },
    { isUseSplitSyncFiles: false, firstSync: true },
    { isUseSplitSyncFiles: true, firstSync: true },
  ]) {
    const scenario = firstSync
      ? 'migration probe preserves local and remote data'
      : 'fresh client retains both writers after upload cache expiry';
    test(`${scenario} (split=${isUseSplitSyncFiles})`, async ({
      browser,
      baseURL,
      request,
    }, testInfo) => {
      const folder = generateSyncFolderName(`stale-monolith-${isUseSplitSyncFiles}`);
      await createSyncFolder(request, folder);
      const config = {
        ...WEBDAV_CONFIG_TEMPLATE,
        syncFolderPath: `/${folder}`,
        isUseSplitSyncFiles,
      };
      const contexts: BrowserContext[] = [];
      const client = async (): Promise<{
        page: Page;
        sync: SyncPage;
        work: WorkViewPage;
      }> => {
        const { context, page } = await setupSyncClient(browser, baseURL);
        contexts.push(context);
        const work = new WorkViewPage(page);
        await work.waitForTaskList();
        const sync = new SyncPage(page);
        // Keep the race and its single retry under test control.
        await page.evaluate(() => {
          const helpers = (
            window as unknown as {
              __e2eTestHelpers: { store: { dispatch: (action: unknown) => void } };
            }
          ).__e2eTestHelpers;
          helpers.store.dispatch({
            type: '[Global Config] Update Global Config Section',
            sectionKey: 'sync',
            sectionCfg: { isManualSyncOnly: true },
          });
        });
        return { page, sync, work };
      };
      const syncOnce = async (c: Awaited<ReturnType<typeof client>>): Promise<void> => {
        await c.sync.triggerSync();
        expect(await waitForSyncComplete(c.page, c.sync)).toBe('success');
      };
      const aTask = 'Writer A task';
      const bTask = 'Writer B pending task';
      const titles = firstSync ? [aTask, bTask] : ['Shared baseline', aTask, bTask];
      const requiresFirstSyncDecision = firstSync && !isUseSplitSyncFiles;
      const remoteTitles = requiresFirstSyncDecision ? [aTask] : titles;
      try {
        const a = await client();
        let remoteUrl = '';
        a.page.on('request', (req) => {
          if (
            req.method() === 'PUT' &&
            req.url().endsWith(isUseSplitSyncFiles ? '/sync-ops.json' : '/sync-data.json')
          ) {
            remoteUrl = req.url();
          }
        });
        const b = await client();
        if (!firstSync) {
          await a.work.addTask('Shared baseline');
          await a.sync.setupWebdavSync(config);
          expect(await waitForSyncComplete(a.page, a.sync)).toBe('success');
          await b.sync.setupWebdavSync(config);
          expect(await waitForSyncComplete(b.page, b.sync)).toBe('success');
          await expect(b.page.locator('task')).toHaveCount(1);
        }
        await b.work.addTask(bTask);
        await waitForStatePersistence(b.page);

        // Hold the real upload lock: the ordinary download and cursor commit
        // finish first, while snapshot capture/upload waits. No adapter or
        // reducer is replaced by a mock.
        await b.page.evaluate(
          () =>
            new Promise<void>((acquired) => {
              void navigator.locks.request(
                'sp_op_log_upload',
                () =>
                  new Promise<void>((release) => {
                    (window as unknown as { releaseUpload: () => void }).releaseUpload =
                      release;
                    acquired();
                  }),
              );
            }),
        );
        if (firstSync) {
          await b.sync.setupWebdavSync(config);
        } else {
          await b.sync.triggerSync();
        }
        await expect
          .poll(() =>
            b.page.evaluate(async () =>
              (await navigator.locks.query()).pending?.some(
                (lock) => lock.name === 'sp_op_log_upload',
              ),
            ),
          )
          .toBe(true);
        // First-time setup also captures a config operation. Record all pending
        // work after setup, before the competing writer changes the remote.
        const pending = await pendingIds(b.page);
        expect(pending).toHaveLength(firstSync ? 2 : 1);

        await a.work.addTask(aTask);
        await waitForStatePersistence(a.page);
        if (firstSync) {
          await a.sync.setupWebdavSync(config);
          expect(await waitForSyncComplete(a.page, a.sync)).toBe('success');
        } else {
          await syncOnce(a);
        }
        await expect(b.page.locator('task', { hasText: aTask })).toHaveCount(0);
        let initialUploadWrites = 0;
        b.page.on('request', (req) => {
          if (req.method() === 'PUT') initialUploadWrites++;
        });

        if (!firstSync) {
          // Expire the actual cache without firing timers/auto-sync. On first
          // sync the migration probe instead seeds an unapplied, fresh cache.
          await b.page.clock.setFixedTime(new Date(Date.now() + 31_000));
        }
        const uploadRead = b.page.waitForResponse(
          (response) =>
            response.request().method() === 'GET' && response.url() === remoteUrl,
        );
        await b.page.evaluate(() =>
          (window as unknown as { releaseUpload: () => void }).releaseUpload(),
        );
        expect((await uploadRead).ok()).toBe(true);
        await expect(b.sync.syncSpinner).toBeHidden();
        await expect(b.sync.syncErrorIcon).toBeHidden();
        await expect(b.page.locator('dialog-sync-conflict')).toBeHidden();
        b.sync.completeTriggeredSyncCycle();

        const remaining = await pendingIds(b.page);
        if (remaining.length > 0) {
          // The fixed v2 writer refuses the stale snapshot and leaves the
          // original work pending for the next normal download/upload cycle.
          expect(remaining).toEqual(pending);
          expect(initialUploadWrites).toBe(0);
          await expect(b.page.locator('task', { hasText: bTask })).toBeVisible();
          if (requiresFirstSyncDecision) {
            // Independent first-time datasets use the existing conflict policy.
            // Cancelling must preserve both sides rather than silently overwrite.
            await b.sync.triggerSync();
            expect(await waitForSyncComplete(b.page, b.sync)).toBe('conflict');
            const dialog = b.page.locator('dialog-sync-conflict');
            await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
            await expect(dialog).toBeHidden();
            await expect(b.sync.syncSpinner).toBeHidden();
            expect(initialUploadWrites).toBe(0);
          } else {
            await syncOnce(b);
          }
        }
        expect(await pendingIds(b.page)).toEqual(
          requiresFirstSyncDecision ? pending : [],
        );
        const remote = await request.get(remoteUrl, {
          headers: {
            Authorization: `Basic ${Buffer.from('admin:admin').toString('base64')}`,
          },
        });
        expect(remote.ok()).toBe(true);
        const encoded = await remote.text();
        const data = JSON.parse(encoded.slice(encoded.indexOf('__') + 2)) as {
          version: number;
        };
        expect(data.version).toBe(isUseSplitSyncFiles ? 3 : 2);
        await testInfo.attach('remote-after-writer-b.json', {
          body: JSON.stringify(data, null, 2),
          contentType: 'application/json',
        });

        // C starts at seq 0, with the real snapshot hydration/replay pipeline.
        const c = await client();
        await c.sync.setupWebdavSync(config);
        expect(await waitForSyncComplete(c.page, c.sync)).toBe('success');
        await waitForStatePersistence(c.page);
        await c.page.reload();
        await waitForAppReady(c.page);
        await c.work.waitForTaskList();
        await expect(c.page.locator('task')).toHaveCount(remoteTitles.length);
        for (const title of remoteTitles) {
          await expect(c.page.locator('task', { hasText: title })).toBeVisible();
        }
        expect(remaining).toEqual(isUseSplitSyncFiles ? [] : pending);

        for (const writer of [a, b]) {
          if (!requiresFirstSyncDecision) await syncOnce(writer);
          await waitForStatePersistence(writer.page);
          await writer.page.reload();
          await waitForAppReady(writer.page);
          await writer.work.waitForTaskList();
          const writerTitles = requiresFirstSyncDecision
            ? [writer === a ? aTask : bTask]
            : titles;
          await expect(writer.page.locator('task')).toHaveCount(writerTitles.length);
          for (const title of writerTitles) {
            await expect(writer.page.locator('task', { hasText: title })).toBeVisible();
          }
        }
        if (requiresFirstSyncDecision) {
          expect(await pendingIds(b.page)).toEqual(pending);
        }
      } finally {
        await closeContextsSafely(...contexts);
      }
    });
  }
});

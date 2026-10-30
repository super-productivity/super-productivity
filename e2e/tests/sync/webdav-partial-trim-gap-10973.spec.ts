import type { BrowserContext, Page } from '@playwright/test';
import { FILE_BASED_SYNC_CONSTANTS } from '@sp/sync-providers/file-based';
import { test, expect } from '../../fixtures/webdav.fixture';
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
} from '../../utils/sync-helpers';
import { waitForStatePersistence } from '../../utils/waits';
import { dispatchTaskUpdates, pendingOpCount } from '../../utils/file-sync-churn';

/**
 * #10973: file-based sync trims `recentOps` per op, but one upload is one batch
 * under one syncVersion. When the trim cuts INSIDE the batch right after a
 * lagging client's cursor, the oldest retained op still has
 * `sv === cursor + 1`, no gap is detected, and the lagging client never
 * receives the trimmed head of that batch.
 *
 * Real path end to end: client A creates tasks through the UI and uploads them
 * as one batch; the churn that pushes them out of the buffer is real task
 * updates dispatched into A's store and uploaded by A's normal sync.
 */

interface RemoteOpsFile {
  syncVersion: number;
  recentOps: { sv?: number }[];
}

const AUTHORIZATION = `Basic ${Buffer.from(
  `${WEBDAV_CONFIG_TEMPLATE.username}:${WEBDAV_CONFIG_TEMPLATE.password}`,
).toString('base64')}`;
// Imported, not mirrored: the churn below is sized from these, so a changed cap
// must move the cut with it or the test would stop cutting inside the batch.
const { MAX_RECENT_OPS, SPLIT_COMPACTION_THRESHOLD } = FILE_BASED_SYNC_CONSTANTS;
const HEAD_TASK_COUNT = 10;

test.describe('@webdav partial trim inside the batch after a lagging cursor #10973', () => {
  test.beforeEach(async ({ webdavServerUp }) => {
    expect(webdavServerUp).toBe(true);
  });

  for (const isUseSplitSyncFiles of [false, true]) {
    test(`lagging client receives every task of a batch the trim cut into (split=${isUseSplitSyncFiles})`, async ({
      browser,
      baseURL,
      request,
    }) => {
      test.setTimeout(300000);
      const folder = generateSyncFolderName(`partial-trim-${isUseSplitSyncFiles}`);
      await createSyncFolder(request, folder);
      const config = {
        ...WEBDAV_CONFIG_TEMPLATE,
        syncFolderPath: `/${folder}`,
        isUseSplitSyncFiles,
      };
      // Dev builds write below a DEV/ subfolder.
      const remoteUrl = `${WEBDAV_CONFIG_TEMPLATE.baseUrl}${folder}/DEV/${
        isUseSplitSyncFiles ? 'sync-ops.json' : 'sync-data.json'
      }`;
      const readRemote = (): Promise<RemoteOpsFile> =>
        readPrefixedFile<RemoteOpsFile>(request, remoteUrl, AUTHORIZATION);

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
        // Each upload below must be exactly one, test-controlled batch.
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
      const syncOnce = async (c: Awaited<ReturnType<typeof client>>): Promise<void> => {
        await c.sync.triggerSync();
        expect(await waitForSyncComplete(c.page, c.sync, 60000)).toBe('success');
      };

      try {
        const a = await client();
        const b = await client();

        await a.work.addTask('Churn task');
        await waitForStatePersistence(a.page);
        await a.sync.setupWebdavSync(config);
        expect(await waitForSyncComplete(a.page, a.sync)).toBe('success');
        if (isUseSplitSyncFiles) {
          // The split format compacts only above MAX_RECENT_OPS and then keeps
          // SPLIT_COMPACTION_THRESHOLD ops, so the buffer must already hold more
          // than that before the head batch for the compaction to cut into it.
          await dispatchTaskUpdates(
            a.page,
            'Churn task',
            SPLIT_COMPACTION_THRESHOLD + 100,
            0,
          );
          await syncOnce(a);
        }

        // B syncs once, then lags. Its cursor is the current syncVersion.
        await b.sync.setupWebdavSync(config);
        expect(await waitForSyncComplete(b.page, b.sync)).toBe('success');
        await expect(b.page.locator('task', { hasText: 'Churn task' })).toBeVisible();
        expect(await pendingOpCount(b.page)).toBe(0);
        const laggingCursor = (await readRemote()).syncVersion;

        // A creates the head batch through the UI and uploads it in ONE sync.
        const headTitles = Array.from(
          { length: HEAD_TASK_COUNT },
          // Zero-padded so no title is a substring of another.
          (_, i) => `Head task ${String(i + 1).padStart(2, '0')}`,
        );
        for (const title of headTitles) {
          await a.work.addTask(title);
        }
        await waitForStatePersistence(a.page);
        await syncOnce(a);
        const afterHead = await readRemote();
        const headBatchSv = laggingCursor + 1;
        expect(afterHead.syncVersion).toBe(headBatchSv);
        const headBatchSize = afterHead.recentOps.filter(
          (op) => op.sv === headBatchSv,
        ).length;
        expect(headBatchSize).toBeGreaterThanOrEqual(HEAD_TASK_COUNT);

        // Churn sized so the per-op trim keeps only half of the head batch:
        // the cut lands INSIDE batch laggingCursor + 1.
        const keep = isUseSplitSyncFiles ? SPLIT_COMPACTION_THRESHOLD : MAX_RECENT_OPS;
        const retainedHeadOps = Math.floor(headBatchSize / 2);
        const churn = keep - retainedHeadOps;
        await dispatchTaskUpdates(a.page, 'Churn task', churn, 5000);
        expect(await pendingOpCount(a.page)).toBe(churn);
        // The tail upload must actually trim (split: trigger a compaction).
        expect(afterHead.recentOps.length + churn).toBeGreaterThan(MAX_RECENT_OPS);
        await syncOnce(a);
        const afterTail = await readRemote();
        expect(afterTail.syncVersion).toBe(headBatchSv + 1);

        // B catches up over several rounds; later A traffic must not hide a loss.
        await syncOnce(b);
        await dispatchTaskUpdates(a.page, 'Churn task', 3, 9000);
        await syncOnce(a);
        await syncOnce(b);
        await syncOnce(b);

        for (const title of headTitles) {
          await expect(
            b.page.locator('task', { hasText: title }),
            `B must receive "${title}"`,
          ).toBeVisible();
        }
        await expect(b.page.locator('task')).toHaveCount(HEAD_TASK_COUNT + 1);
      } finally {
        await closeContextsSafely(...contexts);
      }
    });
  }
});

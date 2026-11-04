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
} from '../../utils/sync-helpers';
import { translationText } from '../../utils/i18n-strings';
import { waitForStatePersistence } from '../../utils/waits';

const authorization = `Basic ${Buffer.from('admin:admin').toString('base64')}`;
const headers = { Authorization: authorization };

const remoteText = async (request: APIRequestContext, url: string): Promise<string> => {
  const response = await request.get(url, { headers });
  expect(response.ok(), `Expected remote file: ${url}`).toBe(true);
  return response.text();
};

/** From here on only the test starts sync cycles on this page. */
const blockBackgroundSync = (page: Page): Promise<void> =>
  page.evaluate(() => {
    (globalThis as unknown as Record<string, unknown>).__SP_E2E_BLOCK_AUTO_SYNC = true;
  });

test.describe('@webdav claiming a split folder neutralizes a surviving v2 backup', () => {
  test.beforeEach(async ({ webdavServerUp }) => {
    void webdavServerUp;
  });

  // A Surgical sync device creates a split folder where an interrupted v2 write
  // left only the v2 backup. Devices with Surgical sync saved off (every device
  // upgraded from 18.14-19.1) recover an unreadable sync-data.json from that
  // backup without looking at sync-ops.json.
  test('a torn tombstone does not bring v2 back over the split files', async ({
    browser,
    baseURL,
    request,
  }) => {
    const folder = generateSyncFolderName('split-claim-bak');
    const remote = `${WEBDAV_CONFIG_TEMPLATE.baseUrl}${folder}/DEV/`;
    const config = { ...WEBDAV_CONFIG_TEMPLATE, syncFolderPath: `/${folder}` };
    await createSyncFolder(request, folder);
    const a = await setupSyncClient(browser, baseURL);
    let b: Awaited<ReturnType<typeof setupSyncClient>> | undefined;
    try {
      // A v2 device with Surgical sync saved off creates the folder.
      const workA = new WorkViewPage(a.page);
      const syncA = new SyncPage(a.page);
      await workA.waitForTaskList();
      await workA.addTask(`First v2 task ${folder}`);
      await waitForStatePersistence(a.page);
      await syncA.setupWebdavSync({ ...config, isUseSplitSyncFiles: false });
      await waitForSyncComplete(a.page, syncA);
      await blockBackgroundSync(a.page);
      await workA.addTask(`Second v2 task ${folder}`);
      await waitForStatePersistence(a.page);
      await syncA.triggerSync();
      await waitForSyncComplete(a.page, syncA);

      // A's next upload backs up the primary before replacing it (this copy is
      // byte-identical to that backup). An Android local-folder write deletes and
      // recreates the file; killed after the delete, it leaves only the live v2
      // backup, and A's change stays pending.
      const pendingTask = `Pending v2 task ${folder}`;
      await workA.addTask(pendingTask);
      await waitForStatePersistence(a.page);
      const primary = await remoteText(request, `${remote}sync-data.json`);
      const backedUp = await request.put(`${remote}sync-data.json.bak`, {
        headers,
        data: primary,
      });
      expect(backedUp.ok()).toBe(true);
      const deleted = await request.delete(`${remote}sync-data.json`, { headers });
      expect(deleted.ok()).toBe(true);

      // A device with Surgical sync on finds no sync file and creates a split folder.
      b = await setupSyncClient(browser, baseURL);
      const workB = new WorkViewPage(b.page);
      const syncB = new SyncPage(b.page);
      await workB.waitForTaskList();
      const splitTask = `Split task ${folder}`;
      await workB.addTask(splitTask);
      await waitForStatePersistence(b.page);
      await syncB.setupWebdavSync({ ...config, isUseSplitSyncFiles: true });
      await waitForSyncComplete(b.page, syncB);
      await blockBackgroundSync(b.page);
      const tombstone = await remoteText(request, `${remote}sync-data.json`);
      const bodyStart = tombstone.indexOf('__') + 2;
      expect(JSON.parse(tombstone.slice(bodyStart))).toMatchObject({
        version: 3,
        format: 'split',
      });

      // An interrupted write tears the tombstone.
      const torn = tombstone.slice(0, Math.floor((bodyStart + tombstone.length) / 2));
      const tore = await request.put(`${remote}sync-data.json`, { headers, data: torn });
      expect(tore.ok()).toBe(true);
      const splitFiles = ['sync-ops.json', 'sync-state.json'];
      const readSplitFiles = (): Promise<string[]> =>
        Promise.all(splitFiles.map((file) => remoteText(request, `${remote}${file}`)));
      const splitBefore = await readSplitFiles();

      // A retries its upload, still with Surgical sync saved off.
      const writesByA: string[] = [];
      a.page.on('request', (req) => {
        const isRead = ['GET', 'HEAD', 'OPTIONS', 'PROPFIND'].includes(req.method());
        if (req.url().includes(folder) && !isRead) {
          writesByA.push(`${req.method()} ${req.url()}`);
        }
      });
      await syncA.triggerSync();
      const outcome = await waitForSyncComplete(a.page, syncA).then(
        () => 'sync completed',
        (e: unknown) => String(e),
      );
      await expect(syncA.syncSpinner).toBeHidden();

      // Nothing is overwritten: A finds no v2 data to heal over the split folder.
      expect(writesByA).toEqual([]);
      expect(await remoteText(request, `${remote}sync-data.json`)).toBe(torn);
      expect(await readSplitFiles()).toEqual(splitBefore);
      const backup = await readPrefixedFile<{ version: number; format?: string }>(
        request,
        `${remote}sync-data.json.bak`,
        authorization,
      );
      expect(backup).toMatchObject({ version: 3, format: 'split' });
      // A reports the unreadable remote instead of recovering v2, and keeps its work.
      expect(outcome).toContain('Sync failed');
      await expect(
        a.page.locator('snack-custom', {
          hasText: translationText('F.SYNC.S.ERROR_REMOTE_FILE_CORRUPTED'),
        }),
      ).toBeVisible();
      await expect(a.page.locator('task').filter({ hasText: pendingTask })).toBeVisible();

      // The split files stay authoritative for Surgical sync devices.
      await syncB.triggerSync();
      await waitForSyncComplete(b.page, syncB);
      await expect(b.page.locator('task').filter({ hasText: splitTask })).toBeVisible();
      await expect(b.page.locator('task').filter({ hasText: folder })).toHaveCount(1);
    } finally {
      await closeContextsSafely(a.context, b?.context);
    }
  });
});

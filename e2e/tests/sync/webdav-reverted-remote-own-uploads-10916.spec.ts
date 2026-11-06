import type { APIRequestContext } from '@playwright/test';
import { test, expect } from '../../fixtures/webdav.fixture';
import { SyncPage } from '../../pages/sync.page';
import { WorkViewPage } from '../../pages/work-view.page';
import { waitForStatePersistence } from '../../utils/waits';
import {
  WEBDAV_CONFIG_TEMPLATE,
  WEBDAV_SYNC_FILE,
  closeContextsSafely,
  createSyncFolder,
  generateSyncFolderName,
  setupSyncClient,
  waitForSyncComplete,
} from '../../utils/sync-helpers';

/**
 * #10916 follow-up: the sync file reverts to a copy from before the phone's
 * upload, and nobody writes on top of it.
 *
 * Unlike the stale-base write (webdav-lost-update-concurrent-snapshot-10916),
 * the remote clock is now LESS_THAN the phone's. The phone re-downloads from
 * seq 0, `planSnapshotHydration` sees its local clock dominate and skips
 * hydration before the own-uploads-missing check, so nothing is deleted and no
 * dialog appears. But the phone's create op is already marked synced and is
 * never uploaded again, so the desktop never receives the task, even after the
 * phone's next upload carries a later change. "Not deleted, but not syncing."
 *
 * Restoring the pre-upload file over WebDAV stands in for a folder-sync tool or
 * server that rolls the file back.
 *
 * Run: npm run quiet -- e2e:webdav:file e2e/tests/sync/webdav-reverted-remote-own-uploads-10916.spec.ts --retries=0
 */
const INBOX_URL = '/#/project/INBOX_PROJECT/tasks';
const AUTHORIZATION =
  'Basic ' +
  Buffer.from(
    `${WEBDAV_CONFIG_TEMPLATE.username}:${WEBDAV_CONFIG_TEMPLATE.password}`,
  ).toString('base64');

const syncFileUrl = (folder: string): string =>
  `${WEBDAV_CONFIG_TEMPLATE.baseUrl}${folder}/DEV/${WEBDAV_SYNC_FILE}`;

const readRaw = async (request: APIRequestContext, folder: string): Promise<string> => {
  const response = await request.get(syncFileUrl(folder), {
    headers: { Authorization: AUTHORIZATION },
  });
  expect(response.ok()).toBe(true);
  return response.text();
};

const writeRaw = async (
  request: APIRequestContext,
  folder: string,
  body: string,
): Promise<void> => {
  const response = await request.put(syncFileUrl(folder), {
    headers: { Authorization: AUTHORIZATION },
    data: body,
  });
  expect(response.ok()).toBe(true);
};

test.describe('@webdav Remote reverted below own uploads (#10916)', () => {
  test('phone tasks lost by a remote rollback still reach the desktop', async ({
    browser,
    baseURL,
    request,
  }) => {
    // Restoring one file only stands in for a rollback in the single-file format.
    test.skip(WEBDAV_SYNC_FILE !== 'sync-data.json', 'single-file format only');
    test.slow();
    const folder = generateSyncFolderName('e2e-reverted-remote-10916');
    await createSyncFolder(request, folder);
    const config = { ...WEBDAV_CONFIG_TEMPLATE, syncFolderPath: `/${folder}` };
    const url = baseURL || 'http://localhost:4242';
    const lostTask = `Phone-lost-${Date.now()}`;
    const laterTask = `Phone-later-${Date.now()}`;

    const phone = await setupSyncClient(browser, url);
    let desktop: Awaited<ReturnType<typeof setupSyncClient>> | undefined;

    try {
      const syncPhone = new SyncPage(phone.page);
      const workPhone = new WorkViewPage(phone.page);
      await workPhone.waitForTaskList();
      await syncPhone.setupWebdavSync(config);
      expect(await waitForSyncComplete(phone.page, syncPhone)).toBe('success');

      desktop = await setupSyncClient(browser, url);
      const syncDesktop = new SyncPage(desktop.page);
      const workDesktop = new WorkViewPage(desktop.page);
      await workDesktop.waitForTaskList();
      await syncDesktop.setupWebdavSync(config);
      expect(await waitForSyncComplete(desktop.page, syncDesktop)).toBe('success');

      // The file both devices agree on before the phone's upload.
      const staleFile = await readRaw(request, folder);

      // --- Phone adds a task and uploads it ---
      await workPhone.addTask(lostTask);
      await waitForStatePersistence(phone.page);
      await syncPhone.triggerSync();
      expect(await waitForSyncComplete(phone.page, syncPhone)).toBe('success');
      expect(await readRaw(request, folder)).toContain(lostTask);

      // --- The file rolls back; nobody writes on top ---
      await writeRaw(request, folder, staleFile);

      // --- Phone syncs: nothing is deleted locally ---
      await syncPhone.triggerSync();
      expect(await waitForSyncComplete(phone.page, syncPhone)).toBe('success');
      await phone.page.goto(INBOX_URL);
      await expect(
        phone.page.locator('task', { hasText: lostTask }).first(),
      ).toBeVisible();

      // --- Phone makes a later change and uploads it ---
      await workPhone.addTask(laterTask);
      await waitForStatePersistence(phone.page);
      await syncPhone.triggerSync();
      expect(await waitForSyncComplete(phone.page, syncPhone)).toBe('success');

      // --- Desktop syncs: it must end up with both phone tasks ---
      await syncDesktop.triggerSync();
      expect(await waitForSyncComplete(desktop.page, syncDesktop)).toBe('success');
      await desktop.page.goto(INBOX_URL);
      await expect(
        desktop.page.locator('task', { hasText: laterTask }).first(),
      ).toBeVisible();
      await expect(
        desktop.page.locator('task', { hasText: lostTask }).first(),
      ).toBeVisible();
    } finally {
      await closeContextsSafely(phone.context, desktop?.context);
    }
  });
});

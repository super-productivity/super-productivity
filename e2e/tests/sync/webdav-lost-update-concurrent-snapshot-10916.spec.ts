import type { APIRequestContext } from '@playwright/test';
import { test, expect } from '../../fixtures/webdav.fixture';
import { SyncPage } from '../../pages/sync.page';
import { WorkViewPage } from '../../pages/work-view.page';
import { waitForStatePersistence } from '../../utils/waits';
import {
  WEBDAV_CONFIG_TEMPLATE,
  WEBDAV_SYNC_FILE,
  closeContextsSafely,
  confirmSyncConflictOverwriteIfShown,
  createSyncFolder,
  generateSyncFolderName,
  setupSyncClient,
  waitForSyncComplete,
} from '../../utils/sync-helpers';

/**
 * #10916: the sync file loses the phone's upload outside the app, and the
 * desktop then writes on that stale base.
 *
 * A file shared through a cloud folder (local-file sync over iCloud, Syncthing,
 * Google Drive) or a server that ignores If-Match can do this: the desktop
 * still sees the old file, its write passes its own rev check, and the folder
 * tool keeps the desktop's copy. The desktop reports success without the
 * phone's tasks. The phone then sees a remote clock CONCURRENT with the one it
 * last saw (lineage break), re-downloads from seq 0 and, having no pending
 * ops, hydrates the snapshot: its already-uploaded tasks are gone too.
 *
 * Restoring the pre-upload file over WebDAV stands in for the folder tool.
 * Expected: the phone shows the conflict dialog instead of hydrating, and its
 * Keep local (an intentional full replacement) then wins on the desktop
 * without a dialog. Both conflict directions are covered (AGENTS.md rule 12).
 *
 * Run: npm run quiet -- e2e:webdav:file e2e/tests/sync/webdav-lost-update-concurrent-snapshot-10916.spec.ts --retries=0
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

test.describe('@webdav Lost upload overwritten by a stale-base writer (#10916)', () => {
  test('phone asks before dropping its synced tasks; its Keep local wins on the desktop', async ({
    browser,
    baseURL,
    request,
  }) => {
    // Restoring one file only stands in for a lost update in the single-file format.
    test.skip(WEBDAV_SYNC_FILE !== 'sync-data.json', 'single-file format only');
    test.slow();
    const folder = generateSyncFolderName('e2e-lost-update-10916');
    await createSyncFolder(request, folder);
    const config = { ...WEBDAV_CONFIG_TEMPLATE, syncFolderPath: `/${folder}` };
    const url = baseURL || 'http://localhost:4242';
    const phoneTask = `Phone-task-${Date.now()}`;
    const desktopTask = `Desktop-task-${Date.now()}`;

    const phone = await setupSyncClient(browser, url);
    let desktop: Awaited<ReturnType<typeof setupSyncClient>> | undefined;

    try {
      const syncPhone = new SyncPage(phone.page);
      const workPhone = new WorkViewPage(phone.page);
      await workPhone.waitForTaskList();
      await syncPhone.setupWebdavSync(config);
      await waitForSyncComplete(phone.page, syncPhone);

      desktop = await setupSyncClient(browser, url);
      const syncDesktop = new SyncPage(desktop.page);
      const workDesktop = new WorkViewPage(desktop.page);
      await workDesktop.waitForTaskList();
      await syncDesktop.setupWebdavSync(config);
      await waitForSyncComplete(desktop.page, syncDesktop);

      // The file both devices agree on before the phone's upload.
      const staleFile = await readRaw(request, folder);

      // --- Phone adds a task and uploads it ---
      await workPhone.addTask(phoneTask);
      await waitForStatePersistence(phone.page);
      await syncPhone.triggerSync();
      expect(await waitForSyncComplete(phone.page, syncPhone)).toBe('success');
      expect(await readRaw(request, folder)).toContain(phoneTask);

      // --- The phone's upload is lost; the desktop writes on the stale file ---
      await writeRaw(request, folder, staleFile);
      await workDesktop.addTask(desktopTask);
      await waitForStatePersistence(desktop.page);
      await syncDesktop.triggerSync();
      expect(await waitForSyncComplete(desktop.page, syncDesktop)).toBe('success');
      const afterDesktop = await readRaw(request, folder);
      expect(afterDesktop).toContain(desktopTask);
      expect(afterDesktop).not.toContain(phoneTask);

      // --- Phone syncs: it must ask instead of dropping its uploaded task ---
      await syncPhone.triggerSync();
      expect(await waitForSyncComplete(phone.page, syncPhone)).toBe('conflict');
      const conflictDialog = phone.page.locator('dialog-sync-conflict');
      await expect(conflictDialog).toContainText(
        'Changes this device already synced are missing',
      );
      await conflictDialog.locator('button', { hasText: /Keep local/i }).click();
      await confirmSyncConflictOverwriteIfShown(phone.page, conflictDialog);
      expect(await waitForSyncComplete(phone.page, syncPhone)).toBe('success');
      await phone.page.goto(INBOX_URL);
      await expect(
        phone.page.locator('task', { hasText: phoneTask }).first(),
      ).toBeVisible();

      // --- Desktop: the intentional replacement wins without a dialog ---
      await syncDesktop.triggerSync();
      expect(await waitForSyncComplete(desktop.page, syncDesktop)).toBe('success');
      await desktop.page.goto(INBOX_URL);
      await expect(
        desktop.page.locator('task', { hasText: phoneTask }).first(),
      ).toBeVisible();
      // Keep local replaces all remote data, as the dialog says.
      await expect(desktop.page.locator('task', { hasText: desktopTask })).toHaveCount(0);
    } finally {
      await closeContextsSafely(phone.context, desktop?.context);
    }
  });
});

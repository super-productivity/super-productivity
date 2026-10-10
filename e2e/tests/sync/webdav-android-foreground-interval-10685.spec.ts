import { test, expect } from '../../fixtures/webdav.fixture';
import { SyncPage } from '../../pages/sync.page';
import { WorkViewPage } from '../../pages/work-view.page';
import {
  WEBDAV_CONFIG_TEMPLATE,
  setupSyncClient,
  createSyncFolder,
  waitForSyncComplete,
  generateSyncFolderName,
  closeContextsSafely,
} from '../../utils/sync-helpers';
import { installAndroidTimerBridge } from '../focus-mode/android-timer-bridge';

/**
 * #10685: on Android, file-based sync had no interval trigger while the app
 * stays in the foreground, so another device's changes never arrived until
 * the next pause/resume.
 *
 * Client B runs with the Android bridge stub (IS_ANDROID_WEB_VIEW) and never
 * pauses, resumes or syncs manually after setup; it must pick up Client A's
 * task through the default 1-minute sync interval alone.
 */
const SYNC_INTERVAL_MS = 60_000;

test.describe('@webdav Android foreground interval sync', () => {
  test.describe.configure({ mode: 'serial' });

  const SYNC_FOLDER_NAME = generateSyncFolderName('e2e-android-fg');
  const WEBDAV_CONFIG = {
    ...WEBDAV_CONFIG_TEMPLATE,
    syncFolderPath: `/${SYNC_FOLDER_NAME}`,
  };

  test('Android client in the foreground receives remote changes on the interval', async ({
    browser,
    baseURL,
    request,
    webdavServerUp,
  }) => {
    // Waits out real sync intervals.
    test.setTimeout(6 * SYNC_INTERVAL_MS);
    await createSyncFolder(request, SYNC_FOLDER_NAME);

    const clientA = await setupSyncClient(browser, baseURL);
    let contextB: Awaited<ReturnType<typeof setupSyncClient>>['context'] | null = null;

    try {
      const syncPageA = new SyncPage(clientA.page);
      const workViewPageA = new WorkViewPage(clientA.page);
      await workViewPageA.waitForTaskList();
      await syncPageA.setupWebdavSync(WEBDAV_CONFIG);
      await syncPageA.triggerSync();
      await waitForSyncComplete(clientA.page, syncPageA);

      const clientB = await setupSyncClient(
        browser,
        baseURL,
        [],
        installAndroidTimerBridge,
      );
      contextB = clientB.context;
      expect(
        await clientB.page.evaluate(() => 'SUPAndroid' in window),
        'client B must run as the Android WebView',
      ).toBe(true);
      const syncPageB = new SyncPage(clientB.page);
      const workViewPageB = new WorkViewPage(clientB.page);
      await workViewPageB.waitForTaskList();
      await syncPageB.setupWebdavSync(WEBDAV_CONFIG);
      await syncPageB.triggerSync();
      await waitForSyncComplete(clientB.page, syncPageB);

      // Enabling sync starts B's trigger pipeline, whose audit path fires once
      // a full interval later even without a periodic trigger. Let that pass
      // so only a recurring trigger can deliver the change below.
      await clientB.page.waitForTimeout(SYNC_INTERVAL_MS + 10_000);

      const taskName = `AndroidFgTask-${Date.now()}`;
      await workViewPageA.addTask(taskName);
      await expect(clientA.page.locator(`task:has-text("${taskName}")`)).toBeVisible();
      await syncPageA.triggerSync();
      await waitForSyncComplete(clientA.page, syncPageA);

      await expect(clientB.page.locator(`task:has-text("${taskName}")`)).toBeVisible({
        timeout: SYNC_INTERVAL_MS + 30_000,
      });
    } finally {
      await closeContextsSafely(clientA.context, contextB);
    }
  });
});

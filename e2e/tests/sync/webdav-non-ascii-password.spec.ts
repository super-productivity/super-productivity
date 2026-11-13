import { test, expect } from '../../fixtures/webdav.fixture';
import { SyncPage } from '../../pages/sync.page';
import { WorkViewPage } from '../../pages/work-view.page';
import { waitForStatePersistence } from '../../utils/waits';
import {
  WEBDAV_CONFIG_TEMPLATE,
  WEBDAV_SYNC_FILE,
  setupSyncClient,
  waitForSyncComplete,
  generateSyncFolderName,
  closeContextsSafely,
} from '../../utils/sync-helpers';

/**
 * WebDAV sync with a non-ASCII password.
 *
 * The e2e server stores these throwaway users hashed from the UTF-8 bytes of
 * their password (e2e/webdav-server/Dockerfile), as Nextcloud, Apache and
 * browsers do. A client that sends Latin-1 bytes gets 401 for `éß`, and one
 * that calls `btoa` on the raw string throws for `€` before any request.
 *
 * Run with: npm run e2e:webdav:file e2e/tests/sync/webdav-non-ascii-password.spec.ts
 */
const CASES = [
  { name: 'Latin-1 range (éß)', username: 'e2e-latin1', password: 'pw-éß-e2e' },
  { name: 'beyond Latin-1 (€)', username: 'e2e-euro', password: 'pw-€-e2e' },
];

test.describe('@webdav WebDAV non-ASCII password', () => {
  for (const { name, username, password } of CASES) {
    test(`first sync uploads with a password in the ${name}`, async ({
      browser,
      baseURL,
      request,
    }) => {
      test.slow(); // Sync tests take longer
      const folderName = generateSyncFolderName('e2e-non-ascii-pw');
      const folderUrl = `${WEBDAV_CONFIG_TEMPLATE.baseUrl}${folderName}`;
      // Buffer encodes as UTF-8, independent of how the app builds its header.
      const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
      const taskTitle = `NonAsciiPw-${Date.now()}`;

      const mkcol = await request.fetch(folderUrl, {
        method: 'MKCOL',
        headers: { Authorization: authorization },
      });
      expect(mkcol.status(), 'server accepts the UTF-8 credentials').toBe(201);

      const { context, page } = await setupSyncClient(
        browser,
        baseURL || 'http://localhost:4242',
      );
      try {
        const syncPage = new SyncPage(page);
        const workViewPage = new WorkViewPage(page);
        await workViewPage.waitForTaskList();
        await workViewPage.addTask(taskTitle);
        await waitForStatePersistence(page);

        await syncPage.setupWebdavSync({
          baseUrl: WEBDAV_CONFIG_TEMPLATE.baseUrl,
          username,
          password,
          syncFolderPath: `/${folderName}`,
        });
        await expect(syncPage.syncBtn).toBeVisible();
        await syncPage.triggerSync();
        await waitForSyncComplete(page, syncPage);

        // Non-production builds nest the sync file under `/DEV`.
        const remote = await request.fetch(`${folderUrl}/DEV/${WEBDAV_SYNC_FILE}`, {
          headers: { Authorization: authorization },
        });
        expect(remote.status(), 'sync file was uploaded').toBe(200);
      } finally {
        await closeContextsSafely(context);
      }
    });
  }
});

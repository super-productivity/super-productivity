import { test, expect } from '../../fixtures/webdav.fixture';
import { SyncPage } from '../../pages/sync.page';
import { WorkViewPage } from '../../pages/work-view.page';
import { waitForStatePersistence } from '../../utils/waits';
import {
  WEBDAV_CONFIG_TEMPLATE,
  closeContextsSafely,
  createSyncFolder,
  generateSyncFolderName,
  setupSyncClient,
  waitForSyncComplete,
} from '../../utils/sync-helpers';

/**
 * #10808 / #10102: generic WebDAV behind Apache mod_deflate. Compressed GETs
 * serve the strong ETag as `"…-gzip"`, but the DAV backend compares `If-Match`
 * against the bare `"…"`, so a client that echoes the served tag gets 412 on
 * every upload and its changes never leave the device.
 *
 * The E2E WebDAV server compresses only folders named `gzip-etag-*`.
 */
test.describe('@webdav WebDAV behind mod_deflate (-gzip ETags)', () => {
  test.describe.configure({ mode: 'serial' });

  const AUTHORIZATION = `Basic ${Buffer.from(
    `${WEBDAV_CONFIG_TEMPLATE.username}:${WEBDAV_CONFIG_TEMPLATE.password}`,
  ).toString('base64')}`;

  for (const isUseSplitSyncFiles of [false, true]) {
    test(`both clients keep uploading when the server suffixes ETags with -gzip (split=${isUseSplitSyncFiles})`, async ({
      browser,
      baseURL,
      request,
    }) => {
      test.slow();
      const syncFolderName = generateSyncFolderName(`gzip-etag-${isUseSplitSyncFiles}`);
      await createSyncFolder(request, syncFolderName);
      const webdavConfig = {
        ...WEBDAV_CONFIG_TEMPLATE,
        syncFolderPath: `/${syncFolderName}`,
        isUseSplitSyncFiles,
      };

      // Prove the server reproduces the reported shape, so a pass below cannot
      // come from a server that stopped compressing or started honouring the tag.
      const probeUrl = `${WEBDAV_CONFIG_TEMPLATE.baseUrl}${syncFolderName}/probe.json`;
      const probeBody = JSON.stringify({ pad: 'x'.repeat(400) });
      const created = await request.put(probeUrl, {
        headers: { Authorization: AUTHORIZATION },
        data: probeBody,
      });
      expect(created.status()).toBe(201);
      const servedGet = await request.get(probeUrl, {
        headers: { Authorization: AUTHORIZATION, ['Accept-Encoding']: 'gzip' },
      });
      const servedEtag = servedGet.headers()['etag'];
      expect(servedEtag).toMatch(/^"[^"]+-gzip"$/);
      const echoedPut = await request.put(probeUrl, {
        headers: { Authorization: AUTHORIZATION, ['If-Match']: servedEtag },
        data: probeBody,
      });
      expect(echoedPut.status()).toBe(412);
      await request.delete(probeUrl, { headers: { Authorization: AUTHORIZATION } });

      const url = baseURL || 'http://localhost:4242';
      const a = await setupSyncClient(browser, url);
      const b = await setupSyncClient(browser, url);
      // The app's own traffic must show the reported shape (it was served
      // `-gzip` tags) and the fix (it never echoed one back in If-Match).
      const servedGzipEtags: string[] = [];
      const gzipIfMatches: string[] = [];
      for (const page of [a.page, b.page]) {
        page.on('response', (response) => {
          if (!response.url().includes(`/${syncFolderName}/`)) return;
          const etag = response.headers()['etag'];
          if (etag?.endsWith('-gzip"')) servedGzipEtags.push(etag);
          const ifMatch = response.request().headers()['if-match'];
          if (ifMatch?.includes('-gzip"')) gzipIfMatches.push(ifMatch);
        });
      }
      try {
        const syncA = new SyncPage(a.page);
        const workA = new WorkViewPage(a.page);
        const syncB = new SyncPage(b.page);
        const workB = new WorkViewPage(b.page);

        await workA.waitForTaskList();
        await syncA.setupWebdavSync(webdavConfig);
        await workA.addTask('Gzip task 1 from A');
        await waitForStatePersistence(a.page);
        await syncA.triggerSync();
        await waitForSyncComplete(a.page, syncA);

        await workB.waitForTaskList();
        await syncB.setupWebdavSync(webdavConfig);
        await syncB.triggerSync();
        await waitForSyncComplete(b.page, syncB);
        await expect(
          b.page.locator('task', { hasText: 'Gzip task 1 from A' }),
        ).toBeVisible();

        // B now holds a `-gzip` revision of the existing file: its upload is
        // the conditional write that 412s on every attempt on the broken path.
        await workB.addTask('Gzip task 2 from B');
        await waitForStatePersistence(b.page);
        await syncB.triggerSync();
        await waitForSyncComplete(b.page, syncB);

        await syncA.triggerSync();
        await waitForSyncComplete(a.page, syncA);
        await expect(
          a.page.locator('task', { hasText: 'Gzip task 2 from B' }),
        ).toBeVisible();

        // And back again, so both clients have written over the other's revision.
        await workA.addTask('Gzip task 3 from A');
        await waitForStatePersistence(a.page);
        await syncA.triggerSync();
        await waitForSyncComplete(a.page, syncA);

        await syncB.triggerSync();
        await waitForSyncComplete(b.page, syncB);
        await expect(
          b.page.locator('task', { hasText: 'Gzip task 3 from A' }),
        ).toBeVisible();
        await expect(b.page.locator('task')).toHaveCount(3);
        await expect(a.page.locator('task')).toHaveCount(3);
        expect(servedGzipEtags.length).toBeGreaterThan(0);
        expect(gzipIfMatches).toEqual([]);
      } finally {
        await closeContextsSafely(a.context, b.context);
      }
    });
  }
});

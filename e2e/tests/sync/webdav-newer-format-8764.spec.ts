import { test, expect } from '../../fixtures/webdav.fixture';
import { SyncPage } from '../../pages/sync.page';
import {
  closeContextsSafely,
  createSyncFolder,
  generateSyncFolderName,
  setupSyncClient,
  waitForSyncComplete,
  WEBDAV_CONFIG_TEMPLATE,
} from '../../utils/sync-helpers';

test.describe('@webdav newer split snapshot format (#8764)', () => {
  test('pauses rather than recovering a newer state file from an older backup', async ({
    browser,
    baseURL,
    request,
  }) => {
    test.slow();
    const folderName = generateSyncFolderName('e2e-newer-state');
    const folderUrl = `${WEBDAV_CONFIG_TEMPLATE.baseUrl}${folderName}/DEV/`;
    const config = {
      ...WEBDAV_CONFIG_TEMPLATE,
      syncFolderPath: `/${folderName}`,
      isUseSplitSyncFiles: true,
    };
    const headers = {
      Authorization:
        'Basic ' +
        Buffer.from(
          `${WEBDAV_CONFIG_TEMPLATE.username}:${WEBDAV_CONFIG_TEMPLATE.password}`,
        ).toString('base64'),
    };
    await createSyncFolder(request, folderName);

    const clientA = await setupSyncClient(browser, baseURL);
    let clientB: Awaited<ReturnType<typeof setupSyncClient>> | null = null;
    try {
      const syncA = new SyncPage(clientA.page);
      await syncA.setupWebdavSync(config);
      await waitForSyncComplete(clientA.page, syncA);

      const opsResponse = await request.get(`${folderUrl}sync-ops.json`, { headers });
      expect(opsResponse.ok()).toBe(true);
      const opsText = await opsResponse.text();
      const ops = JSON.parse(opsText.slice(opsText.indexOf('{'))) as {
        snapshotRef: { file?: string };
      };
      const stateUrl = `${folderUrl}${ops.snapshotRef.file ?? 'sync-state.json'}`;
      const backupUrl = `${folderUrl}${ops.snapshotRef.file ? 'sync-state.json' : 'sync-state.json.bak'}`;
      const original = await request.get(stateUrl, { headers });
      expect(original.ok()).toBe(true);
      const originalText = await original.text();
      expect(originalText).toMatch(/^pf_3__/);
      const state = JSON.parse(originalText.slice(originalText.indexOf('{'))) as {
        version: number;
      };
      expect(state.version).toBe(3);
      if (!ops.snapshotRef.file) {
        expect((await request.put(backupUrl, { headers, data: originalText })).ok()).toBe(
          true,
        );
      }
      expect((await request.get(backupUrl, { headers })).ok()).toBe(true);

      const newerText = `pf_4__${JSON.stringify({ ...state, version: 4 })}`;
      expect((await request.put(stateUrl, { headers, data: newerText })).ok()).toBe(true);

      clientB = await setupSyncClient(browser, baseURL);
      const writes: string[] = [];
      clientB.page.on('request', (webdavRequest) => {
        if (
          webdavRequest.method() === 'PUT' &&
          webdavRequest.url().startsWith(folderUrl)
        ) {
          writes.push(webdavRequest.url());
        }
      });
      const syncB = new SyncPage(clientB.page);
      await syncB.setupWebdavSync(config);

      await expect(
        clientB.page.getByText('Your app version is too old for the synced data.'),
      ).toBeVisible();
      expect(writes).toEqual([]);
      expect(await (await request.get(stateUrl, { headers })).text()).toBe(newerText);
    } finally {
      await closeContextsSafely(clientB?.context, clientA.context);
    }
  });
});

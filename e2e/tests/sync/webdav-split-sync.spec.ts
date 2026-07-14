import { expect, test } from '../../fixtures/webdav.fixture';
import { SyncPage } from '../../pages/sync.page';
import { WorkViewPage } from '../../pages/work-view.page';
import {
  WEBDAV_CONFIG_TEMPLATE,
  createSyncFolder,
  createUniqueSyncFolder,
  setupClient,
  waitForSync,
} from '../../utils/sync-helpers';

const authHeader = `Basic ${Buffer.from(
  `${WEBDAV_CONFIG_TEMPLATE.username}:${WEBDAV_CONFIG_TEMPLATE.password}`,
).toString('base64')}`;

test.describe('@webdav WebDAV Split-file Sync', () => {
  test('split ops and snapshot files bootstrap a second client', async ({
    browser,
    baseURL,
    request,
    webdavServerUp,
  }) => {
    void webdavServerUp;
    test.slow();
    const folder = createUniqueSyncFolder('split-sync');
    await createSyncFolder(request, folder);
    const config = {
      ...WEBDAV_CONFIG_TEMPLATE,
      syncFolderPath: `/${folder}`,
      isUseSplitSyncFiles: true,
    };
    const appUrl = baseURL || 'http://localhost:4242';
    const { context: contextA, page: pageA } = await setupClient(browser, appUrl);
    const { context: contextB, page: pageB } = await setupClient(browser, appUrl);

    try {
      const syncA = new SyncPage(pageA);
      const workViewA = new WorkViewPage(pageA);
      await workViewA.waitForTaskList();
      await syncA.setupWebdavSync(config);

      const taskTitle = `Split-file task ${Date.now()}`;
      await workViewA.addTask(taskTitle);
      await syncA.triggerSync();
      await waitForSync(pageA, syncA);

      const remoteFile = async (name: string): Promise<string> => {
        const response = await request.get(
          `${WEBDAV_CONFIG_TEMPLATE.baseUrl}${folder}/DEV/${name}`,
          { headers: { Authorization: authHeader } },
        );
        expect(response.ok(), `${name} should exist on WebDAV`).toBe(true);
        return response.text();
      };
      const [opsFile, stateFile] = await Promise.all([
        remoteFile('sync-ops.json'),
        remoteFile('sync-state.json'),
      ]);
      expect(opsFile).toMatch(/^pf_3__/);
      expect(stateFile).toMatch(/^pf_3__/);

      const syncB = new SyncPage(pageB);
      const workViewB = new WorkViewPage(pageB);
      await workViewB.waitForTaskList();
      await syncB.setupWebdavSync(config);
      await syncB.triggerSync();
      await waitForSync(pageB, syncB);

      await expect(pageB.locator('task', { hasText: taskTitle }).first()).toBeVisible({
        timeout: 20000,
      });
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});

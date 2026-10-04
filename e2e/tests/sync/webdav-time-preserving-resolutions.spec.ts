import { expect, test } from '../../fixtures/webdav.fixture';
import { SyncPage } from '../../pages/sync.page';
import { WorkViewPage } from '../../pages/work-view.page';
import {
  createSyncFolder,
  generateSyncFolderName,
  setupSyncClient,
  waitForSyncComplete,
  WEBDAV_CONFIG_TEMPLATE,
} from '../../utils/sync-helpers';
import {
  blockBackgroundSync,
  runReminderClearScenario,
  runIncomingNotesScenario,
  type JoinResolutionClient,
} from '../../utils/time-preserving-resolution-helpers';
import type { APIRequestContext, Browser } from '@playwright/test';

const createJoin = async (
  browser: Browser,
  baseURL: string | undefined,
  request: APIRequestContext,
): Promise<JoinResolutionClient> => {
  const folder = generateSyncFolderName('e2e-time-preserving-resolution');
  await createSyncFolder(request, folder);
  const config = { ...WEBDAV_CONFIG_TEMPLATE, syncFolderPath: `/${folder}` };
  return async () => {
    const { context, page } = await setupSyncClient(browser, baseURL);
    const syncPage = new SyncPage(page);
    const workView = new WorkViewPage(page);
    await workView.waitForTaskList();
    await page.evaluate(blockBackgroundSync);
    await page.addInitScript(blockBackgroundSync);
    await syncPage.setupWebdavSync(config);
    expect(await waitForSyncComplete(page, syncPage)).toBe('success');
    return {
      page,
      workView,
      sync: async () => {
        await syncPage.triggerSync();
        expect(await waitForSyncComplete(page, syncPage)).toBe('success');
      },
      close: () => context.close(),
    };
  };
};

test.describe('@webdav time-preserving conflict resolution', () => {
  for (const firstSync of ['A', 'B'] as const) {
    test(`${firstSync}-first a winning plan clears scheduled time and reminder everywhere`, async ({
      browser,
      baseURL,
      request,
      webdavServerUp,
    }, testInfo) => {
      void webdavServerUp;
      test.setTimeout(300000);
      const join = await createJoin(browser, baseURL, request);
      await runReminderClearScenario(
        join,
        `TimePreserving-${testInfo.testId}`,
        firstSync,
      );
    });
  }
  test('conflict resolution preserves concurrent downloaded notes', async ({
    browser,
    baseURL,
    request,
    webdavServerUp,
  }, testInfo) => {
    void webdavServerUp;
    test.setTimeout(300000);
    await runIncomingNotesScenario(
      await createJoin(browser, baseURL, request),
      `IncomingNotes-${testInfo.testId}`,
    );
  });
});

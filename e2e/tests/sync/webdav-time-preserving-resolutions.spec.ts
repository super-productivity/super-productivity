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
  runThreeTrackerScenario,
  runIncomingNotesScenario,
  type JoinResolutionClient,
} from '../../utils/time-preserving-resolution-helpers';
import type { APIRequestContext, Browser, ConsoleMessage } from '@playwright/test';

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
      sync: async ({ allowConcurrentUploadRetry = false } = {}) => {
        let retryObserved = false;
        const onConsole = (message: ConsoleMessage): void => {
          if (
            message
              .text()
              .includes('Concurrent upload detected, will retry on next sync cycle')
          ) {
            retryObserved = true;
          }
        };
        if (allowConcurrentUploadRetry) page.on('console', onConsole);
        try {
          await syncPage.triggerSync();
          expect(
            await waitForSyncComplete(page, syncPage, 30000, {
              allowResponseOnlyCompletion: allowConcurrentUploadRetry,
            }),
          ).toBe('success');
          if (allowConcurrentUploadRetry) {
            // WebDAV defers a losing revision race; the following manual cycles
            // must still confirm success and preserve every recorded millisecond.
            expect((await syncPage.syncConfirmedIcon.isVisible()) || retryObserved).toBe(
              true,
            );
          }
        } finally {
          if (allowConcurrentUploadRetry) page.off('console', onConsole);
        }
      },
      close: () => context.close(),
    };
  };
};

test.describe('@webdav time-preserving conflict resolution', () => {
  for (const firstSync of ['A', 'B'] as const) {
    test(`${firstSync}-first three trackers preserve all 9000 ms`, async ({
      browser,
      baseURL,
      request,
      webdavServerUp,
    }, testInfo) => {
      void webdavServerUp;
      test.setTimeout(300000);
      await runThreeTrackerScenario(
        await createJoin(browser, baseURL, request),
        `ThreeTrackers-${testInfo.testId}`,
        firstSync,
      );
    });
    test(`${firstSync}-first three trackers preserve child and parent totals`, async ({
      browser,
      baseURL,
      request,
      webdavServerUp,
    }, testInfo) => {
      void webdavServerUp;
      test.setTimeout(300000);
      await runThreeTrackerScenario(
        await createJoin(browser, baseURL, request),
        `ThreeChildTrackers-${testInfo.testId}`,
        firstSync,
        true,
      );
    });
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
  test('simultaneous resolvers preserve all three tracker contributions', async ({
    browser,
    baseURL,
    request,
    webdavServerUp,
  }, testInfo) => {
    void webdavServerUp;
    test.setTimeout(300000);
    await runThreeTrackerScenario(
      await createJoin(browser, baseURL, request),
      `SimultaneousTrackers-${testInfo.testId}`,
      'simultaneous',
    );
  });
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

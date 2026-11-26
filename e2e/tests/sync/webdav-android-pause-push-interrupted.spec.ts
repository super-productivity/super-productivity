import { expect, test } from '../../fixtures/webdav.fixture';
import { SyncPage } from '../../pages/sync.page';
import {
  createSyncFolder,
  generateSyncFolderName,
  waitForSyncComplete,
  WEBDAV_CONFIG_TEMPLATE,
  WEBDAV_SYNC_FILE,
} from '../../utils/sync-helpers';
import {
  closeClient,
  createSimulatedClient,
  waitForTask,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { waitForAppReady } from '../../utils/waits';
import { installAndroidTimerBridge } from '../focus-mode/android-timer-bridge';

/**
 * R3 of docs/plans/2026-10-30-narrow-mobile-background-sync.md: the pause push
 * also runs for file providers, so the OS can cut it off mid-upload. Either
 * the upload never reaches the server, or it is stored and the response is
 * lost. The aborted request stands in for the freeze or suspension, the reload
 * for the process being killed. Another device uploads in between, so a retry
 * that trusted stale remote state would overwrite its change.
 */

type BridgeWindow = Window & { SUPAndroid: { onPause$: { next: () => void } } };

const sync = async (client: SimulatedE2EClient): Promise<void> => {
  const page = new SyncPage(client.page);
  await page.triggerSync();
  expect(await waitForSyncComplete(client.page, page)).toBe('success');
};

const expectTaskOnce = async (
  client: SimulatedE2EClient,
  title: string,
): Promise<void> => {
  await expect(client.page.locator(`task:has-text("${title}")`)).toHaveCount(1);
};

for (const isStored of [false, true]) {
  const outcome = isStored ? 'stored, response lost' : 'never reached the server';
  test(`@webdav an interrupted Android pause push (${outcome}) converges`, async ({
    browser,
    baseURL,
    request,
    webdavServerUp,
  }, testInfo) => {
    void webdavServerUp;
    test.setTimeout(300000);
    const clients: SimulatedE2EClient[] = [];
    const folder = generateSyncFolderName('pause-push-cut');
    await createSyncFolder(request, folder);
    const titleA = `PauseCutA-${testInfo.testId}`;
    const titleB = `PauseCutB-${testInfo.testId}`;
    try {
      for (const name of ['A', 'B']) {
        const client = await createSimulatedClient(
          browser,
          baseURL!,
          name,
          testInfo.testId,
        );
        clients.push(client);
        if (name === 'A') {
          // A plays the Android app: the native bridge must exist before boot.
          await client.page.addInitScript({
            content: `(${installAndroidTimerBridge.toString()})();`,
          });
          await client.page.reload();
          await client.workView.waitForTaskList();
        }
        const page = new SyncPage(client.page);
        await page.setupWebdavSync({
          ...WEBDAV_CONFIG_TEMPLATE,
          syncFolderPath: `/${folder}`,
        });
        expect(await waitForSyncComplete(client.page, page)).toBe('success');
      }
      const [a, b] = clients;

      await a.workView.addTask(titleA);
      await waitForTask(a.page, titleA);
      let isCut = false;
      let storedStatus = 0;
      await a.page.route('**:2345/**', async (route) => {
        const req = route.request();
        // Cut the main sync file only: the .bak copy is written before it.
        if (req.method() !== 'PUT' || !req.url().endsWith(`/${WEBDAV_SYNC_FILE}`)) {
          return route.continue();
        }
        if (isStored && !isCut) {
          storedStatus = (await route.fetch()).status();
        }
        isCut = true;
        await route.abort('failed');
      });
      await a.page.evaluate(() =>
        (window as unknown as BridgeWindow).SUPAndroid.onPause$.next(),
      );
      await expect.poll(() => isCut, { timeout: 30000 }).toBe(true);
      if (isStored) {
        expect(storedStatus, 'the cut upload did not store the sync file').toBeLessThan(
          300,
        );
        expect(storedStatus).toBeGreaterThanOrEqual(200);
      }

      // B uploads while A is gone.
      await b.workView.addTask(titleB);
      await waitForTask(b.page, titleB);
      await sync(b);

      await a.page.unroute('**:2345/**');
      await a.page.reload();
      await waitForAppReady(a.page);
      for (const client of [a, b, a]) await sync(client);

      for (const client of clients) {
        await expectTaskOnce(client, titleA);
        await expectTaskOnce(client, titleB);
      }
    } finally {
      for (const client of clients) await closeClient(client);
    }
  });
}

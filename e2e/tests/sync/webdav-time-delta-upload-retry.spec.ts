import { expect, test } from '../../fixtures/webdav.fixture';
import { SyncPage } from '../../pages/sync.page';
import {
  createSyncFolder,
  generateSyncFolderName,
  waitForSyncComplete,
  WEBDAV_CONFIG_TEMPLATE,
} from '../../utils/sync-helpers';
import {
  closeClient,
  createSimulatedClient,
  expectExactTaskTime,
  recordTaskTimeDelta,
  renameTask,
  waitForTask,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { readDeltas } from '../../utils/time-delta-retry-helpers';
import { waitForAppReady } from '../../utils/waits';

test('@webdav a delta retries unchanged after a lost file-upload response', async ({
  browser,
  baseURL,
  request,
  webdavServerUp,
}, testInfo) => {
  void webdavServerUp;
  test.setTimeout(300000);
  const clients: SimulatedE2EClient[] = [];
  const folder = generateSyncFolderName('delta-retry');
  await createSyncFolder(request, folder);
  const title = `FileDeltaRetry-${testInfo.testId}`;
  const sync = async (client: SimulatedE2EClient): Promise<void> => {
    const page = new SyncPage(client.page);
    await page.triggerSync();
    expect(await waitForSyncComplete(client.page, page)).toBe('success');
  };
  try {
    for (const name of ['A', 'B']) {
      const client = await createSimulatedClient(
        browser,
        baseURL!,
        name,
        testInfo.testId,
      );
      clients.push(client);
      const page = new SyncPage(client.page);
      await page.setupWebdavSync({
        ...WEBDAV_CONFIG_TEMPLATE,
        syncFolderPath: `/${folder}`,
      });
      expect(await waitForSyncComplete(client.page, page)).toBe('success');
      const block = (): void => {
        (globalThis as typeof globalThis & Record<string, boolean>)[
          '__SP_E2E_BLOCK_AUTO_SYNC'
        ] = true;
      };
      await client.page.evaluate(block);
      await client.page.addInitScript(block);
      if (name === 'A') {
        await client.workView.addTask(title);
        await sync(client);
      }
      await waitForTask(client.page, title);
    }
    const [a, b] = clients;
    await renameTask(a, title, `${title}-A`);
    await sync(a);
    await recordTaskTimeDelta(b, title, '2026-10-03', 3000);
    await renameTask(b, title, `${title}-B`);
    await expect.poll(async () => (await readDeltas(b)).length).toBe(1);
    const original = (await readDeltas(b))[0].op;
    let stored = false;
    await b.page.route('**:2345/**', async (route) => {
      if (route.request().method() !== 'PUT') return route.continue();
      if (!stored) {
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        stored = true;
      }
      await route.abort('failed');
    });
    await new SyncPage(b.page).triggerSync();
    await expect.poll(() => stored, { timeout: 30000 }).toBe(true);
    expect((await readDeltas(b))[0].op).toEqual(original);
    await b.page.reload();
    await waitForAppReady(b.page);
    await b.page.unroute('**:2345/**');
    for (const client of [b, a, b, a]) await sync(client);
    expect((await readDeltas(b)).find(({ op }) => op.id === original.id)?.op).toEqual(
      original,
    );
    for (const client of clients) {
      await expectExactTaskTime(client, title, 3000);
      await client.page.reload();
      await waitForAppReady(client.page);
      await expectExactTaskTime(client, title, 3000);
    }
  } finally {
    for (const client of clients) await closeClient(client);
  }
});

import type { Locator, Page } from '@playwright/test';
import { strToU8, zipSync } from 'fflate';
import { expect, test } from '../../fixtures/webdav.fixture';
import { waitForPluginManagementInit } from '../../helpers/plugin-test.helpers';
import { SyncPage } from '../../pages/sync.page';
import { TaskPage } from '../../pages/task.page';
import { WorkViewPage } from '../../pages/work-view.page';
import {
  closeContextsSafely,
  createSyncFolder,
  generateSyncFolderName,
  setupSyncClient,
  waitForSyncComplete,
  WEBDAV_CONFIG_TEMPLATE,
} from '../../utils/sync-helpers';
import { flushPendingWrites } from '../../utils/waits';

interface PublishedProjection {
  format: 'file-v2';
  revision: string;
  tasks: { id: string; location: 'active' | 'archive'; isDone: boolean | null }[];
  pluginData: { key: string; value: string }[];
}

interface FixtureAPI {
  persistDataSynced(value: string, key?: string): Promise<void>;
  readPublishedSnapshot(): Promise<PublishedProjection>;
}

interface FixtureWindow {
  PluginAPI: FixtureAPI;
}

const ownerId = 'published-reader-fixture';
const neighborId = ownerId + '-neighbor';
const authorization = `Basic ${Buffer.from('admin:admin').toString('base64')}`;
const navigate = (page: Page, route: string): Promise<unknown> =>
  page.goto(page.url().split('#')[0] + '#' + route);

const installFixture = async (page: Page, id: string, name: string): Promise<void> => {
  expect(await waitForPluginManagementInit(page)).toBe(true);
  const manifest = {
    id,
    name,
    version: '1.0.0',
    manifestVersion: 1,
    minSupVersion: '19.2.0',
    iFrame: true,
    supportsIndexHtml: true,
    hooks: [],
    permissions: ['getTasks', 'persistDataSynced', 'loadSyncedData'],
  };
  const files = Object.fromEntries([
    ['manifest.json', strToU8(JSON.stringify(manifest))],
    ['plugin.js', strToU8('// Published snapshot E2E fixture.\n')],
    [
      'index.html',
      strToU8('<html><head></head><body>Published reader fixture</body></html>'),
    ],
  ]);
  const bytes = zipSync(files);
  await page.locator('input[type="file"][accept=".zip"]').setInputFiles({
    name: `${id}.zip`,
    mimeType: 'application/zip',
    buffer: Buffer.from(bytes),
  });
  await page.getByRole('button', { name: 'Install Plugin', exact: true }).click();
  const toggle = page
    .locator('plugin-management mat-card')
    .filter({ hasText: name })
    .locator('button[role="switch"]');
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute('aria-checked')) !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
};

const openFrame = async (page: Page, pluginId: string): Promise<Locator> => {
  await navigate(page, `/plugins/${pluginId}/index`);
  const body = page.frameLocator('plugin-index iframe').locator('body');
  await expect(body).toBeVisible();
  return body;
};

const readSnapshot = async (
  page: Page,
  pluginId = ownerId,
): Promise<PublishedProjection> => {
  const body = await openFrame(page, pluginId);
  return body.evaluate(async () => {
    const api = (window as unknown as FixtureWindow).PluginAPI;
    if (typeof api.readPublishedSnapshot !== 'function') {
      throw new Error('Expected the public published-snapshot reader');
    }
    return api.readPublishedSnapshot();
  });
};

const readFailure = async (page: Page): Promise<string> => {
  const body = await openFrame(page, ownerId);
  return body.evaluate(async () => {
    try {
      await (window as unknown as FixtureWindow).PluginAPI.readPublishedSnapshot();
      return 'unexpected-success';
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  });
};

for (const encrypted of [false, true]) {
  test(`@webdav published plugin reader verifies ${encrypted ? 'encrypted' : 'plain'} primary and isolates namespaces`, async ({
    browser,
    baseURL,
    request,
    webdavServerUp,
  }) => {
    void webdavServerUp;
    test.slow();
    const folder = generateSyncFolderName(`plugin-reader-${encrypted}`);
    const primary = `${WEBDAV_CONFIG_TEMPLATE.baseUrl}${folder}/DEV/sync-data.json`;
    const split = `${WEBDAV_CONFIG_TEMPLATE.baseUrl}${folder}/DEV/sync-ops.json`;
    await createSyncFolder(request, folder);
    const client = await setupSyncClient(browser, baseURL);
    try {
      const { page } = client;
      const work = new WorkViewPage(page);
      const tasks = new TaskPage(page);
      const sync = new SyncPage(page);
      await work.waitForTaskList();
      await page.evaluate(() => {
        const target = window as unknown as {
          __e2eTestHelpers: { store: { dispatch(action: unknown): void } };
        };
        target.__e2eTestHelpers.store.dispatch({
          type: '[Global Config] Update Global Config Section',
          sectionKey: 'sync',
          sectionCfg: { isManualSyncOnly: true, isUseSplitSyncFiles: false },
        });
      });
      await work.addTask(`Archived published owner ${folder}`);
      const archivedRow = tasks
        .getTaskByText(`Archived published owner ${folder}`)
        .first();
      const archivedId = await archivedRow.getAttribute('data-task-id');
      if (!archivedId) throw new Error('Expected the archived owner ID');
      await tasks.markTaskAsDone(archivedRow);
      await page.locator('.e2e-finish-day').click();
      await page.waitForURL(/daily-summary/);
      await page
        .locator(
          'daily-summary button[mat-flat-button]:has(mat-icon:has-text("wb_sunny"))',
        )
        .click();
      await page.waitForURL(/(active\/tasks|tag\/TODAY\/tasks)/);
      await work.addTask(`Active published owner ${folder}`);
      const activeId = await tasks
        .getTaskByText(`Active published owner ${folder}`)
        .first()
        .getAttribute('data-task-id');
      if (!activeId) throw new Error('Expected the active owner ID');
      await installFixture(page, ownerId, 'Published reader primary fixture');
      await installFixture(page, neighborId, 'Published reader neighbor fixture');
      await flushPendingWrites(page);
      await sync.setupWebdavSync({
        ...WEBDAV_CONFIG_TEMPLATE,
        syncFolderPath: `/${folder}`,
        isUseSplitSyncFiles: false,
        ...(encrypted
          ? {
              encryptionPassword: 'Published reader fixture password',
              encryptAtSetup: true,
            }
          : {}),
      });
      expect(await waitForSyncComplete(page, sync)).toBe('success');
      const ownValue = 'own-compressed-' + 'fixture'.repeat(300);
      const neighborValue = 'neighbor-private-value';
      for (const [id, value] of [
        [ownerId, ownValue],
        [neighborId, neighborValue],
      ]) {
        const body = await openFrame(page, id);
        await body.evaluate(async (_element, data) => {
          await (window as unknown as FixtureWindow).PluginAPI.persistDataSynced(
            data,
            'probe',
          );
        }, value);
      }
      await flushPendingWrites(page);
      await sync.triggerSync();
      expect(await waitForSyncComplete(page, sync)).toBe('success');
      const methods: string[] = [];
      page.on('request', (outgoing) => {
        if (outgoing.url().startsWith(`${WEBDAV_CONFIG_TEMPLATE.baseUrl}${folder}/`)) {
          methods.push(outgoing.method());
        }
      });
      const observed = await readSnapshot(page);
      expect(observed.format).toBe('file-v2');
      expect(observed.revision).toBeTruthy();
      expect(observed.pluginData).toEqual([{ key: 'probe', value: ownValue }]);
      expect(observed.tasks).toContainEqual({
        id: activeId,
        location: 'active',
        isDone: false,
      });
      expect(observed.tasks.find((task) => task.id === archivedId)?.location).toBe(
        'archive',
      );
      expect((await readSnapshot(page, neighborId)).pluginData).toEqual([
        { key: 'probe', value: neighborValue },
      ]);
      expect(methods).toContain('GET');
      expect(
        methods.filter(
          (method) => !['GET', 'HEAD', 'PROPFIND', 'OPTIONS'].includes(method),
        ),
      ).toEqual([]);

      const savedResponse = await request.get(primary, {
        headers: { Authorization: authorization },
      });
      expect(savedResponse.ok()).toBe(true);
      const saved = await savedResponse.text();
      expect(saved).toMatch(encrypted ? /^pf_C?E2__/ : /^pf_C?2__/);
      if (encrypted) expect(saved).not.toContain(ownValue);
      expect(
        (
          await request.put(primary + '.bak', {
            headers: { Authorization: authorization },
            data: saved,
          })
        ).ok(),
      ).toBe(true);
      expect(
        (
          await request.put(primary, {
            headers: { Authorization: authorization },
            data: 'corrupt primary fixture',
          })
        ).ok(),
      ).toBe(true);
      expect(await readFailure(page)).toBe('Published snapshot could not be verified');
      expect(
        (
          await request.put(primary, {
            headers: { Authorization: authorization },
            data: saved,
          })
        ).ok(),
      ).toBe(true);
      expect((await readSnapshot(page)).pluginData).toEqual(observed.pluginData);

      expect(
        (
          await request.put(split, {
            headers: { Authorization: authorization },
            data: '{}',
          })
        ).ok(),
      ).toBe(true);
      expect(await readFailure(page)).toBe('Published snapshot could not be verified');
      expect(
        (await request.delete(split, { headers: { Authorization: authorization } })).ok(),
      ).toBe(true);
      expect((await readSnapshot(page)).pluginData).toEqual(observed.pluginData);
    } finally {
      await closeContextsSafely(client.context);
    }
  });
}

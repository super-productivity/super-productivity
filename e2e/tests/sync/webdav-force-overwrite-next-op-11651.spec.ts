import type { APIRequestContext, Browser, Page } from '@playwright/test';
import { test, expect } from '../../fixtures/webdav.fixture';
import { SyncPage } from '../../pages/sync.page';
import { WorkViewPage } from '../../pages/work-view.page';
import { translationRegex, translationText } from '../../utils/i18n-strings';
import { waitForStatePersistence } from '../../utils/waits';
import {
  WEBDAV_CONFIG_TEMPLATE,
  WEBDAV_SYNC_FILE,
  closeContextsSafely,
  createSyncFolder,
  generateSyncFolderName,
  setupSyncClient,
  waitForSyncComplete,
} from '../../utils/sync-helpers';

/**
 * Regression test for #11651: the first change a device makes after
 * "Force Overwrite" must reach every other device.
 *
 * The force upload appended its SYNC_IMPORT without advancing the stored
 * vector clock, so the device's next op reused the import's clock. A device
 * that had already applied the import and then learned anything newer judged
 * that op superseded and skipped it for good: permanent divergence, no error.
 *
 * Trace from the issue: [C forceUpload][A s][C rename t3][B s][A rename t2],
 * then sync until nothing changes.
 *
 * Run: npm run quiet -- e2e:webdav:file e2e/tests/sync/webdav-force-overwrite-next-op-11651.spec.ts --retries=0
 */
const INBOX_URL = '/#/project/INBOX_PROJECT/tasks';
const AUTHORIZATION =
  'Basic ' +
  Buffer.from(
    `${WEBDAV_CONFIG_TEMPLATE.username}:${WEBDAV_CONFIG_TEMPLATE.password}`,
  ).toString('base64');

interface Device {
  context: Awaited<ReturnType<typeof setupSyncClient>>['context'];
  page: Page;
  sync: SyncPage;
}

const readSyncFile = async (
  request: APIRequestContext,
  folder: string,
): Promise<string> => {
  const response = await request.get(
    `${WEBDAV_CONFIG_TEMPLATE.baseUrl}${folder}/DEV/${WEBDAV_SYNC_FILE}`,
    { headers: { Authorization: AUTHORIZATION } },
  );
  expect(response.ok()).toBe(true);
  return response.text();
};

const syncNow = async (device: Device): Promise<void> => {
  await device.sync.triggerSync();
  expect(await waitForSyncComplete(device.page, device.sync)).toBe('success');
};

const addDevice = async (
  browser: Browser,
  url: string,
  folder: string,
): Promise<Device> => {
  const client = await setupSyncClient(browser, url, [
    translationRegex('F.SYNC.C.FORCE_UPLOAD'),
  ]);
  const device = { ...client, sync: new SyncPage(client.page) };
  await new WorkViewPage(device.page).waitForTaskList();
  await device.sync.setupWebdavSync({
    ...WEBDAV_CONFIG_TEMPLATE,
    syncFolderPath: `/${folder}`,
  });
  expect(await waitForSyncComplete(device.page, device.sync)).toBe('success');
  return device;
};

/** Renames through a real persistent dispatch, as in the #11564 spec. */
const renameTask = async (page: Page, from: string, to: string): Promise<void> => {
  await page.goto(INBOX_URL);
  const taskId = await page
    .locator('task', { hasText: from })
    .first()
    .getAttribute('data-task-id');
  expect(taskId).toBeTruthy();
  await page.evaluate(
    ({ id, title }) => {
      (
        window as unknown as {
          __e2eTestHelpers: { store: { dispatch: (action: unknown) => void } };
        }
      ).__e2eTestHelpers.store.dispatch({
        type: '[Task Shared] updateTask',
        task: { id, changes: { title } },
        meta: { isPersistent: true, entityType: 'TASK', entityId: id, opType: 'UPD' },
      });
    },
    { id: taskId!, title: to },
  );
  await expect(page.locator('task', { hasText: to }).first()).toBeVisible();
  await waitForStatePersistence(page);
};

/** Sync settings → Advanced → "Force Overwrite", until the remote is replaced. */
const forceOverwrite = async (
  device: Device,
  request: APIRequestContext,
  folder: string,
): Promise<void> => {
  const before = await readSyncFile(request, folder);
  await device.sync.clickSyncBtn({ button: 'right', noWaitAfter: true });
  const dialog = device.page.locator('dialog-sync-cfg');
  await expect(dialog).toBeVisible();
  await device.sync.expandAdvancedSettings();
  await dialog
    .locator('button', { hasText: translationText('F.SYNC.S.BTN_FORCE_OVERWRITE') })
    .click();
  await expect
    .poll(() => readSyncFile(request, folder), { timeout: 30000 })
    .not.toBe(before);
  await expect(device.sync.syncSpinner).toBeHidden({ timeout: 30000 });
  if (await dialog.isVisible()) {
    await device.page.keyboard.press('Escape');
  }
  await expect(dialog).toBeHidden();
  await waitForStatePersistence(device.page);
};

test.describe('@webdav First change after Force Overwrite reaches every device (#11651)', () => {
  // Three devices reproduce the bug; two were clean before the fix and stay
  // in as a control for the common case.
  for (const withThirdDevice of [true, false]) {
    test(`rename after force overwrite syncs (${withThirdDevice ? 'three' : 'two'} devices)`, async ({
      browser,
      baseURL,
      request,
    }) => {
      test.slow();
      const folder = generateSyncFolderName('e2e-force-next-op');
      await createSyncFolder(request, folder);
      const url = baseURL || 'http://localhost:4242';
      const stamp = Date.now();
      const t2 = `Two-${stamp}`;
      const t3 = `Three-${stamp}`;
      const t2Renamed = `TwoRenamed-${stamp}`;
      const t3Renamed = `ThreeRenamed-${stamp}`;
      const devices: Device[] = [];

      try {
        // --- All devices in sync on two tasks ---
        const b = await addDevice(browser, url, folder);
        devices.push(b);
        const workB = new WorkViewPage(b.page);
        await workB.addTask(t2);
        await workB.addTask(t3);
        await waitForStatePersistence(b.page);
        await syncNow(b);
        const c = await addDevice(browser, url, folder);
        devices.push(c);
        const a = withThirdDevice ? await addDevice(browser, url, folder) : undefined;
        if (a) {
          devices.push(a);
        }

        // --- [C forceUpload][A s][C rename t3][B s][A rename t2] ---
        await forceOverwrite(c, request, folder);
        if (a) {
          await syncNow(a);
        }
        await renameTask(c.page, t3, t3Renamed);
        await syncNow(b);
        if (a) {
          await renameTask(a.page, t2, t2Renamed);
        }

        // --- Sync until nothing changes ---
        const syncOrder = a ? [a, b, c] : [b, c];
        for (let round = 0; round < 2; round++) {
          for (const device of syncOrder) {
            await syncNow(device);
          }
        }

        // --- Every device shows every rename ---
        for (const device of devices) {
          await device.page.goto(INBOX_URL);
          await expect(device.page.locator('task', { hasText: t3Renamed })).toHaveCount(
            1,
          );
          await expect(
            device.page.locator('task', { hasText: a ? t2Renamed : t2 }),
          ).toHaveCount(1);
        }
      } finally {
        await closeContextsSafely(...devices.map((device) => device.context));
      }
    });
  }
});

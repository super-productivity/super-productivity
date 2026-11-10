import type { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../fixtures/webdav.fixture';
import { SyncPage } from '../../pages/sync.page';
import { WorkViewPage } from '../../pages/work-view.page';
import { translationRegex, translationText } from '../../utils/i18n-strings';
import { waitForStatePersistence } from '../../utils/waits';
import {
  WEBDAV_CONFIG_TEMPLATE,
  WebDavConfig,
  closeContextsSafely,
  createSyncFolder,
  generateSyncFolderName,
  setupSyncClient,
  waitForSyncComplete,
} from '../../utils/sync-helpers';

/**
 * Reproduction for #11660: the first change a device makes after a force
 * upload never reaches another device on file-based sync.
 *
 * The force upload's SYNC_IMPORT does not advance the device's stored vector
 * clock, so its next change carries the import's clock again. A device that
 * took the forced state and then applied any other remote change compacts,
 * after which its snapshot clock (which contains the import's counter) is the
 * frontier of every entity: the change is skipped as superseded, for good,
 * with nothing pending and no error.
 *
 * Open bug: fails at B's last assertion until #11660 is fixed.
 *
 * Run: npm run quiet -- e2e:webdav:file e2e/tests/sync/webdav-force-upload-skip-11660.spec.ts --retries=0
 */
const INBOX_URL = '/#/project/INBOX_PROJECT/tasks';

interface Client {
  context: BrowserContext;
  page: Page;
  sync: SyncPage;
}

const joinSync = async (
  browser: Browser,
  url: string,
  config: WebDavConfig,
): Promise<Client> => {
  // Only the force upload's own confirmation is accepted, on any client.
  const { context, page } = await setupSyncClient(browser, url, [
    translationRegex('F.SYNC.C.FORCE_UPLOAD'),
  ]);
  const sync = new SyncPage(page);
  await new WorkViewPage(page).waitForTaskList();
  await sync.setupWebdavSync(config);
  expect(await waitForSyncComplete(page, sync)).toBe('success');
  return { context, page, sync };
};

const syncNow = async ({ page, sync }: Client): Promise<void> => {
  await sync.triggerSync();
  expect(await waitForSyncComplete(page, sync)).toBe('success');
};

/** "Force Overwrite" in the sync settings, as a user starts it. */
const forceOverwrite = async ({ page, sync }: Client): Promise<void> => {
  await sync.syncBtn.click({ button: 'right', noWaitAfter: true });
  await sync.providerSelect.waitFor({ state: 'visible', timeout: 10000 });
  const button = page.getByRole('button', {
    name: translationText('F.SYNC.S.BTN_FORCE_OVERWRITE'),
    exact: true,
  });
  if (!(await button.isVisible().catch(() => false))) {
    await page.locator('.collapsible-header').filter({ hasText: 'Advanced' }).click();
  }
  await expect(button).toBeVisible();
  sync.prepareForNextSyncCycle('write');
  await button.click();
  // A force upload exposes no reliable terminal state; A's next sync runs
  // against the uploaded file.
  expect(
    await waitForSyncComplete(page, sync, 30000, { allowResponseOnlyCompletion: true }),
  ).toBe('success');
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog-sync-cfg')).toHaveCount(0);
};

/**
 * Renames a task through a real, persistent store dispatch (as in the #10972
 * and #11564 specs, where UI title editing proved unreliable).
 */
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

test.describe('@webdav First change after a force upload reaches every device', () => {
  test('a device that took the forced state gets the next change (#11660)', async ({
    browser,
    baseURL,
    request,
  }) => {
    test.slow();
    const folder = generateSyncFolderName('e2e-force-upload-skip');
    await createSyncFolder(request, folder);
    const config = { ...WEBDAV_CONFIG_TEMPLATE, syncFolderPath: `/${folder}` };
    const url = baseURL || 'http://localhost:4242';
    const stamp = Date.now();
    const task2 = `Task2-${stamp}`;
    const task3 = `Task3-${stamp}`;
    const task2Renamed = `Task2ByA-${stamp}`;
    const task3Renamed = `Task3ByC-${stamp}`;
    const clients: Client[] = [];

    try {
      // --- A, B and C in sync on one folder, with two tasks ---
      const a = await joinSync(browser, url, config);
      clients.push(a);
      const workA = new WorkViewPage(a.page);
      await workA.addTask(task2);
      await workA.addTask(task3);
      await waitForStatePersistence(a.page);
      await syncNow(a);
      const b = await joinSync(browser, url, config);
      clients.push(b);
      const c = await joinSync(browser, url, config);
      clients.push(c);
      for (const { page } of [b, c]) {
        await page.goto(INBOX_URL);
        await expect(page.locator('task', { hasText: task2 })).toHaveCount(1);
        await expect(page.locator('task', { hasText: task3 })).toHaveCount(1);
      }

      // --- C force-uploads; A takes the forced state ---
      await forceOverwrite(c);
      await syncNow(a);

      // --- C's first change after the force upload, not synced yet ---
      await renameTask(c.page, task3, task3Renamed);

      // --- B takes the forced state; A edits another task ---
      await syncNow(b);
      await renameTask(a.page, task2, task2Renamed);

      // --- Everybody syncs until nothing is left to exchange ---
      await syncNow(a);
      // B applies A's edit: its first remote change on top of the forced state.
      await syncNow(b);
      await b.page.goto(INBOX_URL);
      await expect(b.page.locator('task', { hasText: task2Renamed })).toHaveCount(1);
      await syncNow(c);
      await syncNow(a);
      await syncNow(b);
      await syncNow(c);

      // C then A before B: A showing C's change proves it reached the folder.
      for (const [name, { page }] of [
        ['C', c],
        ['A', a],
        ['B', b],
      ] as const) {
        await page.goto(INBOX_URL);
        await expect(
          page.locator('task', { hasText: task2Renamed }),
          `${name} shows A's rename`,
        ).toHaveCount(1);
        await expect(
          page.locator('task', { hasText: task3Renamed }),
          `${name} shows C's first change after the force upload`,
        ).toHaveCount(1);
      }
    } finally {
      await closeContextsSafely(...clients.map((client) => client.context));
    }
  });
});

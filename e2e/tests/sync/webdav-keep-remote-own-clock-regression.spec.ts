import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect } from '../../fixtures/webdav.fixture';
import { SyncPage } from '../../pages/sync.page';
import { WorkViewPage } from '../../pages/work-view.page';
import { waitForStatePersistence } from '../../utils/waits';
import {
  WEBDAV_CONFIG_TEMPLATE,
  WEBDAV_SYNC_FILE,
  closeContextsSafely,
  confirmSyncConflictOverwriteIfShown,
  createSyncFolder,
  generateSyncFolderName,
  setupSyncClient,
  waitForSyncComplete,
} from '../../utils/sync-helpers';

/**
 * Reproduction (no fix): after "Keep remote" on a rolled-back sync file, the
 * phone's next edit of a task the desktop already knows must reach the desktop.
 *
 * Keep remote rebuilds the phone's vector clock from the remote file only
 * (`forceDownloadRemoteState`); file-snapshot hydration then bumps the phone's
 * own counter once (`hydrateFromRemoteSync`). If the rollback dropped more of
 * the phone's ops than that one bump covers, the phone's next op reuses a
 * counter the desktop already saw on that task, and the desktop skips it as a
 * duplicate/superseded op: permanent divergence, no dialog.
 *
 * `lostOps` is how many uploaded phone renames the rollback drops. With one,
 * the bump covers the gap; with two, it should not.
 *
 * Needs the own-uploads dialog for a plain rollback (PR #11551); on master the
 * phone skips silently (#10916) and the test fails at the dialog step.
 *
 * Run: npm run quiet -- e2e:webdav:file e2e/tests/sync/webdav-keep-remote-own-clock-regression.spec.ts --retries=0
 */
const INBOX_URL = '/#/project/INBOX_PROJECT/tasks';
const AUTHORIZATION =
  'Basic ' +
  Buffer.from(
    `${WEBDAV_CONFIG_TEMPLATE.username}:${WEBDAV_CONFIG_TEMPLATE.password}`,
  ).toString('base64');

const syncFileUrl = (folder: string): string =>
  `${WEBDAV_CONFIG_TEMPLATE.baseUrl}${folder}/DEV/${WEBDAV_SYNC_FILE}`;

const readRaw = async (request: APIRequestContext, folder: string): Promise<string> => {
  const response = await request.get(syncFileUrl(folder), {
    headers: { Authorization: AUTHORIZATION },
  });
  expect(response.ok()).toBe(true);
  return response.text();
};

const writeRaw = async (
  request: APIRequestContext,
  folder: string,
  body: string,
): Promise<void> => {
  const response = await request.put(syncFileUrl(folder), {
    headers: { Authorization: AUTHORIZATION },
    data: body,
  });
  expect(response.ok()).toBe(true);
};

/**
 * Renames a task through a real, persistent store dispatch (as in the #10972
 * spec); UI title editing proved unreliable on a task rendered in two lists.
 */
const renameTask = async (page: Page, from: string, to: string): Promise<void> => {
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

test.describe('@webdav Keep remote after rollback keeps later edits syncing', () => {
  for (const lostOps of [1, 2] as const) {
    test(`phone edit after Keep remote reaches the desktop (${lostOps} lost op${lostOps > 1 ? 's' : ''})`, async ({
      browser,
      baseURL,
      request,
    }) => {
      // Restoring one file only stands in for a rollback in the single-file format.
      test.skip(WEBDAV_SYNC_FILE !== 'sync-data.json', 'single-file format only');
      test.slow();
      const folder = generateSyncFolderName('e2e-keep-remote-clock');
      await createSyncFolder(request, folder);
      const config = { ...WEBDAV_CONFIG_TEMPLATE, syncFolderPath: `/${folder}` };
      const url = baseURL || 'http://localhost:4242';
      const stamp = Date.now();
      const original = `Shared-${stamp}`;
      const lostRenames = Array.from({ length: lostOps }, (_, i) => `Lost${i}-${stamp}`);
      const laterRename = `LaterRename-${stamp}`;

      const phone = await setupSyncClient(browser, url);
      let desktop: Awaited<ReturnType<typeof setupSyncClient>> | undefined;

      try {
        const syncPhone = new SyncPage(phone.page);
        const workPhone = new WorkViewPage(phone.page);
        await workPhone.waitForTaskList();
        await syncPhone.setupWebdavSync(config);
        expect(await waitForSyncComplete(phone.page, syncPhone)).toBe('success');

        // --- A task both devices know ---
        await workPhone.addTask(original);
        await waitForStatePersistence(phone.page);
        await syncPhone.triggerSync();
        expect(await waitForSyncComplete(phone.page, syncPhone)).toBe('success');

        desktop = await setupSyncClient(browser, url);
        const syncDesktop = new SyncPage(desktop.page);
        const workDesktop = new WorkViewPage(desktop.page);
        await workDesktop.waitForTaskList();
        await syncDesktop.setupWebdavSync(config);
        expect(await waitForSyncComplete(desktop.page, syncDesktop)).toBe('success');
        await desktop.page.goto(INBOX_URL);
        await expect(desktop.page.locator('task', { hasText: original })).toHaveCount(1);

        // The file both devices agree on before the phone's renames.
        const staleFile = await readRaw(request, folder);

        // --- Phone renames the task (lostOps times); the desktop receives it ---
        await phone.page.goto(INBOX_URL);
        let current = original;
        for (const title of lostRenames) {
          await renameTask(phone.page, current, title);
          current = title;
        }
        await syncPhone.triggerSync();
        expect(await waitForSyncComplete(phone.page, syncPhone)).toBe('success');
        await syncDesktop.triggerSync();
        expect(await waitForSyncComplete(desktop.page, syncDesktop)).toBe('success');
        await expect(desktop.page.locator('task', { hasText: current })).toHaveCount(1);

        // --- The file rolls back below the phone's renames ---
        await writeRaw(request, folder, staleFile);

        // --- Phone meets the rollback and picks Keep remote ---
        await syncPhone.triggerSync();
        expect(
          await waitForSyncComplete(phone.page, syncPhone, 30000, {
            expectConflict: true,
          }),
        ).toBe('conflict');
        const conflictDialog = phone.page.locator('dialog-sync-conflict');
        await expect(conflictDialog).toContainText(
          'Changes this device already synced are missing',
        );
        syncPhone.prepareForNextSyncCycle('read');
        await conflictDialog.locator('button', { hasText: /Keep remote/i }).click();
        await confirmSyncConflictOverwriteIfShown(phone.page, conflictDialog);
        expect(
          await waitForSyncComplete(phone.page, syncPhone, 30000, {
            allowResponseOnlyCompletion: true,
          }),
        ).toBe('success');
        await phone.page.goto(INBOX_URL);
        await expect(phone.page.locator('task', { hasText: original })).toHaveCount(1);

        // --- Phone edits the task the desktop already knows, and syncs ---
        await renameTask(phone.page, original, laterRename);
        await syncPhone.triggerSync();
        expect(await waitForSyncComplete(phone.page, syncPhone)).toBe('success');
        expect(await readRaw(request, folder)).toContain(laterRename);

        // --- Desktop must receive the later edit ---
        await syncDesktop.triggerSync();
        expect(await waitForSyncComplete(desktop.page, syncDesktop)).toBe('success');
        await desktop.page.goto(INBOX_URL);
        await expect(desktop.page.locator('task', { hasText: laterRename })).toHaveCount(
          1,
        );
      } finally {
        await closeContextsSafely(phone.context, desktop?.context);
      }
    });
  }
});

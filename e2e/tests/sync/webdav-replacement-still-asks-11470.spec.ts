import type { Page } from '@playwright/test';
import { expect, test } from '../../fixtures/webdav.fixture';
import { ImportPage } from '../../pages/import.page';
import { SyncPage } from '../../pages/sync.page';
import { WorkViewPage } from '../../pages/work-view.page';
import {
  closeContextsSafely,
  confirmSyncConflictOverwriteIfShown,
  createSyncFolder,
  generateSyncFolderName,
  setupSyncClient,
  waitForSyncComplete,
  WEBDAV_CONFIG_TEMPLATE,
} from '../../utils/sync-helpers';
import { waitForStatePersistence } from '../../utils/waits';

/**
 * #11470: a peer's automatic REPAIR now continues the file it was written on,
 * so a device with pending work keeps it on top
 * (webdav-rejected-repair-recovery-11352.spec.ts). A real replacement must
 * still ask before it drops anything (#9170, #10916): it starts the file over
 * with its own snapshot base.
 *
 * Both directions: A's backup restore reaches B with a pending task, and B's
 * Keep local (USE_LOCAL) then reaches A with a pending task. Each receiver gets
 * the whole-dataset dialog, and its choice decides what both devices keep.
 *
 * Run: npm run quiet -- e2e:webdav:file e2e/tests/sync/webdav-replacement-still-asks-11470.spec.ts --retries=0
 */
const INBOX_URL = '/#/project/INBOX_PROJECT/tasks';
const BACKUP_TASK = 'E2E Import Test - Simple Active Task';

const task = (page: Page, title: string): ReturnType<Page['locator']> =>
  page.locator('task').filter({ hasText: title });

test.describe('@webdav a real replacement still asks a peer with pending work (#11470)', () => {
  test.beforeEach(async ({ webdavServerUp }) => {
    expect(webdavServerUp).toBe(true);
  });

  for (const isUseSplitSyncFiles of [false, true]) {
    test(`backup restore and Keep local both ask the pending peer (split=${isUseSplitSyncFiles})`, async ({
      browser,
      baseURL,
      request,
    }) => {
      test.setTimeout(300000);
      const folder = generateSyncFolderName(`replacement-asks-${isUseSplitSyncFiles}`);
      await createSyncFolder(request, folder);
      const cfg = {
        ...WEBDAV_CONFIG_TEMPLATE,
        syncFolderPath: `/${folder}`,
        isUseSplitSyncFiles,
      };
      const shared = `Shared ${folder}`;
      const bPending = `B pending ${folder}`;
      const aPending = `A pending ${folder}`;

      const a = await setupSyncClient(browser, baseURL);
      let b: Awaited<ReturnType<typeof setupSyncClient>> | undefined;
      try {
        const syncA = new SyncPage(a.page);
        const workA = new WorkViewPage(a.page);
        await workA.waitForTaskList();
        await workA.addTask(shared);
        await waitForStatePersistence(a.page);
        await syncA.setupWebdavSync(cfg);
        expect(await waitForSyncComplete(a.page, syncA)).toBe('success');

        b = await setupSyncClient(browser, baseURL);
        const syncB = new SyncPage(b.page);
        const workB = new WorkViewPage(b.page);
        await workB.waitForTaskList();
        await syncB.setupWebdavSync(cfg);
        expect(await waitForSyncComplete(b.page, syncB)).toBe('success');
        await expect(task(b.page, shared).first()).toBeVisible();

        // --- A → B: A restores a backup (BACKUP_IMPORT) while B has pending work ---
        await workB.addTask(bPending);
        await waitForStatePersistence(b.page);

        const importA = new ImportPage(a.page);
        await importA.navigateToImportPage();
        await importA.importBackupFile(ImportPage.getFixturePath('test-backup.json'));
        await a.page.goto(INBOX_URL);
        await expect(task(a.page, BACKUP_TASK).first()).toBeVisible();
        await syncA.triggerSync();
        const importDecision = a.page.locator('dialog-sync-import-conflict');
        if (
          await importDecision
            .waitFor({ state: 'visible', timeout: 10000 })
            .then(() => true)
            .catch(() => false)
        ) {
          await importDecision
            .locator('button', {
              has: a.page.locator('mat-icon', { hasText: 'cloud_upload' }),
            })
            .click();
          await expect(importDecision).toBeHidden();
        }
        expect(await waitForSyncComplete(a.page, syncA)).toBe('success');

        // B must ask instead of keeping its pending task on top of the restore.
        await syncB.triggerSync();
        expect(await waitForSyncComplete(b.page, syncB)).toBe('conflict');
        const conflictB = b.page.locator('dialog-sync-conflict');
        await expect(conflictB).toBeVisible();

        // --- B → A: B keeps local (USE_LOCAL) while A has pending work ---
        await workA.addTask(aPending);
        await waitForStatePersistence(a.page);

        syncB.prepareForNextSyncCycle('write');
        await conflictB.locator('button', { hasText: /Keep local/i }).click();
        await confirmSyncConflictOverwriteIfShown(b.page, conflictB);
        await waitForSyncComplete(b.page, syncB, 30000, {
          allowResponseOnlyCompletion: true,
        });
        await b.page.goto(INBOX_URL);
        await expect(task(b.page, bPending).first()).toBeVisible();
        await expect(task(b.page, BACKUP_TASK)).toHaveCount(0);

        // A must ask instead of keeping its pending task on top of B's choice.
        await syncA.triggerSync();
        expect(await waitForSyncComplete(a.page, syncA)).toBe('conflict');
        const conflictA = a.page.locator('dialog-sync-conflict');
        await expect(conflictA).toBeVisible();
        syncA.prepareForNextSyncCycle('write');
        await conflictA.locator('button', { hasText: /Keep remote/i }).click();
        await confirmSyncConflictOverwriteIfShown(a.page, conflictA);
        await waitForSyncComplete(a.page, syncA, 30000, {
          allowResponseOnlyCompletion: true,
        });

        // Both devices converge on B's Keep local, as the dialogs said.
        await syncA.triggerSync();
        expect(await waitForSyncComplete(a.page, syncA)).toBe('success');
        await syncB.triggerSync();
        expect(await waitForSyncComplete(b.page, syncB)).toBe('success');
        for (const page of [a.page, b.page]) {
          await page.goto(INBOX_URL);
          await expect(task(page, shared).first()).toBeVisible();
          await expect(task(page, bPending).first()).toBeVisible();
          await expect(task(page, BACKUP_TASK)).toHaveCount(0);
          await expect(task(page, aPending)).toHaveCount(0);
        }
      } finally {
        await closeContextsSafely(a.context, b?.context);
      }
    });
  }
});

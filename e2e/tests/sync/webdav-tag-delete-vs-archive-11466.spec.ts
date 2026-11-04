import { expect } from '@playwright/test';
import { test } from '../../fixtures/webdav.fixture';
import { SyncPage } from '../../pages/sync.page';
import { WorkViewPage } from '../../pages/work-view.page';
import { TaskPage } from '../../pages/task.page';
import { TagPage } from '../../pages/tag.page';
import { waitForStatePersistence } from '../../utils/waits';
import {
  WEBDAV_CONFIG_TEMPLATE,
  setupSyncClient,
  createSyncFolder,
  waitForSyncComplete,
  generateSyncFolderName,
  waitForArchivePersistence,
  closeContextsSafely,
} from '../../utils/sync-helpers';
import {
  getArchiveYoungTaskTagIds,
  getStoreTagIdByTitle,
  getStoreTaskTagIds,
} from '../../utils/archive-tag-facts';
import { Page } from 'playwright';

/**
 * #11466: Client A deletes a tag while client B archives a task carrying it.
 *
 * A receives B's moveToArchive after its own tag delete already ran, so the
 * remote archive write used to store the deleted tag id on A's archived copy,
 * while B's copy was scrubbed by the incoming deleteTag. Both archives must
 * converge on the task without the deleted tag, in both sync orders.
 *
 * Test 1.3 of webdav-sync-delete-cascade.spec.ts (#11459) logs the same state;
 * whichever PR merges second removes the duplicate.
 */

const archiveDoneTasks = async (page: Page): Promise<void> => {
  const finishDayBtn = page.locator('.e2e-finish-day');
  await finishDayBtn.waitFor({ state: 'visible', timeout: 10000 });
  await finishDayBtn.click();
  await page.waitForURL(/daily-summary/, { timeout: 15000 });
  const saveAndGoHomeBtn = page.locator(
    'daily-summary button[mat-flat-button]:has(mat-icon:has-text("wb_sunny"))',
  );
  await saveAndGoHomeBtn.waitFor({ state: 'visible', timeout: 10000 });
  await saveAndGoHomeBtn.click();
  await page.waitForURL(/(active\/tasks|tag\/TODAY\/tasks)/, { timeout: 15000 });
};

const syncOk = async (page: Page, syncPage: SyncPage): Promise<void> => {
  await waitForStatePersistence(page);
  await syncPage.triggerSync();
  expect(await waitForSyncComplete(page, syncPage)).toBe('success');
};

test.describe('@webdav Tag delete vs archive (#11466)', () => {
  for (const order of ['delete syncs first', 'archive syncs first'] as const) {
    test(`concurrent tag delete and archive converge without the tag (${order})`, async ({
      browser,
      baseURL,
      request,
    }) => {
      test.slow();
      const folder = generateSyncFolderName('e2e-tag-del-archive');
      const config = { ...WEBDAV_CONFIG_TEMPLATE, syncFolderPath: `/${folder}` };
      const url = baseURL || 'http://localhost:4242';
      await createSyncFolder(request, folder);

      // --- A: tag + two tagged tasks ---
      const { context: contextA, page: pageA } = await setupSyncClient(browser, url);
      const syncPageA = new SyncPage(pageA);
      const workViewPageA = new WorkViewPage(pageA);
      const taskPageA = new TaskPage(pageA);
      const tagPageA = new TagPage(pageA);
      await workViewPageA.waitForTaskList();
      await syncPageA.setupWebdavSync(config);

      const tagName = 'Tag-11466';
      const task1Name = 'Task1-ToArchive';
      const task2Name = 'Task2-Remains';
      await tagPageA.createTag(tagName);
      await workViewPageA.addTask(task1Name);
      await workViewPageA.addTask(task2Name);
      const task1 = taskPageA.getTaskByText(task1Name).first();
      const task2 = taskPageA.getTaskByText(task2Name).first();
      await tagPageA.assignTagToTask(task1, tagName);
      await tagPageA.assignTagToTask(task2, tagName);
      const task1Id = await task1.getAttribute('data-task-id');
      const task2Id = await task2.getAttribute('data-task-id');
      const tagId = await getStoreTagIdByTitle(pageA, tagName);
      expect(task1Id).toBeTruthy();
      expect(task2Id).toBeTruthy();
      expect(tagId).toBeTruthy();
      await syncOk(pageA, syncPageA);

      // --- B: download ---
      const { context: contextB, page: pageB } = await setupSyncClient(browser, url);
      const syncPageB = new SyncPage(pageB);
      const workViewPageB = new WorkViewPage(pageB);
      const taskPageB = new TaskPage(pageB);
      await workViewPageB.waitForTaskList();
      await syncPageB.setupWebdavSync(config);
      await syncOk(pageB, syncPageB);
      await expect(pageB.locator('task')).toHaveCount(2);
      expect(await getStoreTaskTagIds(pageB, task1Id!)).toEqual([tagId]);

      // --- Concurrent: A deletes the tag, B archives Task1 ---
      await tagPageA.deleteTag(tagName);
      await taskPageB.markTaskAsDone(taskPageB.getTaskByText(task1Name).first());
      await pageB.waitForTimeout(300);
      await archiveDoneTasks(pageB);
      await waitForArchivePersistence(pageB);
      await expect(pageB.locator('task')).toHaveCount(1);
      // Precondition: B's own archived copy still carries the tag.
      expect(await getArchiveYoungTaskTagIds(pageB, task1Id!)).toEqual([tagId]);

      if (order === 'delete syncs first') {
        await syncOk(pageA, syncPageA);
        await syncOk(pageB, syncPageB);
        await syncOk(pageA, syncPageA);
      } else {
        await syncOk(pageB, syncPageB);
        await syncOk(pageA, syncPageA);
        await syncOk(pageB, syncPageB);
      }
      // One extra round for eventual consistency.
      await syncOk(pageA, syncPageA);
      await syncOk(pageB, syncPageB);

      for (const [label, page] of [
        ['A', pageA],
        ['B', pageB],
      ] as const) {
        expect(
          await getStoreTagIdByTitle(page, tagName),
          `${label}: tag gone`,
        ).toBeNull();
        expect(
          await getStoreTaskTagIds(page, task1Id!),
          `${label}: Task1 live`,
        ).toBeNull();
        expect(await getStoreTaskTagIds(page, task2Id!), `${label}: Task2 tags`).toEqual(
          [],
        );
        // Load-bearing (#11466): A's copy used to keep the deleted tag id.
        await expect
          .poll(async () => getArchiveYoungTaskTagIds(page, task1Id!), {
            timeout: 10000,
            message: `${label}: archived Task1 must exist without the deleted tag`,
          })
          .toEqual([]);
      }

      await closeContextsSafely(contextA, contextB);
    });
  }
});

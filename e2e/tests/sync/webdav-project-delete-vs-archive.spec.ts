import { expect } from '@playwright/test';
import { test } from '../../fixtures/webdav.fixture';
import { SyncPage } from '../../pages/sync.page';
import { WorkViewPage } from '../../pages/work-view.page';
import { TaskPage } from '../../pages/task.page';
import { ProjectPage } from '../../pages/project.page';
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
import { createProjectReliably } from '../../utils/supersync-helpers';
import {
  deleteOpenProject,
  getArchiveYoungTaskProjectId,
  getStoreProjectIdByTitle,
  isTaskInStore,
} from '../../utils/archive-project-facts';
import { Page } from 'playwright';

/**
 * Client A deletes a project while client B archives one of its tasks.
 * Same class as #11466 (tag delete vs archive). Both archives must agree about
 * the archived task in both sync orders. Whether it is kept or removed is
 * only recorded. See supersync-project-delete-vs-archive.spec.ts.
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
  await Promise.all([
    page.waitForURL(/(active\/tasks|tag\/TODAY(?!\/daily-summary)|project\/.+\/tasks)/, {
      timeout: 15000,
    }),
    saveAndGoHomeBtn.click(),
  ]);
};

const syncOk = async (page: Page, syncPage: SyncPage): Promise<void> => {
  await waitForStatePersistence(page);
  await syncPage.triggerSync();
  expect(await waitForSyncComplete(page, syncPage)).toBe('success');
};

test.describe('@webdav Project delete vs archive', () => {
  for (const order of ['delete syncs first', 'archive syncs first'] as const) {
    test(`concurrent project delete and archive converge on the archive (${order})`, async ({
      browser,
      baseURL,
      request,
    }) => {
      test.slow();
      const folder = generateSyncFolderName('e2e-proj-del-archive');
      const config = { ...WEBDAV_CONFIG_TEMPLATE, syncFolderPath: `/${folder}` };
      const url = baseURL || 'http://localhost:4242';
      await createSyncFolder(request, folder);

      // --- A: project + two tasks in it ---
      const { context: contextA, page: pageA } = await setupSyncClient(browser, url);
      const syncPageA = new SyncPage(pageA);
      const workViewPageA = new WorkViewPage(pageA);
      const taskPageA = new TaskPage(pageA);
      await workViewPageA.waitForTaskList();
      await syncPageA.setupWebdavSync(config);

      const projectName = 'Proj-Delete-vs-Archive';
      const task1Name = 'Task1-ToArchive';
      const task2Name = 'Task2-Remains';
      await createProjectReliably(pageA, projectName);
      await new ProjectPage(pageA).navigateToProjectByName(projectName);
      await workViewPageA.waitForTaskList();
      await workViewPageA.addTask(task1Name);
      await workViewPageA.addTask(task2Name);
      const task1Id = await taskPageA
        .getTaskByText(task1Name)
        .first()
        .getAttribute('data-task-id');
      const task2Id = await taskPageA
        .getTaskByText(task2Name)
        .first()
        .getAttribute('data-task-id');
      const projectId = await getStoreProjectIdByTitle(pageA, projectName);
      expect(task1Id).toBeTruthy();
      expect(task2Id).toBeTruthy();
      expect(projectId).toBeTruthy();
      await syncOk(pageA, syncPageA);

      // --- B: download, open the project ---
      const { context: contextB, page: pageB } = await setupSyncClient(browser, url);
      const syncPageB = new SyncPage(pageB);
      const workViewPageB = new WorkViewPage(pageB);
      const taskPageB = new TaskPage(pageB);
      await workViewPageB.waitForTaskList();
      await syncPageB.setupWebdavSync(config);
      await syncOk(pageB, syncPageB);
      await new ProjectPage(pageB).navigateToProjectByName(projectName);
      await workViewPageB.waitForTaskList();
      await expect(pageB.locator('task')).toHaveCount(2);

      // --- Concurrent: A deletes the project, B archives Task1 ---
      await deleteOpenProject(pageA, projectName);
      await taskPageB.markTaskAsDone(taskPageB.getTaskByText(task1Name).first());
      await pageB.waitForTimeout(300);
      await archiveDoneTasks(pageB);
      await waitForArchivePersistence(pageB);
      // Precondition: B's own archived copy points at the project.
      expect(await getArchiveYoungTaskProjectId(pageB, task1Id!)).toBe(projectId);

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

      const archived: Record<string, string | null> = {};
      for (const [label, page] of [
        ['A', pageA],
        ['B', pageB],
      ] as const) {
        expect(
          await getStoreProjectIdByTitle(page, projectName),
          `${label}: project gone`,
        ).toBeNull();
        expect(await isTaskInStore(page, task1Id!), `${label}: Task1 live`).toBe(false);
        expect(await isTaskInStore(page, task2Id!), `${label}: Task2 live`).toBe(false);
        archived[label] = await getArchiveYoungTaskProjectId(page, task1Id!);
      }
      // Which outcome is right (kept or removed) is a design question for
      // deleteProject's delete-wins handling; only record it. Load-bearing:
      // both archives must agree about the archived task.
      console.log(
        `[project-delete-vs-archive] ${order}: archived Task1 projectId per client ${JSON.stringify(archived)}`,
      );
      test.info().annotations.push({
        type: 'archived Task1 projectId',
        description: JSON.stringify(archived),
      });
      expect(archived.A, 'A and B archives must agree on Task1').toBe(archived.B);

      await closeContextsSafely(contextA, contextB);
    });
  }
});

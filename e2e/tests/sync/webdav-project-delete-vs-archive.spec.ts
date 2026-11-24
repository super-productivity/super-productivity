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
 * Intentionally unfixed, see #11486 (#11490 closed; harmless per #6270).
 *
 * Client A deletes a project while client B archives one of its tasks. The
 * remote moveToArchive and the remote deleteProject each touch only the
 * receiving client's archive: B drops the archived task when the delete
 * arrives (removeAllArchiveTasksForProject), while A writes B's copy after its
 * own cleanup and keeps it with a dangling projectId. Dropping it on A too
 * (#11490) could silently lose a task that A moved out of the project before
 * deleting it, so the orphan stays.
 *
 * Only the setup is asserted. The end state is recorded in this test's
 * annotations and log. Expected today, in both orders: live stores agree
 * (project and both tasks gone); A's archive keeps Task1 with the deleted
 * projectId, B's archive does not have it.
 * See supersync-project-delete-vs-archive.spec.ts.
 */

const syncOk = async (page: Page, syncPage: SyncPage): Promise<void> => {
  await waitForStatePersistence(page);
  await syncPage.triggerSync();
  expect(await waitForSyncComplete(page, syncPage)).toBe('success');
};

test.describe('@webdav Project delete vs archive', () => {
  for (const order of ['delete syncs first', 'archive syncs first'] as const) {
    test(`concurrent project delete and archive record the archive outcome (#11486, ${order})`, async ({
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
      // Finish Day only shows on Today; archive from the project's done list.
      await new ProjectPage(pageB).archiveDoneTasks();
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

      // Recorded, not asserted (#11486 is intentionally unfixed).
      const outcome: Record<string, unknown> = {};
      for (const [label, page] of [
        ['A', pageA],
        ['B', pageB],
      ] as const) {
        outcome[label] = {
          projectExists: (await getStoreProjectIdByTitle(page, projectName)) !== null,
          task1Live: await isTaskInStore(page, task1Id!),
          task2Live: await isTaskInStore(page, task2Id!),
          archivedTask1ProjectId: await getArchiveYoungTaskProjectId(page, task1Id!),
        };
      }
      const described = JSON.stringify(outcome);
      console.log(`[11486] ${order}: outcome ${described}`);
      test.info().annotations.push({ type: '11486-outcome', description: described });

      await closeContextsSafely(contextA, contextB);
    });
  }
});

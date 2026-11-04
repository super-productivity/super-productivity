import { test, expect } from '../../fixtures/supersync.fixture';
import { ProjectPage } from '../../pages/project.page';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  createProjectReliably,
  waitForTask,
  markTaskDoneByKey,
  getArchiveYoungTaskIds,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import {
  deleteOpenProject,
  getArchiveYoungTaskProjectId,
  getStoreProjectIdByTitle,
  isTaskInStore,
} from '../../utils/archive-project-facts';

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
 * See webdav-project-delete-vs-archive.spec.ts.
 */

const setWsDownloadBlocked = async (
  client: SimulatedE2EClient,
  blocked: boolean,
): Promise<void> => {
  await client.page.evaluate((b) => {
    (
      globalThis as unknown as { __SP_E2E_BLOCK_WS_DOWNLOAD?: boolean }
    ).__SP_E2E_BLOCK_WS_DOWNLOAD = b;
  }, blocked);
};

test.describe('@supersync Project delete vs archive', () => {
  for (const order of ['delete syncs first', 'archive syncs first'] as const) {
    test(`concurrent project delete and archive record the archive outcome (#11486, ${order}) @supersync`, async ({
      browser,
      baseURL,
      testRunId,
    }) => {
      const uniqueId = Date.now();
      let clientA: SimulatedE2EClient | null = null;
      let clientB: SimulatedE2EClient | null = null;

      try {
        const user = await createTestUser(testRunId);
        const syncConfig = getSuperSyncConfig(user);

        // --- A: project + two tasks in it ---
        clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
        await clientA.sync.setupSuperSync(syncConfig);

        const projectName = `ProjDelArch-${uniqueId}`;
        const task1Name = `T1-ToArchive-${uniqueId}`;
        const task2Name = `T2-Remains-${uniqueId}`;
        await createProjectReliably(clientA.page, projectName);
        await new ProjectPage(clientA.page).navigateToProjectByName(projectName);
        await clientA.workView.waitForTaskList();
        await clientA.workView.addTask(task1Name);
        await clientA.workView.addTask(task2Name);
        const task1Id = await clientA.page
          .locator(`task:has-text("${task1Name}")`)
          .first()
          .getAttribute('data-task-id');
        const task2Id = await clientA.page
          .locator(`task:has-text("${task2Name}")`)
          .first()
          .getAttribute('data-task-id');
        const projectId = await getStoreProjectIdByTitle(clientA.page, projectName);
        expect(task1Id).toBeTruthy();
        expect(task2Id).toBeTruthy();
        expect(projectId).toBeTruthy();
        await clientA.sync.syncAndWait();

        // --- B: download, open the project ---
        clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
        await clientB.sync.setupSuperSync(syncConfig);
        await clientB.sync.syncAndWait();
        await new ProjectPage(clientB.page).navigateToProjectByName(projectName);
        await clientB.workView.waitForTaskList();
        await waitForTask(clientB.page, task1Name);
        await waitForTask(clientB.page, task2Name);

        // Keep the edits concurrent: neither client may pull the other's op
        // before acting. All later downloads go through explicit syncs.
        await setWsDownloadBlocked(clientA, true);
        await setWsDownloadBlocked(clientB, true);

        const deleteProjectOnA = async (): Promise<void> => {
          await deleteOpenProject(clientA!.page, projectName);
        };
        const archiveTask1OnB = async (): Promise<void> => {
          await markTaskDoneByKey(clientB!, task1Name);
          // Finish Day only shows on Today; archive from the project's done list.
          await new ProjectPage(clientB!.page).archiveDoneTasks();
          await expect
            .poll(async () => getArchiveYoungTaskIds(clientB!.page), {
              timeout: 10000,
              message: 'B must have archived Task1',
            })
            .toContain(task1Id!);
          // Precondition: B's archived copy still points at the project.
          expect(await getArchiveYoungTaskProjectId(clientB!.page, task1Id!)).toBe(
            projectId,
          );
        };

        if (order === 'delete syncs first') {
          // A uploads the delete; B archives without having seen it.
          await deleteProjectOnA();
          await clientA.sync.syncAndWait();
          await archiveTask1OnB();
          await clientB.sync.syncAndWait();
          await clientA.sync.syncAndWait();
        } else {
          // B uploads the archive; A deletes without having seen it.
          await archiveTask1OnB();
          await clientB.sync.syncAndWait();
          await deleteProjectOnA();
          await clientA.sync.syncAndWait();
          await clientB.sync.syncAndWait();
        }
        // One extra round for eventual consistency.
        await clientA.sync.syncAndWait();
        await clientB.sync.syncAndWait();

        // Recorded, not asserted (#11486 is intentionally unfixed).
        const outcome: Record<string, unknown> = {};
        for (const client of [clientA, clientB]) {
          const page = client.page;
          const label = client.clientName;
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
      } finally {
        if (clientA) await closeClient(clientA);
        if (clientB) await closeClient(clientB);
      }
    });
  }
});

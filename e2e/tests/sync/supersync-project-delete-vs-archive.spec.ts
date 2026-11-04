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
 * Client A deletes a project while client B archives one of its tasks.
 * Same class as #11466 (tag delete vs archive): the remote moveToArchive and
 * the remote deleteProject each touch only the receiving client's archive, so
 * the archived task can survive on one side with a dangling projectId while
 * the other side removed it. Both archives must agree in both upload orders.
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
    // #11486: A keeps the archived task with a dangling projectId, B drops it.
    test.fixme(`concurrent project delete and archive converge on the archive (${order}) @supersync`, async ({
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

        const archived: Record<string, string | null> = {};
        for (const client of [clientA, clientB]) {
          const label = client.clientName;
          expect(
            await getStoreProjectIdByTitle(client.page, projectName),
            `${label}: project gone`,
          ).toBeNull();
          expect(await isTaskInStore(client.page, task1Id!), `${label}: Task1 live`).toBe(
            false,
          );
          expect(await isTaskInStore(client.page, task2Id!), `${label}: Task2 live`).toBe(
            false,
          );
          archived[label] = await getArchiveYoungTaskProjectId(client.page, task1Id!);
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
      } finally {
        if (clientA) await closeClient(clientA);
        if (clientB) await closeClient(clientB);
      }
    });
  }
});

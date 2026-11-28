import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  markTaskDoneByKey,
  archiveDoneTasks,
  getArchiveYoungTaskIds,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import type { Page } from '@playwright/test';
import { TagPage } from '../../pages/tag.page';
import {
  getArchiveYoungTask,
  getStoreTagIdByTitle,
  getStoreTask,
} from '../../utils/audit-webdav-helpers';

const getArchiveYoungTaskTagIds = async (
  page: Page,
  taskId: string,
): Promise<string[] | null> => (await getArchiveYoungTask(page, taskId))?.tagIds ?? null;

const getStoreTaskTagIds = async (page: Page, taskId: string): Promise<string[] | null> =>
  (await getStoreTask(page, taskId))?.tagIds ?? null;

/**
 * #11466 on SuperSync: client A deletes a tag while client B archives a task
 * carrying it. Both archived copies must end without the deleted tag id, in
 * both upload orders. See webdav-tag-delete-vs-archive-11466.spec.ts.
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

test.describe('@supersync Tag delete vs archive (#11466)', () => {
  for (const order of ['delete syncs first', 'archive syncs first'] as const) {
    test(`concurrent tag delete and archive converge without the tag (${order}) @supersync`, async ({
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

        // --- A: tag + two tagged tasks ---
        clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
        await clientA.sync.setupSuperSync(syncConfig);
        const tagPageA = new TagPage(clientA.page);

        const tagName = `Tag11466-${uniqueId}`;
        const task1Name = `T1-ToArchive-${uniqueId}`;
        const task2Name = `T2-Remains-${uniqueId}`;
        await tagPageA.createTag(tagName);
        await clientA.workView.addTask(task1Name);
        await clientA.workView.addTask(task2Name);
        const task1 = clientA.page.locator(`task:has-text("${task1Name}")`).first();
        const task2 = clientA.page.locator(`task:has-text("${task2Name}")`).first();
        await tagPageA.assignTagToTask(task1, tagName);
        await tagPageA.assignTagToTask(task2, tagName);
        const task1Id = await task1.getAttribute('data-task-id');
        const task2Id = await task2.getAttribute('data-task-id');
        const tagId = await getStoreTagIdByTitle(clientA.page, tagName);
        expect(task1Id).toBeTruthy();
        expect(task2Id).toBeTruthy();
        expect(tagId).toBeTruthy();
        await clientA.sync.syncAndWait();

        // --- B: download ---
        clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
        await clientB.sync.setupSuperSync(syncConfig);
        await clientB.sync.syncAndWait();
        await waitForTask(clientB.page, task1Name);
        await waitForTask(clientB.page, task2Name);
        expect(await getStoreTaskTagIds(clientB.page, task1Id!)).toEqual([tagId]);

        // Keep the edits concurrent: neither client may pull the other's op
        // before acting. All later downloads go through explicit syncs, so a
        // WS-triggered download cannot race syncAndWait.
        await setWsDownloadBlocked(clientA, true);
        await setWsDownloadBlocked(clientB, true);

        const deleteTagOnA = async (): Promise<void> => {
          await tagPageA.deleteTag(tagName);
        };
        // Finish Day syncs on its own, so B uploads its archive right away.
        const archiveTask1OnB = async (): Promise<void> => {
          await markTaskDoneByKey(clientB!, task1Name);
          await archiveDoneTasks(clientB!);
          await expect
            .poll(async () => getArchiveYoungTaskIds(clientB!.page), {
              timeout: 10000,
              message: 'B must have archived Task1',
            })
            .toContain(task1Id!);
        };

        if (order === 'delete syncs first') {
          // A uploads the delete; B archives without having seen it.
          await deleteTagOnA();
          await clientA.sync.syncAndWait();
          await archiveTask1OnB();
          await clientB.sync.syncAndWait();
          await clientA.sync.syncAndWait();
        } else {
          // B uploads the archive; A deletes without having seen it.
          await archiveTask1OnB();
          await clientB.sync.syncAndWait();
          await deleteTagOnA();
          await clientA.sync.syncAndWait();
          await clientB.sync.syncAndWait();
        }
        // One extra round for eventual consistency.
        await clientA.sync.syncAndWait();
        await clientB.sync.syncAndWait();

        for (const client of [clientA, clientB]) {
          const label = client.clientName;
          expect(
            await getStoreTagIdByTitle(client.page, tagName),
            `${label}: tag gone`,
          ).toBeNull();
          expect(
            await getStoreTaskTagIds(client.page, task1Id!),
            `${label}: Task1 live`,
          ).toBeNull();
          expect(
            await getStoreTaskTagIds(client.page, task2Id!),
            `${label}: Task2 tags`,
          ).toEqual([]);
          // Load-bearing (#11466): A's copy used to keep the deleted tag id.
          await expect
            .poll(async () => getArchiveYoungTaskTagIds(client.page, task1Id!), {
              timeout: 10000,
              message: `${label}: archived Task1 must exist without the deleted tag`,
            })
            .toEqual([]);
        }
      } finally {
        if (clientA) await closeClient(clientA);
        if (clientB) await closeClient(clientB);
      }
    });
  }
});

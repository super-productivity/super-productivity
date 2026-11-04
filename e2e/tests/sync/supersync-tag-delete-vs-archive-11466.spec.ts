import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  markTaskDoneByKey,
  archiveDoneTasks,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { TagPage } from '../../pages/tag.page';
import {
  getArchiveYoungTaskTagIds,
  getStoreTagIdByTitle,
  getStoreTaskTagIds,
} from '../../utils/archive-tag-facts';

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
    (globalThis as unknown as { __SP_E2E_BLOCK_WS_DOWNLOAD?: boolean }).__SP_E2E_BLOCK_WS_DOWNLOAD =
      b;
  }, blocked);
};

test.describe('@supersync Tag delete vs archive (#11466)', () => {
  test.describe.configure({ mode: 'serial' });

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

        // Keep the two edits truly concurrent.
        await setWsDownloadBlocked(clientA, true);
        await setWsDownloadBlocked(clientB, true);

        // --- Concurrent: A deletes the tag, B archives Task1 ---
        await tagPageA.deleteTag(tagName);
        await markTaskDoneByKey(clientB, task1Name);
        await archiveDoneTasks(clientB);
        await expect
          .poll(async () => getArchiveYoungTaskTagIds(clientB!.page, task1Id!), {
            timeout: 10000,
            message: "B's own archived copy must still carry the tag",
          })
          .toEqual([tagId]);

        await setWsDownloadBlocked(clientA, false);
        await setWsDownloadBlocked(clientB, false);

        const [first, second] =
          order === 'delete syncs first' ? [clientA, clientB] : [clientB, clientA];
        await first.sync.syncAndWait();
        await second.sync.syncAndWait();
        await first.sync.syncAndWait();
        await second.sync.syncAndWait();

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

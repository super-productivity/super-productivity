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

/**
 * #11489: a tag delete is last-write-wins (only project deletes win outright),
 * so an edit of the tag made before the editing client downloads the delete
 * wins and recreates the tag on the deleting client.
 *
 * 1. A: tag X on T1 and T2. Both clients sync.
 * 2. B archives T1 (Finish Day uploads it).
 * 3. A deletes X and syncs: it applies B's archive and, with the #11466 fix,
 *    writes T1 to its archive without X. Its delete cascade strips X from T2.
 * 4. B renames X before downloading A's delete, then syncs: B's update wins.
 * 5. A syncs: X comes back, but nothing re-applies it to A's tasks.
 *
 * Expected today (pinned by recording, not asserted, until #11489 is fixed):
 * X exists on both; on B, T1 (archived) and T2 (live) still carry X; on A
 * neither does. The outcome lands in this test's annotations and log.
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

/** Renames a tag through its sidebar context menu and the rename prompt. */
const renameTag = async (page: Page, oldName: string, newName: string): Promise<void> => {
  const tagTreeItem = page
    .locator('[role="treeitem"]')
    .filter({ hasText: oldName })
    .first();
  await tagTreeItem.waitFor({ state: 'visible', timeout: 10000 });
  await tagTreeItem.click({ button: 'right' });
  const renameBtn = page
    .locator('.mat-mdc-menu-content button')
    .filter({ hasText: /rename/i })
    .first();
  await renameBtn.waitFor({ state: 'visible', timeout: 5000 });
  await renameBtn.click();
  const prompt = page.locator('dialog-prompt');
  await prompt.waitFor({ state: 'visible', timeout: 5000 });
  await prompt.locator('input').fill(newName);
  await prompt.locator('button[mat-flat-button]').click();
  await prompt.waitFor({ state: 'hidden', timeout: 5000 });
};

const tagIdsOrNull = (t: { tagIds: string[] } | null): string[] | null =>
  t ? [...t.tagIds] : null;

test.describe('@supersync Tag delete vs rename race (#11489)', () => {
  test('records the outcome when a tag rename beats a concurrent delete (#11489) @supersync', async ({
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

      // --- A: tag X on T1 and T2 ---
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);
      const tagPageA = new TagPage(clientA.page);
      const tagName = `Tag11489-${uniqueId}`;
      const renamedTag = `Tag11489-renamed-${uniqueId}`;
      const task1Name = `T1-Archived-${uniqueId}`;
      const task2Name = `T2-Live-${uniqueId}`;
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

      // All later downloads go through explicit syncs.
      await setWsDownloadBlocked(clientA, true);
      await setWsDownloadBlocked(clientB, true);

      // --- B archives T1 and uploads it ---
      await markTaskDoneByKey(clientB, task1Name);
      await archiveDoneTasks(clientB);
      await expect
        .poll(async () => getArchiveYoungTaskIds(clientB!.page), { timeout: 10000 })
        .toContain(task1Id!);
      await clientB.sync.syncAndWait();

      // --- A deletes X and syncs (applies B's archive, uploads the delete) ---
      await tagPageA.deleteTag(tagName);
      await clientA.sync.syncAndWait();
      expect(
        (await getArchiveYoungTask(clientA.page, task1Id!))?.tagIds ?? null,
        'precondition: A archived T1 without the deleted tag (#11466 fix)',
      ).toEqual([]);

      // --- B renames X before downloading A's delete, then syncs ---
      await renameTag(clientB.page, tagName, renamedTag);
      expect(await getStoreTagIdByTitle(clientB.page, renamedTag)).toBe(tagId);
      await clientB.sync.syncAndWait();

      // --- A syncs; one more round each ---
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await clientA.sync.syncAndWait();

      const outcome: Record<string, unknown> = {};
      for (const client of [clientA, clientB]) {
        const label = client.clientName;
        outcome[label] = {
          tagExists:
            (await getStoreTagIdByTitle(client.page, renamedTag)) === tagId ||
            (await getStoreTagIdByTitle(client.page, tagName)) === tagId,
          archivedT1TagIds: tagIdsOrNull(
            await getArchiveYoungTask(client.page, task1Id!),
          ),
          liveT2TagIds: tagIdsOrNull(await getStoreTask(client.page, task2Id!)),
        };
      }
      // Ids only, no titles. tagId stands in as "X" for readability.
      const described = JSON.stringify(outcome).split(tagId!).join('X');
      console.log(`[11489] outcome: ${described}`);
      test.info().annotations.push({ type: '11489-outcome', description: described });
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});

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
 * #11489: a tag delete used to be last-write-wins (only project deletes won
 * outright), so an edit of the tag made before the editing client downloaded
 * the delete won and recreated the tag on the deleting client, while that
 * client's delete cascade had already stripped the tag from its tasks, live
 * and archived. The devices then stayed different for good.
 *
 * A single-tag delete now carries `tagDeleteWins` and wins over a concurrent
 * edit, like a project delete (ARCHITECTURE-DECISIONS.md #7). Both directions
 * must converge with the tag gone everywhere, live and archived:
 *
 * - delete first: A's delete reaches the server, then B renames before
 *   downloading it. B applies the remote delete; its rename loses.
 * - rename first: A deletes, then B renames (the newer write) and uploads
 *   first; A syncs its older pending delete. A's local delete wins and its
 *   replacement reaches B.
 *
 * In both, B archives T1 (tagged X) first, so the archive cleanup is covered.
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

type Outcome = {
  tagExists: boolean;
  archivedT1TagIds: string[] | null;
  liveT2TagIds: string[] | null;
};

const readOutcome = async (
  client: SimulatedE2EClient,
  ids: { tagId: string; task1Id: string; task2Id: string },
  titles: string[],
): Promise<Outcome> => {
  let tagExists = false;
  for (const title of titles) {
    if ((await getStoreTagIdByTitle(client.page, title)) === ids.tagId) tagExists = true;
  }
  return {
    tagExists,
    archivedT1TagIds: tagIdsOrNull(await getArchiveYoungTask(client.page, ids.task1Id)),
    liveT2TagIds: tagIdsOrNull(await getStoreTask(client.page, ids.task2Id)),
  };
};

type RaceOrder = 'delete-first' | 'rename-first';

const runRace = async (
  browser: Parameters<typeof createSimulatedClient>[0],
  baseURL: string,
  testRunId: string,
  order: RaceOrder,
): Promise<void> => {
  const uniqueId = Date.now();
  let clientA: SimulatedE2EClient | null = null;
  let clientB: SimulatedE2EClient | null = null;

  try {
    const user = await createTestUser(testRunId);
    const syncConfig = getSuperSyncConfig(user);

    // --- A: tag X on T1 and T2 ---
    clientA = await createSimulatedClient(browser, baseURL, 'A', testRunId);
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
    clientB = await createSimulatedClient(browser, baseURL, 'B', testRunId);
    await clientB.sync.setupSuperSync(syncConfig);
    await clientB.sync.syncAndWait();
    await waitForTask(clientB.page, task1Name);
    await waitForTask(clientB.page, task2Name);

    // All later downloads go through explicit syncs.
    await setWsDownloadBlocked(clientA, true);
    await setWsDownloadBlocked(clientB, true);

    // --- B archives T1 ---
    await markTaskDoneByKey(clientB, task1Name);
    await archiveDoneTasks(clientB);
    await expect
      .poll(async () => getArchiveYoungTaskIds(clientB!.page), { timeout: 10000 })
      .toContain(task1Id!);

    if (order === 'delete-first') {
      // B uploads the archive; A deletes X and syncs (applies the archive,
      // uploads the delete); B renames X before downloading the delete.
      await clientB.sync.syncAndWait();
      await tagPageA.deleteTag(tagName);
      await clientA.sync.syncAndWait();
      expect(
        (await getArchiveYoungTask(clientA.page, task1Id!))?.tagIds ?? null,
        'precondition: A archived T1 without the deleted tag (#11466 fix)',
      ).toEqual([]);
      await renameTag(clientB.page, tagName, renamedTag);
      expect(await getStoreTagIdByTitle(clientB.page, renamedTag)).toBe(tagId);
      await clientB.sync.syncAndWait();
    } else {
      // A deletes X first (not synced yet), then B renames X, so the rename
      // is the NEWER write. B uploads archive + rename first; A then syncs
      // with its older delete pending. Under timestamp LWW the rename won
      // here; the marked delete must win instead.
      await tagPageA.deleteTag(tagName);
      await renameTag(clientB.page, tagName, renamedTag);
      expect(await getStoreTagIdByTitle(clientB.page, renamedTag)).toBe(tagId);
      await clientB.sync.syncAndWait();
      await clientA.sync.syncAndWait();
    }

    // --- settle: one more round each ---
    await clientA.sync.syncAndWait();
    await clientB.sync.syncAndWait();
    await clientA.sync.syncAndWait();

    const ids = { tagId: tagId!, task1Id: task1Id!, task2Id: task2Id! };
    const titles = [tagName, renamedTag];
    const outcomeA = await readOutcome(clientA, ids, titles);
    const outcomeB = await readOutcome(clientB, ids, titles);
    // Ids only, no titles. tagId stands in as "X" for readability.
    const described = JSON.stringify({ A: outcomeA, B: outcomeB })
      .split(tagId!)
      .join('X');
    console.log(`[11489] ${order} outcome: ${described}`);
    test.info().annotations.push({ type: `11489-${order}`, description: described });

    // The delete wins: the tag is gone on both, and no task references it,
    // live or archived. Both tasks themselves are kept (they have a project).
    const expected: Outcome = {
      tagExists: false,
      archivedT1TagIds: [],
      liveT2TagIds: [],
    };
    expect(outcomeA, 'A converged on the delete').toEqual(expected);
    expect(outcomeB, 'B converged on the delete').toEqual(expected);
  } finally {
    if (clientA) await closeClient(clientA);
    if (clientB) await closeClient(clientB);
  }
};

test.describe('@supersync Tag delete vs rename race (#11489)', () => {
  test('tag delete wins when it reaches the server before a concurrent rename (#11489) @supersync', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    await runRace(browser, baseURL!, testRunId, 'delete-first');
  });

  test('tag delete wins when a concurrent rename reaches the server first (#11489) @supersync', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    await runRace(browser, baseURL!, testRunId, 'rename-first');
  });
});

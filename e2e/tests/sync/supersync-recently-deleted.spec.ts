import { test, expect } from '../../fixtures/supersync.fixture';
import type { Page } from '@playwright/test';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import {
  closeRecentlyDeleted,
  deleteTaskViaContextMenu,
  expectRecentlyDeletedStoredCount,
  openRecentlyDeleted,
  RECENTLY_DELETED,
} from '../../utils/recently-deleted-helpers';
import { waitForMenuSettled } from '../../utils/waits';

/**
 * Recently deleted across devices (#2778).
 *
 * The trash is device-local but fed by the delete ops every client receives,
 * and a restore goes out as the existing `restoreTask` action. So a task
 * deleted on A can be restored from B's "Recently deleted", and A gets it back.
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-recently-deleted.spec.ts
 */

const backToToday = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    window.location.hash = '#/tag/TODAY/tasks';
  });
  await page.waitForURL(/tag\/TODAY\/tasks/);
};

/** Multi-select delete: one `deleteTasks` op, whose task snapshots the upload strips. */
const bulkDelete = async (page: Page, titles: string[]): Promise<void> => {
  for (const title of titles) {
    await page
      .locator('task')
      .filter({ hasText: title })
      .first()
      .locator('task-title')
      .first()
      .click({ modifiers: ['Control'] });
  }
  const bar = page.locator('task-multi-select-bar .bar');
  // Selecting a parent can count its subtasks too, so no exact number here.
  await expect(bar).toContainText('selected');
  await bar.getByRole('button', { name: 'Actions' }).click();
  await waitForMenuSettled(page);
  await page.locator('.mat-mdc-menu-content button', { hasText: 'Delete task' }).click();
  await page.locator('dialog-confirm button[e2e="confirmBtn"]').click();
  for (const title of titles) {
    await expect(page.locator('task').filter({ hasText: title })).toHaveCount(0);
  }
};

test.describe('@supersync Recently deleted', () => {
  test('a task deleted on A is restored from B and comes back on A', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(180000);
    const appUrl = baseURL || 'http://localhost:4242';
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);
      const title = `Trash-${testRunId}`;

      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);
      await clientA.workView.addTask(title);
      await waitForTask(clientA.page, title);
      await clientA.sync.syncAndWait();

      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, title);

      // A deletes, B receives the delete and records it in its own trash.
      await deleteTaskViaContextMenu(clientA.page, title);
      await expectRecentlyDeletedStoredCount(clientA.page, 1);
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await expect(clientB.page.locator('task').filter({ hasText: title })).toHaveCount(
        0,
      );
      await expectRecentlyDeletedStoredCount(clientB.page, 1);

      // B restores from its trash.
      await openRecentlyDeleted(clientB.page);
      const entryOnB = clientB.page
        .locator(RECENTLY_DELETED.ENTRY)
        .filter({ hasText: title });
      await expect(entryOnB).toBeVisible();
      await entryOnB.locator(RECENTLY_DELETED.RESTORE_BTN).click();
      await expect(entryOnB).toHaveCount(0);
      await expectRecentlyDeletedStoredCount(clientB.page, 0);
      await closeRecentlyDeleted(clientB.page);
      await backToToday(clientB.page);
      await waitForTask(clientB.page, title);
      await clientB.sync.syncAndWait();

      // A gets the restore. Its stored entry is removed by the remote
      // restoreTask itself, not just hidden because the task is live again.
      await clientA.sync.syncAndWait();
      await waitForTask(clientA.page, title);
      await expectRecentlyDeletedStoredCount(clientA.page, 0);
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  test("a bulk delete on A reaches B's trash with its subtasks", async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(180000);
    const appUrl = baseURL || 'http://localhost:4242';
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);
      const parent = `BulkParent-${testRunId}`;
      const child = `BulkChild-${testRunId}`;
      const other = `BulkOther-${testRunId}`;

      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);
      await clientA.workView.addTask(parent);
      await waitForTask(clientA.page, parent);
      await clientA.workView.addSubTask(
        clientA.page.locator('task').filter({ hasText: parent }).first(),
        child,
      );
      await clientA.workView.addTask(other);
      await waitForTask(clientA.page, other);
      await clientA.sync.syncAndWait();

      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, parent);
      await waitForTask(clientB.page, other);

      await bulkDelete(clientA.page, [parent, other]);
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await expect(clientB.page.locator('task').filter({ hasText: parent })).toHaveCount(
        0,
      );

      // The op B received carries ids only; B snapshots the tasks itself.
      await expectRecentlyDeletedStoredCount(clientB.page, 2);
      await openRecentlyDeleted(clientB.page);
      const parentEntry = clientB.page
        .locator(RECENTLY_DELETED.ENTRY)
        .filter({ hasText: parent });
      await expect(parentEntry).toContainText(/\+1 subtask(?!s)/);
      await expect(
        clientB.page.locator(RECENTLY_DELETED.ENTRY).filter({ hasText: other }),
      ).toBeVisible();
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});

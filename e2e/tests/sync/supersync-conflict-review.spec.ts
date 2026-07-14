import { test, expect } from '../../fixtures/supersync.fixture';
import {
  closeClient,
  createSimulatedClient,
  createTestUser,
  getSuperSyncConfig,
  getTaskElement,
  markTaskDone,
  renameTask,
  waitForTask,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';

/**
 * Covers the user-visible conflict safety net around automatic resolution:
 * disjoint fields survive as a merge, real losses remain reviewable, and FLIP
 * becomes a normal synced edit rather than a device-local display change.
 */
test.describe('@supersync Conflict Review', () => {
  test('disjoint edits merge and a discarded same-field edit can be flipped', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(180000);
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // Disjoint conflict: A changes title while B changes completion state.
      const mergeBase = `Conflict-Merge-${testRunId}`;
      const mergeTitle = `${mergeBase}-Renamed`;
      await clientA.workView.addTask(mergeBase);
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, mergeBase);

      await renameTask(clientA, mergeBase, mergeTitle);
      await markTaskDone(clientB, mergeBase);
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await clientA.sync.syncAndWait();

      await waitForTask(clientA.page, mergeTitle);
      await waitForTask(clientB.page, mergeTitle);
      await expect(getTaskElement(clientA, mergeTitle)).toHaveClass(/isDone/);
      await expect(getTaskElement(clientB, mergeTitle)).toHaveClass(/isDone/);

      // Same-field conflict: B's later title wins, while A's title is retained
      // in the device-local journal for review.
      const reviewBase = `Conflict-Flip-${testRunId}`;
      const discardedTitle = `${reviewBase}-A`;
      const autoWinnerTitle = `${reviewBase}-B`;
      await clientA.workView.addTask(reviewBase);
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, reviewBase);

      await renameTask(clientA, reviewBase, discardedTitle);
      await clientB.page.waitForTimeout(500);
      await renameTask(clientB, reviewBase, autoWinnerTitle);
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();

      await waitForTask(clientB.page, autoWinnerTitle);
      await expect(clientB.page.locator('button.sync-btn .mat-badge-content')).toHaveText(
        '1',
      );

      // Confirm the automatic winner reached the other client before FLIP, so
      // the final assertion proves FLIP propagated a new operation.
      await clientA.sync.syncAndWait();
      await waitForTask(clientA.page, autoWinnerTitle);

      await clientB.page.evaluate(() => {
        window.location.hash = '/sync-conflicts';
      });
      const reviewPage = clientB.page.locator('sync-conflicts-page');
      await expect(reviewPage).toBeVisible();
      await expect(reviewPage.getByRole('heading', { level: 1 })).toHaveText(
        'Sync Conflicts',
      );

      const conflictRow = reviewPage.locator('.conflict-row', {
        hasText: autoWinnerTitle,
      });
      await expect(conflictRow).toContainText('Local won');
      await expect(conflictRow).toContainText('Newer edit won');
      await conflictRow.locator('.row-head').click();
      await expect(conflictRow.locator('.field-name')).toHaveText('title');
      await expect(conflictRow).toContainText(discardedTitle);
      await expect(conflictRow).toContainText(autoWinnerTitle);
      const flipButton = conflictRow.getByRole('button', {
        name: 'Flip',
        exact: true,
      });
      await expect(flipButton).toBeEnabled();
      await flipButton.click();
      await expect(reviewPage.locator('.empty-state')).toContainText(
        'No conflicts to review.',
      );

      // The disjoint merge is informational history, not an unreviewed loss.
      await reviewPage.getByRole('tab', { name: 'History' }).click();
      const mergedRow = reviewPage.locator('.conflict-row', { hasText: mergeTitle });
      await expect(mergedRow).toContainText('Merged');
      await expect(mergedRow).toContainText('Auto-merged');

      await clientB.page.evaluate(() => {
        window.location.hash = '/tag/TODAY/tasks';
      });
      await waitForTask(clientB.page, discardedTitle);
      await clientB.sync.syncAndWait();
      await clientA.sync.syncAndWait();
      await waitForTask(clientA.page, discardedTitle);
      await waitForTask(clientB.page, discardedTitle);
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});

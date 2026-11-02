import { expect, test } from '../../fixtures/test.fixture';

/**
 * Regression for #7498: clicking the done-toggle on a task in the Boards view
 * used to make the task vanish — Eisenhower's four quadrants all filtered
 * `taskDoneState: UnDone` and there was no Done column. The fix relaxes the
 * Eisenhower defaults to `All` so completed tasks stay visible in their
 * original quadrant.
 */
test.describe('Boards #7498', () => {
  test('Eisenhower: task stays in its quadrant after done-toggle', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();

    // Plain task with no tags lands in the NOT_URGENT_AND_NOT_IMPORTANT
    // quadrant (excluded: [Important, Urgent], included: []).
    const taskName = `${testPrefix}repro7498-eisenhower`;
    await workViewPage.addTask(taskName);

    await page.goto('/#/boards/EISENHOWER_MATRIX');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('boards')).toBeVisible({ timeout: 10000 });

    // Default Eisenhower references Important / Urgent tags that don't exist
    // on a fresh profile — the quadrants show anyway, with a "Create Tags"
    // prompt above them; accept it if shown.
    const createTagsBtn = page.locator('button', { hasText: /create tags?/i });
    if (await createTagsBtn.isVisible().catch(() => false)) {
      await createTagsBtn.click();
    }

    const notUrgentNotImportantPanel = page
      .locator('board-panel')
      .filter({
        has: page.locator('header .title', { hasText: /not urgent.*not important/i }),
      })
      .first();
    await expect(notUrgentNotImportantPanel).toBeVisible({ timeout: 10000 });

    const task = notUrgentNotImportantPanel
      .locator('planner-task')
      .filter({ hasText: taskName })
      .first();
    await expect(task).toBeVisible();

    await taskPage.markTaskAsDone(task);

    // Fixed behavior: the task is still in its original quadrant, in its
    // collapsed Done group (as in task lists).
    const doneGroup = notUrgentNotImportantPanel.locator('.done-group');
    await expect(doneGroup).toContainText('(1)');
    await doneGroup.locator('.collapsible-header').click();
    await expect(
      doneGroup.locator('planner-task').filter({ hasText: taskName }),
    ).toBeVisible();
  });
});

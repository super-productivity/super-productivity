import { expect, test } from '../../fixtures/test.fixture';

// Collapsed sub tasks show a done/total badge on the toggle button (#7057).

test.describe('Sub task progress badge', () => {
  test('shows done/total only while sub tasks are collapsed', async ({
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const parentTitle = `${testPrefix}-Parent`;
    await workViewPage.addTask(parentTitle);
    const parent = taskPage.getTaskByText(parentTitle).first();

    await workViewPage.addSubTask(parent, 'Sub A');
    await workViewPage.addSubTask(parent, 'Sub B');
    await workViewPage.addSubTask(parent, 'Sub C');
    const subTasks = taskPage.getSubTasks(parent);
    await expect(subTasks).toHaveCount(3);
    await taskPage.markTaskAsDone(subTasks.filter({ hasText: 'Sub A' }));

    const toggleBtn = parent.locator('.toggle-sub-tasks-btn').first();
    const badge = toggleBtn.locator('.sub-task-progress-badge');
    await expect(badge).toHaveCount(0);

    // with some sub tasks done the toggle cycles: shown -> hide done -> hide all
    await toggleBtn.click();
    await expect(toggleBtn.locator('mat-icon')).toHaveText('remove');
    await expect(badge).toHaveCount(0);
    await toggleBtn.click();
    await expect(toggleBtn.locator('mat-icon')).toHaveText('add');

    await expect(badge).toHaveText('1/3');
    await expect(toggleBtn).toHaveAttribute('aria-label', 'Subtasks: 1 of 3 done');

    await toggleBtn.click();
    await expect(badge).toHaveCount(0);
    await expect(subTasks).toHaveCount(3);
  });
});

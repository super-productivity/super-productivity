import { expect, test } from '../../fixtures/test.fixture';
import { openRecurDialog, saveRecurDialog } from '../../utils/recurring-task-helpers';
import { flushPendingWrites } from '../../utils/waits';

test('keeps the priority when creating the next recurring occurrence', async ({
  page,
  workViewPage,
  taskPage,
}) => {
  await page.clock.setSystemTime(new Date('2026-06-01T10:00:00'));
  await page.reload();
  await workViewPage.waitForTaskList();
  await workViewPage.addTask('Recurring priority');
  const task = taskPage.getTaskByText('Recurring priority').first();
  await task.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Priority', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'High', exact: true }).click();
  await expect(task.locator('task-priority-indicator')).toHaveAttribute(
    'data-priority',
    '3',
  );

  await taskPage.openTaskDetail(task);
  await openRecurDialog(page);
  await saveRecurDialog(page);
  await page.keyboard.press('Escape');
  await taskPage.markTaskAsDone(task);
  await flushPendingWrites(page);

  await page.clock.setSystemTime(new Date('2026-06-02T10:00:00'));
  await page.reload();
  await workViewPage.waitForTaskList();
  const nextTask = taskPage
    .getUndoneTasks()
    .filter({ hasText: 'Recurring priority' })
    .first();
  await expect(nextTask).toBeVisible();
  await expect(nextTask.locator('task-priority-indicator')).toHaveAttribute(
    'data-priority',
    '3',
  );
});

test('edits an existing series priority and can clear it for future tasks only', async ({
  page,
  workViewPage,
  taskPage,
}) => {
  await page.clock.setSystemTime(new Date('2026-06-01T10:00:00'));
  await page.reload();
  await workViewPage.waitForTaskList();
  await workViewPage.addTask('Existing series priority');
  const task = taskPage
    .getUndoneTasks()
    .filter({ hasText: 'Existing series priority' })
    .first();
  await taskPage.openTaskDetail(task);
  await openRecurDialog(page);
  await saveRecurDialog(page);
  await page.keyboard.press('Escape');
  await taskPage.markTaskAsDone(task);
  await flushPendingWrites(page);
  await page.clock.setSystemTime(new Date('2026-06-02T10:00:00'));
  await page.reload();
  await workViewPage.waitForTaskList();
  await expect(task).toBeVisible();
  await expect(task.locator('task-priority-indicator')).toHaveCount(0);

  const setSeriesPriority = async (
    priority: 'High' | 'None',
    updateAll: boolean,
  ): Promise<void> => {
    await taskPage.openTaskDetail(task);
    const dialog = await openRecurDialog(page);
    await dialog.locator('.collapsible-header', { hasText: 'Options' }).click();
    // Formly can rebuild the fields right after Options expands, which removes
    // the select and its open panel, so open it again until the option shows.
    const option = page.getByRole('option', { name: priority, exact: true });
    await expect(async () => {
      await dialog.getByRole('combobox', { name: 'Priority', exact: true }).click();
      await expect(option).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 10000 });
    await option.click();
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    const confirmation = page.locator('dialog-confirm');
    await confirmation
      .getByRole('button', {
        name: updateAll ? 'Update all instances' : 'Only future tasks',
        exact: true,
      })
      .click();
    await expect(confirmation).toBeHidden();
    await expect(dialog).toBeHidden();
    await page.keyboard.press('Escape');
  };

  await setSeriesPriority('High', true);
  await expect(task.locator('task-priority-indicator')).toHaveAttribute(
    'data-priority',
    '3',
  );
  await taskPage.markTaskAsDone(task);
  await flushPendingWrites(page);
  await page.clock.setSystemTime(new Date('2026-06-03T10:00:00'));
  await page.reload();
  await workViewPage.waitForTaskList();
  await expect(task.locator('task-priority-indicator')).toHaveAttribute(
    'data-priority',
    '3',
  );

  await setSeriesPriority('None', false);
  await expect(task.locator('task-priority-indicator')).toHaveAttribute(
    'data-priority',
    '3',
  );
  await taskPage.markTaskAsDone(task);
  await flushPendingWrites(page);
  await page.clock.setSystemTime(new Date('2026-06-04T10:00:00'));
  await page.reload();
  await workViewPage.waitForTaskList();
  await expect(task).toBeVisible();
  await expect(task.locator('task-priority-indicator')).toHaveCount(0);
});

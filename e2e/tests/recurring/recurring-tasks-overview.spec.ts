import { type Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';
import { type TaskPage } from '../../pages/task.page';
import { type WorkViewPage } from '../../pages/work-view.page';
import { openRecurDialog, saveRecurDialog } from '../../utils/recurring-task-helpers';

const createRecurringTaskAndOpenProject = async (
  {
    page,
    workViewPage,
    taskPage,
  }: { page: Page; workViewPage: WorkViewPage; taskPage: TaskPage },
  title: string,
): Promise<void> => {
  await workViewPage.waitForTaskList();
  await workViewPage.addTask(title);
  const task = taskPage.getTaskByText(title).first();
  await taskPage.openTaskDetail(task);
  await openRecurDialog(page);
  await saveRecurDialog(page);
  await page.keyboard.press('Escape');

  // In-app navigation: a hash page.goto can be rewritten back to Today mid-bootstrap.
  await page.locator('magic-side-nav').getByText('Inbox', { exact: true }).click();
  await expect(
    page.locator('repeat-cfg-preview').filter({ hasText: title }),
  ).toBeVisible();
};

test('opens the overview of all recurring tasks from a project panel', async ({
  page,
  workViewPage,
  taskPage,
  testPrefix,
}) => {
  const title = `${testPrefix}-recurring`;
  await createRecurringTaskAndOpenProject({ page, workViewPage, taskPage }, title);

  // The overview has no side-nav entry; it is reached from the recurring panel.
  await expect(page.locator('magic-side-nav a[href="#/scheduled-list"]')).toHaveCount(0);

  await page.getByRole('button', { name: 'All recurring tasks', exact: true }).click();

  const overview = page.locator('scheduled-list-page');
  await expect(
    overview.locator('.repeat-task-cfg').filter({ hasText: title }),
  ).toBeVisible();
});

test('opens the overview with the keyboard', async ({
  page,
  workViewPage,
  taskPage,
  testPrefix,
}) => {
  const title = `${testPrefix}-recurring-kb`;
  await createRecurringTaskAndOpenProject({ page, workViewPage, taskPage }, title);

  await page.getByRole('button', { name: 'All recurring tasks', exact: true }).focus();
  await page.keyboard.press('Enter');

  await expect(
    page.locator('scheduled-list-page .repeat-task-cfg').filter({ hasText: title }),
  ).toBeVisible();
});

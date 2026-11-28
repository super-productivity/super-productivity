import { expect, test } from '../../fixtures/test.fixture';
import { ImportPage } from '../../pages/import.page';
import { waitForPluginAssets } from '../../helpers/plugin-test.helpers';
import { fakeMicrosoftTodo } from '../../helpers/fake-microsoft-todo';

test.describe('Microsoft To Do import plugin', () => {
  test('signs in and imports a list with steps, notes and a repeat', async ({
    page,
    workViewPage,
    projectPage,
    taskPage,
    testPrefix,
  }) => {
    test.setTimeout(90000);
    await workViewPage.waitForTaskList();
    if (!(await waitForPluginAssets(page))) {
      throw new Error('Plugin assets not available — run `npm run plugins:build`');
    }
    const list = `${testPrefix}-Groceries`;
    const graphAuth = await fakeMicrosoftTodo(
      page.context(),
      [{ id: 'L1', displayName: list, wellknownListName: 'none' }],
      {
        L1: [
          {
            id: 'T1',
            title: 'Weekly shop',
            status: 'notStarted',
            categories: ['errand'],
            body: { content: '<p>Bring bags</p>', contentType: 'html' },
            dueDateTime: { dateTime: '2026-12-01T00:00:00.0000000', timeZone: 'UTC' },
            recurrence: {
              pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'] },
              range: { type: 'noEnd' },
            },
            checklistItems: [
              { id: 's1', displayName: 'Milk', isChecked: false },
              { id: 's2', displayName: 'Bread', isChecked: true },
            ],
          },
        ],
      },
    );

    const importPage = new ImportPage(page);
    await importPage.navigateToImportPage();
    await page
      .locator('file-imex button', { hasText: 'Import from Microsoft To Do' })
      .click();

    const frame = page.frameLocator('plugin-index iframe');
    await frame.getByRole('button', { name: 'Sign in with Microsoft' }).click();
    await expect(frame.getByText(`${list} — tasks: 1, steps: 2`)).toBeVisible();
    expect(graphAuth.every((h) => h === 'Bearer fake-token')).toBe(true);
    await frame.getByRole('button', { name: 'Import' }).click();
    await expect(frame.getByRole('heading', { name: 'Import finished' })).toBeVisible({
      timeout: 30000,
    });
    await expect(frame.getByText(`${list}: 1 of 1 tasks, 2 of 2 steps`)).toBeVisible();

    // the summary hands the user straight to the imported tasks
    await frame.getByRole('button', { name: `Open “${list}”` }).click();
    await expect(page).toHaveURL(/#\/project\/[^/]+\/tasks/);
    await expect(projectPage.workCtxTitle).toContainText(list);
    const root = taskPage.getTaskByText('Weekly shop').first();
    await expect(root).toBeVisible();
    expect(await taskPage.taskHasTag(root, 'errand')).toBe(true);
    // `.last()`: the parent task element contains its sub-tasks' text too
    expect(await taskPage.isTaskDone(taskPage.getTaskByText('Bread').last())).toBe(true);
    expect(await taskPage.isTaskDone(taskPage.getTaskByText('Milk').last())).toBe(false);
    // the repeat chip in the task's tag list
    await expect(
      root.locator('tag-list mat-icon', { hasText: 'repeat' }).first(),
    ).toBeVisible();
  });
});

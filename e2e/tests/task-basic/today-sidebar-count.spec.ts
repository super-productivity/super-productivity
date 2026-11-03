import { expect, test } from '../../fixtures/test.fixture';

test('Today sidebar includes overdue tasks and updates its count breakdown', async ({
  page,
  workViewPage,
  taskPage,
  testPrefix,
}) => {
  await page.goto('/#/project/INBOX_PROJECT/tasks');
  await workViewPage.waitForTaskList();
  await page.waitForFunction(
    () => !!(window as unknown as { __e2eTestHelpers?: unknown }).__e2eTestHelpers,
  );
  const ids: string[] = [];
  for (const label of ['today', 'overdue', 'later today']) {
    const title = `${testPrefix} ${label}`;
    await workViewPage.addTask(title);
    ids.push((await taskPage.getTaskByText(title).getAttribute('data-task-id'))!);
  }
  await page.evaluate((taskIds) => {
    const store = (
      window as unknown as {
        __e2eTestHelpers: { store: { dispatch: (action: unknown) => void } };
      }
    ).__e2eTestHelpers.store;
    taskIds.forEach((id, index) => {
      const date = new Date();
      if (index === 1) date.setDate(date.getDate() - 1);
      const dueDay = [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0'),
      ].join('-');
      date.setHours(23, 59, 0, 0);
      store.dispatch({
        type: '[Task Shared] updateTask',
        task: {
          id,
          changes: { dueDay, dueWithTime: index === 2 ? date.getTime() : undefined },
        },
        meta: { isPersistent: true, entityType: 'TASK', entityId: id, opType: 'UPD' },
      });
    });
  }, ids);
  const today = page
    .locator('nav-item')
    .filter({ has: page.getByRole('menuitem', { name: 'Today', exact: true }) });
  await expect(today.locator('.task-count')).toHaveText('3');
  await expect(today.locator('.nav-link')).toHaveAttribute(
    'title',
    '2 today · 1 overdue',
  );
  await expect(today.locator('.task-count')).toHaveAttribute(
    'title',
    '2 today · 1 overdue',
  );
  await taskPage.markTaskAsDone(taskPage.getTaskByText(`${testPrefix} overdue`));
  await expect(today.locator('.task-count')).toHaveText('2');
  await expect(today.locator('.nav-link')).toHaveAttribute(
    'title',
    '2 today · 0 overdue',
  );
  await page.reload();
  await workViewPage.waitForTaskList();
  await expect(today.locator('.task-count')).toHaveText('2');
  await expect(today.locator('.nav-link')).toHaveAttribute(
    'title',
    '2 today · 0 overdue',
  );
});

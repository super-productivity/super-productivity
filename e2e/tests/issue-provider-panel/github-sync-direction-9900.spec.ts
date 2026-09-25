import { expect, test } from '../../fixtures/test.fixture';

// #9900: refreshing a plugin issue used the import mapping and then raw issue
// fields, overwriting task fields even when their sync direction was off.
test('GitHub refresh respects disabled title sync while still pulling status', async ({
  page,
  workViewPage,
  taskPage,
}) => {
  await workViewPage.waitForTaskList();
  let refreshed = false;
  let refreshRequests = 0;
  await page.route('https://api.github.com/**', async (route) => {
    const issue = {
      id: 9900,
      number: 9900,
      title: refreshed ? 'Remote replacement' : 'Original issue',
      body: 'Issue body',
      state: refreshed ? 'closed' : 'open',
      html_url: 'https://github.com/e2e/repro/issues/9900',
      created_at: '2026-09-01T12:00:00Z',
      updated_at: refreshed ? '2026-09-02T12:00:00Z' : '2026-09-01T12:00:00Z',
      comments: 0,
      labels: [],
    };
    if (refreshed && route.request().url().includes('/issues/9900')) {
      refreshRequests++;
    }
    await route.fulfill({
      json: route.request().url().includes('/search/issues') ? { items: [issue] } : issue,
    });
  });

  await page.locator('.e2e-toggle-issue-provider-panel').click();
  await page.locator('mat-tab-group .mat-mdc-tab:last-child').click();
  await page.getByRole('button', { name: 'GitHub Issues', exact: true }).click();
  const dialog = page.locator('dialog-edit-issue-provider');
  await dialog.locator('input[id*="repo"]').fill('e2e/repro');
  await dialog.getByRole('button', { name: /Two-Way Sync/i }).click();
  await dialog.locator('mat-select[id*="twoWaySync.title"]').click();
  await page.getByRole('option', { name: 'Off', exact: true }).click();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();

  await page.locator('mat-tab-group .mat-mdc-tab').first().click();
  await page.locator('issue-provider-tab input[name="search"]').fill('Original issue');
  await page
    .locator('issue-preview-item', { hasText: 'Original issue' })
    .getByRole('button')
    .first()
    .click();
  await page.locator('.e2e-toggle-issue-provider-panel').click();
  const task = taskPage.getTaskByText('#9900 Original issue');
  await expect(task).toBeVisible();
  await expect(task).not.toHaveClass(/isDone/);
  const taskId = await task.getAttribute('data-task-id');

  refreshed = true;
  await task.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Update issue data' }).click();

  // A pulled status change proves the refresh completed. The same response's
  // title must not overwrite the imported, mapped title (#9900 prefix included).
  const updatedTask = page.locator(`task[data-task-id="${taskId}"]`).first();
  await expect(updatedTask).toHaveClass(/isDone/);
  await expect(updatedTask.locator('task-title')).toHaveText('#9900 Original issue');
  expect(refreshRequests).toBeGreaterThan(0);
});

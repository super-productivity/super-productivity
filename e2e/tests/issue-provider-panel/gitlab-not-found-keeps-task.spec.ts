import { expect, test } from '../../fixtures/test.fixture';

// v20.0.0 moved GitLab to the plugin adapter, which deleted a linked task
// without tracked time as soon as a refresh got a 404. GitLab also answers 404
// for lost access or a wrong base URL, so the task must stay until the user
// deletes it from the warning.
test('GitLab refresh 404 keeps the linked task until the user deletes it', async ({
  page,
  workViewPage,
  taskPage,
}) => {
  await workViewPage.waitForTaskList();
  let isIssueMissing = false;
  let notFoundResponses = 0;
  await page.route('https://gitlab.com/api/v4/**', async (route) => {
    const url = route.request().url();
    if (isIssueMissing && url.includes('/issues/42')) {
      notFoundResponses++;
      await route.fulfill({ status: 404, json: { message: '404 Not found' } });
      return;
    }
    const issue = {
      iid: 42,
      title: 'Linked issue',
      description: 'Issue body',
      state: 'opened',
      created_at: '2026-10-01T12:00:00Z',
      updated_at: '2026-10-01T12:00:00Z',
      labels: [],
      web_url: 'https://gitlab.com/e2e/repro/-/issues/42',
      references: { full: 'e2e/repro#42' },
    };
    if (url.includes('/notes')) {
      await route.fulfill({ json: [] });
    } else if (url.includes('/issues?')) {
      await route.fulfill({ json: [issue] });
    } else {
      await route.fulfill({ json: issue });
    }
  });

  await page.locator('.e2e-toggle-issue-provider-panel').click();
  await page.locator('issue-panel .mat-mdc-tab').last().click();
  await page.getByRole('button', { name: 'GitLab Issues', exact: true }).click();
  const dialog = page.locator('dialog-edit-issue-provider');
  await dialog.locator('input[id*="project"]').fill('e2e/repro');
  await dialog.locator('input[id*="token"]').fill('e2e-token');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();

  await page.locator('issue-panel .mat-mdc-tab').first().click();
  await page.locator('issue-provider-tab input[name="search"]').fill('Linked issue');
  await page
    .locator('issue-preview-item', { hasText: 'Linked issue' })
    .getByRole('button')
    .first()
    .click();
  await page.locator('.e2e-toggle-issue-provider-panel').click();
  const task = taskPage.getTaskByText('#42 Linked issue');
  await expect(task).toBeVisible();
  const taskId = await task.getAttribute('data-task-id');
  const linkedTask = page.locator(`task[data-task-id="${taskId}"]`);

  isIssueMissing = true;
  await task.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Update issue data' }).click();

  // The refresh has finished once the warning shows; the task must still be there.
  await expect.poll(() => notFoundResponses).toBeGreaterThan(0);
  const warning = page.locator('snack-custom', { hasText: 'was not found' });
  await expect(warning).toBeVisible();
  await expect(linkedTask).toHaveCount(1);

  await warning.getByRole('button', { name: 'Delete' }).click();
  await expect(linkedTask).toHaveCount(0);
});

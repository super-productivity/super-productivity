import { expect, test } from '../../fixtures/test.fixture';

// #10112: after a restart, plugin providers (GitHub, Linear) register after the
// per-project ("When context is open") poll effect evaluated its providers, so
// backlog auto-import never started until the user switched context.
test('per-project backlog polling starts after restart without a context switch', async ({
  page,
  workViewPage,
}) => {
  test.setTimeout(120000);
  await workViewPage.waitForTaskList();

  let backlogPolls = 0;
  await page.route('https://api.github.com/**', async (route) => {
    const url = decodeURIComponent(route.request().url());
    if (url.includes('/search/issues') && url.includes('sort:updated state:open')) {
      backlogPolls++;
    }
    await route.fulfill({ json: { items: [] } });
  });

  await page.goto('/#/project/INBOX_PROJECT/tasks');
  await workViewPage.waitForTaskList();

  await page.locator('.e2e-toggle-issue-provider-panel').click();
  await page.locator('issue-panel .mat-mdc-tab').last().click();
  await page.getByRole('button', { name: 'GitHub Issues', exact: true }).click();
  const dialog = page.locator('dialog-edit-issue-provider');
  await dialog.locator('input[id*="repo"]').fill('e2e/repro');
  await dialog.getByText('Advanced Config').click();
  await dialog.locator('mat-select[id*="defaultProjectId"]').click();
  await page.getByRole('option', { name: 'Inbox' }).click();
  await dialog.getByText('Auto import to default project').click();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.locator('.e2e-toggle-issue-provider-panel').click();

  // Control: re-entering the project in the running app starts polling.
  await page.goto('/#/tag/TODAY/tasks');
  await page.goto('/#/project/INBOX_PROJECT/tasks');
  await expect.poll(() => backlogPolls, { timeout: 20000 }).toBeGreaterThan(0);

  await page.reload();
  await workViewPage.waitForTaskList();
  backlogPolls = 0;

  // First poll is due DELAY_BEFORE_ISSUE_POLLING (8s) after the trigger.
  await expect.poll(() => backlogPolls, { timeout: 30000 }).toBeGreaterThan(0);
});

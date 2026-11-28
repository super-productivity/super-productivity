import { expect, test } from '../../fixtures/test.fixture';

// OpenProject and Jira refresh a provider's linked tasks one by one in the same
// poll (BaseIssueProviderService). One failed refresh must not drop the others.
test('a missing OpenProject work package does not block other updates in the same poll', async ({
  page,
  workViewPage,
}) => {
  test.setTimeout(90000);
  await workViewPage.waitForTaskList();
  await page.goto('/#/project/INBOX_PROJECT/tasks');
  await workViewPage.waitForTaskList();
  let changed = false;
  let missingRequests = 0;
  let updatedRequests = 0;
  const workPackage = (id: number): Record<string, unknown> => ({
    _type: 'WorkPackage',
    id,
    subject: id === 2 && changed ? 'Updated second package' : `OpenProject audit ${id}`,
    description: { format: 'markdown', raw: 'Remote description', html: '' },
    createdAt: '2026-09-01T12:00:00Z',
    updatedAt: changed ? '2026-09-02T12:00:00Z' : '2026-09-01T12:00:00Z',
    startDate: null,
    dueDate: null,
    estimatedTime: null,
    storyPoints: null,
    lockVersion: 1,
    percentageDone: 0,
    _links: {
      self: { href: `/api/v3/work_packages/${id}`, title: `OpenProject audit ${id}` },
      status: { href: '/api/v3/statuses/1', title: 'New' },
    },
  });
  await page.route('https://openproject.e2e.test/**', async (route) => {
    const url = new URL(route.request().url());
    const workPackageMatch = url.pathname.match(/^\/api\/v3\/work_packages\/([12])$/);
    if (workPackageMatch) {
      const id = Number(workPackageMatch[1]);
      if (changed && id === 1) {
        missingRequests++;
        await route.fulfill({
          status: 404,
          json: { _type: 'Error', message: 'Not Found' },
        });
      } else {
        if (changed) updatedRequests++;
        await route.fulfill({ json: workPackage(id) });
      }
    } else if (url.pathname.endsWith('/work_packages')) {
      await route.fulfill({
        json: {
          _type: 'Collection',
          total: 2,
          count: 2,
          _embedded: { elements: [workPackage(1), workPackage(2)] },
        },
      });
    } else {
      await route.fulfill({
        json: { _type: 'Collection', total: 0, count: 0, _embedded: { elements: [] } },
      });
    }
  });
  await page.locator('.e2e-toggle-issue-provider-panel').click();
  await page.locator('issue-panel .mat-mdc-tab').last().click();
  await page.getByRole('button', { name: 'Open Project', exact: true }).click();
  const dialog = page.locator('dialog-edit-issue-provider');
  await dialog.locator('input[id*="host"]').fill('https://openproject.e2e.test');
  await dialog.locator('input[id*="token"]').fill('synthetic-token');
  await dialog.locator('input[id*="projectId"]').fill('audit');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.locator('issue-panel .mat-mdc-tab').first().click();
  await page.locator('issue-provider-tab input[name="search"]').fill('OpenProject audit');
  for (const id of [1, 2]) {
    await page
      .locator('issue-preview-item', { hasText: `OpenProject audit ${id}` })
      .getByRole('button')
      .first()
      .click();
    await expect(
      page.locator('task-title', { hasText: `#${id} OpenProject audit ${id}` }),
    ).toBeVisible();
  }
  await page.locator('.e2e-toggle-issue-provider-panel').click();
  changed = true;
  // Re-entering the project restarts its update poll after the usual 8s delay.
  await page.goto('/#/tag/TODAY/tasks');
  await page.goto('/#/project/INBOX_PROJECT/tasks');
  await expect.poll(() => missingRequests, { timeout: 25000 }).toBeGreaterThan(0);
  await expect.poll(() => updatedRequests, { timeout: 10000 }).toBeGreaterThan(0);
  await expect(
    page.locator('task-title', { hasText: '#2 Updated second package' }),
  ).toBeVisible({ timeout: 10000 });
  await expect(
    page.locator('task-title', { hasText: '#1 OpenProject audit 1' }),
  ).toBeVisible();
});

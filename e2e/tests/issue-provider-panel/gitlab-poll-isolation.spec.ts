import { expect, test } from '../../fixtures/test.fixture';

test('a missing GitLab issue does not block other issue updates in the same poll', async ({
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
  const issue = (number: number): Record<string, unknown> => ({
    id: 1000 + number,
    iid: number,
    project_id: 10,
    title: number === 2 && changed ? 'Updated second issue' : `GitLab audit ${number}`,
    description: 'Remote description',
    state: 'opened',
    created_at: '2026-09-01T12:00:00Z',
    updated_at: changed ? '2026-09-02T12:00:00Z' : '2026-09-01T12:00:00Z',
    labels: [],
    author: { id: 1, name: 'Synthetic', username: 'synthetic' },
    assignees: [],
    assignee: null,
    milestone: null,
    due_date: null,
    user_notes_count: 0,
    web_url: `https://gitlab.com/e2e/audit/-/issues/${number}`,
    references: {
      full: `e2e/audit#${number}`,
      short: `#${number}`,
      relative: `#${number}`,
    },
    _links: {
      self: `https://gitlab.com/api/v4/projects/10/issues/${number}`,
      notes: `https://gitlab.com/api/v4/projects/10/issues/${number}/notes`,
    },
  });
  await page.route('https://gitlab.com/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/notes')) {
      await route.fulfill({ json: [] });
    } else if (/\/issues\/[12]$/.test(url.pathname)) {
      const number = Number(url.pathname.slice(-1));
      if (changed && number === 1) {
        missingRequests++;
        await route.fulfill({ status: 404, json: { message: 'Not Found' } });
      } else {
        if (changed) updatedRequests++;
        await route.fulfill({ json: issue(number) });
      }
    } else {
      await route.fulfill({ json: [issue(1), issue(2)] });
    }
  });
  await page.locator('.e2e-toggle-issue-provider-panel').click();
  await page.locator('issue-panel .mat-mdc-tab').last().click();
  await page.getByRole('button', { name: 'GitLab', exact: true }).click();
  const dialog = page.locator('dialog-edit-issue-provider');
  await dialog.locator('input[id*="project"]').fill('e2e/audit');
  await dialog.locator('input[id*="token"]').fill('synthetic-token');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.locator('issue-panel .mat-mdc-tab').first().click();
  await page.locator('issue-provider-tab input[name="search"]').fill('GitLab audit');
  for (const number of [1, 2]) {
    await page
      .locator('issue-preview-item', { hasText: `GitLab audit ${number}` })
      .getByRole('button')
      .first()
      .click();
    await expect(
      page.locator('task-title', { hasText: `GitLab audit ${number}` }),
    ).toBeVisible();
  }
  await page.locator('.e2e-toggle-issue-provider-panel').click();
  changed = true;
  await page.goto('/#/tag/TODAY/tasks');
  await page.goto('/#/project/INBOX_PROJECT/tasks');
  await expect.poll(() => missingRequests, { timeout: 25000 }).toBeGreaterThan(0);
  await expect.poll(() => updatedRequests, { timeout: 10000 }).toBeGreaterThan(0);
  await expect(
    page.locator('task-title', { hasText: 'Updated second issue' }),
  ).toBeVisible({ timeout: 10000 });
  await expect(page.locator('task-title', { hasText: 'GitLab audit 1' })).toBeVisible();
});

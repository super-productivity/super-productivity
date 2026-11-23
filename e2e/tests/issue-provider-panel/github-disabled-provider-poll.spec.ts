import { expect, test } from '../../fixtures/test.fixture';

// Disabling a provider must stop the update poll the open project started.
test('a disabled GitHub provider stops updating its linked tasks', async ({
  page,
  workViewPage,
}) => {
  test.setTimeout(120000);
  // The fake clock must precede Angular bootstrap so RxJS timers use it.
  await page.clock.install();
  await page.reload();
  await workViewPage.waitForTaskList();
  let backlogPolls = 0;
  let updatePolls = 0;
  // Each remote edit gets a newer update time, so the poll applies it.
  const remoteEdits = [
    'Synthetic poll issue',
    'Synthetic remote edit',
    'Synthetic edit while disabled',
  ];
  let remoteVersion = 0;
  await page.route('https://api.github.com/**', async (route) => {
    const url = decodeURIComponent(route.request().url());
    const issue = {
      id: 43,
      number: 43,
      title: remoteEdits[remoteVersion],
      body: 'Remote body',
      state: 'open',
      html_url: 'https://github.com/e2e/poll/issues/43',
      created_at: '2026-09-01T12:00:00Z',
      updated_at: `2026-09-0${remoteVersion + 1}T12:00:00Z`,
      comments: 0,
      labels: [],
    };
    if (url.includes('/search/issues')) {
      if (url.includes('sort:updated state:open')) backlogPolls++;
      await route.fulfill({ json: { items: [issue] } });
    } else {
      if (url.includes('/issues/43')) updatePolls++;
      await route.fulfill({ json: issue });
    }
  });
  await page.goto('/#/project/INBOX_PROJECT/tasks');
  await workViewPage.waitForTaskList();
  await page.locator('.e2e-toggle-issue-provider-panel').click();
  await page.locator('issue-panel .mat-mdc-tab').last().click();
  await page.getByRole('button', { name: 'GitHub Issues', exact: true }).click();
  const dialog = page.locator('dialog-edit-issue-provider');
  await dialog.locator('input[id*="repo"]').fill('e2e/poll');
  await dialog.getByText('Advanced Config').click();
  await dialog.locator('mat-select[id*="defaultProjectId"]').click();
  await page.getByRole('option', { name: 'Inbox' }).click();
  await dialog.getByText('Auto import to default project').click();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.locator('.e2e-toggle-issue-provider-panel').click();

  const linkedTitles = (): Promise<string[]> =>
    page.evaluate(() => {
      type LinkedTask = { title: string; issueId?: string };
      const h = (
        window as unknown as {
          __e2eTestHelpers: {
            store: {
              subscribe: (
                fn: (s: { tasks: { entities: Record<string, LinkedTask> } }) => void,
              ) => { unsubscribe: () => void };
            };
          };
        }
      ).__e2eTestHelpers;
      let tasks: LinkedTask[] = [];
      h.store
        .subscribe((s) => {
          tasks = Object.values(s.tasks.entities);
        })
        .unsubscribe();
      return tasks.filter((t) => t.issueId === '43').map((t) => t.title);
    });

  // Re-entering the project starts the per-project polls with the new provider.
  const before = backlogPolls;
  await page.goto('/#/tag/TODAY/tasks');
  await page.goto('/#/project/INBOX_PROJECT/tasks');
  await expect.poll(() => backlogPolls, { timeout: 20000 }).toBeGreaterThan(before);
  await expect.poll(linkedTitles).toEqual(['#43 Synthetic poll issue']);

  // While the provider is enabled, the update poll applies a remote edit.
  remoteVersion = 1;
  await page.clock.fastForward(11 * 60 * 1000);
  await expect.poll(linkedTitles).toEqual(['#43 Synthetic remote edit']);

  await page.locator('.e2e-toggle-issue-provider-panel').click();
  await page.locator('issue-panel .mat-mdc-tab').first().click();
  await page.locator('issue-provider-tab header button').click();
  await dialog.getByRole('switch', { name: 'Enabled', exact: true }).click();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();

  remoteVersion = 2;
  const pollsWhenDisabled = updatePolls;
  // The update interval is ten minutes; without the fix this tick polls.
  await page.clock.fastForward(11 * 60 * 1000);
  // Give a poll triggered by the tick time to reach the mocked API.
  await page.waitForTimeout(1000);
  expect(updatePolls).toBe(pollsWhenDisabled);
  expect(await linkedTitles()).toEqual(['#43 Synthetic remote edit']);
});

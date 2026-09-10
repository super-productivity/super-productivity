import { expect, test } from '../../fixtures/test.fixture';

// #9900: CalendarIntegrationService swallowed the HttpErrorResponse, so the
// setup dialog could only say "Connection failed". Preserve the reason but
// redact the URL, which commonly embeds a private calendar access token.
test('calendar connection failure shows the HTTP status without exposing its URL', async ({
  page,
  workViewPage,
}) => {
  await workViewPage.waitForTaskList();
  const calendarUrl = 'https://calendar.example/private-secret-9900/events.ics';
  let requests = 0;
  await page.route(calendarUrl, async (route) => {
    requests++;
    await route.fulfill({ status: 401, body: 'Unauthorized' });
  });

  await page.locator('.e2e-toggle-issue-provider-panel').click();
  await page.locator('mat-tab-group .mat-mdc-tab:last-child').click();
  await page.getByRole('button', { name: 'Other (iCal)' }).click();
  const dialog = page.locator('dialog-edit-issue-provider');
  await dialog.locator('input[id*="icalUrl"]').fill(calendarUrl);
  await dialog.getByRole('button', { name: 'Test connection' }).click();

  const snack = page.locator('mat-snack-bar-container');
  await expect(snack).toContainText('Connection failed:');
  await expect(snack).toContainText('401');
  await expect(snack).not.toContainText('private-secret-9900');
  await expect(snack).not.toContainText(calendarUrl);
  expect(requests).toBeGreaterThan(0);
  await expect(dialog).toBeVisible();
});

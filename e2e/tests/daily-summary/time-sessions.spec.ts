import { expect, test } from '../../fixtures/test.fixture';

test.describe('Time sessions', () => {
  test('records separate stopwatch sessions and preserves them after correcting a total and reloading', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    await page.clock.install();
    await page.reload();
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('Session recording');
    const task = taskPage.getTaskByText('Session recording');
    await taskPage.toggleTaskTimeTracking(task);
    await page.clock.fastForward(2000);
    await expect(task.locator('.time .separator')).toHaveCount(1);
    await taskPage.toggleTaskTimeTracking(task);
    await taskPage.toggleTaskTimeTracking(task);
    await page.clock.fastForward(2000);
    await taskPage.toggleTaskTimeTracking(task);
    await page.goto('/#/tag/TODAY/daily-summary');
    const detail = page.locator('daily-worklog-table');
    await detail.locator('summary').click();
    await expect(detail.locator('.recording')).toHaveCount(2);
    const total = detail.locator('tbody inline-input');
    await total.click();
    await total.locator('input').fill('10m');
    await total.locator('input').press('Enter');
    await expect(detail.locator('tbody')).toContainText('0:10');
    await expect(detail.locator('.recording')).toHaveCount(2);
    await page.reload();
    await detail.locator('summary').click();
    await expect(detail.locator('tbody')).toContainText('0:10');
    await expect(detail.locator('.recording')).toHaveCount(2);
  });

  test('adds and edits a manual session for a new task from the daily summary', async ({
    page,
    workViewPage,
  }, testInfo) => {
    await workViewPage.waitForTaskList();
    await page.goto('/#/tag/TODAY/daily-summary');
    const detail = page.locator('daily-worklog-table');
    await detail.locator('summary').click();
    await detail.getByRole('button', { name: 'Add session', exact: true }).click();
    await detail
      .getByRole('textbox', { name: 'New task', exact: true })
      .fill('Retrospective work');
    await detail.getByLabel('Start time (optional)').fill('09:00');
    await detail.getByLabel('Duration', { exact: true }).fill('30m');
    await detail.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(detail.locator('tbody')).toContainText('Retrospective work');
    await expect(detail.locator('.recording')).toContainText('09:00 – 09:30');
    await detail.getByRole('button', { name: 'Edit', exact: true }).click();
    await detail.getByLabel('End time', { exact: true }).fill('09:45');
    await detail.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(detail.locator('.recording')).toContainText('09:00 – 09:45');
    await expect(detail.locator('tbody inline-input')).toContainText('0:45');
    await page.getByRole('button', { name: 'Finish the day', exact: true }).click();
    await expect(page.locator('daily-summary')).toHaveCount(0);
    await page.goto('/#/tag/TODAY/daily-summary');
    await detail.locator('summary').click();
    await expect(detail.locator('.recording')).toContainText('09:00 – 09:45');
    await detail.getByRole('button', { name: 'Edit', exact: true }).click();
    await detail.getByLabel('End time', { exact: true }).fill('10:00');
    await detail.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(detail.locator('.recording')).toContainText('09:00 – 10:00');
    await expect(detail.locator('tbody inline-input')).toContainText('1:00');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      detail.getByRole('button', { name: 'Add session', exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('time-sessions-mobile.png'),
      fullPage: true,
    });
  });
});

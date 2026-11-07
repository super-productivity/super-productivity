import { readFile } from 'node:fs/promises';
import { expect, test } from '../../fixtures/test.fixture';
import { flushPendingWrites } from '../../utils/waits';

test('export options recompute rows and an added column enters the export', async ({
  page,
  workViewPage,
  testPrefix,
}) => {
  await workViewPage.waitForTaskList();
  await workViewPage.addTask(`${testPrefix}-Alpha 10m/1h`);
  await workViewPage.addTask(`${testPrefix}-Beta 20m/1h`);
  await flushPendingWrites(page);
  await page.goto('/#/tag/TODAY/history');
  await page
    .locator('history .month-title button[aria-label="Export data"]')
    .first()
    .click();
  const dialog = page.locator('dialog-worklog-export');
  await expect(dialog.locator('table tr')).toHaveCount(3);
  await dialog.locator('.options-collapsible .collapsible-header').click();
  const grouping = dialog
    .locator('mat-form-field')
    .filter({ hasText: 'Group by' })
    .locator('mat-select');
  await grouping.click();
  await page.getByRole('option', { name: 'Task/Subtask', exact: true }).click();
  await expect(dialog.locator('table tr')).toHaveCount(4);
  await dialog.locator('button.add-col').click();
  await page.getByRole('menuitem', { name: 'Time as milliseconds', exact: true }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.locator('a').filter({ hasText: 'Save to file' }).click(),
  ]);
  const path = await download.path();
  if (!path) throw new Error('CSV path missing');
  const csv = (await readFile(path, 'utf8')).replace(/^\uFEFF/, '');
  expect(csv.split('\n')[0]).toBe('Date;Start;End;Worked;Titles;Worked');
  expect(csv).toContain(';600000');
  expect(csv).toContain(';1200000');
  await expect(dialog.locator('table th')).toHaveCount(6);
  await flushPendingWrites(page);
  await page.goto('/#/tag/TODAY/history');
  await page
    .locator('history .month-title button[aria-label="Export data"]')
    .first()
    .click();
  await expect(page.locator('dialog-worklog-export table th')).toHaveCount(6);
});

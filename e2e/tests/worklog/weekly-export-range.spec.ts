import type { Store } from '@ngrx/store';
import type { RootState } from '../../../src/app/root-store/root-state';
import { expect, test } from '../../fixtures/test.fixture';
import { flushPendingWrites } from '../../utils/waits';
import { readFile } from 'node:fs/promises';

for (const scenario of [
  { date: '2027-01-01', firstDay: 1, start: '2027-01-01', end: '2027-01-03' },
  { date: '2025-12-31', firstDay: 1, start: '2025-12-29', end: '2025-12-31' },
  { date: '2026-12-31', firstDay: 1, start: '2026-12-28', end: '2026-12-31' },
  { date: '2026-10-18', firstDay: 0, start: '2026-10-18', end: '2026-10-24' },
]) {
  test(`history weekly export includes the displayed day ${scenario.date} (week starts ${scenario.firstDay})`, async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    await page.clock.setSystemTime(new Date(`${scenario.date}T12:00:00`));
    await page.reload();
    await workViewPage.waitForTaskList();
    await page.evaluate((firstDayOfWeek) => {
      const store = (window as Window & { __e2eTestHelpers: { store: Store<RootState> } })
        .__e2eTestHelpers.store;
      store.dispatch({
        type: '[Global Config] Update Global Config Section',
        sectionKey: 'localization',
        sectionCfg: { firstDayOfWeek },
        meta: {
          isPersistent: true,
          entityType: 'GLOBAL_CONFIG',
          entityId: 'GLOBAL_CONFIG',
          opType: 'UPD',
        },
      });
    }, scenario.firstDay);
    const title = `${testPrefix}-Weekly export`;
    await workViewPage.addTask(`${title} 10m/1h`);
    await flushPendingWrites(page);
    await page.goto('/#/tag/TODAY/history');
    const week = page.locator('history .week').first();
    await expect(week).toContainText('10m');
    await week.locator('.week-header button[aria-label="Export data"]').click();
    const dialog = page.locator('dialog-worklog-export');
    await expect(dialog.locator('table')).toContainText(title);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      dialog.locator('a').filter({ hasText: 'Save to file' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(
      `tasks${scenario.start}-${scenario.end}.csv`,
    );
    const path = await download.path();
    if (!path) throw new Error('CSV path missing');
    expect(await readFile(path, 'utf8')).toContain(
      `${scenario.date}; - ; - ;0:10;${title}`,
    );
  });
}

test('daily summary exports its current week across New Year', async ({
  page,
  workViewPage,
  testPrefix,
}) => {
  await page.clock.setSystemTime(new Date('2027-01-01T12:00:00'));
  await page.reload();
  await workViewPage.waitForTaskList();
  const title = `${testPrefix}-New Year summary`;
  await workViewPage.addTask(`${title} 10m/1h`);
  await page.locator('.e2e-finish-day').click();
  await page.waitForURL(/daily-summary/);
  await page.locator('worklog-week button').last().click();
  await expect(page.locator('dialog-worklog-export table')).toContainText(title);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('dialog-worklog-export a').filter({ hasText: 'Save to file' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('tasks2026-12-28-2027-01-03.csv');
});

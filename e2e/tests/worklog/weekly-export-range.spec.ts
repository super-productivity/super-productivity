import type { Store } from '@ngrx/store';
import type { RootState } from '../../../src/app/root-store/root-state';
import { expect, test } from '../../fixtures/test.fixture';

for (const scenario of [
  { date: '2027-01-01', firstDay: 1, start: '2026-12-28', end: '2027-01-03' },
  { date: '2026-10-18', firstDay: 0, start: '2026-10-18', end: '2026-10-24' },
]) {
  test(`daily summary exports its displayed week on ${scenario.date} (week starts ${scenario.firstDay})`, async ({
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
    const title = `${testPrefix}-Weekly summary export`;
    await workViewPage.addTask(`${title} 10m/1h`);
    await page.locator('.e2e-finish-day').click();
    await page.waitForURL(/daily-summary/);
    await page.locator('worklog-week button').last().click();
    const dialog = page.locator('dialog-worklog-export');
    await expect(dialog.locator('table')).toContainText(title);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      dialog.locator('a').filter({ hasText: 'Save to file' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(
      `tasks${scenario.start}-${scenario.end}.csv`,
    );
  });
}

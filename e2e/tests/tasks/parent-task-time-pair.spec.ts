import { test, expect } from '../../fixtures/test.fixture';

// #9190: a parent row shows 'Σ time spent / ⏳ time left'. Both are rendered rounded
// down and share a partial minute, so rounding them separately dropped it twice and
// the pair read a minute short of the estimate.
test.describe('Parent task time pair', () => {
  test.beforeEach(async ({ workViewPage }) => {
    await workViewPage.waitForTaskList();
  });

  test('should add up to the sub task estimates when a partial minute is tracked', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.addTask('parent task');
    const parent = page.locator('task').first();

    // '0.05m/2m' is 3s spent against a 2m estimate - the reported state, without
    // having to track for real.
    await workViewPage.addSubTask(parent, 'sub a 0.05m/2m');
    await workViewPage.addSubTask(parent, 'sub b 1m');

    // The parent row is the one carrying the sub task totals.
    const timeWrapper = parent.locator('.time-wrapper').first();
    // 2m + 1m estimated, 3s of it spent: the pair has to still read 3m. Before the
    // fix this rendered 'Σ - / ⏳ 2m' - a minute short of the estimates.
    await expect(timeWrapper).toContainText('3m');
    await expect(timeWrapper).not.toContainText('2m');
  });
});

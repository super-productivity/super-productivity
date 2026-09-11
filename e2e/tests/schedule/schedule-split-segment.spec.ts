import { expect, test } from '../../fixtures/test.fixture';

const DESKTOP_VIEWPORT = { width: 1280, height: 720 };

test.describe('Schedule split segments', () => {
  test.use({ viewport: DESKTOP_VIEWPORT });

  test('should open the task when a continued segment is clicked', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    await page.getByRole('menuitem', { name: 'Schedule' }).click();

    // A 30h estimate crosses midnight no matter which hour the click lands on,
    // so the split does not depend on the grid's scroll position or on the time
    // of day the test runs at. Two later columns stay visible for the tails.
    const dayCols = page.locator('schedule-week .col:not(.end-of-day)[data-day]');
    const targetDay = dayCols.nth(2);
    await targetDay.click({
      position: {
        x: await targetDay.evaluate((el) => el.clientWidth - 5),
        y: await targetDay.evaluate((el) => el.clientHeight / 2),
      },
    });

    const newTaskInput = page.getByRole('combobox', { name: 'Schedule task...' });
    await newTaskInput.fill('Runs past midnight 30h');
    await newTaskInput.press('Enter');

    // The tail of a task crossing midnight renders as SplitTaskContinuedLast on
    // the following day. It is the segment #9363 reported as dead.
    const continuedSegment = page
      .locator('schedule-event.SplitTaskContinuedLast')
      .first();
    await expect(continuedSegment).toBeVisible();

    await continuedSegment.click({ position: { x: 0, y: 0 } });

    await expect(
      page.locator('task-detail-panel').filter({ hasText: 'Runs past midnight' }),
    ).toBeVisible();
  });
});

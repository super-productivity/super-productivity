import { expect, test } from '../../fixtures/test.fixture';
import { openTaskDetailPanel } from '../../utils/schedule-task-helper';

// Regression test for the schedule dialog on small phones (e.g. 360–390px wide):
// - mat-calendar's min-height used to transfer through its aspect-ratio into a
//   ~400px intrinsic width, forcing horizontal scrolling inside the dialog.
// - The Cancel/Unschedule/Schedule action row used to wrap onto a second row.
test.use({ viewport: { width: 372, height: 800 } });

const SCHEDULE_DIALOG = 'dialog-schedule-task';
const DETAIL_PANEL_SCHEDULE_ITEM =
  'task-detail-item:has(mat-icon:text("alarm")), ' +
  'task-detail-item:has(mat-icon:text("today")), ' +
  'task-detail-item:has(mat-icon:text("schedule"))';

test.describe('schedule dialog on a small viewport', () => {
  test('fits without horizontal scroll and keeps action buttons on one row', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const title = `${testPrefix}-small-screen`;
    // Mobile layout: use the bottom-nav FAB to open the add task bar
    await page.locator('mobile-bottom-nav .add-task-button').click();
    const input = page.locator('add-task-bar .main-input').first();
    await input.waitFor({ state: 'visible' });
    await input.fill(title);
    await input.press('Enter');
    await page.keyboard.press('Escape');
    const task = page.locator(`task:has-text("${title}")`).first();
    await task.waitFor({ state: 'visible' });

    // Schedule the task with a time so the dialog shows all three action
    // buttons (Cancel / Unschedule / Schedule) when reopened.
    await openTaskDetailPanel(page, task);
    const scheduleItem = page.locator(DETAIL_PANEL_SCHEDULE_ITEM).first();
    await scheduleItem.click();
    const dialog = page.locator(SCHEDULE_DIALOG);
    await dialog.waitFor({ state: 'visible' });
    const timeInput = page.locator(`${SCHEDULE_DIALOG} input[type="time"]`);
    await timeInput.fill('23:00');
    await page.locator('[data-test-id="schedule-submit-btn"]').click();
    await dialog.waitFor({ state: 'hidden' });

    await page.locator(DETAIL_PANEL_SCHEDULE_ITEM).first().click();
    await dialog.waitFor({ state: 'visible' });
    // Let the dialog's open animation finish — getBoundingClientRect is scaled
    // down while the MDC dialog scale-in transform is still running.
    await page.waitForTimeout(500);

    const metrics = await dialog.evaluate((dialogEl) => {
      const content = dialogEl.querySelector('mat-dialog-content');
      const cal = dialogEl.querySelector('mat-calendar');
      const btns = Array.from(
        dialogEl.querySelectorAll('mat-dialog-actions button'),
      ) as HTMLElement[];
      return {
        contentClientW: content?.clientWidth ?? 0,
        contentScrollW: content?.scrollWidth ?? 0,
        calRight: cal?.getBoundingClientRect().right ?? 0,
        calHeight: cal?.getBoundingClientRect().height ?? 0,
        btnTops: btns.map((b) => b.getBoundingClientRect().top),
        windowW: window.innerWidth,
      };
    });

    // No horizontal overflow inside the dialog
    expect(metrics.contentScrollW).toBeLessThanOrEqual(metrics.contentClientW + 1);
    // Calendar (incl. the last weekday column) fits the viewport
    expect(metrics.calRight).toBeLessThanOrEqual(metrics.windowW);
    // The 6-row month height reservation is still in place (see #6556, #9452)
    expect(metrics.calHeight).toBeGreaterThanOrEqual(416);
    // All three action buttons stay on a single row
    expect(metrics.btnTops.length).toBe(3);
    expect(Math.max(...metrics.btnTops) - Math.min(...metrics.btnTops)).toBeLessThan(2);
  });
});

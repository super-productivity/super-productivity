import { Locator, Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';

/**
 * Bug: https://github.com/super-productivity/super-productivity/issues/7724
 *
 * Sibling of #7423. A recurring config carries `lastTaskCreationDay` — a
 * watermark that the planner's projection logic treats as a hard lower bound:
 * days at or before it are never projected/created.
 *
 * `rescheduleTaskOnRepeatCfgUpdate$` re-anchors that watermark when the user
 * moves `startDate` earlier — but it used to bail out early when no live task
 * instance existed, so the re-anchoring never ran. Result: after the user
 * DELETES the materialised instance and then moves `startDate` earlier, the
 * stale watermark keeps suppressing every day between the new `startDate` and
 * the old watermark.
 *
 * Repro from the issue (today fixed to 2026-05-01):
 *   1. Create task → make recurring (daily) → startDate = 2026-05-04 → save
 *   2. Delete the live (non-transparent) instance
 *   3. Open the repeat config from a transparent projection → startDate =
 *      2026-05-02 → save
 * Expected post-fix: the task projects onto May 2, 3 and 4.
 * Bug:               May 2, 3 and 4 stay empty; projections resume on May 5.
 *
 * Dates kept close to today so they fit inside the planner's default 15-day
 * desktop window without horizontal scrolling.
 */

const FIXED_TODAY = new Date('2026-05-01T10:00:00');

const openRecurDialog = async (page: Page): Promise<Locator> => {
  const recurItem = page
    .locator('task-detail-item')
    .filter({ has: page.locator('mat-icon', { hasText: /^repeat$/ }) });
  await expect(recurItem).toBeVisible({ timeout: 5000 });
  await recurItem.click();
  const dialog = page.locator('mat-dialog-container');
  await dialog.waitFor({ state: 'visible', timeout: 10000 });
  return dialog;
};

// After the live instance is deleted, the repeat config can only be edited via
// a transparent projection in the planner — clicking it opens the same dialog.
const openRecurDialogFromProjection = async (
  page: Page,
  taskTitle: string,
): Promise<Locator> => {
  const projection = page
    .locator('planner-repeat-projection')
    .filter({ hasText: taskTitle })
    .first();
  await expect(projection).toBeVisible({ timeout: 15000 });
  await projection.click();
  const dialog = page.locator('mat-dialog-container');
  await dialog.waitFor({ state: 'visible', timeout: 10000 });
  return dialog;
};

// Set the Start date by typing into the matInput directly (en-GB → "DD/MM/YYYY").
const setStartDate = async (page: Page, ddmmyyyy: string): Promise<void> => {
  const dialog = page.locator('mat-dialog-container');
  const startDateInput = dialog
    .locator('mat-form-field')
    .filter({ hasText: /Start date/i })
    .locator('input')
    .first();
  await expect(startDateInput).toBeVisible({ timeout: 5000 });
  // The Material datepicker input occasionally drops the first fill while the
  // dialog is still binding/animating (the field is left empty + ng-invalid).
  // Retry the fill until the value sticks before committing it with Tab.
  await expect(async () => {
    await startDateInput.fill('');
    await startDateInput.fill(ddmmyyyy);
    await expect(startDateInput).toHaveValue(ddmmyyyy, { timeout: 1000 });
  }).toPass({ timeout: 10000 });
  await startDateInput.press('Tab');
  await expect(startDateInput).toHaveValue(ddmmyyyy, { timeout: 3000 });
};

/**
 * Navigate to a hash route reliably. Playwright's page.goto only mutates the
 * URL fragment for SPA hash routes, and Angular's router occasionally drops
 * that hashchange when goto lands mid-bootstrap — leaving the previous view
 * mounted (e.g. the work-view stays on "Today" instead of switching to the
 * Inbox project) and sometimes rewriting the fragment back to the old route.
 * When the expected marker doesn't render, hop through about:blank so the next
 * goto is a cross-document load that bootstraps the app fresh on the target
 * URL and reads the fragment on init.
 */
const gotoHashRoute = async (
  page: Page,
  route: string,
  marker: Locator,
): Promise<void> => {
  await page.goto(route);
  await page.waitForLoadState('networkidle');
  const landed = await marker
    .waitFor({ state: 'visible', timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  if (!landed) {
    await page.goto('about:blank');
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    await expect(marker).toBeVisible({ timeout: 15000 });
  }
};

const saveDialog = async (page: Page): Promise<void> => {
  const dialog = page.locator('mat-dialog-container');
  const saveBtn = dialog.getByRole('button', { name: /Save/i });
  await expect(saveBtn).toBeEnabled({ timeout: 5000 });
  await saveBtn.click();
  await dialog.waitFor({ state: 'hidden', timeout: 10000 });
};

test.describe('Recurring Task - Move Start Date Earlier With No Live Instance (#7724)', () => {
  test('moving startDate earlier still projects the new days after the instance is deleted', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    const taskTitle = `${testPrefix}-MoveStartEarlierNoInstance7724`;

    // Fix today to Friday, May 1, 2026 so calendar interactions are deterministic.
    await page.clock.setFixedTime(FIXED_TODAY);
    await page.reload();
    await workViewPage.waitForTaskList();

    // 1. Create the task and make it recurring (daily) starting May 4, 2026.
    await workViewPage.addTask(taskTitle);
    const task = taskPage.getTaskByText(taskTitle).first();
    await expect(task).toBeVisible({ timeout: 10000 });
    await taskPage.openTaskDetail(task);
    await openRecurDialog(page);
    await setStartDate(page, '04/05/2026');
    await saveDialog(page);

    // 2. Delete the live (non-transparent) instance. After the first save the
    //    task has dueDay = May 4; the Inbox project view lists it regardless of
    //    due day. A plain task delete does NOT touch the repeat config's
    //    lastTaskCreationDay or deletedInstanceDates.
    const taskRows = page.locator('task').filter({ hasText: taskTitle });
    await gotoHashRoute(page, '/#/project/INBOX_PROJECT/tasks', taskRows.first());
    // The task list can still be settling (entry animation / re-render) right
    // after navigation, so a single right-click occasionally races the
    // "stable" check. Retry opening the context menu with a short per-attempt
    // timeout until it appears.
    const contextMenu = page.locator('.mat-mdc-menu-content');
    await expect(async () => {
      await taskRows.first().click({ button: 'right', timeout: 4000 });
      await expect(contextMenu).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 20000 });
    await contextMenu.locator('button.color-warn').click();
    const confirmBtn = page.locator('[e2e="confirmBtn"]');
    await expect(confirmBtn).toBeVisible({ timeout: 5000 });
    await confirmBtn.click();
    await expect(taskRows).toHaveCount(0, { timeout: 10000 });

    // 3. Re-open the repeat config from a transparent projection and move
    //    startDate to May 2 — earlier than the stale anchor (May 4).
    await gotoHashRoute(
      page,
      '/#/planner',
      page.locator('planner-repeat-projection').filter({ hasText: taskTitle }).first(),
    );
    await openRecurDialogFromProjection(page, taskTitle);
    await setStartDate(page, '02/05/2026');
    await saveDialog(page);

    // 4. Verify: the task now projects onto May 2, 3 and 4 — the days the stale
    //    anchor used to suppress. May 5 is the control (it projected pre-fix
    //    too). No live instance was recreated, so every day is a projection.
    await gotoHashRoute(page, '/#/planner', page.locator('planner-day').first());

    for (const date of [/^2\/5$/, /^3\/5$/, /^4\/5$/, /^5\/5$/]) {
      const day = page
        .locator('planner-day')
        .filter({ has: page.locator('.date', { hasText: date }) });
      await expect(
        day.locator('planner-repeat-projection').filter({ hasText: taskTitle }),
      ).toHaveCount(1, { timeout: 15000 });
    }
  });
});

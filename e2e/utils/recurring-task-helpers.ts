import { expect, Locator, Page } from '@playwright/test';

/**
 * Shared helpers for the recurring-task start-date E2E specs
 * (e2e/tests/recurring/*).
 *
 * These flows were duplicated — at varying levels of robustness — across the
 * start-date specs. Centralising them keeps the flaky-edge fixes (datepicker
 * text entry, SPA hash-route drops) in one place so one hardening pass covers
 * every spec that uses them.
 */

const DIALOG_CONTAINER = 'mat-dialog-container:has(dialog-edit-task-repeat-cfg)';
const SCHEDULE_DIALOG = 'mat-dialog-container:has(dialog-schedule-task)';

/** Open the recurring-config dialog via the task detail panel's schedule row. */
export const openRecurDialog = async (page: Page): Promise<Locator> => {
  const scheduleItem = page
    .locator('task-detail-item')
    .filter({
      has: page.locator('mat-icon', {
        hasText: /^(alarm|today|schedule|repeat)$/,
      }),
    })
    .first();
  await expect(scheduleItem).toBeVisible({ timeout: 5000 });
  await scheduleItem.click();

  const scheduleDialog = page.locator(SCHEDULE_DIALOG);
  await scheduleDialog.waitFor({ state: 'visible', timeout: 10000 });
  await scheduleDialog.locator('.repeat-btn').click();

  const dialog = page.locator(DIALOG_CONTAINER);
  await dialog.waitFor({ state: 'visible', timeout: 10000 });
  return dialog;
};

/**
 * Open the recurring-config dialog by clicking a transparent planner
 * projection. After the live instance is deleted, the repeat config can only be
 * reached this way.
 */
export const openRecurDialogFromProjection = async (
  page: Page,
  taskTitle: string,
): Promise<Locator> => {
  const projection = page
    .locator('planner-repeat-projection')
    .filter({ hasText: taskTitle })
    .first();
  await expect(projection).toBeVisible({ timeout: 15000 });
  await projection.click();
  const dialog = page.locator(DIALOG_CONTAINER);
  await dialog.waitFor({ state: 'visible', timeout: 10000 });
  return dialog;
};

/**
 * Open the schedule dialog nested inside the recurring-config dialog.
 */
export const openRecurScheduleDialog = async (page: Page): Promise<Locator> => {
  const dialog = page.locator(DIALOG_CONTAINER).first();
  const scheduleBtn = dialog.locator('.planned-start-date-btn');
  await expect(scheduleBtn).toBeVisible({ timeout: 5000 });
  const scheduleDialogs = page.locator(SCHEDULE_DIALOG);
  const previousScheduleDialogCount = await scheduleDialogs.count();
  await scheduleBtn.click();

  await expect(scheduleDialogs).toHaveCount(previousScheduleDialogCount + 1, {
    timeout: 5000,
  });
  return scheduleDialogs.nth(previousScheduleDialogCount);
};

/**
 * Set the recurring "Start date" by using the calendar datepicker.
 */
export const setRecurStartDate = async (page: Page, ddmmyyyy: string): Promise<void> => {
  const scheduleDialog = await openRecurScheduleDialog(page);
  await scheduleDialog.waitFor({ state: 'visible', timeout: 5000 });

  const calendar = scheduleDialog.locator('mat-calendar');
  await expect(calendar).toBeVisible({ timeout: 5000 });

  const [dayStr, monthStr, yearStr] = ddmmyyyy.split('/');
  const day = parseInt(dayStr, 10);
  const month = parseInt(monthStr, 10) - 1; // 0-indexed
  const year = parseInt(yearStr, 10);

  // Navigate to correct year
  await scheduleDialog.locator('.mat-calendar-period-button').click();
  const yearCell = scheduleDialog
    .locator('.mat-calendar-body-cell')
    .filter({ hasText: new RegExp(`^\\s*${year}\\s*$`) })
    .first();
  await expect(yearCell).toBeVisible({ timeout: 5000 });
  await yearCell.click();

  // Navigate to correct month
  const monthCell = scheduleDialog
    .locator('.mat-calendar-body-cell')
    .filter({
      hasText: new RegExp(
        `^\\s*${new Intl.DateTimeFormat('en-US', { month: 'short' }).format(new Date(year, month, 1))}\\s*$`,
        'i',
      ),
    })
    .first();
  await expect(monthCell).toBeVisible({ timeout: 5000 });
  await monthCell.click();

  // Select day
  const dayCell = scheduleDialog
    .locator('.mat-calendar-body-cell')
    .filter({ hasText: new RegExp(`^\\s*${day}\\s*$`) })
    .first();
  await expect(dayCell).toBeVisible({ timeout: 5000 });
  await dayCell.click();

  // Click Schedule button
  const scheduleSubmitBtn = scheduleDialog.locator(
    '[data-test-id="schedule-submit-btn"]',
  );
  await scheduleSubmitBtn.click();
  await scheduleDialog.waitFor({ state: 'hidden', timeout: 5000 });
};

/** Switch the recurring-config quick-setting select (e.g. Daily → Mon-Fri). */
export const setRecurQuickSetting = async (
  page: Page,
  optionLabel: RegExp,
): Promise<void> => {
  const dialog = page.locator(DIALOG_CONTAINER);
  await dialog.locator('mat-select').first().click();
  const option = page.locator('mat-option').filter({ hasText: optionLabel });
  await expect(option).toBeVisible({ timeout: 5000 });
  await option.click();
};

/** Click Save in the recurring-config dialog and wait for it to close. */
export const saveRecurDialog = async (page: Page): Promise<void> => {
  const dialog = page.locator(DIALOG_CONTAINER);
  const saveBtn = dialog.getByRole('button', { name: /Save/i });
  await expect(saveBtn).toBeEnabled({ timeout: 5000 });
  await saveBtn.click();
  await dialog.waitFor({ state: 'hidden', timeout: 10000 });

  const scheduleDialog = page.locator(SCHEDULE_DIALOG);
  if (await scheduleDialog.isVisible()) {
    await scheduleDialog.locator('[data-test-id="schedule-cancel-btn"]').click();
    await scheduleDialog.waitFor({ state: 'hidden', timeout: 5000 });
  }
};

/**
 * Navigate to a SPA hash route reliably. Playwright's page.goto only mutates the
 * URL fragment for hash routes, and Angular's router occasionally drops that
 * hashchange when goto lands mid-bootstrap — leaving the previous view mounted
 * (e.g. the work-view stays on "Today" instead of switching to the Inbox
 * project) and sometimes rewriting the fragment back to the old route. When the
 * expected marker doesn't render, hop through about:blank so the next goto is a
 * cross-document load that bootstraps the app fresh on the target URL and reads
 * the fragment on init.
 */
export const gotoHashRoute = async (
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

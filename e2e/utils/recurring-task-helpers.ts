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

const DIALOG_CONTAINER = 'mat-dialog-container';

/** Open the recurring-config dialog from the task detail panel's repeat row. */
export const openRecurDialog = async (page: Page): Promise<Locator> => {
  const recurItem = page
    .locator('task-detail-item')
    .filter({ has: page.locator('mat-icon', { hasText: /^repeat$/ }) });
  await expect(recurItem).toBeVisible({ timeout: 5000 });
  await recurItem.click();
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
 * Set the recurring "Start date" by typing into the matInput. The input parses
 * the locale's display format (en-GB → "DD/MM/YYYY") on blur, which is more
 * robust than driving the calendar overlay across Material versions.
 *
 * Flake guard: the Material datepicker input intermittently drops the typed
 * value while the dialog is still binding/animating. On blur the (dateChange)
 * handler clears `innerValue` whenever the field hasn't yet parsed to a valid
 * date, and the one-way `[ngModel]="innerValue()"` binding then re-renders the
 * input as empty (`toHaveValue("")`). The previous guard wrapped only the
 * fill — so the value still vanished on the Tab-triggered blur. Retry the WHOLE
 * type-and-commit cycle (fill + Tab) until the committed value sticks.
 */
export const setRecurStartDate = async (page: Page, ddmmyyyy: string): Promise<void> => {
  const dialog = page.locator(DIALOG_CONTAINER);
  const startDateInput = dialog
    .locator('mat-form-field')
    .filter({ hasText: /Start date/i })
    .locator('input')
    .first();
  await expect(startDateInput).toBeVisible({ timeout: 5000 });
  await expect(async () => {
    await startDateInput.fill('');
    await startDateInput.fill(ddmmyyyy);
    await startDateInput.press('Tab');
    await expect(startDateInput).toHaveValue(ddmmyyyy, { timeout: 1000 });
  }).toPass({ timeout: 10000 });
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

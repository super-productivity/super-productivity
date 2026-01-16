import { type Locator, type Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';
import { ensureGlobalAddTaskBarOpen } from '../../utils/element-helpers';

const ADD_TASK_BAR = 'add-task-bar.global';
const ADD_TASK_INPUT = `${ADD_TASK_BAR} input`;
const DUE_BUTTON = `${ADD_TASK_BAR} [data-test="add-task-bar-due-btn"]`;
const CLEAR_DUE_BUTTON = `${ADD_TASK_BAR} [data-test="add-task-bar-clear-due-btn"]`;
const SCHEDULE_DIALOG = 'dialog-schedule-task';
const QUICK_ACCESS_BTN = '.quick-access button';

const openScheduleDialogFromBar = async (
  page: Page,
): Promise<{ dialog: Locator; dueButton: Locator }> => {
  const dueButton = page.locator(DUE_BUTTON).first();
  await dueButton.waitFor({ state: 'visible', timeout: 10000 });
  await dueButton.click();

  const dialog = page.locator(SCHEDULE_DIALOG);
  await dialog.waitFor({ state: 'visible', timeout: 10000 });

  return { dialog, dueButton };
};

const resetDueDateIfNeeded = async (page: Page): Promise<void> => {
  const dueButton = page.locator(DUE_BUTTON).first();
  await dueButton.waitFor({ state: 'visible', timeout: 10000 });
  const clearButton = page.locator(CLEAR_DUE_BUTTON).first();
  if (await clearButton.isVisible().catch(() => false)) {
    await clearButton.click();
    await expect(dueButton).not.toHaveClass(/has-value/);
  }
};

const getDueStateFromLocator = async (
  dueButton: Locator,
): Promise<{ hasValue: boolean; label: string }> => {
  const classAttr = (await dueButton.getAttribute('class')) || '';
  const hasValue = classAttr.includes('has-value');
  const label = ((await dueButton.textContent()) || '').replace(/\s+/g, ' ').trim();
  return { hasValue, label };
};

const getDueState = async (page: Page): Promise<{ hasValue: boolean; label: string }> => {
  const dueButton = page.locator(DUE_BUTTON).first();
  await dueButton.waitFor({ state: 'visible', timeout: 10000 });
  return getDueStateFromLocator(dueButton);
};

const expectDueStateUnchanged = async (
  dueButton: Locator,
  initial: { hasValue: boolean; label: string },
): Promise<void> => {
  const current = await getDueStateFromLocator(dueButton);
  expect(current.hasValue).toBe(initial.hasValue);
  expect(current.label).toBe(initial.label);
};

test.describe('Add Task Bar date picker', () => {
  test.beforeEach(async ({ workViewPage }) => {
    await workViewPage.waitForTaskList();
  });

  test('selecting Today keeps add-task-bar open and sets the date', async ({
    page,
    testPrefix,
  }) => {
    const input = await ensureGlobalAddTaskBarOpen(page);
    await resetDueDateIfNeeded(page);
    await input.fill(`${testPrefix}-today quick date`);

    const { dialog, dueButton } = await openScheduleDialogFromBar(page);
    await dialog.locator(QUICK_ACCESS_BTN).first().click();
    await dialog.waitFor({ state: 'hidden', timeout: 10000 });

    await expect(page.locator(ADD_TASK_INPUT)).toBeVisible();
    await expect(dueButton).toHaveClass(/has-value/);
    await expect(dueButton).toContainText(/today/i);
  });

  test('selecting Tomorrow keeps add-task-bar open and sets the date', async ({
    page,
    testPrefix,
  }) => {
    const input = await ensureGlobalAddTaskBarOpen(page);
    await resetDueDateIfNeeded(page);
    await input.fill(`${testPrefix}-tomorrow quick date`);

    const { dialog, dueButton } = await openScheduleDialogFromBar(page);
    await dialog.locator(QUICK_ACCESS_BTN).nth(1).click();
    await dialog.waitFor({ state: 'hidden', timeout: 10000 });

    await expect(page.locator(ADD_TASK_INPUT)).toBeVisible();
    await expect(dueButton).toHaveClass(/has-value/);
    await expect(dueButton).toContainText(/tomorrow/i);
  });

  test('canceling the dialog keeps add-task-bar open without setting a date', async ({
    page,
    testPrefix,
  }) => {
    const input = await ensureGlobalAddTaskBarOpen(page);
    await resetDueDateIfNeeded(page);
    await input.fill(`${testPrefix}-cancel quick date`);
    const initialDueState = await getDueState(page);

    const { dialog, dueButton } = await openScheduleDialogFromBar(page);
    await dialog.locator('button:has-text("Cancel")').click();
    await dialog.waitFor({ state: 'hidden', timeout: 10000 });

    await expect(page.locator(ADD_TASK_INPUT)).toBeVisible();
    await expectDueStateUnchanged(dueButton, initialDueState);
  });
});

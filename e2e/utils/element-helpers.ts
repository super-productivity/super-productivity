import type { Locator, Page } from '@playwright/test';

/**
 * Safely checks if an element is visible, returning false on any error.
 * Use this instead of `.isVisible().catch(() => false)` pattern.
 *
 * @param locator - Playwright locator to check
 * @param timeout - Optional timeout in ms (default uses Playwright's default)
 * @returns Promise<boolean> - true if visible, false otherwise
 */
export const safeIsVisible = async (
  locator: Locator,
  timeout?: number,
): Promise<boolean> => {
  try {
    return await locator.isVisible({ timeout });
  } catch {
    return false;
  }
};

/**
 * Safely checks if an element is enabled, returning false on any error.
 * Use this instead of `.isEnabled().catch(() => false)` pattern.
 *
 * @param locator - Playwright locator to check
 * @returns Promise<boolean> - true if enabled, false otherwise
 */
export const safeIsEnabled = async (locator: Locator): Promise<boolean> => {
  try {
    return await locator.isEnabled();
  } catch {
    return false;
  }
};

/**
 * Ensures the global add task bar is open and returns the input locator.
 * If the bar is closed, it will click the add button to open it.
 * Uses proper condition-based waiting to avoid race conditions.
 *
 * @param page - Playwright page object
 * @returns Promise<Locator> - The add task input locator, ready for interaction
 */
export const ensureGlobalAddTaskBarOpen = async (page: Page): Promise<Locator> => {
  const ADD_TASK_INPUT = 'add-task-bar.global input';
  const addTaskInput = page.locator(ADD_TASK_INPUT).first();
  const isVisible = await addTaskInput.isVisible().catch(() => false);

  if (!isVisible) {
    const addBtn = page.locator('.tour-addBtn').first();
    await addBtn.waitFor({ state: 'visible', timeout: 10000 });
    await addBtn.click();
  }

  await addTaskInput.waitFor({ state: 'visible', timeout: 10000 });
  return addTaskInput;
};

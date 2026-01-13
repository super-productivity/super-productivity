import { type Locator, type Page } from '@playwright/test';
import { safeIsVisible } from '../utils/element-helpers';

export abstract class BasePage {
  protected page: Page;
  protected routerWrapper: Locator;
  protected backdrop: Locator;
  protected testPrefix: string;

  constructor(page: Page, testPrefix: string = '') {
    this.page = page;
    this.routerWrapper = page.locator('.route-wrapper');
    this.backdrop = page.locator('.backdrop');
    this.testPrefix = testPrefix;
  }

  /**
   * Apply the test prefix to a value for test isolation.
   * Returns the original value if already prefixed or no prefix is set.
   * @param value - The value to prefix (task name, project name, etc.)
   * @returns The prefixed value
   */
  protected applyPrefix(value: string): string {
    if (!this.testPrefix || value.startsWith(this.testPrefix)) {
      return value;
    }
    return `${this.testPrefix}-${value}`;
  }

  async addTask(taskName: string, skipClose = false): Promise<void> {
    // Add test prefix to task name for isolation
    const prefixedTaskName = this.applyPrefix(taskName);

    const inputEl = this.page.locator('add-task-bar.global input');

    // Check if input is visible - if not, try clicking the add button
    const isInputVisible = await inputEl
      .first()
      .isVisible()
      .catch(() => false);
    if (!isInputVisible) {
      const addBtn = this.page.locator('.tour-addBtn');
      // Wait for add button with longer timeout - it depends on config loading
      await addBtn.waitFor({ state: 'visible', timeout: 20000 });
      await addBtn.click();
    }

    // Ensure input is visible - Playwright auto-waits for actionability
    const input = inputEl.first();
    await input.waitFor({ state: 'visible', timeout: 10000 });

    // Clear and fill input - Playwright handles waiting for interactability
    await input.click();
    await input.clear();
    await input.fill(prefixedTaskName);

    // Store the initial count before submission
    const initialCount = await this.page.locator('task').count();
    const expectedCount = initialCount + 1;

    // Click submit button
    const submitBtn = this.page.locator('.e2e-add-task-submit');
    await submitBtn.click();

    // Check if a dialog appeared (e.g., create tag dialog)
    const dialogExists = await safeIsVisible(this.page.locator('mat-dialog-container'));

    if (!dialogExists) {
      // Wait for task to be created - check for the specific task
      const taskLocator = this.page.locator(
        `task:has-text("${prefixedTaskName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}")`,
      );

      try {
        await taskLocator.first().waitFor({ state: 'visible', timeout: 10000 });
      } catch (error) {
        // If specific task not found, verify count increased
        const finalCount = await this.page.locator('task').count();
        if (finalCount < expectedCount) {
          const tasks = await this.page.locator('task').allTextContents();
          throw new Error(
            `Task creation failed. Expected ${expectedCount} tasks, but got ${finalCount}.\n` +
              `Task name: "${prefixedTaskName}"\n` +
              `Existing tasks: ${JSON.stringify(tasks, null, 2)}`,
          );
        }
      }
    }

    if (!skipClose) {
      // Close the add task bar if backdrop is visible
      const backdropVisible = await safeIsVisible(this.backdrop);
      if (backdropVisible) {
        await this.backdrop.click();
        await this.backdrop.waitFor({ state: 'hidden', timeout: 2000 }).catch(() => {
          // Non-fatal: backdrop might auto-hide
        });
      }
    }
  }
}

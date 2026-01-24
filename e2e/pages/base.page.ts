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

  /**
   * Ensures all overlay backdrops are removed from the DOM before proceeding.
   * This is critical before interacting with elements that might be blocked by overlays.
   * Uses Escape key to dismiss overlays if they don't close naturally.
   */
  async ensureOverlaysClosed(): Promise<void> {
    const backdrop = this.page.locator('.cdk-overlay-backdrop');

    // Check if any overlays are present
    const count = await backdrop.count();
    if (count === 0) {
      return; // No overlays - nothing to do
    }

    // Overlays present - try dismissing with Escape
    console.log(
      `[ensureOverlaysClosed] Found ${count} overlay(s), attempting to dismiss with Escape`,
    );
    await this.page.keyboard.press('Escape');

    try {
      // Wait for backdrop to be removed (uses Playwright's smart waiting)
      await backdrop.first().waitFor({ state: 'detached', timeout: 3000 });
    } catch (e) {
      // Fallback: try Escape again for stacked overlays
      const remaining = await backdrop.count();
      if (remaining > 0) {
        console.warn(
          `[ensureOverlaysClosed] ${remaining} overlay(s) still present after first Escape, trying again`,
        );
        await this.page.keyboard.press('Escape');
        await backdrop
          .first()
          .waitFor({ state: 'detached', timeout: 2000 })
          .catch(() => {
            console.error(
              '[ensureOverlaysClosed] Failed to close overlays after multiple attempts',
            );
          });
      }
    }
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
      const maxWaitTime = 15000; // Increased from 10s to handle slow renders
      const taskSelector = `task:has-text("${prefixedTaskName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}")`;

      try {
        // Primary: wait for the specific task to be visible
        await this.page.locator(taskSelector).first().waitFor({
          state: 'visible',
          timeout: maxWaitTime,
        });
      } catch (error) {
        // Fallback: verify task count increased (captures edge cases)
        const finalCount = await this.page.locator('task').count();
        if (finalCount < expectedCount) {
          // Get fresh snapshot for error message after DOM settles
          await this.page.waitForTimeout(500);
          const tasks = await this.page.locator('task').allTextContents();
          const currentCount = await this.page.locator('task').count();
          throw new Error(
            `Task creation failed. Expected ${expectedCount} tasks, but got ${currentCount}.\n` +
              `Task name: "${prefixedTaskName}"\n` +
              `Existing tasks: ${JSON.stringify(tasks, null, 2)}`,
          );
        }
      }
    }

    if (!skipClose) {
      // Close the add task bar by clicking the backdrop
      // Use force: true to bypass element coverage checks (overlays may cover backdrop)
      const backdropVisible = await safeIsVisible(this.backdrop);
      if (backdropVisible) {
        await this.backdrop.click({ force: true });
        await this.backdrop.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {
          // Non-fatal: backdrop might auto-hide
        });
      }
    }
  }
}

import { Locator, Page } from '@playwright/test';
import { BasePage } from './base.page';
import { waitForAngularStability } from '../utils/waits';

export class WorkViewPage extends BasePage {
  readonly addTaskGlobalInput: Locator;
  readonly addBtn: Locator;
  readonly taskList: Locator;
  readonly backdrop: Locator;
  readonly routerWrapper: Locator;

  constructor(page: Page, testPrefix: string = '') {
    super(page, testPrefix);

    this.addTaskGlobalInput = page.locator('add-task-bar.global input');
    this.addBtn = page.locator('.switch-add-to-btn');
    this.taskList = page.locator('task-list').first();
    this.backdrop = page.locator('.backdrop');
    this.routerWrapper = page.locator('.route-wrapper, main, [role="main"]').first();
  }

  async waitForTaskList(): Promise<void> {
    // Wait for the loading screen to disappear first (if visible).
    // The app shows `.loading-full-page-wrapper` while syncing/importing data.
    const loadingWrapper = this.page.locator('.loading-full-page-wrapper');
    try {
      const isLoadingVisible = await loadingWrapper.isVisible().catch(() => false);
      if (isLoadingVisible) {
        await loadingWrapper.waitFor({ state: 'hidden', timeout: 30000 });
      }
    } catch {
      // Loading screen might not appear at all - that's fine
    }

    // Wait for task list to be visible
    await this.page.waitForSelector('task-list', {
      state: 'visible',
      timeout: 15000,
    });

    // Ensure route wrapper is fully loaded
    await this.routerWrapper.waitFor({ state: 'visible', timeout: 10000 });

    // Wait for Angular to stabilize using shared helper
    await waitForAngularStability(this.page);
  }

  async addSubTask(task: Locator, subTaskName: string): Promise<void> {
    await task.waitFor({ state: 'visible' });
    await task.focus();
    // Wait for focus to be established
    await this.page.waitForFunction(
      (el) => el === document.activeElement,
      await task.elementHandle(),
      { timeout: 1000 },
    );
    await task.press('a');

    // Wait for textarea to appear and be focused
    const textarea = this.page.locator('textarea:focus, input[type="text"]:focus');
    await textarea.waitFor({ state: 'visible', timeout: 1000 });

    // Ensure the field is properly focused and cleared before filling
    await textarea.click();
    await textarea.fill('');

    // Use fill() instead of type() for more reliable text input
    await textarea.fill(subTaskName);
    await this.page.keyboard.press('Enter');
  }
}

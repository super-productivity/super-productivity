import { Locator, Page } from '@playwright/test';
import { BasePage } from './base.page';
import { cssSelectors } from '../constants/selectors';
import { waitForAngularStability } from '../utils/waits';

const { TASK, FIRST_TASK, TASK_DONE_BTN, TASK_TEXTAREA, SUB_TASK } = cssSelectors;

export class TaskPage extends BasePage {
  constructor(page: Page, testPrefix: string = '') {
    super(page, testPrefix);
  }

  /**
   * Get a task by index (1-based)
   */
  getTask(index: number = 1): Locator {
    if (index === 1) {
      return this.page.locator(FIRST_TASK);
    }
    return this.page.locator(TASK).nth(index - 1);
  }

  /**
   * Get a task by text content
   */
  getTaskByText(text: string): Locator {
    return this.page.locator(TASK).filter({ hasText: text });
  }

  /**
   * Get all tasks
   */
  getAllTasks(): Locator {
    return this.page.locator(TASK);
  }

  /**
   * Get task count
   */
  async getTaskCount(): Promise<number> {
    return await this.page.locator(TASK).count();
  }

  /**
   * Get task title element for a specific task
   */
  getTaskTitle(task: Locator): Locator {
    return task.locator('task-title');
  }

  /**
   * Mark a task as done
   */
  async markTaskAsDone(task: Locator): Promise<void> {
    await task.waitFor({ state: 'visible' });
    await task.hover();
    const doneBtn = task.locator(TASK_DONE_BTN);
    await doneBtn.waitFor({ state: 'visible', timeout: 5000 });
    await doneBtn.click();
    await waitForAngularStability(this.page);
  }

  /**
   * Mark the first task as done
   */
  async markFirstTaskAsDone(): Promise<void> {
    const firstTask = this.getTask(1);
    await this.markTaskAsDone(firstTask);
  }

  /**
   * Edit task title
   */
  async editTaskTitle(task: Locator, newTitle: string): Promise<void> {
    const titleElement = this.getTaskTitle(task);
    await titleElement.waitFor({ state: 'visible' });
    await titleElement.click();

    const textarea = task.locator(TASK_TEXTAREA);
    await textarea.waitFor({ state: 'visible', timeout: 3000 });
    await textarea.clear();
    await this.page.waitForTimeout(50);
    await textarea.fill(newTitle);
    await this.page.keyboard.press('Tab'); // Blur to save
    await waitForAngularStability(this.page);
  }

  /**
   * Open task detail panel (additional info)
   */
  async openTaskDetail(task: Locator): Promise<void> {
    await task.waitFor({ state: 'visible' });
    await task.hover();
    const showDetailBtn = this.page.getByRole('button', {
      name: 'Show/Hide additional info',
    });
    await showDetailBtn.waitFor({ state: 'visible', timeout: 3000 });
    await showDetailBtn.click();
    await this.page.waitForTimeout(300);
  }

  /**
   * Open detail panel for the first task
   */
  async openFirstTaskDetail(): Promise<void> {
    const firstTask = this.getTask(1);
    await this.openTaskDetail(firstTask);
  }

  /**
   * Get subtasks for a task
   */
  getSubTasks(task: Locator): Locator {
    return task.locator(SUB_TASK);
  }

  /**
   * Get subtask count for a task
   */
  async getSubTaskCount(task: Locator): Promise<number> {
    return await this.getSubTasks(task).count();
  }

  /**
   * Check if a task is marked as done
   */
  async isTaskDone(task: Locator): Promise<boolean> {
    const classes = await task.getAttribute('class');
    return classes?.includes('isDone') || false;
  }

  /**
   * Get done tasks
   */
  getDoneTasks(): Locator {
    return this.page.locator(`${TASK}.isDone`);
  }

  /**
   * Get undone tasks
   */
  getUndoneTasks(): Locator {
    return this.page.locator(`${TASK}:not(.isDone)`);
  }

  /**
   * Get done task count
   */
  async getDoneTaskCount(): Promise<number> {
    return await this.getDoneTasks().count();
  }

  /**
   * Get undone task count
   */
  async getUndoneTaskCount(): Promise<number> {
    return await this.getUndoneTasks().count();
  }

  /**
   * Wait for a task to appear with specific text
   */
  async waitForTaskWithText(text: string, timeout: number = 10000): Promise<Locator> {
    const task = this.getTaskByText(text);
    await task.waitFor({ state: 'visible', timeout });
    return task;
  }

  /**
   * Wait for task count to match expected count
   */
  async waitForTaskCount(expectedCount: number, timeout: number = 10000): Promise<void> {
    await this.page.waitForFunction(
      (args) => {
        const currentCount = document.querySelectorAll('task').length;
        return currentCount === args.expectedCount;
      },
      { expectedCount },
      { timeout },
    );
  }

  /**
   * Get task tags
   */
  getTaskTags(task: Locator): Locator {
    return task.locator('tag');
  }

  /**
   * Check if task has a specific tag
   */
  async taskHasTag(task: Locator, tagName: string): Promise<boolean> {
    const tags = this.getTaskTags(task);
    const tagCount = await tags.count();

    for (let i = 0; i < tagCount; i++) {
      const tagText = await tags.nth(i).textContent();
      if (tagText?.includes(tagName)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Toggle task detail panel
   */
  async toggleTaskDetail(task: Locator): Promise<void> {
    await task.hover();
    const toggleBtn = this.page.getByRole('button', {
      name: 'Show/Hide additional info',
    });
    await toggleBtn.click();
    await this.page.waitForTimeout(300);
  }

  /**
   * Start/Stop task time tracking
   */
  async toggleTaskTimeTracking(task: Locator): Promise<void> {
    await task.waitFor({ state: 'visible' });
    await task.hover();
    const playBtn = task.locator('.play-btn, .pause-btn').first();
    await playBtn.waitFor({ state: 'visible', timeout: 3000 });
    await playBtn.click();
    await waitForAngularStability(this.page);
  }

  /**
   * Get the date info element (created/completed) in task detail
   */
  getDateInfo(infoPrefix: string): Locator {
    return this.page
      .locator('.edit-date-info')
      .filter({ hasText: new RegExp(infoPrefix) });
  }
}

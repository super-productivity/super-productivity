import { type Page, type Locator } from '@playwright/test';
import { BasePage } from './base.page';

export class PlannerPage extends BasePage {
  readonly plannerView: Locator;
  readonly taskList: Locator;
  readonly dayContainer: Locator;
  readonly addTaskBtn: Locator;
  readonly plannerScheduledTasks: Locator;
  readonly scheduledTask: Locator;
  readonly repeatProjection: Locator;

  constructor(page: Page) {
    super(page);
    this.plannerView = page.locator('planner-view');
    this.taskList = page.locator('task-list');
    this.dayContainer = page.locator('.day-container');
    this.addTaskBtn = page.locator('.tour-addBtn');
    this.plannerScheduledTasks = page.locator('planner-scheduled-tasks');
    this.scheduledTask = page.locator('.scheduled-task');
    this.repeatProjection = page.locator('.repeat-projection');
  }

  async navigateToPlanner(): Promise<void> {
    // Try to click the planner nav item first, fallback to direct navigation
    try {
      await this.page.locator('magic-side-nav a[href="#/planner"]').click();
    } catch (error) {
      // Fallback to direct navigation
      await this.page.goto('/#/tag/TODAY/planner');
    }
    await this.page.waitForURL(/\/(planner|tasks)/);
    await this.routerWrapper.waitFor({ state: 'visible' });
  }

  async navigateToPlannerForProject(projectId: string): Promise<void> {
    await this.page.goto(`/#/project/${projectId}/planner`);
    await this.page.waitForURL(/\/(planner|tasks)/);
    await this.routerWrapper.waitFor({ state: 'visible' });
  }

  async waitForPlannerView(): Promise<void> {
    // Planner might redirect to tasks view if there are no scheduled tasks
    await this.page.waitForURL(/\/(planner|tasks)/);
    await this.routerWrapper.waitFor({ state: 'visible' });
  }

  async getDayContainers(): Promise<Locator> {
    return this.dayContainer;
  }

  async getScheduledTasks(): Promise<Locator> {
    return this.scheduledTask;
  }

  async dragTaskToPlanner(taskSelector: string, dayIndex: number = 0): Promise<void> {
    const task = this.page.locator(taskSelector);
    const targetDay = this.dayContainer.nth(dayIndex);

    await task.dragTo(targetDay, {
      targetPosition: { x: 100, y: 100 },
    });
  }

  async scheduleTaskForTime(taskName: string, time: string): Promise<void> {
    const task = this.page.locator(`task:has-text("${taskName}")`);
    const timeInput = task.locator('input[type="time"]');

    await timeInput.fill(time);
    await this.page.keyboard.press('Enter');
  }

  async verifyTaskScheduledForTime(taskName: string, time: string): Promise<boolean> {
    const scheduledTask = this.page.locator(`.scheduled-task:has-text("${taskName}")`);
    const scheduledTime = await scheduledTask.locator('.scheduled-time').textContent();
    return scheduledTime?.includes(time) ?? false;
  }
}

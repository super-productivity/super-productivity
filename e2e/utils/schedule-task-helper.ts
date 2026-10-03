import { expect, type Locator, type Page } from '@playwright/test';
import type { WorkViewPage } from '../pages/work-view.page';
import { cssSelectors } from '../constants/selectors';
import { calendarNextMonthBtn } from './element-helpers';
import { fillTimeInput } from './time-input-helper';

// Selectors for scheduling
const DETAIL_PANEL_BTN = '.show-additional-info-btn';
const DETAIL_PANEL_SELECTOR = 'task-detail-panel';
const DETAIL_PANEL_SCHEDULE_ITEM =
  'task-detail-item:has(mat-icon:text("alarm")), ' +
  'task-detail-item:has(mat-icon:text("today")), ' +
  'task-detail-item:has(mat-icon:text("schedule"))';
const RIGHT_PANEL = '.right-panel';
const DIALOG_CONTAINER = 'mat-dialog-container';
const DIALOG_SUBMIT = 'mat-dialog-actions button[color="primary"]';

/**
 * Closes the task detail panel if it's currently open.
 */
export const closeDetailPanelIfOpen = async (page: Page): Promise<void> => {
  const detailPanel = page.locator(DETAIL_PANEL_SELECTOR).first();
  const isVisible = await detailPanel.isVisible().catch(() => false);
  if (isVisible) {
    await page.keyboard.press('Escape');
    await detailPanel.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  }
};

/**
 * Opens the detail panel for a task by hovering and clicking the detail button.
 *
 * @param page - Playwright page object
 * @param task - Locator for the task element
 */
export const openTaskDetailPanel = async (page: Page, task: Locator): Promise<void> => {
  await task.waitFor({ state: 'visible' });
  await task.scrollIntoViewIfNeeded();
  await task.hover();

  const detailBtn = task.locator(DETAIL_PANEL_BTN).first();
  await detailBtn.waitFor({ state: 'visible', timeout: 5000 });
  await detailBtn.click();

  // Wait for detail panel to be visible
  await page
    .locator(RIGHT_PANEL)
    .or(page.locator(DETAIL_PANEL_SELECTOR))
    .first()
    .waitFor({ state: 'visible', timeout: 10000 });
};

/**
 * Schedules a task via the detail panel.
 *
 * @param page - Playwright page object
 * @param task - Locator for the task element
 * @param scheduleTime - Date object or timestamp for when to schedule
 */
export const scheduleTaskViaDetailPanel = async (
  page: Page,
  task: Locator,
  scheduleTime: Date | number,
): Promise<void> => {
  await openTaskDetailPanel(page, task);

  // Click the schedule item
  const scheduleItem = page.locator(DETAIL_PANEL_SCHEDULE_ITEM).first();
  await scheduleItem.waitFor({ state: 'visible', timeout: 5000 });
  await scheduleItem.click();

  // Wait for schedule dialog
  const dialogContainer = page.locator(DIALOG_CONTAINER);
  await dialogContainer.waitFor({ state: 'visible', timeout: 10000 });

  // Fill time input
  await fillTimeInput(page, scheduleTime);

  // Submit dialog - click the primary action button (Schedule button)
  const submitBtn = page.locator(DIALOG_SUBMIT);
  await submitBtn.waitFor({ state: 'visible', timeout: 5000 });
  await submitBtn.click();

  // Wait for dialog to close
  await dialogContainer.waitFor({ state: 'hidden', timeout: 10000 });

  // Close detail panel if open
  await closeDetailPanelIfOpen(page);
};

/**
 * Schedule a task for an exact day (day-only, no time) via the keyboard
 * shortcut ('S' opens the schedule dialog) and calendar.
 *
 * The keyboard path is used deliberately: it is independent of whether the task
 * is already scheduled (a scheduled task's detail item shows a "Reschedule"
 * control instead of "Schedule Task") and of task height (hovering a parent
 * with sub-tasks lands on a sub-task row).
 */
export const scheduleTaskForDay = async (
  page: Page,
  task: Locator,
  targetDate: Date,
): Promise<void> => {
  await task.scrollIntoViewIfNeeded();
  await task.focus();
  await expect(task).toBeFocused();

  await page.keyboard.press('s');

  const scheduleDialog = page.locator(cssSelectors.DIALOG_SCHEDULE_TASK);
  await expect(scheduleDialog).toBeVisible({ timeout: 10000 });
  // No time set -> this creates a date-only dueDay, not a timed dueWithTime.
  await expect(scheduleDialog.locator('input[type="time"]')).toHaveValue('');

  const today = new Date();
  if (
    targetDate.getMonth() !== today.getMonth() ||
    targetDate.getFullYear() !== today.getFullYear()
  ) {
    await calendarNextMonthBtn(scheduleDialog).click();
  }

  const targetDay = scheduleDialog
    .locator('.mat-calendar-body-cell:not(.mat-calendar-body-disabled)')
    .filter({ hasText: new RegExp(`^\\s*${targetDate.getDate()}\\s*$`) })
    .first();
  await expect(targetDay).toBeVisible();
  await targetDay.click();
  await scheduleDialog.locator('[data-test-id="schedule-submit-btn"]').click();
  await scheduleDialog.waitFor({ state: 'hidden', timeout: 10000 });
};

// Default schedule delta: 5 seconds from now
const DEFAULT_SCHEDULE_DELTA = 5000;

/**
 * Adds a task and schedules it with a reminder.
 * This is a convenience function combining task creation and scheduling.
 *
 * @param page - Playwright page object
 * @param workViewPage - WorkViewPage instance
 * @param taskTitle - Title for the new task
 * @param scheduleTime - Date object or timestamp for when to schedule (defaults to 5s from now)
 */
export const addTaskWithReminder = async (
  page: Page,
  workViewPage: WorkViewPage,
  taskTitle: string,
  scheduleTime: Date | number = Date.now() + DEFAULT_SCHEDULE_DELTA,
): Promise<void> => {
  // Add the task
  await workViewPage.addTask(taskTitle);

  // Find the task by title
  const escapedTitle = taskTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const task = page.locator(`task:has-text("${escapedTitle}")`).first();
  await task.waitFor({ state: 'visible', timeout: 10000 });

  // Schedule it
  await scheduleTaskViaDetailPanel(page, task, scheduleTime);
};

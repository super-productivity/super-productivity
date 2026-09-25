import { expect, test } from '../../fixtures/test.fixture';
import { openRecurDialog, saveRecurDialog } from '../../utils/recurring-task-helpers';
import type { Page } from '@playwright/test';

/**
 * Bug: https://github.com/super-productivity/super-productivity/issues/9728
 *
 * Single-client half of the #9728 coverage: a daily repeat with inherited
 * subtasks must materialise each template EXACTLY once on the next day's
 * instance. The cross-device duplication that actually triggered the report
 * needs two clients and lives in
 * e2e/tests/sync/supersync-repeat-subtask-duplication-9728.spec.ts; this one
 * needs no sync server and guards the everyday path — including that the
 * deterministic subtask ids (getRepeatableSubTaskId) did not break ordinary
 * day-to-day instance creation.
 *
 * Clock strategy per #6230: setSystemTime, never setFixedTime — the day-change
 * effect chain's debounceTime(1000) needs Date.now() to keep advancing.
 */

const addSubtask = async (
  page: Page,
  parentTaskName: string,
  subtaskTitle: string,
): Promise<void> => {
  const parentTask = page.locator(`task:has-text("${parentTaskName}")`).first();
  await parentTask.waitFor({ state: 'visible', timeout: 10000 });
  await parentTask.focus();
  await parentTask.press('a');

  const draftInput = page.locator('.e2e-add-subtask-input');
  await draftInput.waitFor({ state: 'visible', timeout: 5000 });
  await draftInput.fill(subtaskTitle);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await draftInput.waitFor({ state: 'detached', timeout: 5000 });
  await expect(page.locator(`task:has-text("${subtaskTitle}")`).first()).toBeVisible({
    timeout: 10000,
  });
};

/** Open the detail panel from the hover toolbar (mirrors TaskPage.openTaskDetail). */
const openTaskDetail = async (page: Page, taskName: string): Promise<void> => {
  const task = page.locator(`task:not(.hasNoSubTasks):has-text("${taskName}")`).first();
  await task.waitFor({ state: 'visible', timeout: 10000 });
  // Hover the parent's OWN row: subtasks render inside the parent element, so
  // hovering the element centre lands on a subtask and opens ITS detail panel —
  // which has no repeat button (canRepeat requires !task.parentId).
  await task.locator('.first-line').first().hover();
  const showDetailBtn = page.getByRole('button', { name: 'Show/hide task panel' });
  await showDetailBtn.waitFor({ state: 'visible', timeout: 5000 });
  await showDetailBtn.click();
};

test.describe('Recurring task inherited subtasks (#9728)', () => {
  test('creates each inherited subtask exactly once on the next day instance', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    const parentName = `${testPrefix}-Routine9728`;
    const sub1 = `${testPrefix}-Step1`;
    const sub2 = `${testPrefix}-Step2`;

    await page.clock.setSystemTime(new Date('2026-06-15T23:55:00'));
    await page.reload();
    await workViewPage.waitForTaskList();

    // 1. A parent with two subtasks.
    await workViewPage.addTask(parentName);
    await addSubtask(page, parentName, sub1);
    await addSubtask(page, parentName, sub2);

    // 2. Make it a daily repeat. shouldInheritSubtasks defaults to true when the
    //    task already has subtasks (dialog-edit-task-repeat-cfg.component.ts).
    await openTaskDetail(page, parentName);
    await openRecurDialog(page);
    await saveRecurDialog(page);
    await page.keyboard.press('Escape');

    // 3. Finish day 15's instance so day 16's is unambiguous.
    const day15 = page
      .locator(`task:not(.hasNoSubTasks):not(.ng-animating):has-text("${parentName}")`)
      .first();
    await day15.focus();
    await day15.press('d');
    const confirmBtn = page.locator('dialog-confirm button[mat-flat-button]');
    if (await confirmBtn.isVisible().catch(() => false)) {
      await confirmBtn.click();
    }
    await expect(day15).toHaveClass(/isDone/, { timeout: 10000 });

    // 4. Cross midnight; the day-change effect creates day 16's instance.
    await page.clock.setSystemTime(new Date('2026-06-16T00:05:00'));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));

    const day16 = page
      .locator(
        `task:not(.hasNoSubTasks):not(.isDone):not(.ng-animating):has-text("${parentName}")`,
      )
      .first();
    await expect(day16).toBeVisible({ timeout: 60000 });

    // 5. Each template must appear ONCE on the new instance. Scoped to the new
    //    parent on purpose: a global count would also see day 15's instance.
    //    Before the fix a second creation run made this 4 / 2 / 2 (#9728).
    await expect(day16.locator('.sub-tasks task')).toHaveCount(2, { timeout: 15000 });
    await expect(day16.locator(`.sub-tasks task:has-text("${sub1}")`)).toHaveCount(1);
    await expect(day16.locator(`.sub-tasks task:has-text("${sub2}")`)).toHaveCount(1);
  });
});

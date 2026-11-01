import { test, expect } from '../../fixtures/test.fixture';

const TASK = 'task';
const TASK_TITLE = 'task task-title';
const FIRST_TASK = 'task:first-of-type';
const UNDONE_TASK_LIST = 'task-list[listmodelid="UNDONE"]';
const DONE_TASK_LIST = 'task-list[listmodelid="DONE"]';
const DONE_TASKS_SECTION = '.tour-doneList';
const TOGGLE_DONE_TASKS_BTN = '.tour-doneList .mat-expansion-indicator';

test.describe('Work View Features', () => {
  test('should show undone and done task lists', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    test.setTimeout(45000);

    // Wait for work view to be ready
    await workViewPage.waitForTaskList();

    // Verify undone task list is visible
    await expect(page.locator(UNDONE_TASK_LIST)).toBeVisible({ timeout: 8000 });

    // Create tasks
    await workViewPage.addTask('Task 1');
    await page.locator(TASK).first().waitFor({ state: 'visible', timeout: 5000 });

    await workViewPage.addTask('Task 2');
    await expect(page.locator(TASK)).toHaveCount(2, { timeout: 5000 });

    // Mark first task as done
    const firstTask = page.locator(FIRST_TASK);
    await firstTask.waitFor({ state: 'visible' });

    // Hover over the task to show the done button
    await firstTask.hover();

    // Click the done button
    const doneBtn = firstTask.locator('done-toggle');
    await doneBtn.waitFor({ state: 'visible' });
    await doneBtn.click();

    // Wait for task count in undone list to decrease
    await expect(page.locator(`${UNDONE_TASK_LIST} ${TASK}`)).toHaveCount(1, {
      timeout: 5000,
    });

    // Check if done section exists
    const doneSectionExists = await page
      .locator(DONE_TASKS_SECTION)
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    if (doneSectionExists) {
      // Toggle done tasks visibility if needed
      const toggleBtn = page.locator(TOGGLE_DONE_TASKS_BTN);
      if (await toggleBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await toggleBtn.click();
        await expect(page.locator(DONE_TASK_LIST)).toBeVisible({ timeout: 5000 });
      }

      // Verify done task list is visible
      await expect(page.locator(DONE_TASK_LIST)).toBeVisible({ timeout: 5000 });

      // Verify tasks are in correct lists
      await expect(page.locator(`${UNDONE_TASK_LIST} ${TASK}`)).toHaveCount(1);
      await expect(page.locator(`${DONE_TASK_LIST} ${TASK}`)).toHaveCount(1);
    } else {
      // If no done section, just verify we have one less undone task
      await expect(page.locator(`${UNDONE_TASK_LIST} ${TASK}`)).toHaveCount(1);
    }
  });

  test('should restore the done list after collapsing it across a reload', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    // keeps the undone list on screen after reload, which waitForTaskList needs
    await workViewPage.addTask('Open task');
    await workViewPage.addTask('Finished task');
    await expect(page.locator(TASK)).toHaveCount(2);

    const finished = page.locator(TASK, { hasText: 'Finished task' });
    await finished.hover();
    await finished.locator('done-toggle').click();
    await expect(page.locator(`${DONE_TASK_LIST} ${TASK}`)).toHaveCount(1);

    const doneHeader = page.locator('collapsible .collapsible-header', {
      hasText: 'Completed Tasks',
    });
    await doneHeader.click();
    await expect(page.locator(DONE_TASK_LIST)).toHaveCount(0);

    // the collapsed state is persisted, so the list must stay absent on boot
    await page.reload();
    await workViewPage.waitForTaskList();
    await expect(doneHeader).toBeVisible();
    await expect(page.locator(DONE_TASK_LIST)).toHaveCount(0);

    await doneHeader.click();
    await expect(page.locator(`${DONE_TASK_LIST} ${TASK}`)).toHaveCount(1);
    await expect(page.locator(`${DONE_TASK_LIST} ${TASK_TITLE}`)).toContainText(
      'Finished task',
    );
  });

  test('should keep the done rows while the done list collapses', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('Open task');
    await workViewPage.addTask('Finished task');
    await expect(page.locator(TASK)).toHaveCount(2);

    const finished = page.locator(TASK, { hasText: 'Finished task' });
    await finished.hover();
    await finished.locator('done-toggle').click();
    await expect(page.locator(`${DONE_TASK_LIST} ${TASK}`)).toHaveCount(1);

    // sample every frame of the leave animation: while the panel is still on
    // screen it must not have been emptied ahead of it
    const frames = await page.evaluate(
      () =>
        new Promise<{ hasPanel: boolean; rows: number }[]>((resolve) => {
          const header = [...document.querySelectorAll('collapsible .collapsible-header')]
            .filter((el): el is HTMLElement => el instanceof HTMLElement)
            .find((el) => el.textContent?.includes('Completed Tasks'));
          const collapsible = header?.closest('collapsible');
          if (!header || !collapsible) {
            resolve([]);
            return;
          }
          const out: { hasPanel: boolean; rows: number }[] = [];
          const sample = (): void => {
            const hasPanel = !!collapsible.querySelector('.collapsible-panel');
            out.push({ hasPanel, rows: collapsible.querySelectorAll('task').length });
            if (hasPanel && out.length < 300) {
              requestAnimationFrame(sample);
            } else {
              resolve(out);
            }
          };
          header.click();
          requestAnimationFrame(sample);
        }),
    );

    const panelFrames = frames.filter((f) => f.hasPanel);
    // at least one frame mid-animation, or the check below passes vacuously
    expect(panelFrames.length).toBeGreaterThan(0);
    expect(panelFrames.every((f) => f.rows === 1)).toBe(true);
    await expect(page.locator(DONE_TASK_LIST)).toHaveCount(0);
  });

  test('should handle task order correctly', async ({ page, workViewPage }) => {
    test.setTimeout(process.env.CI ? 60000 : 45000);

    // Wait for work view to be ready
    await workViewPage.waitForTaskList();

    // Create multiple tasks - wait for each to appear before adding next
    await workViewPage.addTask('First created');
    await expect(page.locator(TASK)).toHaveCount(1, { timeout: 5000 });

    await workViewPage.addTask('Second created');
    await expect(page.locator(TASK)).toHaveCount(2, { timeout: 5000 });

    await workViewPage.addTask('Third created');
    await expect(page.locator(TASK)).toHaveCount(3, { timeout: 5000 });

    await workViewPage.addTask('Fourth created');
    await expect(page.locator(TASK)).toHaveCount(4, { timeout: 5000 });

    // Verify order (newest first)
    await expect(page.locator('task:nth-of-type(1) task-title')).toContainText(
      /Fourth created/,
    );
    await expect(page.locator('task:nth-of-type(2) task-title')).toContainText(
      /Third created/,
    );
    await expect(page.locator('task:nth-of-type(3) task-title')).toContainText(
      /Second created/,
    );
    await expect(page.locator('task:nth-of-type(4) task-title')).toContainText(
      /First created/,
    );
  });

  test('should persist tasks after navigation', async ({ page, workViewPage }) => {
    // Wait for work view to be ready
    await workViewPage.waitForTaskList();

    // Create a task
    await workViewPage.addTask('Persistent task');
    await page.waitForSelector(TASK, { state: 'visible' });

    // Navigate to settings
    await page.goto('/#/config');
    await expect(page.locator('.page-settings')).toBeVisible({ timeout: 10000 });

    // Navigate back
    await page.goto('/#/tag/TODAY/tasks');
    await workViewPage.waitForTaskList();

    // Verify task is still there
    await expect(page.locator(TASK_TITLE).first()).toContainText(/Persistent task/);
  });
});

import { test } from '../../fixtures/test.fixture';

test.describe('Schedule overlap', () => {
  test('should display multiple tasks starting the same time', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();

    // Navigate to schedule view
    await page.getByRole('menuitem', { name: 'Schedule' }).click();
    // Wait for and dismiss the scheduling information dialog
    const dialog = page.locator('mat-dialog-container');
    await dialog.waitFor({ state: 'visible', timeout: 10000 });
    await dialog.locator('button', { hasText: /Cancel/ }).click();
    await dialog.waitFor({ state: 'detached', timeout: 10000 });

    const addTask = async (taskDescription: string): Promise<void> => {
      // Last day is far enough into the future to avoid any created tasks
      // spawning reminder popups to interrupt the test
      const lastDayColumn = page.locator('schedule [data-day]').last();
      // Tasks appearing in columns are expected to always allow for a small
      // margin to the rightmost column edge for additional tasks to be created
      // around the same start time
      await lastDayColumn.click({
        position: {
          x: await lastDayColumn.evaluate((el) => el.clientWidth - 5),
          y: await lastDayColumn.evaluate((el) => el.clientHeight / 2),
        },
      });

      const newTaskInput = page.getByRole('combobox', { name: 'Schedule task...' });
      await newTaskInput.fill(taskDescription);
      await newTaskInput.press('Enter');
    };

    await addTask('task1');
    await addTask('task2');
    await addTask('task3');

    const checkTaskAccessible = async (taskDescription: string): Promise<void> => {
      await page
        .locator('schedule-event')
        .filter({ hasText: taskDescription })
        // Regardless of how the elements representing tasks overlap, the top
        // left corner should always be visible to click on
        .click({ position: { x: 0, y: 0 } });
      // Clicking on the task should bring up its details panel
      await page
        .locator('task-detail-panel')
        .filter({ hasText: taskDescription })
        .isVisible();
    };

    await checkTaskAccessible('task1');
    await checkTaskAccessible('task2');
    await checkTaskAccessible('task3');
  });
});

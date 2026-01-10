import { expect, test } from '../../fixtures/test.fixture';

test.describe('Task List - Start/Stop', () => {
  test('should start and stop single task', async ({ page, workViewPage }) => {
    // Wait for work view to be ready
    await workViewPage.waitForTaskList();

    // Add a task
    await workViewPage.addTask('0 C task');

    // Get the first task
    const firstTask = page.locator('task').first();

    // Hover over the task to show the play button
    await firstTask.hover();

    // Wait for play button to be visible and click it
    const playBtn = page.locator('.play-btn.tour-playBtn').first();
    await playBtn.waitFor({ state: 'visible' });
    await playBtn.click();

    // Verify the task has the 'isCurrent' class (auto-waits)
    await expect(firstTask).toHaveClass(/isCurrent/, { timeout: 5000 });

    // Hover again to ensure button is visible
    await firstTask.hover();

    // Click the play button again to stop the task
    await playBtn.click();

    // Verify the task no longer has the 'isCurrent' class (auto-waits)
    await expect(firstTask).not.toHaveClass(/isCurrent/, { timeout: 5000 });
  });
});

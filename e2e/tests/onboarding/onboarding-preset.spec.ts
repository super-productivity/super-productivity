import { expect, test } from '../../fixtures/test.fixture';
import {
  assertNoRuntimeBrowserErrors,
  attachPageErrorCollector,
  installDevErrorDialogHandler,
} from '../../utils/runtime-errors';
import { waitForStatePersistence } from '../../utils/waits';
import { WorkViewPage } from '../../pages/work-view.page';

test.describe('First-run onboarding', () => {
  test('applies a preset and does not show onboarding again after reload', async ({
    isolatedContext,
  }) => {
    const page = await isolatedContext.newPage();
    const runtimeErrors = attachPageErrorCollector(page, 'onboarding');
    installDevErrorDialogHandler(page, 'onboarding');

    await page.goto('/');

    const onboarding = page.locator('onboarding-preset-selection');
    await expect(onboarding).toBeVisible();
    await expect(onboarding.locator('.preset-card')).toHaveCount(3);

    await onboarding.getByRole('button', { name: /Simple Todo/ }).click();

    await expect(onboarding).toBeHidden();
    await expect(page.locator('task-list').first()).toBeVisible();
    expect(
      await page.evaluate(() => localStorage.getItem('SUP_ONBOARDING_PRESET_DONE')),
    ).toBe('true');

    const taskTitle = `Simple Todo preset ${Date.now()}`;
    await new WorkViewPage(page).addTask(taskTitle);
    const task = page.locator('task').filter({ hasText: taskTitle }).first();
    await expect(task).toBeVisible();
    await task.hover();
    await expect(task.locator('.start-task-btn')).toHaveCount(0);
    await waitForStatePersistence(page);

    await page.reload();

    await expect(page.locator('task-list').first()).toBeVisible();
    await expect(onboarding).toHaveCount(0);
    const reloadedTask = page.locator('task').filter({ hasText: taskTitle }).first();
    await expect(reloadedTask).toBeVisible();
    await reloadedTask.hover();
    await expect(reloadedTask.locator('.start-task-btn')).toHaveCount(0);
    assertNoRuntimeBrowserErrors(runtimeErrors, 'onboarding');
    await page.close();
  });
});

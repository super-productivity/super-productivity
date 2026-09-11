import { expect, test } from '../../fixtures/test.fixture';
import { devices } from '@playwright/test';
import {
  assertNoRuntimeBrowserErrors,
  attachPageErrorCollector,
  installDevErrorDialogHandler,
} from '../../utils/runtime-errors';
import { waitForStatePersistence } from '../../utils/waits';

const pixel5TestOptions = { ...devices['Pixel 5'] };
// Browser type is worker-scoped and cannot be overridden inside a describe block.
Reflect.deleteProperty(pixel5TestOptions, 'defaultBrowserType');

test.describe('First-run onboarding', () => {
  test('applies a preset and does not show onboarding again after reload', async ({
    isolatedContext,
  }) => {
    const page = await isolatedContext.newPage();
    await page.setViewportSize({ width: 599, height: 800 });
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
    await page.getByRole('button', { name: 'Add new task' }).click();
    const input = page.locator('add-task-bar.global .main-input');
    await input.fill(taskTitle);
    await input.press('Enter');
    await expect(page.locator('add-task-bar.global')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('add-task-bar.global')).toBeHidden();
    await page.setViewportSize({ width: 1280, height: 720 });
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

  test.describe('mobile', () => {
    test.use(pixel5TestOptions);

    test('closes the composer after the first onboarding task', async ({
      isolatedContext,
    }) => {
      const page = await isolatedContext.newPage();
      const runtimeErrors = attachPageErrorCollector(page, 'mobile onboarding');
      installDevErrorDialogHandler(page, 'mobile onboarding');

      await page.addInitScript(() => {
        localStorage.setItem('SUP_EXAMPLE_TASKS_CREATED', 'true');
      });

      await page.goto('/');
      const userAgent = await page.evaluate(() => navigator.userAgent);
      expect(userAgent).toContain('Pixel 5');
      expect(userAgent).toContain('PLAYWRIGHT-WORKER-');

      const onboarding = page.locator('onboarding-preset-selection');
      await onboarding.getByRole('button', { name: /Simple Todo/ }).tap();
      await expect(onboarding).toBeHidden();
      await expect(page.locator('onboarding-hint')).toContainText(
        'Tap + to add your first task',
      );

      await page.getByRole('button', { name: 'Add new task' }).tap();
      const input = page.locator('add-task-bar.global .main-input');
      await input.fill('My first mobile task');
      await input.press('Enter');

      await expect(page.locator('add-task-bar.global')).toBeHidden();
      await expect(page.locator('onboarding-hint')).toContainText(
        'Tap a task to open its details.',
      );
      assertNoRuntimeBrowserErrors(runtimeErrors, 'mobile onboarding');
      await page.close();
    });

    test('keeps the composer open after a later touch task', async ({
      isolatedContext,
    }) => {
      const page = await isolatedContext.newPage();
      const runtimeErrors = attachPageErrorCollector(page, 'hybrid onboarding');
      installDevErrorDialogHandler(page, 'hybrid onboarding');

      await page.addInitScript(() => {
        localStorage.setItem('SUP_EXAMPLE_TASKS_CREATED', 'true');
      });

      await page.goto('/');

      const onboarding = page.locator('onboarding-preset-selection');
      await onboarding.getByRole('button', { name: /Simple Todo/ }).tap();
      await expect(onboarding).toBeHidden();
      await expect(page.locator('onboarding-hint')).toContainText(
        'Tap + to add your first task',
      );

      await page.mouse.move(10, 10);
      await expect(page.locator('body')).toHaveClass(/isMousePrimary/);
      await page.getByRole('button', { name: 'Add new task' }).click();

      const composer = page.locator('add-task-bar.global');
      const input = composer.locator('.main-input');
      await input.fill('First hybrid task');
      await input.press('Enter');
      await expect(composer).toBeVisible();

      // Switch intent before the real submit tap so the touch layout has settled.
      await page.locator('body').dispatchEvent('pointerdown', {
        pointerType: 'touch',
      });
      await expect(page.locator('body')).toHaveClass(/isTouchPrimary/);
      await expect(composer).toBeVisible();

      await input.fill('Second hybrid task');
      await composer.locator('.e2e-add-task-submit').tap();
      await expect(composer).toBeVisible();

      await input.press('Escape');
      await expect(composer).toBeHidden();
      assertNoRuntimeBrowserErrors(runtimeErrors, 'hybrid onboarding');
      await page.close();
    });
  });
});

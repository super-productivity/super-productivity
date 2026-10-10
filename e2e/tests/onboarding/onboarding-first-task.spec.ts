import { expect, test } from '../../fixtures/test.fixture';
import { devices, Page } from '@playwright/test';
import {
  assertNoRuntimeBrowserErrors,
  attachPageErrorCollector,
  installDevErrorDialogHandler,
} from '../../utils/runtime-errors';
import { waitForMenuSettled, waitForStatePersistence } from '../../utils/waits';

const pixel5TestOptions = { ...devices['Pixel 5'] };
// Browser type is worker-scoped and cannot be overridden inside a describe block.
Reflect.deleteProperty(pixel5TestOptions, 'defaultBrowserType');

const INBOX_TIP = 'Some optional tips are waiting in your Inbox.';
const INBOX_NAV_ITEM =
  'magic-side-nav nav-item[data-project-id="INBOX_PROJECT"] .nav-link';

/** First run; `withExamples: false` skips seeding the Inbox example tasks. */
const openFreshApp = async (
  page: Page,
  { withExamples }: { withExamples: boolean },
): Promise<void> => {
  if (!withExamples) {
    await page.addInitScript(() => {
      localStorage.setItem('SUP_EXAMPLE_TASKS_CREATED', 'true');
    });
  }
  await page.goto('/');
};

const addTaskViaComposer = async (page: Page, title: string): Promise<void> => {
  await page.locator('.tour-addBtn').click();
  const composer = page.locator('add-task-bar.global');
  const input = composer.locator('.main-input');
  await input.fill(title);
  await input.press('Enter');
  await expect(composer).toBeVisible();
  await input.press('Escape');
  await expect(composer).toBeHidden();
};

test.describe('First-run onboarding', () => {
  test('a new install starts with a calm feature set', async ({ isolatedContext }) => {
    const page = await isolatedContext.newPage();
    const runtimeErrors = attachPageErrorCollector(page, 'onboarding defaults');
    installDevErrorDialogHandler(page, 'onboarding defaults');
    await openFreshApp(page, { withExamples: false });
    await expect(page.locator('onboarding-hint')).toContainText(
      'Click + to add your first task',
    );

    const sideNav = page.locator('magic-side-nav');
    await expect(sideNav.getByText('Planner', { exact: true })).toBeVisible();
    await expect(page.locator('.tour-playBtn')).toBeVisible();
    for (const hidden of ['Schedule', 'Boards', 'Habits']) {
      await expect(sideNav.getByText(hidden, { exact: true })).toHaveCount(0);
    }
    assertNoRuntimeBrowserErrors(runtimeErrors, 'onboarding defaults');
    await page.close();
  });

  test('ends by pointing at the Inbox, where the example tasks wait', async ({
    isolatedContext,
  }) => {
    const page = await isolatedContext.newPage();
    const runtimeErrors = attachPageErrorCollector(page, 'onboarding inbox');
    installDevErrorDialogHandler(page, 'onboarding inbox');
    await openFreshApp(page, { withExamples: true });
    await expect(page.locator('onboarding-hint')).toContainText(
      'Click + to add your first task',
    );

    await addTaskViaComposer(page, `Inbox tip task ${Date.now()}`);

    const hint = page.locator('onboarding-hint');
    await expect(hint).toContainText(INBOX_TIP);
    const inboxNavItem = page.locator(INBOX_NAV_ITEM);
    await expect
      .poll(async () => {
        const target = await inboxNavItem.boundingBox();
        const chip = await hint.locator('.hint-chip').boundingBox();
        return !!target && !!chip && chip.y > target.y + target.height;
      })
      .toBe(true);

    await inboxNavItem.click();
    await expect(hint).toHaveCount(0);
    await expect(page.locator('task').filter({ hasText: 'Go further' })).toBeVisible();
    assertNoRuntimeBrowserErrors(runtimeErrors, 'onboarding inbox');
    await page.close();
  });

  test('the last tip concludes guidance and ends it for good', async ({
    isolatedContext,
  }) => {
    const page = await isolatedContext.newPage();
    const runtimeErrors = attachPageErrorCollector(page, 'onboarding dismiss');
    installDevErrorDialogHandler(page, 'onboarding dismiss');
    await openFreshApp(page, { withExamples: true });
    await expect(page.locator('onboarding-hint')).toBeAttached();

    await addTaskViaComposer(page, `Dismissed tip task ${Date.now()}`);
    const hint = page.locator('onboarding-hint');
    await expect(hint).toContainText(INBOX_TIP);
    // Focus returns to + after the composer closes; move it so the + tooltip
    // does not sit on top of the hint's close button.
    await page.mouse.click(640, 600);
    await expect(hint).toContainText("You're all set");
    await hint.getByRole('button', { name: 'Got it' }).click();
    await expect(hint).toHaveCount(0);

    await waitForStatePersistence(page);
    await page.reload();
    await expect(page.locator('task-list').first()).toBeVisible();
    await expect(page.locator('onboarding-hint')).toHaveCount(0);
    assertNoRuntimeBrowserErrors(runtimeErrors, 'onboarding dismiss');
    await page.close();
  });

  test('time tracking can be switched off from the play button', async ({
    isolatedContext,
  }) => {
    const page = await isolatedContext.newPage();
    const runtimeErrors = attachPageErrorCollector(page, 'disable tracking');
    installDevErrorDialogHandler(page, 'disable tracking');
    await openFreshApp(page, { withExamples: false });
    // The play button stays disabled (and inert) until there is something to track.
    await addTaskViaComposer(page, `Tracking off task ${Date.now()}`);

    const playBtn = page.locator('.tour-playBtn');
    const disableItem = page.getByRole('menuitem', { name: 'Disable feature' });
    // Closing the menu hands focus back to the play button.
    await playBtn.click({ button: 'right' });
    await expect(disableItem).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(disableItem).toHaveCount(0);
    await expect(playBtn).toBeFocused();

    await playBtn.click({ button: 'right' });
    await disableItem.click();
    await expect(playBtn).toHaveCount(0);

    await waitForStatePersistence(page);
    await page.reload();
    await expect(page.locator('task-list').first()).toBeVisible();
    await expect(page.locator('.tour-playBtn')).toHaveCount(0);
    assertNoRuntimeBrowserErrors(runtimeErrors, 'disable tracking');
    await page.close();
  });

  test('reloading after the first task does not start over', async ({
    isolatedContext,
  }) => {
    const page = await isolatedContext.newPage();
    const runtimeErrors = attachPageErrorCollector(page, 'onboarding reload');
    installDevErrorDialogHandler(page, 'onboarding reload');
    await openFreshApp(page, { withExamples: true });
    await expect(page.locator('onboarding-hint')).toBeAttached();

    await addTaskViaComposer(page, `Reloaded first task ${Date.now()}`);
    await expect(page.locator('onboarding-hint')).toContainText(INBOX_TIP);

    await waitForStatePersistence(page);
    await page.reload();
    await expect(page.locator('task-list').first()).toBeVisible();
    await expect(page.locator('onboarding-hint')).toHaveCount(0);
    // The calm defaults survive the reload.
    await expect(
      page.locator('magic-side-nav').getByText('Boards', { exact: true }),
    ).toHaveCount(0);
    assertNoRuntimeBrowserErrors(runtimeErrors, 'onboarding reload');
    await page.close();
  });

  test.describe('mobile', () => {
    test.use(pixel5TestOptions);

    test('keeps + uncovered, then teaches the swipe gestures', async ({
      isolatedContext,
    }) => {
      const page = await isolatedContext.newPage();
      const runtimeErrors = attachPageErrorCollector(page, 'mobile onboarding');
      installDevErrorDialogHandler(page, 'mobile onboarding');

      await openFreshApp(page, { withExamples: false });
      const userAgent = await page.evaluate(() => navigator.userAgent);
      expect(userAgent).toContain('Pixel 5');
      expect(userAgent).toContain('PLAYWRIGHT-WORKER-');

      await expect(page.locator('onboarding-hint')).toContainText(
        'Tap + to add your first task',
      );
      // The hint sits above the + button, clear of its pulse glow and the arrow.
      const addBtn = await page.locator('.add-task-button').boundingBox();
      await expect
        .poll(async () => {
          const chip = await page.locator('onboarding-hint .hint-chip').boundingBox();
          return chip ? addBtn!.y - (chip.y + chip.height) : -1;
        })
        .toBeGreaterThanOrEqual(16);

      await page.getByRole('button', { name: 'Add new task' }).tap();
      const input = page.locator('add-task-bar.global .main-input');
      await input.fill('My first mobile task');
      await input.press('Enter');

      await expect(page.locator('add-task-bar.global')).toBeHidden();
      const hint = page.locator('onboarding-hint');
      await expect(hint).toContainText('Swipe task left for more actions');
      const task = page
        .locator('task')
        .filter({ hasText: 'My first mobile task' })
        .first();
      await expect
        .poll(async () => {
          const target = await task.boundingBox();
          const chip = await hint.locator('.hint-chip').boundingBox();
          return !!target && !!chip && chip.y >= target.y + target.height;
        })
        .toBe(true);

      // Marking the task done (swipe right or checkbox) completes guidance.
      await task.locator('done-toggle').tap();
      await expect(hint).toHaveCount(0);
      assertNoRuntimeBrowserErrors(runtimeErrors, 'mobile onboarding');
      await page.close();
    });

    test('deleting the first task from its menu ends the swipe tips', async ({
      isolatedContext,
    }) => {
      const page = await isolatedContext.newPage();
      const runtimeErrors = attachPageErrorCollector(page, 'onboarding delete');
      installDevErrorDialogHandler(page, 'onboarding delete');

      await openFreshApp(page, { withExamples: false });
      await expect(page.locator('onboarding-hint')).toContainText(
        'Tap + to add your first task',
      );
      await page.getByRole('button', { name: 'Add new task' }).tap();
      const input = page.locator('add-task-bar.global .main-input');
      await input.fill('Task to delete');
      await input.press('Enter');
      await expect(page.locator('add-task-bar.global')).toBeHidden();

      const hint = page.locator('onboarding-hint');
      await expect(hint).toContainText('Swipe task left for more actions');
      const task = page.locator('task').filter({ hasText: 'Task to delete' }).first();
      // The keyboard route to the menu that swipe-left opens.
      await task.focus();
      await page.keyboard.press('q');
      await waitForMenuSettled(page);
      await page
        .locator('.mat-mdc-menu-content button', { hasText: 'Delete task' })
        .tap();
      await page.getByRole('button', { name: 'Delete', exact: true }).click();
      await expect(page.locator('task')).toHaveCount(0);

      // Nothing is left to swipe: guidance ends instead of waiting unseen.
      await expect(hint).toHaveCount(0);
      await expect
        .poll(() =>
          page.evaluate(() => localStorage.getItem('SUP_ONBOARDING_HINTS_DONE')),
        )
        .toBe('true');
      assertNoRuntimeBrowserErrors(runtimeErrors, 'onboarding delete');
      await page.close();
    });

    test('keeps the composer open after a later touch task', async ({
      isolatedContext,
    }) => {
      const page = await isolatedContext.newPage();
      const runtimeErrors = attachPageErrorCollector(page, 'hybrid onboarding');
      installDevErrorDialogHandler(page, 'hybrid onboarding');

      await openFreshApp(page, { withExamples: false });
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

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

// Up to the inline icons, whose ligature names are part of the text content.
const MODEL_TIP = 'This task is planned for today, so it shows in';
const INBOX_TIP = 'Tasks without a project of your own stay in';
const INBOX_NAV_ITEM =
  'magic-side-nav nav-item[data-project-id="INBOX_PROJECT"] .nav-link';
const TODAY_NAV_ITEM = 'magic-side-nav nav-item[data-tag-id="TODAY"] .nav-link';
const MORE_FALLBACK = "There's more already switched on";

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

/** The last tip sits below the task's "Inbox" chip, its arrow pointing at it. */
const expectHintOnInboxChip = async (page: Page, taskTitle: string): Promise<void> => {
  const chipTarget = page
    .locator('task')
    .filter({ hasText: taskTitle })
    .first()
    .locator('tag-list tag')
    .first();
  const hint = page.locator('onboarding-hint');
  await expect(chipTarget).toContainText('Inbox');
  await expect
    .poll(async () => {
      const target = await chipTarget.boundingBox();
      const chip = await hint.locator('.hint-chip').boundingBox();
      const arrow = await hint.locator('.hint-arrow').boundingBox();
      if (!target || !chip || !arrow) {
        return false;
      }
      const halfArrow = arrow.width / 2;
      const arrowCenter = arrow.x + halfArrow;
      return (
        chip.y >= target.y + target.height &&
        arrowCenter >= target.x &&
        arrowCenter <= target.x + target.width
      );
    })
    .toBe(true);
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

  test('ends by explaining Today and the Inbox, where the example tasks wait', async ({
    isolatedContext,
  }) => {
    const page = await isolatedContext.newPage();
    const runtimeErrors = attachPageErrorCollector(page, 'onboarding inbox');
    installDevErrorDialogHandler(page, 'onboarding inbox');
    await openFreshApp(page, { withExamples: true });
    await expect(page.locator('onboarding-hint')).toContainText(
      'Click + to add your first task',
    );

    const title = `Inbox tip task ${Date.now()}`;
    await addTaskViaComposer(page, title);

    const hint = page.locator('onboarding-hint');
    await expect(hint).toContainText(MODEL_TIP);
    await expect(hint).toContainText(INBOX_TIP);
    await expect(hint).not.toContainText('☰');
    await expectHintOnInboxChip(page, title);

    await page.locator(INBOX_NAV_ITEM).click();
    await expect(hint).toContainText(MORE_FALLBACK);
    await expect(
      page.locator('task').filter({ hasText: 'Optional: getting started tips' }),
    ).toBeVisible();
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
    await hint.getByRole('button', { name: 'Close tip' }).click();
    await expect(hint).toHaveCount(0);

    await waitForStatePersistence(page);
    await page.reload();
    await expect(page.locator('task-list').first()).toBeVisible();
    await expect(page.locator('onboarding-hint')).toHaveCount(0);
    assertNoRuntimeBrowserErrors(runtimeErrors, 'onboarding dismiss');
    await page.close();
  });

  test('the last tip follows its task and ends once the task is out of view', async ({
    isolatedContext,
  }) => {
    const page = await isolatedContext.newPage();
    const runtimeErrors = attachPageErrorCollector(page, 'onboarding follow');
    installDevErrorDialogHandler(page, 'onboarding follow');
    await openFreshApp(page, { withExamples: false });
    const title = `Followed tip task ${Date.now()}`;
    await addTaskViaComposer(page, title);
    const hint = page.locator('onboarding-hint');
    await expect(hint).toContainText(MODEL_TIP);
    const task = page.locator('task').filter({ hasText: title }).first();

    // Menus open on the very row the tip points at: the tip steps aside.
    await task.click({ button: 'right' });
    await expect(page.locator('.mat-mdc-menu-content')).toBeVisible();
    await expect(hint).toHaveCount(0);
    // A click during the open animation does not close the menu.
    await waitForMenuSettled(page);
    await page.mouse.click(900, 650);
    await expect(page.locator('.mat-mdc-menu-content')).toHaveCount(0);
    await expect(hint).toContainText(MODEL_TIP);

    // Done moves the row to the completed list; the tip moves with it.
    await task.locator('done-toggle').click();
    await expectHintOnInboxChip(page, title);

    // Once its task is out of view the tip ends instead of pointing at nothing.
    await page.getByText('Completed Tasks', { exact: false }).first().click();
    await expect(hint).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('SUP_ONBOARDING_HINTS_DONE')))
      .toBe('true');
    assertNoRuntimeBrowserErrors(runtimeErrors, 'onboarding follow');
    await page.close();
  });

  test('points at the bottom-nav + in a narrow window used with a mouse', async ({
    isolatedContext,
  }) => {
    const page = await isolatedContext.newPage();
    const runtimeErrors = attachPageErrorCollector(page, 'narrow mouse onboarding');
    installDevErrorDialogHandler(page, 'narrow mouse onboarding');
    // Phone-width layout (bottom nav, no header +) with a fine pointer.
    await page.setViewportSize({ width: 400, height: 800 });
    await openFreshApp(page, { withExamples: false });
    await expect(page.locator('body')).toHaveClass(/isMousePrimary/);

    const hint = page.locator('onboarding-hint');
    await expect(hint).toContainText('Click + to add your first task');
    const addBtn = page.getByRole('button', { name: 'Add new task' });
    // The hint, arrow included, sits fully above + once the bottom nav has settled.
    await expect
      .poll(async () => {
        const btn = await addBtn.boundingBox();
        const chip = await hint.locator('.hint-chip').boundingBox();
        const arrow = await hint.locator('.hint-arrow').boundingBox();
        return (
          !!btn &&
          !!chip &&
          !!arrow &&
          Math.max(chip.y + chip.height, arrow.y + arrow.height) <= btn.y
        );
      })
      .toBe(true);

    await addBtn.click();
    await expect(page.locator('add-task-bar.global')).toBeVisible();
    assertNoRuntimeBrowserErrors(runtimeErrors, 'narrow mouse onboarding');
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

  test('explains Today and the Inbox even when no tips were seeded', async ({
    isolatedContext,
  }) => {
    const page = await isolatedContext.newPage();
    const runtimeErrors = attachPageErrorCollector(page, 'onboarding model');
    installDevErrorDialogHandler(page, 'onboarding model');
    await openFreshApp(page, { withExamples: false });
    await addTaskViaComposer(page, `Model tip task ${Date.now()}`);

    const hint = page.locator('onboarding-hint');
    await expect(hint).toContainText(MODEL_TIP);
    await expect(hint).toContainText(INBOX_TIP);

    // Moving on offers the quick tour once more; moving on again ends guidance.
    await page.locator(INBOX_NAV_ITEM).click();
    await expect(hint).toContainText(MORE_FALLBACK);
    await page.locator(TODAY_NAV_ITEM).click();
    await expect(hint).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('SUP_ONBOARDING_HINTS_DONE')))
      .toBe('true');
    assertNoRuntimeBrowserErrors(runtimeErrors, 'onboarding model');
    await page.close();
  });

  test('a tour from the Help menu replaces the hints and can be closed', async ({
    isolatedContext,
  }) => {
    const page = await isolatedContext.newPage();
    const runtimeErrors = attachPageErrorCollector(page, 'onboarding tour');
    installDevErrorDialogHandler(page, 'onboarding tour');
    await openFreshApp(page, { withExamples: true });
    const hint = page.locator('onboarding-hint');
    await expect(hint).toContainText('Click + to add your first task');

    await page.locator('magic-side-nav').getByText('Help', { exact: true }).click();
    await page.getByText('How to: Create a task', { exact: true }).click();

    const tourStep = page.locator('.shepherd-element');
    await expect(tourStep).toContainText('Create a task');
    await expect(hint).toHaveCount(0);

    // Every step has a close button.
    await tourStep.locator('.shepherd-cancel-icon').click();
    await expect(tourStep).toHaveCount(0);
    await expect(hint).toHaveCount(0);
    assertNoRuntimeBrowserErrors(runtimeErrors, 'onboarding tour');
    await page.close();
  });

  test.describe('mobile', () => {
    test.use(pixel5TestOptions);

    test('keeps + uncovered, then teaches swiping and the Inbox', async ({
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

      // Marking the task done (swipe right or checkbox) leads to the last tip,
      // on the task's "Inbox" chip, saying where the Inbox is on phones.
      await task.locator('done-toggle').tap();
      await expect(hint).toContainText(MODEL_TIP);
      await expect(hint).toContainText('Inbox, under ☰');
      await expectHintOnInboxChip(page, 'My first mobile task');
      // The tip would sit above the opened menu: it steps aside until it closes.
      await page.locator('mobile-bottom-nav nav > button:last-of-type').tap();
      await expect(page.locator(INBOX_NAV_ITEM)).toBeVisible();
      await expect(hint).toHaveCount(0);
      await page.locator('.mobile-menu-close').tap();
      await expect(page.locator(INBOX_NAV_ITEM)).toBeHidden();
      await expect(hint).toContainText(INBOX_TIP);
      await expect(hint).toContainText('Inbox, under ☰');
      await hint.getByRole('button', { name: 'Close tip' }).tap();
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

      // Nothing is left to swipe or explain: guidance ends instead of waiting unseen.
      await expect(hint).toHaveCount(0);
      await expect
        .poll(() =>
          page.evaluate(() => localStorage.getItem('SUP_ONBOARDING_HINTS_DONE')),
        )
        .toBe('true');
      assertNoRuntimeBrowserErrors(runtimeErrors, 'onboarding delete');
      await page.close();
    });

    test('re-anchors the hint after the nav slides in under mouse input', async ({
      isolatedContext,
    }) => {
      const page = await isolatedContext.newPage();
      // Stretch the bottom-nav entrance so the hint is placed mid-slide, as on slow CI.
      await page.addInitScript(() => {
        document.addEventListener('DOMContentLoaded', () => {
          const style = document.createElement('style');
          style.textContent =
            '.mobile-bottom-nav.entrance { animation-duration: 3s !important; }';
          document.head.appendChild(style);
        });
      });
      await openFreshApp(page, { withExamples: false });
      await expect(page.locator('onboarding-hint')).toContainText(
        'Tap + to add your first task',
      );

      const addBtn = page.locator('.add-task-button');
      const expectHintClearOfAddBtn = (): Promise<void> =>
        expect
          .poll(
            async () => {
              const btn = await addBtn.boundingBox();
              const chip = await page.locator('onboarding-hint .hint-chip').boundingBox();
              return btn && chip ? btn.y - (chip.y + chip.height) : -1;
            },
            { timeout: 6000 },
          )
          .toBeGreaterThanOrEqual(16);
      // AppComponent drops the entrance class after 1.5s, cutting the stretched
      // slide short (animationcancel, no animationend); the hint must follow.
      await expect(page.locator('.mobile-bottom-nav')).not.toHaveClass(/entrance/);
      await expectHintClearOfAddBtn();

      await page.mouse.move(10, 10);
      await expect(page.locator('body')).toHaveClass(/isMousePrimary/);
      // Once the nav has settled, the hint must sit clear above the + button again.
      await expectHintClearOfAddBtn();
      await addBtn.click();
      await expect(page.locator('add-task-bar.global')).toBeVisible();
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

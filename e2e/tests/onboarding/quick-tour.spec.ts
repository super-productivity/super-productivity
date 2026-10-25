import { expect, test } from '../../fixtures/test.fixture';
import { devices, Locator, Page } from '@playwright/test';
import {
  assertNoRuntimeBrowserErrors,
  attachPageErrorCollector,
  installDevErrorDialogHandler,
} from '../../utils/runtime-errors';
import { waitForStatePersistence } from '../../utils/waits';

// Up to the inline icon, whose ligature name is part of the text content.
const INBOX_TIP = 'Tasks without a project of your own stay in';
const DECLINED = "It's under Help → Quick tour";

/** First run without the seeded Inbox tasks, so the user's task is the only one. */
const openFreshApp = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    localStorage.setItem('SUP_EXAMPLE_TASKS_CREATED', 'true');
  });
  await page.goto('/');
  // The + works before the data has loaded. A task added then misses Today
  // and the onboarding hints, which only start listening once loaded; the
  // first tip shows that they are.
  await expect(page.locator('onboarding-hint')).toContainText('to add your first task');
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

/** Adds the first task and waits for part 1's last tip with the tour offer. */
const reachTourOffer = async (page: Page, title: string): Promise<Locator> => {
  await openFreshApp(page);
  await addTaskViaComposer(page, title);
  const hint = page.locator('onboarding-hint');
  await expect(hint).toContainText(INBOX_TIP);
  // Focus returns to + after the composer closes; move it so the + tooltip
  // does not sit on top of the hint's buttons.
  await page.mouse.click(640, 600);
  return hint;
};

const pixel5TestOptions = { ...devices['Pixel 5'] };
// Keep the configured Chromium: the device preset would select WebKit.
Reflect.deleteProperty(pixel5TestOptions, 'defaultBrowserType');

const openQuickTourFromHelp = async (page: Page): Promise<void> => {
  await page.locator('magic-side-nav').getByText('Help', { exact: true }).click();
  await page.getByText('Quick tour', { exact: true }).click();
};

test.describe('Quick tour', () => {
  test('walks through the steps on the first task, then offers more', async ({
    isolatedContext,
  }) => {
    const page = await isolatedContext.newPage();
    const runtimeErrors = attachPageErrorCollector(page, 'quick tour');
    installDevErrorDialogHandler(page, 'quick tour');
    const title = `Tour task ${Date.now()}`;
    const hint = await reachTourOffer(page, title);
    const task = page.locator('task').filter({ hasText: title }).first();

    await hint.getByRole('button', { name: 'Show me more ›' }).click();
    await expect(hint).toContainText('to track time');
    await expect(hint).toContainText('1 of 5');

    // 1: track time. Doing it shows ✓, then the chip moves on by itself.
    await task.hover();
    await task.locator('.start-task-btn').click();
    await expect(hint.locator('.ack')).toBeVisible();
    await expect(hint).toContainText('Break it down');
    await expect(hint).toContainText('2 of 5');
    await expect(hint).toContainText("Timer's running");

    // 2: add a subtask from the task's menu.
    await task.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Add subtask' }).click();
    const subtaskInput = page.locator('.e2e-add-subtask-input');
    await subtaskInput.fill('Tour subtask');
    await subtaskInput.press('Enter');
    await subtaskInput.press('Escape');
    await expect(hint).toContainText('Make a project of your own');
    await expect(hint).toContainText('3 of 5');

    // 3: the nav's + is hover-only; the tour reveals the one it points at.
    const addProjectBtn = page.locator('[data-nav-btn="add-project"]');
    await expect(addProjectBtn).toHaveClass(/onboarding-pulse/);
    await addProjectBtn.click();
    const projectNameInput = page
      .locator('dialog-create-project input[type="text"]')
      .first();
    await projectNameInput.fill(`Tour project ${Date.now()}`);
    await page.locator('dialog-create-project button[type=submit]').click();
    await expect(projectNameInput).toBeHidden();
    await expect(hint).toContainText('Plan the next days');
    await expect(hint).toContainText('4 of 5');

    // 4: open the Planner.
    await page.locator('magic-side-nav .tour-planner').first().click();
    await expect(page).toHaveURL(/\/planner/);
    const card = page.locator('quick-tour-card');
    await expect(card).toContainText('Want more?');
    await expect(card).toContainText('5 of 5');

    // 5: the card leads to the feature switches in Settings.
    await card.getByRole('button', { name: 'Open settings ›' }).click();
    await expect(page).toHaveURL(/\/config\?section=appFeatures/);
    await expect(card).toHaveCount(0);

    await waitForStatePersistence(page);
    await page.reload();
    await expect(page.locator('magic-side-nav')).toBeVisible();
    await expect(page.locator('onboarding-hint')).toHaveCount(0);

    // Help → Quick tour starts over on Today.
    await openQuickTourFromHelp(page);
    await expect(page).toHaveURL(/\/tag\/TODAY\/tasks/);
    await expect(page.locator('onboarding-hint')).toContainText('1 of 5');
    assertNoRuntimeBrowserErrors(runtimeErrors, 'quick tour');
    await page.close();
  });

  test('resumes after a reload and ends on ✕', async ({ isolatedContext }) => {
    const page = await isolatedContext.newPage();
    const runtimeErrors = attachPageErrorCollector(page, 'quick tour resume');
    installDevErrorDialogHandler(page, 'quick tour resume');
    const hint = await reachTourOffer(page, `Resume task ${Date.now()}`);
    await hint.getByRole('button', { name: 'Show me more ›' }).click();
    await hint.getByRole('button', { name: 'Next ›' }).click();
    await expect(hint).toContainText('2 of 5');

    await waitForStatePersistence(page);
    await page.reload();
    await expect(page.locator('onboarding-hint')).toContainText('2 of 5');

    await page
      .locator('onboarding-hint')
      .getByRole('button', { name: 'Close tip' })
      .click();
    await expect(page.locator('onboarding-hint')).toHaveCount(0);
    await page.reload();
    await expect(page.locator('task-list').first()).toBeVisible();
    await expect(page.locator('onboarding-hint')).toHaveCount(0);
    assertNoRuntimeBrowserErrors(runtimeErrors, 'quick tour resume');
    await page.close();
  });

  test('No thanks points to Help once, and nothing follows', async ({
    isolatedContext,
  }) => {
    const page = await isolatedContext.newPage();
    const runtimeErrors = attachPageErrorCollector(page, 'quick tour declined');
    installDevErrorDialogHandler(page, 'quick tour declined');
    const hint = await reachTourOffer(page, `Declined task ${Date.now()}`);

    await hint.getByRole('button', { name: 'No thanks' }).click();
    await expect(hint).toContainText(DECLINED);
    // The pointer to Help leaves by itself after a moment.
    await expect(hint).toHaveCount(0, { timeout: 5000 });

    await waitForStatePersistence(page);
    await page.reload();
    await expect(page.locator('task-list').first()).toBeVisible();
    await expect(page.locator('onboarding-hint')).toHaveCount(0);
    assertNoRuntimeBrowserErrors(runtimeErrors, 'quick tour declined');
    await page.close();
  });

  test('✕ on the last tip ends guidance without an offer', async ({
    isolatedContext,
  }) => {
    const page = await isolatedContext.newPage();
    const runtimeErrors = attachPageErrorCollector(page, 'quick tour skipped');
    installDevErrorDialogHandler(page, 'quick tour skipped');
    const hint = await reachTourOffer(page, `Skipped task ${Date.now()}`);

    await hint.getByRole('button', { name: 'Close tip' }).click();
    await expect(hint).toHaveCount(0);
    await page.locator('magic-side-nav .tour-planner').first().click();
    await expect(page).toHaveURL(/\/planner/);
    await expect(page.locator('onboarding-hint')).toHaveCount(0);
    assertNoRuntimeBrowserErrors(runtimeErrors, 'quick tour skipped');
    await page.close();
  });
  test('Help → Quick tour ends a running How-to tour', async ({ isolatedContext }) => {
    const page = await isolatedContext.newPage();
    const runtimeErrors = attachPageErrorCollector(page, 'quick tour over shepherd');
    installDevErrorDialogHandler(page, 'quick tour over shepherd');
    const hint = await reachTourOffer(page, `Shepherd task ${Date.now()}`);
    await hint.getByRole('button', { name: 'No thanks' }).click();
    await expect(hint).toHaveCount(0, { timeout: 5000 });

    await page.locator('magic-side-nav').getByText('Help', { exact: true }).click();
    await page.getByText('How to: Create a task', { exact: true }).click();
    const tourStep = page.locator('.shepherd-element');
    await expect(tourStep).toContainText('Create a task');

    await openQuickTourFromHelp(page);
    await expect(page.locator('onboarding-hint')).toContainText('1 of 5');
    await expect(tourStep).toHaveCount(0);
    assertNoRuntimeBrowserErrors(runtimeErrors, 'quick tour over shepherd');
    await page.close();
  });

  test('task steps are skipped once the task is out of view', async ({
    isolatedContext,
  }) => {
    const page = await isolatedContext.newPage();
    const runtimeErrors = attachPageErrorCollector(page, 'quick tour off today');
    installDevErrorDialogHandler(page, 'quick tour off today');
    const hint = await reachTourOffer(page, `Off-Today task ${Date.now()}`);
    await hint.getByRole('button', { name: 'Show me more ›' }).click();
    await expect(hint).toContainText('1 of 5');

    // Leaving Today removes the row the task steps point at.
    await page.locator('magic-side-nav .tour-planner').first().click();
    await expect(page).toHaveURL(/\/planner/);
    await expect(page.locator('onboarding-hint')).toContainText(
      'Make a project of your own',
    );
    await expect(page.locator('onboarding-hint')).toContainText('3 of 5');
    assertNoRuntimeBrowserErrors(runtimeErrors, 'quick tour off today');
    await page.close();
  });

  test('a collapsed side nav is expanded first, then + is shown', async ({
    isolatedContext,
  }) => {
    const page = await isolatedContext.newPage();
    const runtimeErrors = attachPageErrorCollector(page, 'quick tour collapsed');
    installDevErrorDialogHandler(page, 'quick tour collapsed');
    const hint = await reachTourOffer(page, `Collapsed task ${Date.now()}`);
    await hint.getByRole('button', { name: 'Show me more ›' }).click();
    await hint.getByRole('button', { name: 'Next ›' }).click();
    await hint.getByRole('button', { name: 'Next ›' }).click();
    await expect(hint).toContainText('3 of 5');

    const toggle = page.locator('magic-side-nav .mode-toggle').first();
    await toggle.click();
    await expect(hint).toContainText('Expand the side nav');
    await expect(toggle).toHaveClass(/onboarding-pulse/);
    // Screen readers hear the changed tip, not only the first one of a step.
    await expect(page.locator('.cdk-live-announcer-element')).toContainText(
      'Expand the side nav',
    );

    await toggle.click();
    await expect(hint).toContainText('Create one with +');
    await expect(page.locator('[data-nav-btn="add-project"]')).toHaveClass(
      /onboarding-pulse/,
    );
    assertNoRuntimeBrowserErrors(runtimeErrors, 'quick tour collapsed');
    await page.close();
  });

  test.describe('phone', () => {
    test.use(pixel5TestOptions);

    test('organizes via ☰, then teaches the task menu on a new run', async ({
      isolatedContext,
    }) => {
      const page = await isolatedContext.newPage();
      const runtimeErrors = attachPageErrorCollector(page, 'quick tour phone');
      installDevErrorDialogHandler(page, 'quick tour phone');
      await openFreshApp(page);
      await page.getByRole('button', { name: 'Add new task' }).tap();
      const input = page.locator('add-task-bar.global .main-input');
      await input.fill('Phone tour task');
      await input.press('Enter');
      await expect(page.locator('add-task-bar.global')).toBeHidden();
      const hint = page.locator('onboarding-hint');
      await expect(hint).toContainText('Swipe task left');

      // Part 1 on phones often ends with the task done: no task steps follow.
      await page.locator('task').first().locator('done-toggle').tap();
      await expect(hint).toContainText('under ☰');
      // The chip slides after the done task; a tap mid-slide can miss (run 39889225439).
      await expect(hint.locator('.hint-container')).not.toHaveClass(/is-sliding/);
      await hint.getByRole('button', { name: 'Show me more ›' }).tap();
      await expect(hint).toContainText('Projects and tags live under ☰');
      await expect(hint).toContainText('1 of 3');

      // ☰ opens the drawer; the tip moves to its Tags +.
      await page.locator('.tour-navMenuBtn').tap();
      const addTagBtn = page.locator('.nav-sidenav.mobile [data-nav-btn="add-tag"]');
      await expect(addTagBtn).toHaveClass(/onboarding-pulse/);
      await expect(hint).toContainText('Create one with +');
      await addTagBtn.tap();
      // A fill right after the dialog opens can be cleared by ngModel's first
      // write (run 40151758322); refill until Save sees the title.
      const saveTagBtn = page.getByRole('button', { name: 'Save' });
      await expect(async () => {
        await page.locator('dialog-create-tag input[name="title"]').fill('Phone tag');
        await expect(saveTagBtn).toBeEnabled({ timeout: 1000 });
      }).toPass();
      await saveTagBtn.tap();
      await expect(page.locator('dialog-create-tag')).toHaveCount(0);
      await expect(hint).toContainText('Plan the next days');
      await expect(hint).toContainText('2 of 3');

      // The drawer stays open, so the tip points at its Planner.
      await page.locator('magic-side-nav .tour-planner').first().tap();
      await expect(page).toHaveURL(/\/planner/);
      const card = page.locator('quick-tour-card');
      await expect(card).toContainText('3 of 3');
      await expect(card).toContainText('Search everything from ☰');
      await card.getByRole('button', { name: 'Done' }).tap();
      await expect(card).toHaveCount(0);

      // A new run with an undone task starts on its swipe menu.
      await page.goto('/#/tag/TODAY/tasks');
      await page.getByRole('button', { name: 'Add new task' }).tap();
      await input.fill('Second phone task');
      await input.press('Enter');
      // Past part 1 the composer stays open for the next task.
      await expect(
        page.locator('task').filter({ hasText: 'Second phone task' }),
      ).toHaveCount(1);
      await input.press('Escape');
      await expect(page.locator('add-task-bar.global')).toBeHidden();
      await page.locator('.tour-navMenuBtn').tap();
      await page.getByText('Help', { exact: true }).first().tap();
      await page.getByText('Quick tour', { exact: true }).tap();
      await expect(hint).toContainText('Swipe a task left for its menu');
      await expect(hint).toContainText('1 of 4');
      assertNoRuntimeBrowserErrors(runtimeErrors, 'quick tour phone');
      await page.close();
    });
  });
});

import { expect, test } from '../../fixtures/test.fixture';
import { Browser, Page } from '@playwright/test';
import { WorkViewPage } from '../../pages/work-view.page';
import { skipOnboardingForE2E, waitForAppReady } from '../../utils/waits';

const POMODORO_DURATION_MS = 25 * 60 * 1000;
const FOCUS_PREPARATION_DURATION_MS = 5_900;

const parseClockSeconds = (value: string | null): number => {
  const parts = value?.trim().split(':') ?? [];
  if (parts.length !== 2) {
    return 0;
  }

  const minutes = Number.parseInt(parts[0], 10);
  const seconds = Number.parseInt(parts[1], 10);

  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    return 0;
  }

  const minuteSeconds = minutes * 60;
  return minuteSeconds + seconds;
};

const createClockControlledPage = async (
  browser: Browser,
  baseURL: string | undefined,
  workerIndex: number,
): Promise<Page> => {
  const context = await browser.newContext({
    storageState: undefined,
    userAgent: `PLAYWRIGHT PLAYWRIGHT-WORKER-${workerIndex}`,
    baseURL: baseURL || 'http://localhost:4242',
  });
  try {
    const page = await context.newPage();

    await page.clock.install({ time: new Date('2026-05-18T10:00:00') });
    await page.addInitScript(skipOnboardingForE2E);
    await page.goto('/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await waitForAppReady(page);

    return page;
  } catch (error) {
    await context.close();
    throw error;
  }
};

test.describe('Issue #7642: switch active Pomodoro to Flowtime', () => {
  test('keeps the active session running after switching to Flowtime', async ({
    browser,
    baseURL,
    testPrefix,
  }, testInfo) => {
    const page = await createClockControlledPage(browser, baseURL, testInfo.workerIndex);
    const workViewPage = new WorkViewPage(page, testPrefix);
    const taskName = `${testPrefix}-Issue7642`;
    const focusModeOverlay = page.locator('focus-mode-overlay');
    const mainFocusButton = page.locator('main-header focus-button button');
    const taskSelectionPlaceholder = page.locator('.task-title-placeholder');
    const pomodoroButton = page.locator('segmented-button-group button', {
      hasText: 'Pomodoro',
    });
    const flowtimeButton = page.locator('segmented-button-group button', {
      hasText: 'Flowtime',
    });
    const playButton = page.locator('focus-mode-main button.play-button');
    const completeSessionButton = page.locator(
      'focus-mode-main button.complete-session-btn',
    );
    const pauseResumeIcon = page.locator(
      'focus-mode-main button.pause-resume-btn mat-icon',
    );
    const decreaseTimeButton = page.locator(
      'focus-mode-main button.time-adjust-btn--decrease',
    );
    const clockTime = page.locator('focus-mode-main .clock-time');

    try {
      await workViewPage.waitForTaskList();
      await workViewPage.addTask(taskName);

      await mainFocusButton.click();
      await expect(focusModeOverlay).toBeVisible();

      if (await taskSelectionPlaceholder.isVisible()) {
        await taskSelectionPlaceholder.click();
        const taskSelectorOverlay = page.locator('.task-selector-overlay');
        await expect(taskSelectorOverlay).toBeVisible();
        await page.locator('mat-option, .mat-mdc-option').first().click();
        await expect(taskSelectorOverlay).not.toBeVisible();
      }

      await pomodoroButton.click();
      await expect(pomodoroButton).toHaveClass(/is-active/);

      await playButton.click();
      await page.clock.runFor(FOCUS_PREPARATION_DURATION_MS);
      await expect(completeSessionButton).toBeVisible();
      await expect(decreaseTimeButton).toBeVisible();

      await flowtimeButton.click();

      // After switching to Flowtime mid-session the mode selector hides:
      // the breathing dot + count-up clock already convey the mode and the
      // user can't switch back to a fixed-duration mode mid-session.
      await expect(flowtimeButton).not.toBeVisible();
      await expect(pomodoroButton).not.toBeVisible();
      await expect(completeSessionButton).toBeVisible();
      await expect(decreaseTimeButton).not.toBeVisible();
      await expect(pauseResumeIcon).toHaveText('pause');

      await page.clock.runFor(POMODORO_DURATION_MS + 1_000);
      await expect
        .poll(async () => parseClockSeconds(await clockTime.textContent()))
        .toBeGreaterThan(POMODORO_DURATION_MS / 1000);
      await expect(pauseResumeIcon).toHaveText('pause');
      await expect(completeSessionButton).toBeVisible();
    } finally {
      await page.context().close();
    }
  });
});

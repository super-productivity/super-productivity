import { expect, test } from '../../fixtures/test.fixture';
import type { Locator, Page } from '@playwright/test';
import type { SettingsPage } from '../../pages/settings.page';
import type { WorkViewPage } from '../../pages/work-view.page';
import { cssSelectors } from '../../constants/selectors';
import { waitForStatePersistence } from '../../utils/waits';

/**
 * #8565: with a 24h "Datetime format locale" on a 12h browser, time entry
 * fields must show and accept 24h times. The native <input type="time"> follows
 * the browser locale, so the app swaps in MatTimepicker there. Only a real
 * browser with a 12h locale reaches that branch (the suite pins en-GB).
 */
test.use({ locale: 'en-US' });

const LOCALIZATION = '.section-localization';
const DIALOG = cssSelectors.DIALOG_SCHEDULE_TASK;
const TIME_INPUT = `${DIALOG} .time-form-field input`;
const SUBMIT = `${DIALOG} [data-test-id="schedule-submit-btn"]`;
const NO_AM_PM = /^(?!.*[AP]M)\d{2}:\d{2}$/;

const selectDateTimeLocale = async (
  page: Page,
  settingsPage: SettingsPage,
  optionText: RegExp,
): Promise<void> => {
  await page.goto('/#/config');
  await page.locator(`${LOCALIZATION} collapsible`).waitFor({ state: 'visible' });
  await settingsPage.expandSection(LOCALIZATION);
  await page
    .locator(`${LOCALIZATION} mat-form-field`)
    .filter({ hasText: 'Datetime format locale' })
    .locator('mat-select')
    .click();
  await page.locator('mat-option').filter({ hasText: optionText }).click();
  await waitForStatePersistence(page);
};

const openScheduleDialog = async (page: Page, task: Locator): Promise<Locator> => {
  await task.focus();
  await page.keyboard.press('s');
  const dialog = page.locator(DIALOG);
  await expect(dialog).toBeVisible();
  return dialog;
};

// Tomorrow, so a typed time is never in the past.
const pickTomorrow = async (dialog: Locator): Promise<void> => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (tomorrow.getDate() === 1) {
    await dialog.locator('.mat-calendar-next-button').click();
  }
  await dialog
    .locator('.mat-calendar-body-cell:not(.mat-calendar-body-disabled)')
    .filter({ hasText: new RegExp(`^\\s*${tomorrow.getDate()}\\s*$`) })
    .first()
    .click();
};

// Escape on a closed list would close the dialog, so open it by clicking first
const focusWithListClosed = async (page: Page, input: Locator): Promise<void> => {
  await input.click();
  await expect(page.locator('mat-option').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('mat-option')).toHaveCount(0);
};

const setUp = async (
  page: Page,
  workViewPage: WorkViewPage,
  settingsPage: SettingsPage,
  title: string,
): Promise<Locator> => {
  await workViewPage.waitForTaskList();
  await selectDateTimeLocale(page, settingsPage, /ISO 8601/);
  // Inbox, not Today: a task scheduled for tomorrow stays listed there
  await page.goto('/#/project/INBOX_PROJECT/tasks');
  await workViewPage.waitForTaskList();
  await workViewPage.addTask(title);
  const task = page.locator('task').filter({ hasText: title }).first();
  await expect(task).toBeVisible();
  return task;
};

const submitAndReadBack = async (page: Page, task: Locator): Promise<string> => {
  await page.locator(SUBMIT).click();
  await expect(page.locator(DIALOG)).toBeHidden();
  await waitForStatePersistence(page);
  await openScheduleDialog(page, task);
  const value = await page.locator(TIME_INPUT).inputValue();
  await page.keyboard.press('Escape');
  return value;
};

test.describe('24h datetime locale on a 12h browser (#8565)', () => {
  test('keyboard: shows the focus default in 24h and saves a compact typed time', async ({
    page,
    workViewPage,
    settingsPage,
  }) => {
    const task = await setUp(page, workViewPage, settingsPage, 'kbd task 8565');
    const dialog = await openScheduleDialog(page, task);
    await pickTomorrow(dialog);

    const input = page.locator(TIME_INPUT);
    await expect(input).not.toHaveAttribute('type', 'time');
    await focusWithListClosed(page, input);
    await expect(input).toHaveValue(NO_AM_PM);

    await input.fill('');
    await input.pressSequentially('2215');
    await expect(input).toHaveValue('2215');

    expect(await submitAndReadBack(page, task)).toBe('22:15');
  });

  test('keyboard: Enter in the open list picks the option, not submit', async ({
    page,
    workViewPage,
    settingsPage,
  }) => {
    const task = await setUp(page, workViewPage, settingsPage, 'list task 8565');
    const dialog = await openScheduleDialog(page, task);
    await pickTomorrow(dialog);

    const input = page.locator(TIME_INPUT);
    await focusWithListClosed(page, input);
    await input.fill('');
    await input.pressSequentially('09:00');
    await page.keyboard.press('ArrowDown'); // opens the list
    await expect(page.locator('mat-option').first()).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    await expect(dialog).toBeVisible();
    await expect(input).toHaveValue(NO_AM_PM);
    const picked = await input.inputValue();
    expect(picked).not.toBe('09:00');

    expect(await submitAndReadBack(page, task)).toBe(picked);
  });

  test('mouse: picks a 24h option from the list', async ({
    page,
    workViewPage,
    settingsPage,
  }) => {
    const task = await setUp(page, workViewPage, settingsPage, 'mouse task 8565');
    const dialog = await openScheduleDialog(page, task);
    await pickTomorrow(dialog);

    await page.locator(TIME_INPUT).click();
    const option = page.locator('mat-option').filter({ hasText: /^\s*15:00\s*$/ });
    await option.scrollIntoViewIfNeeded();
    await option.click();
    await expect(page.locator(TIME_INPUT)).toHaveValue('15:00');

    expect(await submitAndReadBack(page, task)).toBe('15:00');
  });

  test('clears a mistyped time on blur', async ({ page, workViewPage, settingsPage }) => {
    const task = await setUp(page, workViewPage, settingsPage, 'bad task 8565');
    const dialog = await openScheduleDialog(page, task);
    await pickTomorrow(dialog);

    const input = page.locator(TIME_INPUT);
    await focusWithListClosed(page, input);
    await input.fill('');
    await input.pressSequentially('25');
    await page.keyboard.press('Tab');
    await expect(input).toHaveValue('');
    await expect(dialog).toBeVisible();
  });

  test('settings: the work day start field takes 24h input', async ({
    page,
    workViewPage,
    settingsPage,
  }) => {
    await workViewPage.waitForTaskList();
    await selectDateTimeLocale(page, settingsPage, /ISO 8601/);
    const section = '.section-schedule';
    await page.goto('/#/config?tab=2');
    await page.locator(`${section} collapsible`).waitFor({ state: 'visible' });
    await settingsPage.expandSection(section);

    const input = page.locator(`${section} input.mat-timepicker-input`).first();
    await expect(input).toHaveValue(NO_AM_PM);
    // typed fast: the saved "18" can echo back while "183" is in the field
    // (timing-dependent here; input-time-formly.component.spec.ts pins it)
    await input.fill('');
    await input.pressSequentially('1830');
    await input.blur();
    await expect(input).toHaveValue('18:30');
    await waitForStatePersistence(page);

    await page.reload();
    await page.locator(`${section} collapsible`).waitFor({ state: 'visible' });
    await settingsPage.expandSection(section);
    await expect(
      page.locator(`${section} input.mat-timepicker-input`).first(),
    ).toHaveValue('18:30');
  });

  test('System default on a 12h browser keeps the native time input', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    const title = 'native task 8565';
    await workViewPage.addTask(title);
    const task = page.locator('task').filter({ hasText: title }).first();
    await openScheduleDialog(page, task);
    await expect(page.locator(TIME_INPUT)).toHaveAttribute('type', 'time');
  });
});

test.describe('24h datetime locale on a 12h touch device (#8565)', () => {
  test.use({ hasTouch: true });

  test('touch: taps a 24h option from the list', async ({
    page,
    workViewPage,
    settingsPage,
  }) => {
    const task = await setUp(page, workViewPage, settingsPage, 'touch task 8565');
    const dialog = await openScheduleDialog(page, task);
    await pickTomorrow(dialog);

    await page.locator(TIME_INPUT).tap();
    const option = page.locator('mat-option').filter({ hasText: /^\s*16:30\s*$/ });
    await option.scrollIntoViewIfNeeded();
    await option.tap();
    await expect(page.locator(TIME_INPUT)).toHaveValue('16:30');

    expect(await submitAndReadBack(page, task)).toBe('16:30');
  });
});

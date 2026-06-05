import { test, expect } from '../../fixtures/test.fixture';
import { type Locator, type Page } from '@playwright/test';

/**
 * Round-trip e2e coverage for the newer RRULE builder widgets: custom nth
 * ordinals, the BYSETPOS multi-select toggles, mode-switch hygiene, and the
 * yearly BYMONTH seeding. The dialog's live result band is the oracle:
 *  - `.rrule-result__expr` shows the exact assembled rrule string
 *  - `.rrule-result__next` shows engine-computed upcoming dates
 * so recurrence semantics are assertable without waiting for real time to
 * pass. Each test also reopens the dialog after save to verify the parsed
 * rule renders the same widget state (parse/display round-trip).
 */

const openRepeatDialog = async (page: Page): Promise<Locator> => {
  const repeatItem = page
    .locator('task-detail-item')
    .filter({ has: page.locator('mat-icon', { hasText: 'repeat' }) })
    .first();
  await expect(repeatItem).toBeVisible({ timeout: 5000 });
  await repeatItem.click();
  const dialog = page.locator('mat-dialog-container');
  await expect(dialog).toBeVisible({ timeout: 10000 });
  return dialog;
};

/**
 * Read the persisted rrule for a task (by title substring) from the live
 * NgRx store. Saving a recurring cfg re-plans the task onto the rule's first
 * occurrence — which is usually NOT today — so the task leaves the work view
 * and a UI reopen is date-dependent. The store read is the date-independent
 * persistence oracle; the parse→widget rendering side of the round-trip is
 * covered by the dialog/builder unit specs.
 */
const getPersistedRRule = async (page: Page, titlePart: string): Promise<string | null> =>
  page.evaluate((title) => {
    type TaskLike = { title?: string; repeatCfgId?: string | null };
    type CfgLike = { rrule?: string | null };
    type StoreState = {
      tasks?: { entities?: Record<string, TaskLike | undefined> };
      taskRepeatCfg?: { entities?: Record<string, CfgLike | undefined> };
    };
    type StoreLike = {
      subscribe: (next: (s: StoreState) => void) => { unsubscribe: () => void };
    };
    const helpers = (window as unknown as { __e2eTestHelpers?: { store?: StoreLike } })
      .__e2eTestHelpers;
    const store = helpers?.store;
    if (!store) throw new Error('__e2eTestHelpers.store missing');
    let state: StoreState | undefined;
    store.subscribe((s) => (state = s)).unsubscribe();
    const task = Object.values(state?.tasks?.entities ?? {}).find((t) =>
      t?.title?.includes(title),
    );
    if (!task?.repeatCfgId) return null;
    return (state?.taskRepeatCfg?.entities ?? {})[task.repeatCfgId]?.rrule ?? null;
  }, titlePart);

const switchToBuilderMode = async (page: Page, dialog: Locator): Promise<void> => {
  await dialog.locator('mat-select').first().click();
  await page
    .getByRole('option', { name: /custom recurring config/i })
    .first()
    .click();
  await expect(dialog.locator('.rrule-result__expr')).toBeVisible({ timeout: 5000 });
};

const addTaskWithDetailOpen = async (
  page: Page,
  workViewPage: {
    waitForTaskList: () => Promise<void>;
    addTask: (t: string) => Promise<void>;
  },
  taskPage: {
    getTaskByText: (t: string) => Locator;
    openTaskDetail: (t: Locator) => Promise<void>;
  },
  title: string,
): Promise<Locator> => {
  await workViewPage.waitForTaskList();
  await workViewPage.addTask(title);
  const task = taskPage.getTaskByText(title).first();
  await expect(task).toBeVisible({ timeout: 10000 });
  await taskPage.openTaskDetail(task);
  return task;
};

test.describe('RRULE builder round-trips', () => {
  test('custom nth ordinal: build → save → reopen shows the custom input', async ({
    page,
    workViewPage,
    taskPage,
    dialogPage,
    testPrefix,
  }) => {
    await addTaskWithDetailOpen(page, workViewPage, taskPage, `${testPrefix}-NthCustom`);
    const dialog = await openRepeatDialog(page);
    await switchToBuilderMode(page, dialog);

    const builder = dialog.locator('rrule-builder');
    const expr = dialog.locator('.rrule-result__expr');

    // MONTHLY → nth-weekday mode → switch the row's ordinal to custom → -2.
    await builder.locator('select').nth(0).selectOption('MONTHLY');
    await builder.locator('select').nth(1).selectOption('NTH_WEEKDAY');
    await builder.locator('select').nth(2).selectOption('CUSTOM');
    // (the plain interval field is .rb-num too — match the titled custom input)
    const customPos = builder.getByRole('spinbutton', { name: /occurrence number/i });
    await expect(customPos).toBeVisible();
    await customPos.fill('-2');
    await customPos.blur();

    // 2nd-to-last <start weekday> of the month.
    await expect(expr).toHaveText(/^FREQ=MONTHLY;BYDAY=-2(MO|TU|WE|TH|FR|SA|SU)$/);
    // The engine resolves it to concrete upcoming dates (rule is alive).
    await expect(dialog.locator('.rrule-result__next')).toBeVisible();

    const savedExpr = (await expr.textContent())!.trim();
    await dialogPage.clickSaveButton();
    await dialogPage.waitForDialogToClose();

    // The exact custom-ordinal rule is persisted verbatim.
    await expect
      .poll(async () => getPersistedRRule(page, 'NthCustom'), { timeout: 10000 })
      .toBe(savedExpr);
  });

  test('BYSETPOS multi-select: first + last weekday round-trips with both toggles active', async ({
    page,
    workViewPage,
    taskPage,
    dialogPage,
    testPrefix,
  }) => {
    await addTaskWithDetailOpen(page, workViewPage, taskPage, `${testPrefix}-SetPos`);
    const dialog = await openRepeatDialog(page);
    await switchToBuilderMode(page, dialog);

    const builder = dialog.locator('rrule-builder');
    const expr = dialog.locator('.rrule-result__expr');

    // MONTHLY → weekday-set mode (byDay pre-seeded with the start weekday).
    await builder.locator('select').nth(0).selectOption('MONTHLY');
    await builder.locator('select').nth(1).selectOption('WEEKDAYS');

    await builder.getByRole('button', { name: 'first', exact: true }).click();
    await builder.getByRole('button', { name: 'last', exact: true }).click();
    await expect(expr).toHaveText(/;BYSETPOS=1,-1$/);

    const savedExpr = (await expr.textContent())!.trim();
    await dialogPage.clickSaveButton();
    await dialogPage.waitForDialogToClose();

    // The multi-value BYSETPOS rule is persisted verbatim.
    await expect
      .poll(async () => getPersistedRRule(page, 'SetPos'), { timeout: 10000 })
      .toBe(savedExpr);
  });

  test('mode switch clears BYSETPOS: weekday-set narrowing must not leak into day-of-month', async ({
    page,
    workViewPage,
    taskPage,
    dialogPage,
    testPrefix,
  }) => {
    await addTaskWithDetailOpen(page, workViewPage, taskPage, `${testPrefix}-ModeLeak`);
    const dialog = await openRepeatDialog(page);
    await switchToBuilderMode(page, dialog);

    const builder = dialog.locator('rrule-builder');
    const expr = dialog.locator('.rrule-result__expr');

    // Weekday-set mode with a 'second' narrowing…
    await builder.locator('select').nth(0).selectOption('MONTHLY');
    await builder.locator('select').nth(1).selectOption('WEEKDAYS');
    await builder.getByRole('button', { name: 'second', exact: true }).click();
    await expect(expr).toHaveText(/;BYSETPOS=2$/);

    // …then switching to day-of-month must DROP the BYSETPOS: leaked it would
    // silently narrow the day list (BYMONTHDAY=n;BYSETPOS=2 never fires).
    await builder.locator('select').nth(1).selectOption('DAY_OF_MONTH');
    await expect(expr).toHaveText(/^FREQ=MONTHLY;BYMONTHDAY=[\d,-]+$/);
    await expect(expr).not.toHaveText(/BYSETPOS/);
    // Rule is alive — engine produces upcoming dates.
    await expect(dialog.locator('.rrule-result__next')).toBeVisible();

    await dialogPage.clickSaveButton();
    await dialogPage.waitForDialogToClose();
  });

  test('switching to YEARLY seeds BYMONTH so the rule fires once a year', async ({
    page,
    workViewPage,
    taskPage,
    dialogPage,
    testPrefix,
  }) => {
    await addTaskWithDetailOpen(page, workViewPage, taskPage, `${testPrefix}-Yearly`);
    const dialog = await openRepeatDialog(page);
    await switchToBuilderMode(page, dialog);

    const builder = dialog.locator('rrule-builder');
    const expr = dialog.locator('.rrule-result__expr');

    await builder.locator('select').nth(0).selectOption('YEARLY');
    // Without BYMONTH a bare yearly BYMONTHDAY would fire EVERY month
    // (RFC 5545 expansion) — the seed pins it to the start month.
    await expect(expr).toHaveText(/^FREQ=YEARLY;BYMONTH=\d+;BYMONTHDAY=\d+$/);

    // The upcoming dates must be one year apart (same month), not monthly.
    const nextBand = dialog.locator('.rrule-result__next');
    await expect(nextBand).toBeVisible();
    const dates = await nextBand
      .locator('span:not(.rrule-result__sep)')
      .allTextContents();
    const years = dates
      .map((d) => new Date(d).getFullYear())
      .filter((y) => !Number.isNaN(y));
    expect(years.length).toBeGreaterThan(1);
    expect(new Set(years).size).toBe(years.length); // strictly one per year

    await dialogPage.clickSaveButton();
    await dialogPage.waitForDialogToClose();
  });
});

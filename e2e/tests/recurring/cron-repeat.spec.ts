import { test, expect } from '../../fixtures/test.fixture';
import { type Page } from '@playwright/test';

// Loosely matches a 5-7 field cron expression (standard or Quartz dialect).
const CRON_RE = /^[\d*?/,\-A-Z]+( [\d*?/,\-A-Z]+){4,6}$/i;

type RepeatSnapshot = {
  taskTitle: string;
  repeatCfgId: string | null;
  repeatCycle: string | null;
  cronExpression: string | null;
  lastTaskCreationDay: string | null;
};

// Reads the live NgRx store via the e2e helper to inspect the repeat cfg
// attached to a task (matched by a substring of its title).
const getRepeatCfgForTask = async (
  page: Page,
  titlePart: string,
): Promise<RepeatSnapshot | null> =>
  page.evaluate((title) => {
    type TaskLike = { title?: string; repeatCfgId?: string | null };
    type CfgLike = {
      repeatCycle?: string;
      cronExpression?: string | null;
      lastTaskCreationDay?: string | null;
    };
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
    if (!task) return null;
    const cfg = task.repeatCfgId
      ? (state?.taskRepeatCfg?.entities ?? {})[task.repeatCfgId]
      : undefined;
    return {
      taskTitle: task.title ?? '',
      repeatCfgId: task.repeatCfgId ?? null,
      repeatCycle: cfg?.repeatCycle ?? null,
      cronExpression: cfg?.cronExpression ?? null,
      lastTaskCreationDay: cfg?.lastTaskCreationDay ?? null,
    };
  }, titlePart);

const addTaskRaw = async (page: Page, rawInput: string): Promise<void> => {
  const input = page.locator('add-task-bar.global input').first();
  const visible = await input.isVisible().catch(() => false);
  if (!visible) await page.locator('.tour-addBtn').click();
  await input.waitFor({ state: 'visible', timeout: 10000 });
  await input.click();
  await input.clear();
  await input.fill(rawInput);
  // The add bar parses input asynchronously (a microtask via shortSyntax), so
  // cleanText / cronExpression land a tick after fill. A DOM round-trip plus a
  // short settle lets that complete before submit — otherwise the raw, unparsed
  // title is used (mirrors BasePage.addTask, which round-trips via count()).
  await page.locator('task').count();
  await page.waitForTimeout(500);
  await page.locator('.e2e-add-task-submit').click();
};

// Creates a task, opens its repeat-config dialog, switches the quick-setting to
// CRON, and returns the dialog + cron input locators.
const openRepeatCronDialog = async (
  page: Page,
  workViewPage: { addTask: (t: string) => Promise<void> },
  taskPage: {
    getTaskByText: (t: string) => { first: () => ReturnType<Page['locator']> };
    openTaskDetail: (t: ReturnType<Page['locator']>) => Promise<void>;
  },
  title: string,
): Promise<{
  dialog: ReturnType<Page['locator']>;
  cronInput: ReturnType<Page['locator']>;
}> => {
  await workViewPage.addTask(title);
  const task = taskPage.getTaskByText(title).first();
  await expect(task).toBeVisible({ timeout: 10000 });
  await taskPage.openTaskDetail(task);
  const repeatItem = page
    .locator('task-detail-item')
    .filter({ has: page.locator('mat-icon', { hasText: 'repeat' }) })
    .first();
  await expect(repeatItem).toBeVisible({ timeout: 5000 });
  await repeatItem.click();
  const dialog = page.locator('mat-dialog-container');
  await expect(dialog).toBeVisible({ timeout: 10000 });
  // CRON lives inside "Custom recurring config": pick Custom, then set the
  // repeatCycle dropdown to "Cron".
  await dialog.locator('mat-select').first().click();
  await page
    .getByRole('option', { name: /custom/i })
    .first()
    .click();
  await dialog.locator('mat-select').nth(1).click();
  await page
    .getByRole('option', { name: /^cron$/i })
    .first()
    .click();
  const cronInput = dialog.locator('input[id*="cronExpression"]').first();
  await expect(cronInput).toBeVisible({ timeout: 5000 });
  return { dialog, cronInput };
};

test.describe('Cron / natural-language recurring tasks', () => {
  test('attaches a CRON repeat cfg via the @+ short syntax', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();

    const title = `${testPrefix}-Mow Lawn`;
    await addTaskRaw(page, `${title} @+every monday`);

    // Verify via the store, not the Today view: a non-daily schedule's first
    // instance can be a future day (e.g. `every monday` when today is not a
    // Monday), so the task legitimately won't appear in Today on most days.
    // A CRON repeat cfg with a runnable cron expression must be attached, and
    // the @+ clause stripped from the stored title.
    await expect
      .poll(async () => (await getRepeatCfgForTask(page, title))?.repeatCycle ?? null, {
        timeout: 10000,
      })
      .toBe('CRON');

    const snap = await getRepeatCfgForTask(page, title);
    expect(snap).not.toBeNull();
    expect(snap!.taskTitle).not.toContain('@+');
    expect(snap!.repeatCfgId).not.toBeNull();
    expect(snap!.cronExpression ?? '').toMatch(CRON_RE);
  });

  test('full dialog flow: phrase → live preview → save → cron cfg created', async ({
    page,
    workViewPage,
    taskPage,
    dialogPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();

    const title = `${testPrefix}-Water Plants`;
    await workViewPage.addTask(title);
    const task = taskPage.getTaskByText(title).first();
    await expect(task).toBeVisible({ timeout: 10000 });

    // Open the task detail panel and trigger the repeat-config editor.
    await taskPage.openTaskDetail(task);
    const repeatItem = page
      .locator('task-detail-item')
      .filter({ has: page.locator('mat-icon', { hasText: 'repeat' }) })
      .first();
    await expect(repeatItem).toBeVisible({ timeout: 5000 });
    await repeatItem.click();

    const dialog = page.locator('mat-dialog-container');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // CRON lives inside "Custom recurring config": pick Custom, then set the
    // repeatCycle dropdown to "Cron".
    await dialog.locator('mat-select').first().click();
    await page
      .getByRole('option', { name: /custom/i })
      .first()
      .click();
    await dialog.locator('mat-select').nth(1).click();
    await page
      .getByRole('option', { name: /^cron$/i })
      .first()
      .click();

    // Type a natural-language phrase; the field accepts cron or English.
    const cronInput = dialog.locator('input[id*="cronExpression"]').first();
    await expect(cronInput).toBeVisible({ timeout: 5000 });
    await cronInput.fill('every monday at 9am');

    // The live preview below the field shows the interpreted cron, its
    // humanized reading, and the time-of-day-ignored warning.
    const preview = dialog.locator('.cron-preview');
    await expect(preview).toBeVisible({ timeout: 5000 });
    await expect(preview).toContainText(/Monday/i);
    await expect(preview.locator('.cron-preview__warn')).toContainText(
      /time of day is ignored/i,
    );

    await dialogPage.clickSaveButton();
    await dialogPage.waitForDialogToClose();

    // A CRON cfg with a runnable cron expression is persisted for the task.
    await expect
      .poll(async () => (await getRepeatCfgForTask(page, title))?.repeatCycle ?? null, {
        timeout: 10000,
      })
      .toBe('CRON');
    const snap = await getRepeatCfgForTask(page, title);
    expect(snap!.cronExpression ?? '').toMatch(CRON_RE);
  });

  test('invalid phrase blocks save and shows an inline error', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const title = `${testPrefix}-Bad Cron`;
    const { dialog, cronInput } = await openRepeatCronDialog(
      page,
      workViewPage,
      taskPage,
      title,
    );

    await cronInput.fill('blargle nonsense not a schedule');
    await cronInput.blur();

    // No live preview for unrecognized input.
    await expect(dialog.locator('.cron-preview')).toHaveCount(0);
    // Inline validator error is shown.
    await expect(dialog.locator('mat-error')).toBeVisible({ timeout: 5000 });
    // Save is disabled (form invalid) → the schedule cannot be saved.
    await expect(dialog.locator('button[type="submit"]')).toBeDisabled();
    // Dialog stays open; no cron cfg persisted.
    await expect(dialog).toBeVisible();
    expect((await getRepeatCfgForTask(page, title))?.repeatCfgId ?? null).toBeNull();
  });

  test('raw cron expression: preview + save', async ({
    page,
    workViewPage,
    taskPage,
    dialogPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const title = `${testPrefix}-Raw Cron`;
    const { dialog, cronInput } = await openRepeatCronDialog(
      page,
      workViewPage,
      taskPage,
      title,
    );

    await cronInput.fill('0 9 * * 1');
    const preview = dialog.locator('.cron-preview');
    await expect(preview).toBeVisible({ timeout: 5000 });
    await expect(preview).toContainText('0 9 * * 1');
    await expect(preview).toContainText(/Monday/i);

    await dialogPage.clickSaveButton();
    await dialogPage.waitForDialogToClose();

    await expect
      .poll(
        async () => (await getRepeatCfgForTask(page, title))?.cronExpression ?? null,
        {
          timeout: 10000,
        },
      )
      .toBe('0 9 * * 1');
  });

  test('jumpDay fast-forward creates the next daily instance (live day-change path)', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    await page.waitForFunction(
      () =>
        !!(window as unknown as { __e2eTestHelpers?: { jumpDay?: unknown } })
          .__e2eTestHelpers?.jumpDay,
      undefined,
      { timeout: 10000 },
    );

    const title = `${testPrefix}-Daily Cron`;
    await addTaskRaw(page, `${title} @+every day`);

    // Wait until the CRON cfg exists and record the day its first instance was created.
    await expect
      .poll(async () => (await getRepeatCfgForTask(page, title))?.repeatCycle ?? null, {
        timeout: 10000,
      })
      .toBe('CRON');
    const before = await getRepeatCfgForTask(page, title);
    expect(before!.lastTaskCreationDay).not.toBeNull();

    // Fast-forward a day: Date.now() shifts, the day-change effect runs
    // addAllDueToday(), and the next instance is created (lastTaskCreationDay
    // advances). This exercises the real live day-change → creation path.
    await page.evaluate(() =>
      (
        window as unknown as { __e2eTestHelpers: { jumpDay: (n?: number) => string } }
      ).__e2eTestHelpers.jumpDay(1),
    );

    await expect
      .poll(
        async () => (await getRepeatCfgForTask(page, title))?.lastTaskCreationDay ?? null,
        { timeout: 15000 },
      )
      .not.toBe(before!.lastTaskCreationDay);
  });
});

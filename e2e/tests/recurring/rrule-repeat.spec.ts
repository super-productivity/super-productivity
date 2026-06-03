import { test, expect } from '../../fixtures/test.fixture';
import { type Page } from '@playwright/test';

type RepeatSnapshot = {
  taskTitle: string;
  repeatCfgId: string | null;
  repeatCycle: string | null;
  rrule: string | null;
};

// Reads the live NgRx store via the e2e helper to inspect the repeat cfg
// attached to a task (matched by a substring of its title).
const getRepeatCfgForTask = async (
  page: Page,
  titlePart: string,
): Promise<RepeatSnapshot | null> =>
  page.evaluate((title) => {
    type TaskLike = { title?: string; repeatCfgId?: string | null };
    type CfgLike = { repeatCycle?: string; rrule?: string | null };
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
      rrule: cfg?.rrule ?? null,
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
  // The add bar parses input asynchronously (shortSyntax microtask), so the
  // cleanText / rrule land a tick after fill. A DOM round-trip plus a short
  // settle lets that complete before submit.
  await page.locator('task').count();
  await page.waitForTimeout(500);
  await page.locator('.e2e-add-task-submit').click();
};

test.describe('RRULE recurring tasks', () => {
  test('attaches an rrule repeat cfg via the @+ short syntax', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();

    const title = `${testPrefix}-Mow Lawn`;
    await addTaskRaw(page, `${title} @+every monday`);

    // Verify via the store, not the Today view: "every monday" first instance
    // can be a future day, so the task legitimately may not appear in Today.
    await expect
      .poll(async () => (await getRepeatCfgForTask(page, title))?.rrule ?? null, {
        timeout: 10000,
      })
      .toBe('FREQ=WEEKLY;BYDAY=MO');

    const snap = await getRepeatCfgForTask(page, title);
    expect(snap).not.toBeNull();
    expect(snap!.taskTitle).not.toContain('@+');
    expect(snap!.repeatCfgId).not.toBeNull();
    // Legacy repeatCycle kept populated (FREQ-derived) for older-client fallback.
    expect(snap!.repeatCycle).toBe('WEEKLY');
  });

  test('full dialog flow: Custom recurring config builder → live preview → save', async ({
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

    await taskPage.openTaskDetail(task);
    const repeatItem = page
      .locator('task-detail-item')
      .filter({ has: page.locator('mat-icon', { hasText: 'repeat' }) })
      .first();
    await expect(repeatItem).toBeVisible({ timeout: 5000 });
    await repeatItem.click();

    const dialog = page.locator('mat-dialog-container');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Pick the "Custom recurring config" quick setting → the dropdown builder appears.
    await dialog.locator('mat-select').first().click();
    await page
      .getByRole('option', { name: /custom recurring config/i })
      .first()
      .click();

    // The live preview shows the humanized reading of the assembled rule.
    const preview = dialog.locator('.rb-preview');
    await expect(preview).toBeVisible({ timeout: 5000 });
    await expect(preview).toContainText(/week/i);

    await dialogPage.clickSaveButton();
    await dialogPage.waitForDialogToClose();

    // An rrule-backed cfg is persisted, with a FREQ-derived legacy repeatCycle.
    await expect
      .poll(async () => (await getRepeatCfgForTask(page, title))?.rrule ?? null, {
        timeout: 10000,
      })
      .toMatch(/^FREQ=WEEKLY/);
    const snap = await getRepeatCfgForTask(page, title);
    expect(snap!.repeatCycle).toBe('WEEKLY');
  });
});

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

// NOTE: the `@+` natural-language short syntax is deferred to a later phase
// (see the EPIC on #7948); its e2e coverage will return with that phase. This
// file now only exercises the Phase-1 dialog builder flow.

test.describe('RRULE recurring tasks', () => {
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

    // The live result band (pinned above the actions in RRULE mode) shows the
    // humanized reading of the assembled rule.
    const preview = dialog.locator('.rrule-result');
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

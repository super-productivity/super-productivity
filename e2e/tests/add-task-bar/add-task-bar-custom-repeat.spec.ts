import { type Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';
import { ensureGlobalAddTaskBarOpen } from '../../utils/element-helpers';

const ADD_TASK_BAR = 'add-task-bar.global';
const ADD_TASK_INPUT = `${ADD_TASK_BAR} input`;
const REPEAT_BUTTON = `${ADD_TASK_BAR} [data-test="add-task-bar-repeat-btn"]`;

/** Read the persisted rrule for a task (by title substring) from the store. */
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

test.describe('Add Task Bar custom recurring option', () => {
  // Regression: the menu emits the 'RRULE' quick-setting value, but the
  // add-task-bar used to branch on the legacy 'CUSTOM' value only — picking
  // "Custom recurring config" then silently created a weekly-fallback cfg
  // instead of opening the repeat dialog.
  test('picking "Custom recurring config" opens the repeat dialog after task creation', async ({
    page,
    workViewPage,
    dialogPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    await ensureGlobalAddTaskBarOpen(page);

    const title = `${testPrefix}-CustomRepeat`;
    const input = page.locator(ADD_TASK_INPUT).first();
    await input.fill(title);

    // Pick "Custom recurring config" from the repeat menu.
    const repeatBtn = page.locator(REPEAT_BUTTON).first();
    await repeatBtn.waitFor({ state: 'visible', timeout: 10000 });
    await repeatBtn.click();
    await page
      .getByRole('menuitem', { name: /custom recurring config/i })
      .first()
      .click();

    // Submit the task → the full repeat dialog must open for it.
    await input.press('Enter');
    const dialog = page.locator('mat-dialog-container');
    await expect(dialog).toBeVisible({ timeout: 10000 });
    await expect(dialog.locator('dialog-edit-task-repeat-cfg')).toBeVisible();

    // Builder mode is preselected for the custom option; the live result band
    // shows an assembled rule which saves as the task's rrule.
    const expr = dialog.locator('.rrule-result__expr');
    await expect(expr).toBeVisible({ timeout: 5000 });
    const builtRule = (await expr.textContent())!.trim();
    expect(builtRule).toMatch(/^FREQ=/);

    await dialogPage.clickSaveButton();
    await dialogPage.waitForDialogToClose();

    await expect
      .poll(async () => getPersistedRRule(page, 'CustomRepeat'), { timeout: 10000 })
      .toBe(builtRule);
  });
});

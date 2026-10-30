import { expect, test } from '../../fixtures/test.fixture';
import { type Locator, type Page } from '@playwright/test';
import {
  openRecurDialog,
  setRecurQuickSetting,
} from '../../utils/recurring-task-helpers';

/**
 * Repeat dialog regressions found in the UX review of the dialog rework:
 * - Enter on the read-only "Start date" field submitted the surrounding form,
 *   saving the config and closing the dialog.
 * - For a new config, "If you fall behind" follows the schedule's default until
 *   the user picks a choice. A detour through a monthly pattern stopped that,
 *   so a new every-day config was saved as "Keep every copy".
 */

const DIALOG = 'mat-dialog-container:has(dialog-edit-task-repeat-cfg)';

const pickInField = async (
  page: Page,
  dialog: Locator,
  fieldLabel: RegExp,
  option: RegExp,
): Promise<void> => {
  await dialog
    .locator('mat-form-field')
    .filter({ hasText: fieldLabel })
    .locator('mat-select')
    .click();
  await page.locator('mat-option').filter({ hasText: option }).first().click();
};

const readStoredSkipOverdue = async (
  page: Page,
  title: string,
): Promise<boolean | undefined | null> =>
  page.evaluate((taskTitle: string) => {
    type CfgLike = { title?: string | null; skipOverdue?: boolean };
    type StoreLike = {
      subscribe: (
        next: (s: { taskRepeatCfg?: { entities?: Record<string, CfgLike> } }) => void,
      ) => { unsubscribe: () => void };
    };
    const store = (window as unknown as { __e2eTestHelpers?: { store?: StoreLike } })
      .__e2eTestHelpers?.store;
    if (!store) {
      throw new Error('__e2eTestHelpers.store missing');
    }
    let cfg: CfgLike | undefined | null = null;
    store
      .subscribe((s) => {
        cfg = Object.values(s.taskRepeatCfg?.entities ?? {}).find((c) =>
          c?.title?.includes(taskTitle),
        );
      })
      .unsubscribe();
    return cfg ? (cfg as CfgLike).skipOverdue : null;
  }, title);

test.describe('Recurring task - repeat dialog start date and fall-behind default', () => {
  test('Enter on the start date opens the schedule dialog and keeps the repeat dialog open', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    const taskTitle = `${testPrefix}-EnterStartDate`;
    await workViewPage.waitForTaskList();
    await workViewPage.addTask(taskTitle);
    const task = taskPage.getTaskByText(taskTitle).first();
    await expect(task).toBeVisible({ timeout: 10000 });
    await taskPage.openTaskDetail(task);
    const dialog = await openRecurDialog(page);

    // The schedule dialog the repeat dialog was opened from is still open.
    const scheduleDialogs = page.locator('dialog-schedule-task');
    const before = await scheduleDialogs.count();
    // The dialog moves focus to its first field once it has opened; focus the
    // start date only after that, or Enter lands in another field.
    await page.waitForFunction(() =>
      document.getAnimations().every((a) => a.playState !== 'running'),
    );
    const startDate = dialog.locator('.planned-date-val');
    await startDate.focus();
    await expect(startDate).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(scheduleDialogs).toHaveCount(before + 1);
    await expect(page.locator(DIALOG)).toBeVisible();
    expect(await readStoredSkipOverdue(page, taskTitle)).toBeNull();
  });

  test('a new config keeps following the schedule default after a monthly detour', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    const taskTitle = `${testPrefix}-FallBehindDefault`;
    await workViewPage.waitForTaskList();
    await workViewPage.addTask(taskTitle);
    const task = taskPage.getTaskByText(taskTitle).first();
    await expect(task).toBeVisible({ timeout: 10000 });
    await taskPage.openTaskDetail(task);
    const dialog = await openRecurDialog(page);

    await setRecurQuickSetting(page, /Custom…/i);
    // "If you fall behind" is rendered (and can emit) once Options is open.
    await dialog
      .locator('collapsible')
      .filter({ hasText: /^\s*Options/ })
      .first()
      .click();
    const fallBehind = dialog
      .locator('mat-form-field')
      .filter({ hasText: /If you fall behind/i });
    await expect(fallBehind).toBeVisible();

    await pickInField(page, dialog, /Unit/i, /^\s*Day\s*$/);
    await expect(fallBehind).toContainText(/Only keep the latest/i);

    await pickInField(page, dialog, /Unit/i, /^\s*Month\s*$/);
    await expect(fallBehind).toContainText(/Keep every copy/i);
    await pickInField(page, dialog, /Monthly pattern/i, /^\s*last\s*$/);

    await pickInField(page, dialog, /Unit/i, /^\s*Day\s*$/);
    await expect(fallBehind).toContainText(/Only keep the latest/i);
    await expect(dialog.locator('.rule-summary')).not.toContainText(/keeps every copy/i);

    await dialog.getByRole('button', { name: /Save/i }).click();
    await expect(page.locator(DIALOG)).toHaveCount(0);
    await expect.poll(() => readStoredSkipOverdue(page, taskTitle)).toBe(true);
  });
});

import { test, expect } from '../../fixtures/test.fixture';
import { Locator, Page } from '@playwright/test';

/**
 * Real-DOM verification for the Flowtime break-settings preservation fix
 * (issue #7581). Drives the actual `mat-select` and number inputs in the
 * running app — the unit specs use `setValue`, this proves the real dialog.
 */

const openFlowtimeDialog = async (page: Page): Promise<void> => {
  const mainFocusButton = page
    .getByRole('button')
    .filter({ hasText: 'center_focus_strong' });
  await mainFocusButton.click();
  await expect(page.locator('focus-mode-overlay')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('focus-mode-main')).toBeVisible({ timeout: 5000 });

  await page.locator('segmented-button-group button', { hasText: 'Flowtime' }).click();

  await page.locator('focus-mode-main .mode-settings-btn').click();
  await expect(page.locator('dialog-flowtime-settings')).toBeVisible({ timeout: 5000 });
};

const selectBreakMode = async (page: Page, label: string): Promise<void> => {
  await page.locator('dialog-flowtime-settings mat-select').click();
  await page.locator('mat-option', { hasText: label }).click();
  // mat-option overlay closes
  await expect(page.locator('mat-option')).toHaveCount(0);
};

// The three rule number inputs in render order: min, max, break. Scoped to the
// rule section so the ratio-mode percentage input is not matched.
const ruleInputs = (page: Page): Locator =>
  page.locator('dialog-flowtime-settings .flowtime-break-rules input[type="number"]');

test.describe('Flowtime settings preservation (#7581)', () => {
  test.beforeEach(async ({ page, workViewPage }) => {
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('FlowtimeTest sd:today');

    const firstTask = page.locator('task').first();
    await expect(firstTask).toBeVisible();
    await firstTask.hover();
    const playBtn = page.locator('.play-btn.tour-playBtn').first();
    await playBtn.waitFor({ state: 'visible' });
    await playBtn.click();
    await expect(firstTask).toHaveClass(/isCurrent/, { timeout: 5000 });
  });

  test('rule values survive a real Rule -> Ratio -> Rule switch', async ({ page }) => {
    await openFlowtimeDialog(page);

    // Enable breaks so the mode-dependent fields render.
    await page
      .locator('dialog-flowtime-settings mat-checkbox', { hasText: 'Enable' })
      .click();

    await selectBreakMode(page, 'Rule-based');
    await expect(ruleInputs(page)).toHaveCount(3);

    // Edit the seeded rule to non-default values so we prove real edits survive.
    await ruleInputs(page).nth(1).fill('40'); // max
    await ruleInputs(page).nth(2).fill('12'); // break
    await expect(ruleInputs(page).nth(0)).toHaveValue('0');

    // Round-trip through ratio mode.
    await selectBreakMode(page, 'Ratio-based');
    await expect(ruleInputs(page)).toHaveCount(0); // rules hidden in ratio mode
    await selectBreakMode(page, 'Rule-based');

    // The edited values must still be there.
    await expect(ruleInputs(page)).toHaveCount(3);
    await expect(ruleInputs(page).nth(0)).toHaveValue('0');
    await expect(ruleInputs(page).nth(1)).toHaveValue('40');
    await expect(ruleInputs(page).nth(2)).toHaveValue('12');
  });

  test('a field can be cleared after a mode switch (no cache snap-back)', async ({
    page,
  }) => {
    await openFlowtimeDialog(page);
    await page
      .locator('dialog-flowtime-settings mat-checkbox', { hasText: 'Enable' })
      .click();
    await selectBreakMode(page, 'Rule-based');
    await selectBreakMode(page, 'Ratio-based');
    await selectBreakMode(page, 'Rule-based');

    // Clear the Min field by selecting all + delete, as a user would.
    const minInput = ruleInputs(page).nth(0);
    await minInput.click();
    await minInput.press('ControlOrMeta+a');
    await minInput.press('Backspace');

    await expect(minInput).toHaveValue('');
  });
});

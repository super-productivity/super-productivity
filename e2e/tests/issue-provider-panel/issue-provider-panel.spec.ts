import { expect, test } from '../../fixtures/test.fixture';
import { expectNoGlobalError } from '../../utils/assertions';

const PANEL_BTN = '.e2e-toggle-issue-provider-panel';

test.describe('Issue Provider Panel', () => {
  test('should open all dialogs without error', async ({ page, workViewPage }) => {
    // Wait for work view to be ready
    await workViewPage.waitForTaskList();

    await page.waitForSelector(PANEL_BTN, { state: 'visible' });
    await page.click(PANEL_BTN);
    await page.waitForSelector('mat-tab-group', { state: 'visible' });
    // Click on the last tab (add tab) which contains the issue-provider-setup-overview
    await page.click('mat-tab-group .mat-mdc-tab:last-child');
    await page.waitForSelector('issue-provider-setup-overview', { state: 'visible' });

    // Wait for buttons to be ready
    await page
      .locator('issue-provider-setup-overview button')
      .first()
      .waitFor({ state: 'visible', timeout: 5000 });

    // Start capturing page errors only after the panel is settled so we don't
    // pick up unrelated startup noise (vite overlay, lazy-chunk warnings, etc.)
    // that the surrounding suite tolerates.
    const pageErrors: string[] = [];
    const onPageError = (error: Error): void => {
      pageErrors.push(error.message);
    };
    page.on('pageerror', onPageError);

    // Get all buttons in the issue provider setup overview
    const setupButtons = page.locator('issue-provider-setup-overview button');
    const buttonCount = await setupButtons.count();
    expect(buttonCount).toBeGreaterThan(0);

    // Click each button and close the dialog
    let openedDialogCount = 0;
    for (let i = 0; i < buttonCount; i++) {
      const button = setupButtons.nth(i);

      await expect(button).toBeVisible();
      await expect(button).toBeEnabled();
      await button.click();

      // Wait for dialog to open
      const dialogContainer = page.locator('mat-dialog-container');
      await expect(dialogContainer).toBeVisible({ timeout: 5000 });
      openedDialogCount++;

      // Close the dialog from within the dialog container.
      const cancelBtn = dialogContainer.locator('mat-dialog-actions button').first();
      await expect(cancelBtn).toBeVisible({ timeout: 5000 });
      await cancelBtn.click();

      // Wait for dialog to close
      await expect(dialogContainer).toBeHidden({ timeout: 5000 });

      // Ensure we're back on the issue provider panel
      await expect(page.locator('issue-provider-setup-overview')).toBeVisible({
        timeout: 3000,
      });
    }

    expect(openedDialogCount).toBe(buttonCount);
    page.off('pageerror', onPageError);
    await expectNoGlobalError(page);
    expect(pageErrors).toEqual([]);
  });
});
